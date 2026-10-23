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
process.env.CREWLY_ALLOW_PRIVATE_NETWORK = 'true';
const directory = mkdtempSync(join(tmpdir(), 'crewly-release-'));
let browser, app, db;
const errors = [];
const provider = createServer(async (request, response) => {
  if (request.url === '/v1/models') { response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'release-test-model' }] })); return; }
  if (request.url !== '/v1/chat/completions') { response.writeHead(404).end(); return; }
  const chunks = []; for await (const chunk of request) chunks.push(chunk);
  const { messages } = JSON.parse(Buffer.concat(chunks).toString());
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
  await page.getByRole('button', { name: 'Scheduled tasks', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('Release check reminder', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close scheduled tasks' }).click();
  await runDueSchedules({ db, hub: app.hub, respond: async () => ({ body: 'unused' }) }, new Date(Date.now() + 660000));
  await expect(page.getByText('Your reminder arrived.', { exact: true })).toBeVisible();
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
  console.log('PASS: production bundle → setup → provider → assistant → reply → reload → attached file tool → scheduled delivery → mobile 390/320px → logout/login; no page errors');
} finally {
  await browser?.close(); await app?.close(); db?.close();
  await new Promise(resolve => provider.close(resolve));
  rmSync(directory, { recursive: true, force: true });
}
