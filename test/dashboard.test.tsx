// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dashboard } from '../src/features/dashboard/Dashboard';
import type { DashboardApi } from '../src/features/dashboard/api';

const owner = { id: 'u1', email: 'owner@example.com', displayName: 'Owner', role: 'owner' as const, createdAt: '2026-09-01T10:00:00.000Z', suspendedAt: null };
const member = { id: 'u2', email: 'member@example.com', displayName: 'Member', role: 'member' as const, createdAt: '2026-09-02T10:00:00.000Z', suspendedAt: null };

function api(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    listMembers: async () => [owner, member],
    setRole: vi.fn(async (id, role) => ({ ...member, id, role })),
    setSuspended: vi.fn(async (id, suspended) => ({ ...member, id, suspendedAt: suspended ? '2026-09-22T10:00:00.000Z' : null })),
    removeMember: vi.fn(async () => {}),
    listInvites: async () => [],
    createInvite: vi.fn(async () => ({
      id: 'i1', role: 'member', createdBy: owner.id, createdAt: '2026-09-22T10:00:00.000Z',
      expiresAt: '2026-09-29T10:00:00.000Z', usedAt: null, usedBy: null, label: null, code: 'invite-code-123456',
    })),
    resendInvite: vi.fn(async () => ({
      id: 'i1', role: 'member' as const, email: 'sam@example.com', status: 'pending' as const, createdBy: owner.id,
      createdAt: '2026-09-22T10:00:00.000Z', expiresAt: '2026-09-29T10:00:00.000Z', usedAt: null, usedBy: null,
      label: null, code: 'renewed-code-654321',
    })),
    revokeInvite: vi.fn(async () => {}),
    status: async () => ({
      version: '0.1.0', uptimeSeconds: 3600,
      usage: { users: 2, agents: 3, conversations: 4, messages: 500, providers: 1, devices: 0 },
      jobs: { pending: 0, failed: 2 },
      approvals: { pending: 1 },
    }),
    logs: async () => [
      { kind: 'job_failed' as const, at: '2026-09-22T09:00:00.000Z', subject: 'summarize', detail: 'provider down' },
    ],
    listAgents: async () => [],
    listProviders: async () => [],
    listModels: async () => [],
    removeProvider: vi.fn(async () => {}),
    ...overrides,
  };
}

function open(overrides: Partial<DashboardApi> = {}, role: 'owner' | 'admin' | 'member' = 'owner') {
  const implementation = api(overrides);
  render(<Dashboard api={implementation} currentUser={{ ...owner, role }} serverName="Acme production" onClose={() => {}} />);
  return implementation;
}

afterEach(cleanup);

