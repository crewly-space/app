// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, StrictMode } from 'react';
import type { RegistryServer } from '../src/lib/servers/types';

const server: RegistryServer = {
  id: 'srv_1', kind: 'cloud', name: 'production', endpoint: 'https://production.acme.servers.crewly.space',
  status: 'ready', role: 'owner', organizationId: 'org_1', reachable: true,
};

const me = vi.fn(async () => ({ id: 'u1', email: 'a@example.com', displayName: 'A', isOperator: false }));
// A fresh array and fresh objects on every call, as the real network gives.
const servers = vi.fn(async () => [{ ...server }]);
const connectToServer = vi.fn(async () => ({ state: 'connected' as const }));

vi.mock('../src/lib/cloud/account', () => ({
  CloudAccount: class { me = me; servers = servers; },
}));
vi.mock('../src/lib/servers/connect', () => ({ connectToServer: (...args: unknown[]) => connectToServer(...(args as [])) }));
vi.mock('../src/lib/api/client', () => ({ activateServer: () => {} }));
vi.mock('../src/features/servers/unread', () => ({ watchBackgroundServers: () => () => {} }));

let useServerRegistry: typeof import('../src/features/servers/useServerRegistry').useServerRegistry;

beforeAll(async () => {
  vi.stubEnv('VITE_CREWLY_CLOUD_URL', 'https://app.crewly.space');
  ({ useServerRegistry } = await import('../src/features/servers/useServerRegistry'));
});

beforeEach(() => {
  localStorage.clear();
  me.mockClear(); servers.mockClear(); connectToServer.mockClear();
});
afterEach(cleanup);

describe('server registry', () => {
  it('asks Cloud once and connects once, instead of looping on every render', async () => {
    const { result } = renderHook(() => useServerRegistry());
    await waitFor(() => expect(result.current.epoch).toBe(1));
    // Long enough for a render loop to show itself.
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));

    expect(servers).toHaveBeenCalledTimes(1);
    expect(me).toHaveBeenCalledTimes(1);
    expect(connectToServer).toHaveBeenCalledTimes(1);
    expect(result.current.epoch).toBe(1);
  });

  it('does not reconnect, and reload the app, when a refresh returns the same server', async () => {
    connectToServer.mockClear();
    const { result } = renderHook(() => useServerRegistry());
    await waitFor(() => expect(result.current.epoch).toBe(1));

    await act(() => result.current.refresh());
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));

    expect(connectToServer).toHaveBeenCalledTimes(1);
    expect(result.current.epoch).toBe(1);
  });

  it('reports no servers as a state of its own, not a failure', async () => {
    servers.mockResolvedValueOnce([]);
    const { result } = renderHook(() => useServerRegistry());
    await waitFor(() => expect(result.current.connection.state).toBe('no_servers'));
  });

  it('keeps an unreachable server to that server, and tries it again on request', async () => {
    connectToServer.mockClear();
    connectToServer.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useServerRegistry());
    await waitFor(() => expect(result.current.connection.state).toBe('unreachable'));
    expect(result.current.account?.email).toBe('a@example.com');
    expect(result.current.servers).toHaveLength(1);

    act(() => result.current.reconnect());
    await waitFor(() => expect(result.current.connection.state).toBe('connected'));
    expect(connectToServer).toHaveBeenCalledTimes(2);
  });

  it('asks for the server\'s own login when Cloud cannot hand off', async () => {
    connectToServer.mockResolvedValueOnce({ state: 'needs_local_login' } as never);
    const { result } = renderHook(() => useServerRegistry());
    await waitFor(() => expect(result.current.connection.state).toBe('needs_login'));
  });

  it('says Cloud is down when the server list cannot be read', async () => {
    servers.mockRejectedValueOnce(new Error('502'));
    const { result } = renderHook(() => useServerRegistry());
    await waitFor(() => expect(result.current.connection.state).toBe('cloud_unreachable'));
  });
});


describe('connection lifecycle regressions', () => {
  it('opens a cached server under React StrictMode', async () => {
    localStorage.setItem('crewly:server-registry', JSON.stringify({
      profile: { id: 'u1', email: 'a@example.com' }, servers: [server], selectedId: server.id,
    }));
    const { result } = renderHook(() => useServerRegistry(), {
      wrapper: ({ children }) => createElement(StrictMode, null, children),
    });
    await waitFor(() => expect(result.current.connection.state).toBe('connected'));
  });

  it('can retry while the original connection is still pending', async () => {
    let finish!: (value: { state: 'connected' }) => void;
    connectToServer.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { result } = renderHook(() => useServerRegistry());
    await waitFor(() => expect(connectToServer).toHaveBeenCalledTimes(1));
    act(() => result.current.reconnect());
    await waitFor(() => expect(result.current.connection.state).toBe('connected'));
    await act(async () => finish({ state: 'connected' }));
    expect(result.current.epoch).toBe(1);
  });

  it('reconnects when a server is moved to a different endpoint', async () => {
    const { result } = renderHook(() => useServerRegistry());
    await waitFor(() => expect(result.current.connection.state).toBe('connected'));
    servers.mockResolvedValueOnce([{ ...server, endpoint: 'https://moved.test' }]);
    await act(() => result.current.refresh());
    await waitFor(() => expect(result.current.epoch).toBe(2));
    expect(connectToServer.mock.lastCall?.[0]).toMatchObject({ endpoint: 'https://moved.test' });
  });

  it('ignores an older registry response arriving after a newer one', async () => {
    const { result } = renderHook(() => useServerRegistry());
    await waitFor(() => expect(result.current.connection.state).toBe('connected'));
    let finish!: (value: typeof server[]) => void;
    servers.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    let older!: Promise<void>;
    act(() => { older = result.current.refresh(); });
    servers.mockResolvedValueOnce([{ ...server, name: 'Newest' }]);
    await act(() => result.current.refresh());
    await act(async () => { finish([{ ...server, name: 'Stale' }]); await older; });
    expect(result.current.selected?.name).toBe('Newest');
  });
});
