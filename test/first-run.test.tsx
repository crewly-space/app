// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentEditor } from '../src/features/agents/AgentEditor';
import { FirstRunHome, firstRunStep, useFirstRunSkips } from '../src/features/onboarding/FirstRun';

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
});

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('first run step', () => {
  const owner = { canManageProviders: true, skipped: {} };

  it('starts an owner with no provider on the provider step', () => {
    expect(firstRunStep({ ...owner, hasConnectedProvider: false })).toBe('provider');
  });

  it('moves on to the agent once a provider is connected, whatever was skipped before', () => {
    expect(firstRunStep({ ...owner, hasConnectedProvider: true, skipped: { provider: true } })).toBe('agent');
  });

  it('lands on the server, not in a loop, once a step is skipped', () => {
    expect(firstRunStep({ ...owner, hasConnectedProvider: false, skipped: { provider: true } })).toBe('home');
    expect(firstRunStep({ ...owner, hasConnectedProvider: true, skipped: { agent: true } })).toBe('home');
  });

  it('never offers a member a provider step they cannot complete', () => {
    expect(firstRunStep({ canManageProviders: false, hasConnectedProvider: false, skipped: {} })).toBe('home');
  });
});

describe('first run skips', () => {
  it('survive a reload', () => {
    const first = renderHook(() => useFirstRunSkips());
    act(() => first.result.current.skip('provider'));
    first.unmount();

    const reloaded = renderHook(() => useFirstRunSkips());
    expect(reloaded.result.current.skipped).toEqual({ provider: true });
    act(() => reloaded.result.current.resume('provider'));
    expect(reloaded.result.current.skipped).toEqual({ provider: false });
  });
});

describe('the empty server after a skip', () => {
  const actions = () => ({ onConnectProvider: vi.fn(), onCreateAgent: vi.fn(), onOpenSettings: vi.fn() });

  it('offers to connect a provider when there is none', () => {
    const handlers = actions();
    render(<FirstRunHome hasConnectedProvider={false} canManageProviders {...handlers} />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect provider' }));
    expect(handlers.onConnectProvider).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Open settings' })).toBeTruthy();
  });

  it('offers to create an agent once a provider is connected', () => {
    const handlers = actions();
    render(<FirstRunHome hasConnectedProvider canManageProviders {...handlers} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create an agent' }));
    expect(handlers.onCreateAgent).toHaveBeenCalled();
  });

  it('tells a member who can connect the provider', () => {
    render(<FirstRunHome hasConnectedProvider={false} canManageProviders={false} {...actions()} />);
    expect(screen.queryByRole('button', { name: 'Connect provider' })).toBeNull();
    expect(screen.getByText(/only an owner or admin/)).toBeTruthy();
  });
});

describe('the first-run agent step', () => {
  it('can be skipped', () => {
    const onClose = vi.fn();
    render(<AgentEditor firstRun providers={[]} onClose={onClose} onSubmit={async () => {}} loadModels={async () => []} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(onClose).toHaveBeenCalled();
  });
});