describe('the server dashboard', () => {
  it('opens on the people who can use the server', async () => {
    open();
    expect(await screen.findByText('member@example.com')).toBeTruthy();
    expect(screen.getByText('owner@example.com')).toBeTruthy();
  });

  it('changes what somebody may do', async () => {
    const implementation = open();
    await screen.findByText('member@example.com');

    fireEvent.change(screen.getByRole('combobox', { name: /role for member@example.com/i }), {
      target: { value: 'admin' },
    });

    await waitFor(() => expect(implementation.setRole).toHaveBeenCalledWith(member.id, 'admin'));
  });

  it('takes access away and gives it back', async () => {
    const implementation = open();
    await screen.findByText('member@example.com');

    fireEvent.click(screen.getByRole('button', { name: /suspend member@example.com/i }));
    await waitFor(() => expect(implementation.setSuspended).toHaveBeenCalledWith(member.id, true));
  });

  it('never offers to remove the last owner', async () => {
    open();
    await screen.findByText('owner@example.com');
    // The server would be left with nobody who can administer it.
    expect(screen.queryByRole('button', { name: /remove owner@example.com/i })).toBeNull();
    expect(screen.getByRole('button', { name: /remove member@example.com/i })).toBeTruthy();
  });

  it('makes an invite link instead of a password somebody has to be sent', async () => {
    const implementation = open();
    fireEvent.click(await screen.findByRole('tab', { name: /invites/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Invite' }));
    const dialog = await screen.findByRole('dialog', { name: 'Invite a person' });
    // Nobody picks a password for anybody.
    expect(dialog.querySelector('input[type="password"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Create link only' }));

    await waitFor(() => expect(implementation.createInvite).toHaveBeenCalledWith({ role: 'member' }));
    // Shown once, in full, because it cannot be read back afterwards.
    expect((await screen.findByRole('textbox', { name: /invite link/i })).getAttribute('value'))
      .toContain('invite-code-123456');
  });

  it('invites by email with a role, and falls back to a link when mail is off', async () => {
    const mailOff = Object.assign(new Error('Outbound email is disabled on this server'), { code: 'mail_disabled' });
    const createInvite = vi.fn()
      .mockRejectedValueOnce(mailOff)
      .mockResolvedValueOnce({
        id: 'i2', role: 'admin', email: 'sam@example.com', status: 'pending', createdBy: owner.id,
        createdAt: '2026-09-22T10:00:00.000Z', expiresAt: '2026-09-29T10:00:00.000Z', usedAt: null, usedBy: null,
        label: null, code: 'mailless-code-1',
      });
    open({ createInvite });
    fireEvent.click(await screen.findByRole('tab', { name: /invites/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Invite' }));
    fireEvent.change(await screen.findByLabelText(/^Email/), { target: { value: 'sam@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Role/), { target: { value: 'admin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send invite' }));
    expect(await screen.findByText(/Email is not set up on this server/)).toBeTruthy();
    expect(createInvite).toHaveBeenNthCalledWith(1, { role: 'admin', email: 'sam@example.com', send: true });
    expect(createInvite).toHaveBeenNthCalledWith(2, { role: 'admin', email: 'sam@example.com', send: false });
    expect(screen.getByRole('textbox', { name: /invite link/i }).getAttribute('value')).toContain('mailless-code-1');
  });

  it('lists where each invite stands, with resend and revoke', async () => {
    const base = { role: 'member' as const, createdBy: owner.id, createdAt: '2026-09-22T10:00:00.000Z',
      expiresAt: '2026-09-29T10:00:00.000Z', usedBy: null, label: null };
    const implementation = open({ listInvites: async () => [
      { ...base, id: 'i1', email: 'sam@example.com', status: 'pending', usedAt: null },
      { ...base, id: 'i2', email: 'lee@example.com', status: 'accepted', usedAt: '2026-09-23T10:00:00.000Z' },
      { ...base, id: 'i3', email: 'old@example.com', status: 'revoked', usedAt: null },
    ] });
    fireEvent.click(await screen.findByRole('tab', { name: /invites/i }));
    expect(await screen.findByText('sam@example.com')).toBeTruthy();
    expect(screen.getByText('Accepted')).toBeTruthy();
    expect(screen.getByText('Revoked')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Revoke invite to lee@example.com/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Resend invite to sam@example.com' }));
    await waitFor(() => expect(implementation.resendInvite).toHaveBeenCalledWith('i1'));
    expect((await screen.findByRole('textbox', { name: /invite link/i })).getAttribute('value')).toContain('renewed-code-654321');

    fireEvent.click(screen.getByRole('button', { name: 'Revoke invite to sam@example.com' }));
    await waitFor(() => expect(implementation.revokeInvite).toHaveBeenCalledWith('i1'));
    expect(await screen.findAllByText('Revoked')).toHaveLength(2);
  });

  it('groups server administration by job instead of one row of equal tabs', async () => {
    open();
    for (const group of ['People & access', 'Agents & AI', 'Integrations', 'Usage & operations']) {
      expect(await screen.findByRole('tablist', { name: group })).toBeTruthy();
    }
    expect(screen.getAllByRole('tab')).toHaveLength(14);
  });

  it('reports what the server is doing and what failed', async () => {
    open();
    fireEvent.click(await screen.findByRole('tab', { name: /server/i }));

    expect(await screen.findByText(/0\.1\.0/)).toBeTruthy();
    expect(screen.getByText(/500/)).toBeTruthy();
    expect(await screen.findByText(/provider down/)).toBeTruthy();
  });

  it('says why a member sees nothing here, rather than an empty screen', async () => {
    open({}, 'member');
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/owner or admin/i);
  });

  it('reports a failure instead of pretending the change worked', async () => {
    open({ setRole: vi.fn(async () => { throw new Error('last_owner'); }) });
    await screen.findByText('member@example.com');

    fireEvent.change(screen.getByRole('combobox', { name: /role for member@example.com/i }), {
      target: { value: 'admin' },
    });

    expect((await screen.findByRole('alert')).textContent).toMatch(/last_owner/);
  });
});

describe('agents and providers, out of the chat settings', () => {
  const agent = {
    id: 'a1', name: 'Echo', personality: 'Assistant\nBe brief',
    modelPolicy: { defaultProviderId: 'openai-1', defaultModel: 'gpt-4o-mini' },
    permissions: { tools: [], canMessageAgents: true, canApproveOwnActions: false },
    createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z',
  };
  const provider = { id: 'openai-1', kind: 'openai' as const, baseUrl: null, hasApiKey: true, createdAt: '', updatedAt: '' };

  it('lists the agents this server runs, and what each one runs on', async () => {
    open({ listAgents: async () => [agent] });
    fireEvent.click(await screen.findByRole('tab', { name: /agents/i }));

    expect(await screen.findByText('Echo')).toBeTruthy();
    expect(screen.getByText(/gpt-4o-mini/)).toBeTruthy();
  });

  it('lists providers with whether they are usable', async () => {
    open({ listProviders: async () => [provider] });
    fireEvent.click(await screen.findByRole('tab', { name: /providers/i }));

    expect(await screen.findByText('openai')).toBeTruthy();
    expect(screen.getByText(/api key configured/i)).toBeTruthy();
  });

  it('browses the models a provider offers', async () => {
    const listModels = vi.fn(async () => [
      { id: 'gpt-4o-mini', providerId: 'openai-1', displayName: 'GPT-4o mini', contextWindow: 128_000 },
    ]);
    open({ listProviders: async () => [provider], listModels });
    fireEvent.click(await screen.findByRole('tab', { name: /providers/i }));
    fireEvent.click(await screen.findByRole('button', { name: /models from openai-1/i }));

    await waitFor(() => expect(listModels).toHaveBeenCalledWith('openai-1'));
    expect(await screen.findByText('GPT-4o mini')).toBeTruthy();
    expect(screen.getByText(/128K context/i)).toBeTruthy();
  });

  it('removes a provider that is no longer used', async () => {
    const removeProvider = vi.fn(async () => {});
    open({ listProviders: async () => [provider], removeProvider });
    fireEvent.click(await screen.findByRole('tab', { name: /providers/i }));
    fireEvent.click(await screen.findByRole('button', { name: /remove openai-1/i }));

    await waitFor(() => expect(removeProvider).toHaveBeenCalledWith('openai-1'));
  });
});
