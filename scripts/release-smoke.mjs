// Exercise the production bundle, real API, persistence, model tools and mobile
// layout in Chromium. The loopback provider is deterministic and costs nothing.
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect as baseExpect } from 'playwright/test';
const expect = baseExpect.configure({ timeout: 15000 });
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { buildApp } = await import('../../server/dist/app.js');
const { openDatabase } = await import('../../server/dist/db/connection.js');
const { runMigrations } = await import('../../server/dist/db/migrate.js');
const { runDueSchedules } = await import('../../server/dist/automations/service.js');
const { createProviderRespond } = await import('../../server/dist/providers/respond.js');
const { createAgent } = await import('../../server/dist/agents/repository.js');
const { delegationToolset } = await import('../../server/dist/runtime/delegation.js');
process.env.CREWLY_ALLOW_PRIVATE_NETWORK = 'true';
const directory = mkdtempSync(join(tmpdir(), 'crewly-release-'));
let browser, app, db;
let releaseConsultation;
const errors = [];
const proactiveRequests = [];
const provider = createServer(async (request, response) => {
  if (request.url === '/v1/models') { response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'release-test-model' }] })); return; }
  if (request.url !== '/v1/chat/completions') { response.writeHead(404).end(); return; }
  const chunks = []; for await (const chunk of request) chunks.push(chunk);
  const { messages, tools } = JSON.parse(Buffer.concat(chunks).toString());
  if (messages.some(message => message.role === 'system' && message.content.includes('This is a background review'))) {
    proactiveRequests.push({ tools });
    const message = messages.at(-1).role === 'tool' ? { content: 'Next step for your release: verify the deployment backup.' }
      : { content: null, tool_calls: [{ id: 'consult-release', type: 'function', function: { name: 'delegate_to_agent', arguments: JSON.stringify({ agent: 'Release reviewer', task: 'Suggest one concrete deployment check before the release.' }) } }] };
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] }));
    return;
  }
  if (messages.some(message => message.role === 'system' && message.content.includes('Another agent requested your expertise during a proactive review'))) {
    proactiveRequests.push({ tools, consultation: true });
    releaseConsultation = () => response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: 'Verify the deployment backup by restoring it into a fresh test instance.' }, finish_reason: 'stop' }] }));
    return;
  }
  const latest = messages.at(-1);
  const file = latest.role === 'user' && String(latest.content).includes('Read the attached file')
    ? JSON.parse(String(latest.content).split('metadata only; use an available tool to read contents):\n')[1])[0] : null;
  const message = file ? { content: null, tool_calls: [{ id: 'read', type: 'function', function: { name: 'read_attachment', arguments: JSON.stringify({ id: file.id }) } }] }
    : latest.role === 'tool' ? { content: String(latest.content).includes('release-file-content') ? 'I read release-file-content from your file.' : 'Reminder saved.' } : String(latest.content).includes('Remind me')
    ? { content: null, tool_calls: [{ id: 'schedule', type: 'function', function: { name: 'schedule_message', arguments: JSON.stringify({ name: 'Release check reminder', runAt: new Date(Date.now() + 600000).toISOString(), body: 'Your reminder arrived.' }) } }] }
    : { content: `Release reply: ${latest.content}` };
  response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] }));
});
try {
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  db = openDatabase(directory); runMigrations(db);
  app = await buildApp({ db, attachmentDir: join(directory, 'attachments'), webDir: resolve(root, 'dist'), setupClaimToken: 'release-test-setup-code' });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.getByLabel('Name', { exact: true }).fill('Release owner');
  await page.getByLabel('Email', { exact: true }).fill('release@example.test');
  await page.getByLabel('Password', { exact: true }).fill('release-test-password');
  await page.getByLabel(/Server setup code/).fill('release-test-setup-code');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.getByRole('button', { name: 'Connect a model provider' }).click();
  await page.getByRole('listitem', { name: 'Custom endpoint' }).click();
  await page.getByLabel(/^API key/).fill('test-key');
  await page.getByLabel(/Base URL/).fill(`http://127.0.0.1:${provider.address().port}/v1`);
  await page.getByRole('button', { name: 'Connect Custom endpoint' }).click();
  await page.getByLabel('Assistant name').fill('Release assistant');
  await page.getByRole('button', { name: 'Start chatting' }).click();
  const composer = page.getByRole('textbox', { name: 'Message Release assistant', exact: true });
  async function send(text) { await composer.fill(text); await page.getByRole('button', { name: 'Send message', exact: true }).click(); }
  await send('Hello release');
  await expect(page.getByText('Release reply: Hello release', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Release reply: Hello release', { exact: true })).toBeVisible();
  await page.getByLabel('Choose attachments').setInputFiles({ name: 'release.txt', mimeType: 'text/plain', buffer: Buffer.from('release-file-content') });
  await expect(page.getByLabel('Pending attachments').getByText('release.txt')).toBeVisible();
  await send('Read the attached file');
  await expect(page.getByText('I read release-file-content from your file.', { exact: true })).toBeVisible();
  await send('Remind me in 10 minutes to check the release.');
  await expect(page.getByText('Reminder saved.', { exact: true })).toBeVisible();
  const lead = db.prepare('SELECT owner_user_id, model_policy FROM agents LIMIT 1').get();
  createAgent(db, { ownerUserId: lead.owner_user_id, name: 'Release reviewer', personality: 'Review release plans and suggest a concrete check.',
    modelPolicy: JSON.parse(lead.model_policy), permissions: { tools: [], canMessageAgents: true, canApproveOwnActions: false } });
  await page.reload();
  await page.getByRole('button', { name: 'Scheduled tasks', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('Release check reminder', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New reminder' }).click();
  await page.getByLabel('Task name', { exact: true }).fill('Reminder from the form');
  await page.getByLabel('Reminder message').fill('Saved without asking a model.');
  await page.getByRole('button', { name: 'Save schedule' }).click();
  await expect(page.getByRole('dialog').getByText('Reminder from the form', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Proactive follow-ups', exact: true }).click();
  await expect(page.getByLabel('Repeat')).toHaveValue('1440');
  await expect(page.getByText(/Checks at most once per 24 hours/)).toBeVisible();
  const savedFollowup = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/scheduled-tasks'));
  await page.getByRole('button', { name: 'Save schedule' }).click();
  const followupResponse = await savedFollowup;
  if (followupResponse.status() !== 201) throw new Error(`Follow-up save failed: ${followupResponse.status()} ${await followupResponse.text()}`);
  await expect(page.getByRole('dialog').getByText('Proactive follow-ups · enabled', { exact: true })).toBeVisible();
  const followup = db.prepare("SELECT trigger_config FROM automations WHERE name = 'Proactive follow-ups'").get();
  const followupConfig = JSON.parse(followup.trigger_config);
  if (!followupConfig.proactive || !followupConfig.timeZone || followupConfig.intervalMinutes !== 1440) throw new Error('Proactive controls did not persist');
  await page.getByRole('button', { name: 'Close scheduled tasks' }).click();
  // Let the real responder review a settled conversation, regardless of the
  // runner's clock/time zone. No real provider credentials or paid calls.
  const reviewTime = new Date(); reviewTime.setUTCHours(12, 0, 0, 0);
  const originalNow = Date.now;
  const delegation = delegationToolset({ db, hub: app.hub, status: app.agentStatus, queue: app.runQueue, respond: () => reviewRespond });
  const reviewRespond = createProviderRespond(db, fetch, undefined, { proactiveToolsets: [delegation] });
  let review;
  try {
    Date.now = () => reviewTime.getTime();
    db.prepare('UPDATE messages SET created_at = ?').run(new Date(reviewTime.getTime() - 40 * 60000).toISOString());
    db.prepare("UPDATE automations SET trigger_config = ? WHERE name = 'Proactive follow-ups'")
      .run(JSON.stringify({ ...followupConfig, timeZone: 'UTC', runAt: new Date(reviewTime.getTime() - 60000).toISOString() }));
    review = runDueSchedules({ db, hub: app.hub, respond: reviewRespond }, reviewTime);
  } finally { Date.now = originalNow; }
  await expect(page.getByText('Release assistant is consulting Release reviewer…', { exact: true })).toBeVisible();
  await expect.poll(() => typeof releaseConsultation).toBe('function');
  releaseConsultation(); releaseConsultation = undefined;
  await review;
  await expect(page.getByText('Release assistant is consulting Release reviewer…', { exact: true })).toHaveCount(0);
  if (proactiveRequests.length !== 3 || proactiveRequests.some(request => request.consultation && request.tools)
    || proactiveRequests.some(request => request.tools?.some(tool => tool.function.name !== 'delegate_to_agent'))) throw new Error('Proactive collaboration must offer only delegation to the lead and no tools to the teammate');
  await page.getByRole('button', { name: 'Scheduled tasks', exact: true }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close scheduled tasks' }).click();
  await expect(page.getByText('Next step for your release: verify the deployment backup.', { exact: true })).toBeVisible();
  await runDueSchedules({ db, hub: app.hub, respond: async () => ({ body: 'unused' }) }, new Date(Date.now() + 660000));
  await expect(page.getByText('Your reminder arrived.', { exact: true })).toBeVisible();
  await expect(page.getByText('Saved without asking a model.', { exact: true })).toBeVisible();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(composer).toBeVisible();
    // A responsive drawer animates off-screen after changing the viewport.
    // Wait for the settled layout, then prove the composer is actionable.
    await expect.poll(() => page.locator('.sidebar').evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
    await composer.click();
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('complementary').getByRole('button', { name: 'Close navigation' }).click();
    await expect.poll(() => page.locator('.sidebar').evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
    if (width === 390) {
      await page.getByRole('button', { name: 'Scheduled tasks', exact: true }).click();
      await page.getByRole('button', { name: 'Daily priorities' }).click();
      await page.getByLabel('Task name', { exact: true }).fill('Phone recurring task');
      await page.getByRole('button', { name: 'Save schedule' }).click();
      const item = page.getByRole('listitem').filter({ hasText: 'Phone recurring task' });
      await expect(item).toBeVisible();
      await item.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(item.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: 'Close scheduled tasks' }).click();
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    if (overflow) throw new Error(`Horizontal overflow at ${width}px`);
    await page.screenshot({ path: join(directory, `mobile-${width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Settings sections').getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Log in to Crewly' })).toBeVisible();
  await page.getByLabel('Email', { exact: true }).fill('release@example.test');
  await page.getByLabel('Password', { exact: true }).fill('release-test-password');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByText('Release reply: Hello release', { exact: true })).toBeVisible();
  if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
  console.log('PASS: production bundle → setup → provider → assistant → reply → reload → attached file tool → proactive consultation, live status and combined result → scheduled delivery → mobile 390/320px → logout/login; no page errors');
} finally {
  releaseConsultation?.();
  await browser?.close(); await app?.close(); db?.close();
  await new Promise(resolve => provider.close(resolve));
  rmSync(directory, { recursive: true, force: true });
}
