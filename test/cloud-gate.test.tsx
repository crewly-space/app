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

  it('lets a signed-in account in without reaching any server', async () => {
    gate(account({ servers: async () => [] }));

    expect(await screen.findByText('the chat')).toBeTruthy();
    expect(connectToServer).not.toHaveBeenCalled();
    expect(screen.queryByText(/Start the server/)).toBeNull();
  });

  it('takes the server the dashboard asked for as the remembered choice', async () => {
    window.history.replaceState(null, '', '/?server=srv_2');
    gate(account());

    expect(await screen.findByText('the chat')).toBeTruthy();
    expect(localStorage.getItem('crewly:last-server')).toBe('srv_2');
    expect(window.location.search).toBe('');
  });

  it('says Crewly itself is down, not a server, when the account cannot be read', async () => {
    gate(account({ me: async () => { throw new Error('Cloud returned HTTP 502'); } }));

    expect(await screen.findByRole('heading', { name: "Can't reach Crewly" })).toBeTruthy();
    expect(screen.queryByText(/Start the server/)).toBeNull();
  });
});
