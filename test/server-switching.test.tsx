// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Switching servers once the app is running (CRE-101), and what loading looks
 * like (CRE-100). The registry is driven directly so each connection state can
 * be held still and looked at.
 */
const serverA = { id: 'srv_a', kind: 'cloud', name: 'Alpha', endpoint: 'https://a.test', status: 'ready', role: 'owner', organizationId: 'o', reachable: true };
const serverB = { ...serverA, id: 'srv_b', name: 'Beta', endpoint: 'https://b.test' };

let registry: Record<string, unknown>;
vi.mock('../src/features/servers/useServerRegistry', () => ({
  useServerRegistry: () => registry,
  cloudUrl: undefined,
}));
vi.mock('../src/lib/realtime/events', () => ({ startRealtime: () => () => {}, resubscribeConversations: () => {} }));
const bootstrap = vi.fn();
vi.mock('../src/lib/gateway', async (original) => {
  const actual = await original<typeof import('../src/lib/gateway')>();
  return { ...actual, gateway: { ...actual.gateway, bootstrap: (...args: unknown[]) => bootstrap(...args) } };
});

function workspace(name: string) {
  return {
    agents: [], messages: [], providers: [], approvals: [], devices: [], users: [], people: [], channelCategories: [],
    currentUser: { id: 'u1', email: 'a@example.com', role: 'owner' },
    conversations: [{ id: `${name}-room`, name: `${name} room`, type: 'group', agentIds: [], preview: '', time: '' }],
  };
}

let App: typeof import('../src/App').default;
let writeWorkspace: typeof import('../src/lib/boot-cache').writeWorkspace;
let clearWorkspaces: typeof import('../src/lib/boot-cache').clearWorkspaces;
let Loading: typeof import('../src/features/shell/BrandMark').Loading;

beforeAll(async () => {
  Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) });
  ({ default: App } = await import('../src/App'));
  ({ writeWorkspace, clearWorkspaces } = await import('../src/lib/boot-cache'));
  ({ Loading } = await import('../src/features/shell/BrandMark'));
});

beforeEach(() => {
  bootstrap.mockReset();
  clearWorkspaces();
  registry = {
    multiServer: true, account: null, servers: [serverA, serverB], selected: serverB,
    connection: { state: 'connecting' }, unread: {}, failures: {}, epoch: 0,
    select: vi.fn(), refresh: vi.fn(async () => {}), reconnect: vi.fn(),
  };
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('switching to a server shown before', () => {
  it('shows its last known workspace at once, marked, without asking it for anything yet', () => {
    writeWorkspace('srv_b', workspace('Beta'), 'Beta-room');
    render(<App />);
    expect(screen.getAllByText('Beta room').length).toBeGreaterThan(0);
    expect(screen.getByText(/Showing Beta as you left it/)).toBeTruthy();
    // The rail stays mounted through the switch.
    expect(screen.getByRole('tablist', { name: 'Servers' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled).toBe(true);
    expect(bootstrap).not.toHaveBeenCalled();
  });

  it('refreshes underneath once connected, and never shows another server\'s rooms', async () => {
    writeWorkspace('srv_a', workspace('Alpha'), 'Alpha-room');
    writeWorkspace('srv_b', workspace('Beta'), 'Beta-room');
    bootstrap.mockResolvedValue(workspace('Beta-fresh'));
    const view = render(<App />);
    expect(screen.queryByText('Alpha room')).toBeNull();
    registry = { ...registry, connection: { state: 'connected' }, epoch: 1 };
    view.rerender(<App />);
    expect(await screen.findAllByText('Beta-fresh room')).toBeTruthy();
    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/as you left it/)).toBeNull();
  });
});

describe('switching to a server not shown before', () => {
  it('keeps the rail and shows the shape of the workspace, not a blank page', () => {
    render(<App />);
    expect(screen.getByRole('tablist', { name: 'Servers' })).toBeTruthy();
    expect(screen.getByRole('status').className).toContain('boot-skeleton');
  });
});

describe('loading', () => {
  it('says nothing for a fast start, says what it is doing when slower, and offers a way out when slow', () => {
    vi.useFakeTimers();
    const onRetry = vi.fn();
    render(<Loading phase="Opening Beta…" onRetry={onRetry} />);
    const phase = () => screen.getByText('Opening Beta…');
    expect(phase().className).not.toContain('shown');
    act(() => { vi.advanceTimersByTime(1300); });
    expect(phase().className).toContain('shown');
    act(() => { vi.advanceTimersByTime(7000); });
    expect(screen.getByText('This is taking longer than usual.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });
});
