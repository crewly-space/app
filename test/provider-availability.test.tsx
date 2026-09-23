// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CrewlyApiError, type DeviceInfo } from '@crewly/sdk';

const create = vi.fn(async (..._args: unknown[]): Promise<Record<string, unknown>> => ({}));
const enableOnDevices = vi.fn(async (..._args: unknown[]) => ({ devices: [] as unknown[] }));
let devices: DeviceInfo[] = [];
vi.mock('../src/lib/api/client', () => ({
  client: {
    providers: {
      create: (...args: unknown[]) => create(...args),
      enableOnDevices: (...args: unknown[]) => enableOnDevices(...args),
      oauthKinds: async () => ({ kinds: [] }),
    },
    devices: { list: async () => devices },
  },
}));

const { deviceProviderAvailability, codexRuntimeOn } = await import('../src/features/providers/availability');
const { ProviderConnect } = await import('../src/features/providers/ProviderConnect');

function device(name: string, connected: boolean, capabilities: Record<string, unknown> = {}): DeviceInfo {
  return { id: name, name, platform: 'darwin', capabilities, connected, lastSeenAt: null, createdAt: '' };
}
const claudeRuntime = (authenticated: boolean) => ({ id: 'claude-subscription', name: 'Claude Subscription', authenticated });

afterEach(cleanup);
beforeEach(() => { create.mockReset(); create.mockResolvedValue({}); enableOnDevices.mockReset(); devices = []; });

describe('device provider availability', () => {
  it('asks for a device when none is paired', () => {
    expect(deviceProviderAvailability([], 'claude-subscription')).toEqual({ state: 'no_device' });
  });

  it('tells apart offline, missing runtime, signed out and not enabled', () => {
    expect(deviceProviderAvailability([device('mac', false)], 'claude-subscription').state).toBe('device_offline');
    expect(deviceProviderAvailability([device('mac', true, { runtimes: [] })], 'claude-subscription').state).toBe('runtime_missing');
    expect(deviceProviderAvailability([device('mac', true, { runtimes: [claudeRuntime(false)] })], 'claude-subscription').state).toBe('signed_out');
    expect(deviceProviderAvailability([device('mac', true, { runtimes: [claudeRuntime(true)] })], 'claude-subscription').state).toBe('not_enabled');
  });

  it('prefers the device closest to working', () => {
    const ready = device('laptop', true, { providers: [{ id: 'c', kind: 'claude-subscription' }] });
    expect(deviceProviderAvailability([device('desktop', false), ready], 'claude-subscription'))
      .toEqual({ state: 'ready', deviceName: 'laptop' });
  });

  it('treats Codex as a runtime, never as a provider', () => {
    const codex = device('mac', true, { runtimes: [{ id: 'codex', name: 'Codex', authenticated: true }] });
    expect(codexRuntimeOn([codex])).toBe('mac');
    expect(deviceProviderAvailability([codex], 'claude-subscription').state).toBe('runtime_missing');
  });
});

describe('connecting a provider', () => {
  it('connects Claude through a ready device without asking for a key', async () => {
    devices = [device('laptop', true, { providers: [{ id: 'c', kind: 'claude-subscription' }] })];
    const onConnected = vi.fn();
    render(<ProviderConnect onConnected={onConnected} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Connect Claude' }));
    await waitFor(() => expect(onConnected).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith({ id: 'claude-subscription', kind: 'claude-subscription' });
  });

  it('explains what is missing instead of offering a connection that cannot work', async () => {
    devices = [device('laptop', true, { runtimes: [claudeRuntime(false)] })];
    render(<ProviderConnect onConnected={() => {}} />);

    expect(await screen.findByText(/Claude Code on laptop isn't signed in/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect Claude' })).toBeNull();
    expect(screen.getByText(/ChatGPT subscription can't be used as a chat provider yet/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Crewly Gateway' })).toBeTruthy();
  });

  it('keeps device-backed kinds out of the API key list', async () => {
    render(<ProviderConnect onConnected={() => {}} />);
    const options = Array.from((await screen.findByLabelText('Provider') as HTMLSelectElement).options).map((option) => option.value);
    expect(options).not.toContain('claude-subscription');
    expect(options).not.toContain('ollama');
    expect(options).toContain('openai-compatible');
  });

  it('switches Claude on through a signed-in device that has not enabled it yet', async () => {
    devices = [device('laptop', true, { runtimes: [claudeRuntime(true)] })];
    create.mockResolvedValue({ id: 'claude-subscription', devices: [{ deviceId: 'laptop', deviceName: 'laptop', enabled: true }] });
    const onConnected = vi.fn();
    render(<ProviderConnect onConnected={onConnected} />);

    expect(await screen.findByText(/Connecting switches it on there/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Connect Claude' }));
    await waitFor(() => expect(onConnected).toHaveBeenCalled());
  });

  it('says what the device needs when it refuses', async () => {
    devices = [device('laptop', true, { runtimes: [claudeRuntime(true)] })];
    create.mockResolvedValue({ devices: [{ deviceId: 'laptop', deviceName: 'laptop', enabled: false, error: 'provider_sign_in_expired' }] });
    const onConnected = vi.fn();
    render(<ProviderConnect onConnected={onConnected} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Connect Claude' }));
    expect(await screen.findByText(/Run claude login there, then connect again/)).toBeTruthy();
    expect(onConnected).not.toHaveBeenCalled();
  });

  it('asks the devices again when the provider already exists', async () => {
    devices = [device('laptop', true, { runtimes: [claudeRuntime(true)] })];
    create.mockRejectedValue(new CrewlyApiError('exists', 409, 'provider_exists'));
    enableOnDevices.mockResolvedValue({ devices: [{ deviceId: 'laptop', deviceName: 'laptop', enabled: true }] });
    const onConnected = vi.fn();
    render(<ProviderConnect onConnected={onConnected} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Connect Claude' }));
    await waitFor(() => expect(onConnected).toHaveBeenCalled());
    expect(enableOnDevices).toHaveBeenCalledWith('claude-subscription');
  });
});
