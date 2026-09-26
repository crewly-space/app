// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudAccount } from '../src/lib/cloud/account';
import { clearServerToken, clientFor, readServerToken, storeServerToken } from '../src/lib/servers/session';
import { connectToServer } from '../src/lib/servers/connect';
import type { RegistryServer } from '../src/lib/servers/types';
import { CrewlyApiError } from '../src/sdk/errors';

const cloudServer: RegistryServer = {
  id: 'dep-1',
  kind: 'cloud',
  name: 'production',
  endpoint: 'https://production.acme.servers.crewly.space',
  status: 'ready',
  role: 'owner',
  organizationId: 'org-1',
  reachable: true,
};

const selfHosted: RegistryServer = {
  id: 'own-1',
  kind: 'self_hosted',
  name: 'Home lab',
  endpoint: 'https://crewly.example.com',
  status: 'unknown',
  role: null,
  organizationId: null,
  reachable: true,
};

beforeEach(() => {
  localStorage.clear();
});

describe('per-server sessions', () => {
  it('keeps one server from reading the token of another', () => {
    storeServerToken(cloudServer.id, 'token-for-cloud');
    storeServerToken(selfHosted.id, 'token-for-home');
    expect(readServerToken(cloudServer.id)).toBe('token-for-cloud');
    expect(readServerToken(selfHosted.id)).toBe('token-for-home');

    clearServerToken(cloudServer.id);
    expect(readServerToken(cloudServer.id)).toBeNull();
    // Signing out of one server must not sign anyone out of the rest.
    expect(readServerToken(selfHosted.id)).toBe('token-for-home');
  });

  it('builds a connection per server, pointed at that server', () => {
    storeServerToken(cloudServer.id, 'token-for-cloud');
    const first = clientFor(cloudServer);
    const second = clientFor(selfHosted);
    expect(first).not.toBe(second);
    expect(first.endpoint).toBe(cloudServer.endpoint);
    expect(second.endpoint).toBe(selfHosted.endpoint);
    expect(first.client).not.toBe(second.client);
  });

  it('reuses the connection for a server, so a switch back keeps it', () => {
    expect(clientFor(cloudServer)).toBe(clientFor(cloudServer));
  });
});

describe('connecting to a server', () => {
  it('uses a stored session without asking Cloud for anything', async () => {
    storeServerToken(cloudServer.id, 'stored-token');
    const account = new CloudAccount('https://cloud.crewly.space', vi.fn());
    const result = await connectToServer(cloudServer, account, {
      verifyToken: async () => true,
    });
    expect(result).toEqual({ state: 'connected' });
  });

  it('trades a Cloud handoff token for a session on a cloud server', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ token: 'handoff-token', endpoint: cloudServer.endpoint }), { status: 201 }),
    );
    const account = new CloudAccount('https://cloud.crewly.space', fetchImpl as unknown as typeof fetch);
    const exchange = vi.fn(async () => 'server-session-token');

    const result = await connectToServer(cloudServer, account, {
      verifyToken: async () => false,
      exchangeHandoff: exchange,
    });

    expect(result).toEqual({ state: 'connected' });
    expect(exchange).toHaveBeenCalledWith(cloudServer, 'handoff-token');
    expect(readServerToken(cloudServer.id)).toBe('server-session-token');
  });

  it('asks a self-hosted server for a local login instead of a handoff', async () => {
    const account = new CloudAccount('https://cloud.crewly.space', vi.fn());
    const result = await connectToServer(selfHosted, account, { verifyToken: async () => false });
    expect(result).toEqual({ state: 'needs_local_login' });
  });

  it('reports a server that is not ready rather than trying to reach it', async () => {
    const provisioning: RegistryServer = { ...cloudServer, status: 'provisioning', reachable: false };
    const account = new CloudAccount('https://cloud.crewly.space', vi.fn());
    const result = await connectToServer(provisioning, account, { verifyToken: async () => false });
    expect(result).toEqual({ state: 'not_ready', status: 'provisioning' });
  });

  it('falls back to a local login when the handoff is refused', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ token: 'handoff-token' }), { status: 201 }));
    const account = new CloudAccount('https://cloud.crewly.space', fetchImpl as unknown as typeof fetch);
    const result = await connectToServer(cloudServer, account, {
      verifyToken: async () => false,
      exchangeHandoff: async () => { throw new CrewlyApiError('Unauthorized', 401); },
    });
    expect(result).toEqual({ state: 'needs_local_login' });
  });

  it('does not disguise an unreachable server as a login problem', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ token: 'handoff-token' }), { status: 201 }));
    const account = new CloudAccount('https://cloud.crewly.space', fetchImpl as unknown as typeof fetch);
    await expect(connectToServer(cloudServer, account, {
      verifyToken: async () => false,
      exchangeHandoff: async () => { throw new CrewlyApiError('Cannot reach server', 0, 'network_error'); },
    })).rejects.toThrow(/Cannot reach server/);
  });

  it('does not disguise a Cloud outage as a server login problem', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 }));
    const account = new CloudAccount('https://cloud.crewly.space', fetchImpl as unknown as typeof fetch);
    await expect(connectToServer(cloudServer, account, {
      verifyToken: async () => false,
      exchangeHandoff: async () => 'unused',
    })).rejects.toThrow(/HTTP 503/);
  });
});

describe('the cloud account', () => {
  it('updates the global profile with the Cloud session cookie', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe('PATCH');
      expect(init?.credentials).toBe('include');
      expect(init?.headers).toMatchObject({ 'content-type': 'application/json' });
      expect(init?.body).toBe(JSON.stringify({ displayName: 'Ada', avatarMode: 'name' }));
      return new Response(JSON.stringify({ account: {
        id: 'user-1', email: 'ada@example.com', displayName: 'Ada', isOperator: false,
        avatarMode: 'name', authMethods: ['password'],
      } }), { status: 200 });
    });
    const account = new CloudAccount('https://cloud.crewly.space', fetchImpl as unknown as typeof fetch);
    await expect(account.updateProfile({ displayName: 'Ada', avatarMode: 'name' })).resolves.toMatchObject({
      displayName: 'Ada', avatarMode: 'name',
    });
  });

  it('lists the servers the account can open', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ servers: [cloudServer, selfHosted] }), { status: 200 }),
    );
    const account = new CloudAccount('https://cloud.crewly.space', fetchImpl as unknown as typeof fetch);
    expect(await account.servers()).toEqual([cloudServer, selfHosted]);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe('https://cloud.crewly.space/api/v1/account/servers');
    // The Cloud session is a cookie on its own origin, so the request has to
    // carry it explicitly from another origin.
    expect(init.credentials).toBe('include');
  });

  it('reports no session rather than throwing, so the app can offer a sign-in', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }));
    const account = new CloudAccount('https://cloud.crewly.space', fetchImpl as unknown as typeof fetch);
    expect(await account.me()).toBeNull();
  });
});
