// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connector, ConnectorGrant, ConnectorProviderDefinition } from '@crewly/sdk';

const connectors = vi.hoisted(() => ({
  providers: vi.fn(),
  startOAuth: vi.fn(),
  completeOAuth: vi.fn(),
  grants: vi.fn(),
  setGrants: vi.fn(),
  refresh: vi.fn(),
  revoke: vi.fn(),
}));
const navigate = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/api/client', () => ({ client: { connectors } }));
vi.mock('../src/lib/safe-navigation', () => ({ navigateToServerUrl: navigate }));

import { ConnectorsSection } from '../src/features/settings/ConnectorsSection';
import type { Agent } from '../src/types';

const catalog: ConnectorProviderDefinition[] = [
  { provider: 'github', label: 'GitHub', description: 'Repos.', capabilities: ['read_issues', 'create_issue'], scopes: ['read:user', 'repo'], configured: true,
    setup: { clientIdEnv: 'CREWLY_GITHUB_CLIENT_ID', clientSecretEnv: 'CREWLY_GITHUB_CLIENT_SECRET', setupUrl: 'https://github.com/settings/applications/new' } },
  { provider: 'slack', label: 'Slack', description: 'Channels.', capabilities: ['read_channels'], scopes: ['channels:read'], configured: false,
    setup: { clientIdEnv: 'CREWLY_SLACK_CLIENT_ID', clientSecretEnv: 'CREWLY_SLACK_CLIENT_SECRET', setupUrl: 'https://api.slack.com/apps?new_app=1' } },
];
const connector = (overrides: Partial<Connector> = {}): Connector => ({
  id: 'c1', provider: 'github', accountId: '42', accountName: 'octocat', accountUrl: 'https://github.com/octocat', scopes: ['read:user', 'repo'],
  status: 'connected', ownerUserId: 'u1', createdAt: '', updatedAt: '', lastUsedAt: null, lastCheckedAt: null, revokedAt: null, lastError: null,
  capabilities: ['read_issues', 'create_issue'], ...overrides,
});
const agents = [{ id: 'a1', name: 'Scout' }] as Agent[];

function show(list: Connector[] = []) {
  return render(<ConnectorsSection connectors={list} agents={agents} onNotify={() => {}}
    onConnectorsChanged={async () => {}} onOpenSection={() => {}} />);
}

beforeEach(() => {
  for (const mock of Object.values(connectors)) mock.mockReset();
  navigate.mockReset();
  connectors.providers.mockResolvedValue({ providers: catalog });
});
afterEach(cleanup);

describe('Connectors', () => {
  it('shows what an app needs before it can be connected, instead of failing on Connect', async () => {
    show();
    expect(await screen.findByText('Needs server setup')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'How to set up' }));
    expect(screen.getByText('CREWLY_SLACK_CLIENT_ID=')).toBeTruthy();
    expect(screen.getByText(`${window.location.origin}/?connector=slack`)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Open Slack/ }).getAttribute('href')).toBe('https://api.slack.com/apps?new_app=1');
    // GitHub is configured, so it is one press away.
    expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy();
  });

  it('reconnects a disconnected app in place, so its agent access comes back', async () => {
    connectors.startOAuth.mockResolvedValue({ connectorId: 'c1', state: 's', authorizeUrl: 'https://github.com/login/oauth/authorize' });
    show([connector({ status: 'revoked', scopes: [] })]);
    fireEvent.click(await screen.findByRole('button', { name: 'Reconnect' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('https://github.com/login/oauth/authorize'));
    expect(connectors.startOAuth).toHaveBeenCalledWith('github', expect.objectContaining({ connectorId: 'c1' }));
  });

  it('explains a failed connect with the server\'s own words', async () => {
    connectors.startOAuth.mockRejectedValue(new Error('GitHub sign-in is not set up on this server yet.'));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }));
    expect((await screen.findByRole('alert')).textContent).toContain('GitHub sign-in is not set up');
  });

  it('grants an agent one capability at a time from a connected app', async () => {
    const grants: ConnectorGrant[] = [];
    connectors.grants.mockResolvedValue({ grants });
    connectors.setGrants.mockImplementation(async (_id: string, next: ConnectorGrant[]) => ({ grants: next.map((grant) => ({ ...grant, connectorId: 'c1', createdAt: '' })) }));
    show([connector()]);
    expect(await screen.findByText('Connected as octocat')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Manage' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Read issues' }));
    await waitFor(() => expect(connectors.setGrants).toHaveBeenCalledWith('c1', [{ granteeType: 'agent', granteeId: 'a1', capability: 'read_issues' }]));
    expect((screen.getByRole('checkbox', { name: 'Read issues' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Create issues' }) as HTMLInputElement).checked).toBe(false);
  });

  it('finishes the sign-in the app was sent back from', async () => {
    window.history.replaceState({}, '', '/?connector=github&code=abc&state=xyz');
    connectors.completeOAuth.mockResolvedValue(connector());
    show();
    await waitFor(() => expect(connectors.completeOAuth).toHaveBeenCalledWith('github', { code: 'abc', state: 'xyz' }));
    expect(window.location.search).toBe('');
  });
});
