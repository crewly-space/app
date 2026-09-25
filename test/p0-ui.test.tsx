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
const { runMigrations } = hasServer ? await import(new URL('db/migrate.js', serverDist).href) : ({} as any);

let provider: Server | undefined;
let server: Awaited<ReturnType<typeof buildApp>> | undefined;
let db: ReturnType<typeof openDatabase> | undefined;
let dataDir: string | undefined;
let dom: JSDOM | undefined;
afterEach(async () => {
  await server?.close();
  await new Promise<void>((resolve) => provider?.close(() => resolve()) ?? resolve());
  db?.close();
  dom?.window.close();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

it.skipIf(!hasServer)('renders the authenticated provider-backed DM and restores its reply after remount', async () => {
  provider = createServer(async (req, res) => {
    if (req.url !== '/v1/chat/completions') { res.writeHead(404).end(); return; }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const messages = JSON.parse(Buffer.concat(chunks).toString()).messages as { content: string }[];
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: `Provider says: ${messages.at(-1)?.content}` }, finish_reason: 'stop' }] }));
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
  const { render, fireEvent, within, waitFor } = await import('@testing-library/react');
  const React = await import('react');
  const UI = () => React.createElement(AuthGate, null, React.createElement(App));
  const page = within(win.document.body);
  const view = render(React.createElement(UI), { container: win.document.getElementById('root')! });
  await page.findByRole('heading', { name: 'Create first admin' });
  fireEvent.change(page.getByLabelText('Name'), { target: { value: 'Owner' } });
  fireEvent.change(page.getByLabelText('Email'), { target: { value: 'owner@example.test' } });
  fireEvent.change(page.getByLabelText('Password'), { target: { value: 'test-password-1' } });
  fireEvent.change(page.getByLabelText(/Claim token/), { target: { value: 'test-claim-token' } });
  fireEvent.click(page.getByRole('button', { name: 'Create admin' }));
  // First run offers the provider first, but it is not a gate: skipping lands
  // on the empty server, and the provider is connected from Settings like any
  // other.
  await page.findByRole('heading', { name: 'Connect a model provider' });
  expect(win.localStorage.getItem('crewly:session')).toBeTruthy();
  fireEvent.click(page.getByRole('button', { name: 'Skip for now' }));
  // A new server opens on #general, so skipping setup lands in a channel with
  // a composer rather than on an empty page (CRE-114).
  await page.findByRole('heading', { name: '# general' });
  expect(page.getByRole('combobox', { name: 'Message general' })).toBeTruthy();
  expect(page.queryByText('Groups')).toBeNull();
  expect(page.getByRole('button', { name: 'Create channel' })).toBeTruthy();
  expect(page.queryByRole('dialog', { name: 'Create an agent' })).toBeNull();
  fireEvent.click(page.getByRole('button', { name: 'Settings' }));
  fireEvent.click(await page.findByRole('button', { name: 'Providers' }));
  fireEvent.click(page.getByRole('button', { name: 'Add' }));
  await page.findByRole('heading', { name: 'Connect a model provider' });
  fireEvent.change(page.getByLabelText('Provider'), { target: { value: 'openai-compatible' } });
  // The provider ID defaults to the provider kind and only appears once the
  // second-account disclosure is opened.
  fireEvent.click(page.getByRole('button', { name: /Connecting another/ }));
  // The label wraps a hint, so its text is not exactly "Provider ID".
  fireEvent.change(await page.findByLabelText(/Provider ID/), { target: { value: 'mock' } });
  fireEvent.change(page.getByLabelText('API key'), { target: { value: 'test-key' } });
  fireEvent.change(page.getByLabelText(/Base URL/), { target: { value: `http://127.0.0.1:${providerAddress.port}/v1` } });
  fireEvent.click(page.getByRole('button', { name: 'Save provider' }));
  await page.findByText('Provider saved.');
  fireEvent.click(page.getByRole('button', { name: 'Close settings' }));
  // With a provider connected, first run moves on to the agent step by itself.
  const dialog = within(await page.findByRole('dialog', { name: 'Create an agent' }));
  fireEvent.change(dialog.getByRole('textbox', { name: /Name/ }), { target: { value: 'Echo' } });
  fireEvent.change(dialog.getByRole('textbox', { name: /Role/ }), { target: { value: 'Assistant' } });
  // The mock provider has no /models, so the picker says so and typing an id
  // is an explicit choice rather than the default.
  fireEvent.click(await dialog.findByRole('button', { name: /Enter a model ID instead/ }));
  fireEvent.change(dialog.getByRole('textbox', { name: /Model ID/ }), { target: { value: 'test-model' } });
  fireEvent.click(dialog.getByRole('button', { name: /Create agent/ }));
  const composer = await page.findByRole('combobox', { name: 'Message Echo' });
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

  fireEvent.click(page.getByRole('button', { name: 'Settings' }));
  fireEvent.click(page.getByRole('button', { name: 'People' }));
  // Invite-first: the admin names the person and their role, never a password
  // (CRE-112). Mail is off on this test server, so the link is the handover.
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

  fireEvent.click(page.getByRole('button', { name: 'Providers' }));
  fireEvent.click(await page.findByRole('button', { name: 'Manage' }));
  fireEvent.change(page.getByLabelText('New API key'), { target: { value: 'rotated-test-key' } });
  fireEvent.click(page.getByRole('button', { name: 'Rotate credential' }));
  await page.findByText('Provider credentials updated.');
  const stored = db.prepare('SELECT api_key FROM provider_configs WHERE id = ?').get('mock') as { api_key: string };
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
  await waitFor(() => expect(win.location.pathname).toBe('/'));
  expect(db.prepare('SELECT email, role FROM users WHERE email = ?').get('sam@example.test')).toEqual({ email: 'sam@example.test', role: 'member' });
  expect(db.prepare('SELECT used_at IS NOT NULL AS used FROM invites').get()).toEqual({ used: 1 });
  joinView.unmount();
}, 30_000);
