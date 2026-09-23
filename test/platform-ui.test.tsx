// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Agent, AgentRuntime, AgentStatus, RunTrace } from '@crewly/sdk';
import { AgentSettings } from '../src/features/dashboard/AgentSettings';
import type { PlatformApi } from '../src/features/dashboard/platform-api';
import { UsagePanel } from '../src/features/dashboard/UsagePanel';
import { describeEvent, RunInspector } from '../src/features/runs/RunInspector';
import { statusLabel, statusTitle, withStatus } from '../src/lib/agent-status';

afterEach(cleanup);

const agent: Agent = {
  id: 'a1', ownerUserId: 'u1', name: 'Coder', personality: 'Writes code', availability: 'auto',
  modelPolicy: { defaultProviderId: 'anthropic', defaultModel: 'claude-sonnet-5' },
  permissions: { tools: [], canMessageAgents: true, canApproveOwnActions: false },
  relationships: [], createdAt: '2026-09-22T10:00:00.000Z', updatedAt: '2026-09-22T10:00:00.000Z',
};

const status: AgentStatus = {
  agentId: 'a1', presence: 'offline', execution: 'runtime_unavailable', reason: 'Laptop is offline',
  availability: 'auto', activeRunId: null, lastActiveAt: null,
};

const runtime: AgentRuntime = {
  runtimeKind: 'native',
  binding: null,
  health: { available: true, reason: null },
  sessions: [],
  devices: [{
    id: 'dev_1', name: 'Laptop', connected: true, lastSeenAt: null,
    runtimes: [{ id: 'claude-code', name: 'Claude Code', authenticated: true }],
    workspaces: [{ id: 'ws_app', name: 'app' }],
  }],
};

function platform(overrides: Partial<PlatformApi> = {}): PlatformApi {
  return {
    usage: async () => ({
      from: '', to: '', groupBy: 'agent',
      totals: { calls: 3, errors: 1, inputTokens: 1000, outputTokens: 200, costMicros: 2_500_000, unpricedCalls: 1 },
      rows: [{ key: 'a1', label: 'Coder', calls: 3, errors: 1, inputTokens: 1000, outputTokens: 200, costMicros: 2_500_000, unpricedCalls: 1 }],
    }),
    budgets: async () => [],
    createBudget: vi.fn(async (input) => ({
      id: 'b1', scope: input.scope, agentId: input.agentId ?? null, period: input.period, limitMicros: input.limitUsd * 1e6,
      limitUsd: input.limitUsd, action: input.action ?? 'warn', periodStart: '', periodEnd: '', spentMicros: 0, spentUsd: 0,
      ratio: 0, exceeded: false, createdAt: '', updatedAt: '',
    })),
    deleteBudget: vi.fn(async () => {}),
    providerHealth: async () => [],
    failedRuns: async () => [],
    run: vi.fn(),
    secrets: async () => [],
    createSecret: vi.fn(),
    rotateSecret: vi.fn(),
    revokeSecret: vi.fn(),
    setSecretGrants: vi.fn(),
    deleteSecret: vi.fn(),
    mcpServers: async () => [],
    createMcpServer: vi.fn(),
    testMcpServer: vi.fn(),
    setDisabledTools: vi.fn(),
    deleteMcpServer: vi.fn(),
    skills: async () => [],
    createSkill: vi.fn(),
    installSkill: vi.fn(),
    deleteSkill: vi.fn(),
    agentStatus: async () => status,
    setAvailability: vi.fn(async (_id, availability) => ({ ...status, availability, presence: availability === 'dnd' ? 'dnd' as const : status.presence })),
    agentRuntime: async () => runtime,
    setAgentRuntime: vi.fn(async (_id, input) => ({ ...runtime, runtimeKind: input.runtimeKind })),
    agentTools: async () => [],
    setAgentTools: vi.fn(async () => []),
    agentSkills: async () => [],
    setAgentSkills: vi.fn(async () => []),
    delegates: async () => [],
    setDelegates: vi.fn(async () => []),
    ...overrides,
  };
}

describe('agent status', () => {
  it('shows presence and execution together, and the reason on hover', () => {
    const view = withStatus({ id: 'a1', name: 'Coder', initials: 'C', role: '', color: '', status: 'unknown', model: '', runtime: '', memory: [] }, status);
    expect(view.status).toBe('offline');
    expect(statusLabel(view)).toBe('Offline · Runtime unavailable');
    expect(statusTitle(view)).toBe('Offline · Runtime unavailable — Laptop is offline');
  });

  it('keeps the old wording for a server that reports no canonical status', () => {
    expect(statusLabel({ status: 'online' })).toBe('Ready');
  });
});

