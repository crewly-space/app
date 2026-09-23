// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudAccount } from '../src/lib/cloud/account';
import type { RegistryServer } from '../src/lib/servers/types';

const connectToServer = vi.fn();
vi.mock('../src/lib/servers/connect', () => ({ connectToServer: (...args: unknown[]) => connectToServer(...args) }));

const { CloudGate } = await import('../src/features/servers/CloudGate');

const server: RegistryServer = {
  id: 'srv_1', kind: 'cloud', name: 'production', endpoint: 'https://production.acme.servers.crewly.space',
  status: 'ready', role: 'owner', organizationId: 'org_1', reachable: true,
};

function account(overrides: Partial<Record<'me' | 'servers', () => Promise<unknown>>> = {}): CloudAccount {
  return {
    me: overrides.me ?? (async () => ({ id: 'u1', email: 'a@example.com', displayName: 'A', isOperator: false })),
    servers: overrides.servers ?? (async () => [server]),
    handoffToken: async () => 'handoff',
  } as unknown as CloudAccount;
}

const gate = (cloud: CloudAccount) =>
  render(<CloudGate account={cloud} cloudUrl="https://app.crewly.space"><p>the chat</p></CloudGate>);

beforeEach(() => {
  connectToServer.mockReset();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ providers: [{ id: 'github', label: 'GitHub' }] }))));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the hosted app front door', () => {
  it('asks a signed-out visitor to sign in to their Crewly account', async () => {
    gate(account({ me: async () => null }));

    expect(await screen.findByRole('heading', { name: 'Sign in to Crewly' })).toBeTruthy();
    expect((await screen.findByRole('link', { name: 'Continue with GitHub' })).getAttribute('href'))
      .toBe('https://app.crewly.space/api/v1/auth/oauth/github/start');
    expect(connectToServer).not.toHaveBeenCalled();
  });

  it('points an account with no servers at the dashboard', async () => {
    gate(account({ servers: async () => [] }));

    expect(await screen.findByRole('heading', { name: 'No servers yet' })).toBeTruthy();
  });

  it('opens the account\'s server once it is connected', async () => {
    connectToServer.mockResolvedValue({ state: 'connected' });
    gate(account());

    expect(await screen.findByText('the chat')).toBeTruthy();
    expect(connectToServer.mock.calls[0]![0]).toBe(server);
  });

  it('says so when the server is still being built', async () => {
    connectToServer.mockResolvedValue({ state: 'not_ready', status: 'provisioning' });
    gate(account({ servers: async () => [{ ...server, status: 'provisioning' }] }));

    expect(await screen.findByText(/This server is provisioning/)).toBeTruthy();
    expect(screen.queryByText('the chat')).toBeNull();
  });
});
