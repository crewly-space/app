// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsPanel } from '../src/features/settings/SettingsPanel';
import { SETTINGS_GROUPS, visibleGroups } from '../src/features/settings/sections';
import type { DashboardApi } from '../src/features/dashboard/api';
import type { Provider } from '../src/types';

const provider: Provider = { id: 'openai-1', name: 'openai', detail: 'API key', status: 'connected' };

function adminApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  const none = async () => [];
  return {
    listMembers: none, setRole: vi.fn(), setSuspended: vi.fn(), removeMember: vi.fn(),
    listInvites: none, createInvite: vi.fn(), resendInvite: vi.fn(), revokeInvite: vi.fn(),
    status: async () => ({
      version: '0.1.0', uptimeSeconds: 60,
      usage: { users: 1, agents: 0, conversations: 1, messages: 0, providers: 1, devices: 0 },
      jobs: { pending: 0, failed: 0 }, approvals: { pending: 0 },
    }),
    logs: none, listAgents: none, listProviders: none, listModels: none, removeProvider: vi.fn(),
    listRoles: async () => ({ roles: [], permissions: [] }) as never,
    createRole: vi.fn(), updateRole: vi.fn(), removeRole: vi.fn(), assignRole: vi.fn(), unassignRole: vi.fn(),
    listAutomations: none, listAutomationRuns: none, createAutomation: vi.fn(), updateAutomation: vi.fn(), removeAutomation: vi.fn(),
    ...overrides,
  } as DashboardApi;
}

function open({ role = 'owner', initialSection, api = adminApi() }: {
  role?: 'owner' | 'admin' | 'member';
  initialSection?: Parameters<typeof SettingsPanel>[0]['initialSection'];
  api?: DashboardApi;
} = {}) {
  render(<SettingsPanel
    providers={[provider]} connectors={[]} devices={[]} agents={[]}
    currentUser={{ id: 'u1', email: 'owner@example.test', displayName: 'Owner', role } as never}
    serverBranding={{ displayName: 'Acme', tagline: '', iconDataUrl: null }}
    onAvatarModeChange={() => {}} theme="system" onThemeChange={() => {}} onNotify={() => {}}
    onProvidersChanged={async () => {}} onConnectorsChanged={async () => {}} onDevicesChanged={async () => {}}
    onServerBrandingChanged={async () => {}} onClose={() => {}} serverName="Acme"
    initialSection={initialSection} adminApi={api}
  />);
  return within(screen.getByRole('dialog', { name: 'Settings' }));
}

afterEach(cleanup);

describe('one Settings for the person and the server', () => {
  it('has every section exactly once', () => {
    const ids = SETTINGS_GROUPS.flatMap((group) => group.sections.map((section) => section.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('shows an owner their account and every server section, grouped by job', () => {
    const dialog = open();
    const nav = within(dialog.getByRole('navigation', { name: 'Settings sections' }));
    for (const group of ['Your account', 'Server', 'AI', 'Integrations', 'Operations']) {
      expect(nav.getByText(group)).toBeTruthy();
    }
    for (const section of ['People', 'Connectors', 'MCP tools', 'AI providers', 'Usage']) {
      expect(nav.getByRole('button', { name: section })).toBeTruthy();
    }
    // Server admin is no longer a second place with its own navigation.
    expect(dialog.queryByRole('tablist')).toBeNull();
  });

  it('shows a member only what a member may change or see', () => {
    const dialog = open({ role: 'member' });
    const nav = within(dialog.getByRole('navigation', { name: 'Settings sections' }));
    expect(nav.getByRole('button', { name: 'Appearance' })).toBeTruthy();
    expect(nav.getByRole('button', { name: 'AI providers' })).toBeTruthy();
    expect(nav.queryByRole('button', { name: 'People' })).toBeNull();
    expect(nav.queryByText('Operations')).toBeNull();
    expect(visibleGroups('member').flatMap((group) => group.sections).every((section) => section.access === 'everyone')).toBe(true);
  });

  it('opens on the section a link asked for, and never on one the person may not open', () => {
    let dialog = open({ initialSection: 'general' });
    expect(dialog.getByRole('heading', { name: 'General' })).toBeTruthy();
    cleanup();
    dialog = open({ role: 'member', initialSection: 'people' });
    expect(dialog.queryByRole('heading', { name: 'People' })).toBeNull();
  });

  it('goes from the list of sections to one section and back, as a phone shows it', () => {
    const dialog = open();
    const modal = screen.getByRole('dialog', { name: 'Settings' });
    expect(modal.getAttribute('data-pane')).toBe('nav');
    fireEvent.click(dialog.getByRole('button', { name: 'Connectors' }));
    expect(modal.getAttribute('data-pane')).toBe('content');
    expect(dialog.getByRole('heading', { name: 'Connectors' })).toBeTruthy();
    fireEvent.click(dialog.getByRole('button', { name: 'Back to settings' }));
    expect(modal.getAttribute('data-pane')).toBe('nav');
  });

  it('lists each connector app with its own Connect, and points to MCP tools and providers', () => {
    const dialog = open({ initialSection: 'connectors' });
    expect(dialog.getAllByRole('button', { name: 'Connect' })).toHaveLength(3);
    fireEvent.click(within(dialog.getByText(/For a tool that speaks MCP/)).getByRole('button', { name: 'MCP tools' }));
    expect(dialog.getByRole('heading', { name: 'MCP tools' })).toBeTruthy();
  });

  it('browses the models a provider offers, in the one provider list', async () => {
    const listModels = vi.fn(async () => [
      { id: 'gpt-4o-mini', providerId: 'openai-1', displayName: 'GPT-4o mini', contextWindow: 128_000 },
    ]);
    const dialog = open({ initialSection: 'providers', api: adminApi({ listModels }) as DashboardApi });
    fireEvent.click(dialog.getByRole('button', { name: /models from/i }));
    await waitFor(() => expect(listModels).toHaveBeenCalledWith('openai-1'));
    expect(await dialog.findByText('GPT-4o mini')).toBeTruthy();
    expect(dialog.getByText('128K context')).toBeTruthy();
  });

  it('keeps the server identity fields as labelled fields in a form', () => {
    const dialog = open({ initialSection: 'general' });
    expect((dialog.getByLabelText('Display name') as HTMLInputElement).value).toBe('Acme');
    expect(dialog.getByLabelText(/Tagline/).closest('form')).toBeTruthy();
  });
});
