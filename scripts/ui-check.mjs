// Production UI against a disposable real server, including empty admin views.
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { chromium, expect as baseExpect } from 'playwright/test';
const expect = baseExpect.configure({ timeout: 10000 });
const { buildApp } = await import('../../server/dist/app.js');
const { openDatabase } = await import('../../server/dist/db/connection.js');
const { runMigrations } = await import('../../server/dist/db/migrate.js');
const { createAgent } = await import('../../server/dist/agents/repository.js');
const { createConversation } = await import('../../server/dist/conversations/repository.js');
const { createProviderConfig } = await import('../../server/dist/providers/repository.js');
const { createMessage } = await import('../../server/dist/messages/repository.js');
const directory = mkdtempSync(join(tmpdir(), 'crewly-ui-'));
const screenshots = process.env.CREWLY_UI_SCREENSHOTS;
if (screenshots) mkdirSync(screenshots, { recursive: true });
let app, db, browser;
const errors = [];
try {
  db = openDatabase(directory); runMigrations(db);
  app = await buildApp({ db, webDir: resolve('dist'), respond: async () => ({ body: 'Here is the next useful step.\n\n- Confirm the goal\n- Try the smallest working version\n- Review the result' }) });
  const setup = await app.inject({ method: 'POST', url: '/api/v1/auth/setup', payload: { email: 'ui@example.test', displayName: 'Alex', password: 'ui-test-password' } });
  if (setup.statusCode !== 201) throw new Error(`Setup: ${setup.statusCode}`);
  const { token, user } = setup.json();
  const ownerId = user?.id ?? db.prepare('SELECT id FROM users LIMIT 1').get().id;
  createProviderConfig(db, { id: 'fixture', kind: 'openai-compatible', apiKey: 'fixture', baseUrl: 'https://example.test/v1' });
  const agents = ['Assistant', 'Writing partner', 'Reviewer'].map(name => createAgent(db, { ownerUserId: ownerId, name,
    personality: 'Help turn work into a concrete result.', modelPolicy: { defaultProviderId: 'fixture', defaultModel: 'test-model' }, permissions: { tools: [], canMessageAgents: true, canApproveOwnActions: false } }));
  const rooms = agents.slice(0, 2).map(agent => createConversation(db, { kind: 'dm', name: null, participants: [{ participantId: ownerId, participantType: 'user' }, { participantId: agent.id, participantType: 'agent' }] }));
  const root = createMessage(db, { conversationId: rooms[0].id, authorId: ownerId, authorType: 'user', body: 'Help me prepare the next release.', mentions: [], replyToMessageId: null });
  createMessage(db, { conversationId: rooms[0].id, authorId: agents[0].id, authorType: 'agent', body: '## A clear plan\n\nStart with the flow people use every day.\n\n1. Make conversations reliable.\n2. Keep the next action obvious.\n3. Check the phone layout.\n\n| Check | Result |\n| --- | --- |\n| Sign in | Ready |\n| Send a message | Ready |\n\n```sh\ndocker compose up -d\n```', mentions: [], replyToMessageId: root.id });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Europe/Warsaw' });
  await context.addInitScript(token => localStorage.setItem('crewly:session', token), token);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const shot = async name => { if (screenshots) await page.screenshot({ path: join(screenshots, `${name}.png`), fullPage: true }); };
  await page.goto(base); await expect(page.getByRole('textbox', { name: 'Message Assistant', exact: true })).toBeVisible();
  await shot('chat-desktop');
  app.hub.publish(`conversation:${rooms[0].id}`, 'message.created', { id: 'malformed', body: { invalid: true } });
  await expect(page.getByRole('alert').filter({ hasText: 'A live message could not be loaded' })).toBeVisible();
  const recovered = createMessage(db, { conversationId: rooms[0].id, authorId: agents[0].id, authorType: 'agent', body: 'Live updates still work after a malformed message.', mentions: [], replyToMessageId: null });
  app.hub.publish(`conversation:${rooms[0].id}`, 'message.created', { ...recovered });
  await expect(page.getByText(recovered.body, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Scheduled tasks', exact: true }).click();
  await page.getByRole('button', { name: 'Proactive follow-ups', exact: true }).click();
  await shot('schedule-desktop');
  await page.getByRole('button', { name: 'Close scheduled tasks' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const nav = page.getByLabel('Settings sections');
  const sections = await nav.getByRole('button').allTextContents();
  for (const label of sections.filter(label => label.trim() && !label.includes('Log out'))) {
    await nav.getByRole('button', { name: label.trim(), exact: true }).click();
    await page.waitForTimeout(100);
    if (errors.length) throw new Error(`Settings ${label}: ${errors.join('; ')}`);
  }
  await nav.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search settings' }).fill('provider');
  await expect(nav.getByRole('button', { name: 'People', exact: true })).toHaveCount(0);
  await expect(nav.getByRole('button', { name: 'AI providers', exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search settings' }).fill('');
  await shot('settings-desktop');
  await page.route('**/api/v1/users', route => route.request().method() === 'GET' ? route.fulfill({ json: null }) : route.continue());
  await nav.getByRole('button', { name: 'People', exact: true }).click();
  await expect(page.getByText('This settings section could not be displayed', { exact: true })).toBeVisible();
  await nav.getByRole('button', { name: 'Appearance', exact: true }).click();
  await expect(page.getByText('Color theme', { exact: true })).toBeVisible();
  await page.unroute('**/api/v1/users');
  await page.keyboard.press('Escape');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await shot('chat-dark');
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByRole('textbox', { name: 'Message Assistant', exact: true })).toBeVisible();
    await shot(`chat-${width}`);
    await page.getByRole('button', { name: 'Scheduled tasks', exact: true }).click();
    await page.getByRole('button', { name: 'Proactive follow-ups', exact: true }).click();
    await shot(`schedule-${width}`);
    await expect(page.getByRole('button', { name: 'Save schedule', exact: true })).toBeInViewport();
    await page.setViewportSize({ width, height: 520 });
    await expect(page.getByRole('button', { name: 'Save schedule', exact: true })).toBeInViewport();
    await page.setViewportSize({ width, height: 844 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    if (overflow) throw new Error(`Horizontal page overflow at ${width}px`);
    await page.keyboard.press('Escape');
  }
  if (errors.length) throw new Error(errors.join('; '));
  console.log(`PASS: populated chat, malformed live message recovery, ${sections.length - 1} settings sections, settings search/error isolation, visible save actions at 768/390/320px and 520px height; no page errors`);
} finally {
  await browser?.close(); await app?.close(); db?.close(); rmSync(directory, { recursive: true, force: true });
}
