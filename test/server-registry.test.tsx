// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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
});
