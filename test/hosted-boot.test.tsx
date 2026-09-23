// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RegistryServer } from '../src/lib/servers/types';

/*
 * app.crewly.space from a fresh browser (CRE-95).
 *
 * The hosted app is nobody's server. Signing in to the Crewly account must work
 * with no server reachable at all, the rail must load, and nothing may tell the
 * visitor to start a server -- or ask the page's own origin, which is Cloud,
 * for a server's data.
 */
const CLOUD = 'https://app.crewly.space';

const production: RegistryServer = {
  id: 'srv_1', kind: 'cloud', name: 'production', endpoint: 'https://production.acme.servers.crewly.space',
  status: 'ready', role: 'owner', organizationId: 'org_1', reachable: false,
};

let servers: RegistryServer[] = [];
const requests: string[] = [];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

let App: typeof import('../src/App').default;
let CloudGate: typeof import('../src/features/servers/CloudGate').CloudGate;
let CloudAccount: typeof import('../src/lib/cloud/account').CloudAccount;

beforeAll(async () => {
  vi.stubEnv('VITE_CREWLY_CLOUD_URL', CLOUD);
  Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
  ({ default: App } = await import('../src/App'));
  ({ CloudGate } = await import('../src/features/servers/CloudGate'));
  ({ CloudAccount } = await import('../src/lib/cloud/account'));
});

beforeEach(() => {
  requests.length = 0;
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    requests.push(url);
    if (url === `${CLOUD}/api/v1/account`) return json({ account: { id: 'u1', email: 'a@example.com', displayName: 'A', isOperator: false } });
    if (url === `${CLOUD}/api/v1/account/servers`) return json({ servers });
    if (url === `${CLOUD}/api/v1/auth/oauth/providers`) return json({ providers: [] });
    if (url.startsWith(`${CLOUD}/api/v1/account/servers/`)) return json({ error: 'unavailable' }, 503);
    // Every customer server is offline.
    throw new TypeError('Failed to fetch');
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const boot = () => render(<CloudGate account={new CloudAccount(CLOUD)} cloudUrl={CLOUD}><App /></CloudGate>);

describe('the hosted app on a fresh visit', () => {
  it('opens with the rail when the only server is offline', async () => {
    servers = [production];
    boot();

    expect(await screen.findByRole('heading', { name: "production isn't answering" })).toBeTruthy();
    expect(screen.getByRole('tablist', { name: 'Servers' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add a server' })).toBeTruthy();
    expect(screen.queryByText(/Start the server/)).toBeNull();
    // The page's own origin is Cloud; only account endpoints are asked of it.
    const ownOrigin = requests.filter((url) => url.startsWith(CLOUD));
    expect(ownOrigin.every((url) => url.startsWith(`${CLOUD}/api/v1/account`) || url.startsWith(`${CLOUD}/api/v1/auth/oauth`))).toBe(true);
    expect(requests.some((url) => url.startsWith(window.location.origin))).toBe(false);
  });

  it('offers to create or add a server to an account with none', async () => {
    servers = [];
    boot();

    expect(await screen.findByRole('heading', { name: 'No servers yet' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add a self-hosted server' })).toBeTruthy();
    expect(screen.queryByText(/Start the server/)).toBeNull();
  });
});
