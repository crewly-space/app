import { createServer, type Server } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { afterEach, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

/*
 * This is an end-to-end test: it renders the real UI against a real server.
 * The server lives in the crewly-server repository, so this needs a sibling
 * checkout that has been built. CI clones and builds it. Without one the test
 * skips rather than failing, so a fresh clone is not red for a missing
 * dependency it never asked for.
 */
const serverDist = new URL('../../server/dist/', import.meta.url);
const hasServer = existsSync(fileURLToPath(new URL('app.js', serverDist)));
if (!hasServer) {
  console.warn('p0-ui: ../server/dist not found - skipping. Build the sibling to run it.');
}
const { buildApp } = hasServer ? await import(new URL('app.js', serverDist).href) : ({} as any);
const { openDatabase } = hasServer ? await import(new URL('db/connection.js', serverDist).href) : ({} as any);
const { runDueSchedules } = hasServer ? await import(new URL('automations/service.js', serverDist).href) : ({} as any);
const { runMigrations } = hasServer ? await import(new URL('db/migrate.js', serverDist).href) : ({} as any);

let provider: Server | undefined;
let server: Awaited<ReturnType<typeof buildApp>> | undefined;
let db: ReturnType<typeof openDatabase> | undefined;
let dataDir: string | undefined;
let dom: JSDOM | undefined;
let cleanupUi: (() => void) | undefined;
afterEach(async () => {
  cleanupUi?.(); cleanupUi = undefined;
  await server?.close();
  server = undefined;
  await new Promise<void>((resolve) => provider?.close(() => resolve()) ?? resolve());
  provider = undefined;
  db?.close();
  db = undefined;
  dom?.window.close();
  dom = undefined;
  if (dataDir) rmSync(dataDir, { recursive: true, force: true }); dataDir = undefined;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.skipIf(!hasServer)('renders the authenticated provider-backed DM and restores its reply after remount', async () => {
  // The fake provider listens on loopback, which only a self-hosted server may reach.
  vi.stubEnv('CREWLY_ALLOW_PRIVATE_NETWORK', 'true');
  vi.stubEnv('VITE_CREWLY_CLOUD_URL', '');
  provider = createServer(async (req, res) => {
    if (req.url !== '/v1/chat/completions') { res.writeHead(404).end(); return; }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const messages = JSON.parse(Buffer.concat(chunks).toString()).messages as { role: string; content: string }[];
    const latest = messages.at(-1)!;
    const message = latest.role === 'tool' ? { content: 'Reminder saved.' } : latest.content.includes('Remind me')
      ? { content: null, tool_calls: [{ id: 'schedule', type: 'function', function: { name: 'schedule_message', arguments: JSON.stringify({ name: 'Take a break', runAt: new Date(Date.now() + 600_000).toISOString(), body: 'Time for your break.' }) } }] }
      : { content: `Provider says: ${latest.content}` };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message, finish_reason: 'tool_calls' in message ? 'tool_calls' : 'stop' }] }));
  });
  await new Promise<void>((resolve) => provider!.listen(0, '127.0.0.1', resolve));
  const providerAddress = provider.address();
  if (!providerAddress || typeof providerAddress === 'string') throw new Error('provider address');
  dataDir = mkdtempSync(join(tmpdir(), 'crewly-app-ui-'));
  db = openDatabase(dataDir); runMigrations(db);
  server = await buildApp({ db, setupClaimToken: 'test-claim-token' });
  await server.listen({ port: 0, host: '127.0.0.1' });
  const serverAddress = server.server.address();
  if (!serverAddress || typeof serverAddress === 'string') throw new Error('server address');
  dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>',
    { url: `http://127.0.0.1:${serverAddress.port}/`, pretendToBeVisual: true });
  const win = dom.window;
  Object.defineProperty(win, 'matchMedia', { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
  Object.defineProperty(win.HTMLElement.prototype, 'scrollIntoView', { value() {} });
  vi.stubGlobal('window', win); vi.stubGlobal('document', win.document);
  vi.stubGlobal('navigator', win.navigator); vi.stubGlobal('localStorage', win.localStorage);
  vi.stubGlobal('HTMLElement', win.HTMLElement); vi.stubGlobal('HTMLDivElement', win.HTMLDivElement);
  vi.stubGlobal('Node', win.Node); vi.stubGlobal('Text', win.Text);
  vi.stubGlobal('MutationObserver', win.MutationObserver); vi.stubGlobal('WebSocket', WebSocket);
  vi.resetModules();
  const { default: App } = await import('../src/App');
  const { AuthGate } = await import('../src/features/auth/AuthGate');
  const { render, fireEvent, within, waitFor, cleanup, act } = await import('@testing-library/react');
  cleanupUi = cleanup;
  const React = await import('react');
  const UI = () => React.createElement(AuthGate, null, React.createElement(App));
  const page = within(win.document.body);
  const view = render(React.createElement(UI), { container: win.document.getElementById('root')! });
  await page.findByRole('heading', { name: 'Create your workspace' });
  fireEvent.change(page.getByLabelText('Name'), { target: { value: 'Owner' } });
  fireEvent.change(page.getByLabelText('Email'), { target: { value: 'owner@example.test' } });
  fireEvent.change(page.getByLabelText('Password'), { target: { value: 'test-password-1' } });
  fireEvent.change(page.getByLabelText(/Server setup code/), { target: { value: 'test-claim-token' } });
  fireEvent.click(page.getByRole('button', { name: 'Create workspace' }));
  await page.findByRole('heading', { name: 'Meet your assistant' }, { timeout: 15000 });
  expect(win.localStorage.getItem('crewly:session')).toBeTruthy();
  // First run goes straight from a model connection to a working conversation.
  expect(page.queryByRole('button', { name: "Let's set it up" })).toBeNull();
  fireEvent.click(page.getByRole('button', { name: 'Connect a model provider' }));
  await page.findByRole('heading', { name: 'Connect a model provider' });
  fireEvent.click(page.getByRole('listitem', { name: 'Custom endpoint' }));
  // The first connection of a kind is named after it; the name is asked for
  // only when that kind is already connected.
  expect(page.queryByLabelText(/^Connection name/)).toBeNull();
  fireEvent.change(page.getByLabelText(/^API key/), { target: { value: 'test-key' } });
  fireEvent.change(page.getByLabelText(/Base URL/), { target: { value: `http://127.0.0.1:${providerAddress.port}/v1` } });
  fireEvent.click(page.getByRole('button', { name: 'Connect Custom endpoint' }));
  await page.findByRole('heading', { name: 'Meet your assistant' });
  fireEvent.change(page.getByRole('textbox', { name: 'Assistant name' }), { target: { value: 'Echo' } });
  fireEvent.click(await page.findByRole('button', { name: /Enter a model ID instead/ }));
  fireEvent.change(page.getByRole('textbox', { name: /Model ID/ }), { target: { value: 'test-model' } });
  fireEvent.click(page.getByRole('button', { name: 'Start chatting' }));
  const composer = await page.findByRole('textbox', { name: 'Message Echo' });
  Object.defineProperty(composer, 'innerText', { configurable: true, value: 'Hello' });
  fireEvent.input(composer);
  await waitFor(() => expect(page.getByRole('button', { name: 'Send message' }).hasAttribute('disabled')).toBe(false));
  fireEvent.click(page.getByRole('button', { name: 'Send message' }));
  await page.findByText('Provider says: Hello');
  view.unmount();
  const refreshedRoot = win.document.createElement('div');
  win.document.body.appendChild(refreshedRoot);
  const refreshedView = render(React.createElement(UI), { container: refreshedRoot });
  await page.findByText('Provider says: Hello');
  expect(db.prepare('SELECT COUNT(*) AS n FROM messages').get()).toEqual({ n: 2 });
  // The model calls the real scheduling tool; the UI reads persisted results,
  // and a scheduler tick delivers into the live chat.
  const refreshedComposer = await page.findByRole('textbox', { name: 'Message Echo' });
  const sendReminder = async () => {
    Object.defineProperty(refreshedComposer, 'innerText', { configurable: true, value: 'Remind me in 10 minutes to take a break.' });
    fireEvent.input(refreshedComposer);
    fireEvent.click(page.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(db.prepare('SELECT COUNT(*) AS n FROM automations').get()).toEqual({ n: 1 }));
    await page.findByText('Reminder saved.');
  };
  await sendReminder();
  fireEvent.click(page.getByRole('button', { name: 'Scheduled tasks' }));
  const tasks = within(await page.findByRole('dialog', { name: 'Your scheduled tasks' }));
  await tasks.findByText('Take a break');
  expect(tasks.getByText('Time for your break.')).toBeTruthy();
  fireEvent.click(tasks.getByRole('button', { name: 'Close scheduled tasks' }));
  await act(async () => { await runDueSchedules({ db, hub: server!.hub, respond: async () => ({ body: 'unused' }) }, new Date(Date.now() + 660_000)); });
  await page.findByText('Time for your break.');
  expect(page.queryByText('Direct message', { exact: true })).toBeNull();
  fireEvent.click(page.getByRole('button', { name: 'Scheduled tasks' }));
  const completed = within(await page.findByRole('dialog', { name: 'Your scheduled tasks' }));
  fireEvent.click(await completed.findByText('Completed and cancelled (1)'));
  await completed.findByText('Completed', { exact: true });
  fireEvent.click(completed.getByRole('button', { name: 'Close scheduled tasks' }));


  fireEvent.click(page.getByRole('button', { name: 'Settings' }));
  fireEvent.click(page.getByRole('button', { name: 'People' }));
  fireEvent.click(await page.findByRole('button', { name: 'Invite' }));
  const inviteDialog = within(page.getByRole('dialog', { name: 'Invite a person' }));
  expect(inviteDialog.queryByLabelText(/password/i)).toBeNull();
  fireEvent.change(inviteDialog.getByLabelText(/^Email/), { target: { value: 'sam@example.test' } });
  fireEvent.click(inviteDialog.getByRole('button', { name: 'Send invite' }));
  const inviteUrl = (await inviteDialog.findByRole('textbox', { name: 'Invite link' })).getAttribute('value')!;
  expect(inviteUrl).toMatch(/\/join#invite=/);
  fireEvent.click(inviteDialog.getByRole('button', { name: 'Done' }));
  expect(await page.findByText('sam@example.test')).toBeTruthy();
  expect(page.getByText('Pending')).toBeTruthy();
  expect(db.prepare('SELECT COUNT(*) AS n FROM users WHERE email = ?').get('sam@example.test')).toEqual({ n: 0 });

  fireEvent.click(page.getByRole('button', { name: 'AI providers' }));
  fireEvent.click(await page.findByRole('button', { name: 'Manage' }));
  fireEvent.change(page.getByLabelText('New API key'), { target: { value: 'rotated-test-key' } });
  fireEvent.click(page.getByRole('button', { name: 'Rotate credential' }));
  await page.findByText('Provider credentials updated.');
  const stored = db.prepare('SELECT api_key FROM provider_configs WHERE id = ?').get('openai-compatible') as { api_key: string };
  expect(stored.api_key).toMatch(/^enc:v1:/);
  expect(stored.api_key).not.toContain('rotated-test-key');

  fireEvent.click(page.getByRole('button', { name: 'Manage' }));
  fireEvent.click(page.getByRole('button', { name: 'Remove provider' }));
  await page.findByText('1 agent use this provider and will stop replying until reconfigured.');
  fireEvent.click(page.getByRole('button', { name: 'Keep provider' }));

  // Your avatar is yours, stored on the server, the same for everyone.
  fireEvent.click(page.getByRole('button', { name: 'Appearance' }));
  fireEvent.click(page.getByRole('radio', { name: /Name icon/ }));
  await waitFor(() => expect(db.prepare('SELECT avatar_mode FROM users WHERE email = ?').get('owner@example.test'))
    .toEqual({ avatar_mode: 'name' }));

  const publicKey = randomBytes(32);
  const deviceId = `dev_${createHash('sha256').update(publicKey).digest('hex').slice(0, 20)}`;
  const pairingResponse = await fetch(`http://127.0.0.1:${serverAddress.port}/api/v1/devices/pairings`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId, deviceName: 'Work laptop', publicKey: publicKey.toString('base64').replace(/=+$/, ''), platform: 'linux/amd64' }),
  });
  expect(pairingResponse.status).toBe(201);
  const pairing = await pairingResponse.json() as { userCode: string };
  fireEvent.click(page.getByRole('button', { name: 'Devices' }));
  fireEvent.change(page.getByLabelText('Pairing code'), { target: { value: pairing.userCode } });
  fireEvent.click(page.getByRole('button', { name: 'Continue' }));
  await page.findByText('Work laptop');
  fireEvent.click(page.getByRole('button', { name: 'Approve device' }));
  await page.findByText('Device paired. It can now connect securely.');
  expect(db.prepare('SELECT id, name FROM devices WHERE id = ?').get(deviceId)).toEqual({ id: deviceId, name: 'Work laptop' });
  refreshedView.unmount();

  // Sam opens the link signed out and joins with a password only Sam knows.
  const { clearToken } = await import('../src/lib/api/client');
  vi.stubGlobal('Event', win.Event);
  clearToken();
  win.history.replaceState(null, '', new URL(inviteUrl).pathname + new URL(inviteUrl).hash);
  const joinRoot = win.document.createElement('div');
  win.document.body.appendChild(joinRoot);
  const joinView = render(React.createElement(UI), { container: joinRoot });
  await page.findByRole('heading', { name: 'You’re invited' });
  expect((page.getByLabelText('Email') as HTMLInputElement).value).toBe('sam@example.test');
  fireEvent.change(page.getByLabelText('Name'), { target: { value: 'Sam' } });
  fireEvent.change(page.getByLabelText('Password'), { target: { value: 'sams-own-password-1' } });
  fireEvent.click(page.getByRole('button', { name: 'Create account and join' }));
  await waitFor(() => expect(win.location.pathname).toBe('/'), { timeout: 10_000 });
  expect(db.prepare('SELECT email, role FROM users WHERE email = ?').get('sam@example.test')).toEqual({ email: 'sam@example.test', role: 'member' });
  expect(db.prepare('SELECT used_at IS NOT NULL AS used FROM invites').get()).toEqual({ used: 1 });
  // A joined member must reach messaging even though the owner's private
  // memory and configuration are not readable by that member.
  expect((await page.findAllByRole('button', { name: 'New message' }, { timeout: 5000 })).length).toBeGreaterThan(0);
  expect(page.queryByRole('button', { name: 'Try again' })).toBeNull();
  await waitFor(() => expect(page.queryByText('Reconnecting live updates…')).toBeNull());
  await act(async () => { joinView.unmount(); await new Promise<void>((resolve) => setImmediate(resolve)); });
}, 60_000);