describe('agent settings', () => {
  it('binds a coding runtime to a device and workspace', async () => {
    const api = platform();
    render(<AgentSettings api={api} agent={agent} agents={[agent]} onBack={() => {}} />);
    expect(await screen.findByText('Offline · Runtime unavailable — Laptop is offline')).toBeTruthy();

    fireEvent.click(screen.getByLabelText(/Claude Code/));
    fireEvent.change(screen.getByLabelText('Device'), { target: { value: 'dev_1' } });
    fireEvent.change(screen.getByLabelText('Workspace'), { target: { value: 'ws_app' } });
    fireEvent.change(screen.getByLabelText('What it may do'), { target: { value: 'auto_edit' } });
    fireEvent.click(screen.getByText('Save runtime'));

    await waitFor(() => expect(api.setAgentRuntime).toHaveBeenCalledWith('a1', {
      runtimeKind: 'claude-code', deviceId: 'dev_1', workspaceId: 'ws_app', options: { permissionMode: 'auto_edit' },
    }));
  });

  it('explains how to make a coding runtime available when nothing is paired', async () => {
    render(<AgentSettings api={platform({ agentRuntime: async () => ({ ...runtime, devices: [] }) })} agent={agent} agents={[agent]} onBack={() => {}} />);
    await screen.findByText(/Runtime unavailable/);
    fireEvent.click(screen.getByLabelText(/Codex/));
    expect(screen.getByText('crewly runtime install')).toBeTruthy();
    expect(screen.getByText('crewly connect')).toBeTruthy();
  });

  it('puts the agent on Do Not Disturb', async () => {
    const api = platform();
    render(<AgentSettings api={api} agent={agent} agents={[agent]} onBack={() => {}} />);
    await screen.findByText(/Runtime unavailable/);
    fireEvent.click(screen.getByLabelText('Do not disturb'));
    await waitFor(() => expect(api.setAvailability).toHaveBeenCalledWith('a1', 'dnd'));
  });
});

describe('usage', () => {
  it('shows spend and says when some of it could not be priced', async () => {
    render(<UsagePanel api={platform()} agents={[agent]} />);
    expect(await screen.findByText('$2.50')).toBeTruthy();
    expect(screen.getByText(/1 calls used models with no known price/)).toBeTruthy();
  });

  it('adds a budget in dollars', async () => {
    const api = platform();
    render(<UsagePanel api={api} agents={[agent]} />);
    await screen.findByText('$2.50');
    fireEvent.change(screen.getByLabelText('Budget for'), { target: { value: 'a1' } });
    fireEvent.change(screen.getByLabelText('Limit in dollars'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('At the limit'), { target: { value: 'block' } });
    fireEvent.click(screen.getByText('Add budget'));
    await waitFor(() => expect(api.createBudget).toHaveBeenCalledWith({
      scope: 'agent', agentId: 'a1', period: 'monthly', limitUsd: 20, action: 'block',
    }));
  });
});

describe('run inspector', () => {
  const trace: RunTrace = {
    run: {
      runId: 'r1', rootRunId: 'r1', causationId: null, hopCount: 0, agentId: 'a1', conversationId: 'c1',
      createdAt: '2026-09-22T10:00:00.000Z', status: 'completed', agentName: 'Coder',
      startedAt: '2026-09-22T10:00:00.000Z', finishedAt: '2026-09-22T10:00:02.000Z',
    },
    summary: {
      durationMs: 2000, provider: { providerId: 'anthropic', model: 'claude-sonnet-5' }, providerCalls: 2,
      retries: 1, fallbacks: 0, toolCalls: 1, inputTokens: 900, outputTokens: 80, costMicros: 3900, unpricedCalls: 0,
    },
    events: [
      { seq: 1, type: 'run.started', data: { trigger: 'message', hopCount: 0 }, at: '2026-09-22T10:00:00.000Z' },
      { seq: 2, type: 'provider.retry', data: { errorCode: 'provider_unavailable', delayMs: 250 }, at: '2026-09-22T10:00:00.500Z' },
      { seq: 3, type: 'tool.call', data: { name: 'mcp_github_search', status: 'ok', durationMs: 120 }, at: '2026-09-22T10:00:01.000Z' },
    ],
    providerCalls: [], approvals: [], runtimeSessions: [],
    tree: [{ runId: 'r1', causationId: null, hopCount: 0, agentId: 'a1', agentName: 'Coder', status: 'completed', trigger: 'message', createdAt: '', finishedAt: null }],
    treeCostMicros: 3900,
  };

  it('shows the model, duration, cost and what happened', async () => {
    render(<RunInspector load={async () => trace} onClose={() => {}} />);
    expect(await screen.findByText('anthropic · claude-sonnet-5')).toBeTruthy();
    expect(screen.getByText('2.0 s')).toBeTruthy();
    expect(screen.getByText('$0.0039')).toBeTruthy();
    expect(screen.getByText('Retrying after provider_unavailable in 250 ms')).toBeTruthy();
    expect(screen.getByText('Tool mcp_github_search ran in 120 ms')).toBeTruthy();
  });

  it('words a fallback the way a person would read it', () => {
    expect(describeEvent({
      seq: 1, type: 'provider.fallback', at: '',
      data: { from: { providerId: 'a', model: 'x' }, to: { providerId: 'openai', model: 'gpt-5-mini' }, reason: 'budget_exceeded' },
    })).toBe('Fell back to openai · gpt-5-mini (budget_exceeded)');
  });
});
