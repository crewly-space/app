// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Agent, AgentToolAccess as Access, ApprovalRequest, NormalizedTool, Skill, SkillPlan, ToolExecution } from '@crewly/sdk';
import { AgentToolAccess } from '../src/features/dashboard/AgentToolAccess';
import type { PlatformApi } from '../src/features/dashboard/platform-api';
import { SkillPlanCard } from '../src/features/dashboard/SkillPlanCard';
import { ToolActivityPanel } from '../src/features/dashboard/ToolActivityPanel';
import { approvalView } from '../src/lib/gateway';

afterEach(cleanup);

const agent = { id: 'a1', name: 'backend-engineer' } as Agent;

const tool = (ref: string, risk: NormalizedTool['risk'], permission: string): NormalizedTool => ({
  ref, namespace: ref.split('.')[0]!, name: ref.split('.')[1]!, modelName: ref.replace('.', '__'), description: '', inputSchema: { type: 'object' },
  provider: ref.split('.')[0]!, category: 'development', areas: [], risk, permission,
  source: { kind: 'mcp_server', connectionId: `c-${ref.split('.')[0]}`, connectionName: ref.split('.')[0] === 'github' ? 'GitHub' : 'Sentry', trust: 'official', toolName: ref.split('.')[1]! },
});

const api = (overrides: Partial<PlatformApi>) => overrides as PlatformApi;

describe('approvals in the conversation', () => {
  it('says what a tool approval would run, where, and why it asked', () => {
    const approval: ApprovalRequest = {
      id: 'ap1', runId: 'r1', agentId: 'a1', action: 'github.merge_pull_request', status: 'pending',
      createdAt: '2026-09-28T18:42:31.000Z', resolvedAt: null, expiresAt: '2026-09-29T18:42:31.000Z',
      details: {
        kind: 'tool', title: 'merge pull request on GitHub', conversationId: 'conv1', risk: 'deploy', permission: 'pull_request:merge',
        reason: "this agent's rule for permission pull_request:merge", connection: { name: 'GitHub', trust: 'official' },
        arguments: { repo: 'acme/shop', pullNumber: 42 },
      },
    };
    const view = approvalView(approval, Date.parse('2026-09-28T18:42:31.000Z'));
    expect(view).toMatchObject({ id: 'ap1', conversationId: 'conv1', agentId: 'a1', capability: 'github.merge_pull_request', workspace: 'GitHub · deploy · official', expiresIn: '24h' });
    expect(view.description).toContain('Wants to merge pull request on GitHub.');
    expect(view.description).toContain('"pullNumber":42');
  });
});

describe('tool permissions for an agent', () => {
  const access: Access[] = [
    { tool: tool('sentry.get_issue_details', 'read', 'errors:read'), skillId: 's1', mode: 'always', reason: 'the default for read tools', exposed: true },
    { tool: tool('github.merge_pull_request', 'deploy', 'pull_request:merge'), skillId: 's1', mode: 'ask_every_time', reason: "this agent's rule for permission pull_request:merge", exposed: true },
  ];

  it('shows each tool\'s risk, what happens when it is called, and why', async () => {
    render(<AgentToolAccess api={api({ agentToolAccess: async () => access, agentToolPolicies: async () => [] })} agentId="a1" agentName="backend-engineer" />);
    expect(await screen.findByText('merge_pull_request')).toBeTruthy();
    expect(screen.getByText('Deploys', { selector: '.badge' })).toBeTruthy();
    expect(screen.getByText('Ask every time', { selector: '.badge' })).toBeTruthy();
    expect(screen.getByText(/rule for permission pull_request:merge/)).toBeTruthy();
    expect(screen.getByText('GitHub')).toBeTruthy();
  });

  it('writes a rule for exactly one tool and keeps the others', async () => {
    const setAgentToolPolicies = vi.fn(async () => []);
    const existing = { id: 'p1', agentId: 'a1', selectorType: 'permission' as const, selector: 'errors:read', mode: 'always' as const, sourceSkillId: 's1', createdAt: '', updatedAt: '' };
    render(<AgentToolAccess api={api({ agentToolAccess: async () => access, agentToolPolicies: async () => [existing], setAgentToolPolicies })} agentId="a1" agentName="backend-engineer" />);
    fireEvent.change(await screen.findByLabelText('When backend-engineer uses github.merge_pull_request'), { target: { value: 'blocked' } });
    await waitFor(() => expect(setAgentToolPolicies).toHaveBeenCalledWith('a1', [
      { selectorType: 'permission', selector: 'errors:read', mode: 'always' },
      { selectorType: 'tool', selector: 'github.merge_pull_request', mode: 'blocked' },
    ]));
  });
});

describe('installing a skill', () => {
  const skill = { id: 's1', name: 'Production Bug Fixer' } as Skill;
  const plan: SkillPlan = {
    skillId: 's1', ready: true, missing: [], unavailable: [],
    requirements: [
      { capability: 'error_tracking', oneOf: ['sentry'], required: true, candidates: [{ id: 'sentry', name: 'Sentry' }], satisfiedBy: [{ connectionId: 'c-sentry', connectionName: 'Sentry', provider: 'sentry' }] },
      { capability: 'deployment', oneOf: [], required: false, candidates: [{ id: 'vercel', name: 'Vercel' }], satisfiedBy: [] },
    ],
    permissions: [
      { permission: 'errors:read', approval: false, tools: [{ ref: 'sentry.get_issue_details', connectionId: 'c-sentry', connectionName: 'Sentry', connectionKind: 'mcp_server', toolName: 'get_issue_details', risk: 'read', serverCapabilities: ['network'] }] },
      { permission: 'pull_request:merge', approval: true, tools: [{ ref: 'github.merge_pull_request', connectionId: 'c-gh', connectionName: 'GitHub', connectionKind: 'mcp_server', toolName: 'merge_pull_request', risk: 'deploy', serverCapabilities: ['network'] }] },
    ],
  };

  it('shows what it needs and what always asks, and authorizes only once the access is acknowledged', async () => {
    const authorizeSkill = vi.fn(async () => []);
    const onAuthorized = vi.fn();
    render(<SkillPlanCard api={api({ skillPlan: async () => plan, authorizeSkill })} skill={skill} agents={[agent]} onAuthorized={onAuthorized} />);
    expect(await screen.findByText('Error tracking')).toBeTruthy();
    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.getByText('Always asks for approval')).toBeTruthy();
    expect(screen.getByText('github.merge_pull_request')).toBeTruthy();
    const submit = screen.getByText('Authorize and install') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/I understand these tools use network access/));
    fireEvent.click(submit);
    await waitFor(() => expect(authorizeSkill).toHaveBeenCalledWith('a1', 's1', ['network']));
    expect(onAuthorized).toHaveBeenCalledWith('backend-engineer');
  });

  it('says what to connect when a requirement is missing', async () => {
    render(<SkillPlanCard api={api({ skillPlan: async () => ({ ...plan, ready: false, missing: ['code_host'] }), authorizeSkill: vi.fn() })} skill={skill} agents={[agent]} />);
    expect(await screen.findByText(/Connect Code host first/)).toBeTruthy();
    expect(screen.queryByText('Authorize and install')).toBeNull();
  });
});

describe('tool activity', () => {
  it('lists every call with who made it and how it went, and every decision', async () => {
    const execution: ToolExecution = {
      id: 'e1', createdAt: '2026-09-28T18:42:31.000Z', agentId: 'a1', userId: 'u1', runId: 'r1', conversationId: 'c1', skillId: 's1',
      connectionKind: 'mcp_server', connectionId: 'c-gh', provider: 'github', toolRef: 'github.create_pull_request', toolName: 'create_pull_request',
      risk: 'write', permission: 'pull_request:create', arguments: { repo: 'acme/shop', token: '[redacted]' }, status: 'success',
      policyMode: 'always', approvalId: null, resultMeta: { bytes: 40 }, durationMs: 714, error: null,
    };
    const decision = { id: 'ap1', runId: 'r1', agentId: 'a1', action: 'github.merge_pull_request', details: {}, status: 'approved', createdAt: '', resolvedAt: '2026-09-28T18:50:00.000Z',
      execution: { status: 'success', toolRef: 'github.merge_pull_request', content: '' } } as ApprovalRequest;
    render(<ToolActivityPanel api={api({ toolExecutions: async () => [execution], approvalHistory: async () => [decision] })} agents={[agent]} />);
    expect(await screen.findByText('github.create_pull_request')).toBeTruthy();
    expect(screen.getAllByText('backend-engineer', { selector: 'td' })).toHaveLength(2);
    expect(screen.getByText('Ran', { selector: '.badge' })).toBeTruthy();
    expect(screen.getByText('Ran after approval')).toBeTruthy();
    fireEvent.click(screen.getByText('Details'));
    expect(screen.getByText(/714 ms/)).toBeTruthy();
    expect(screen.getByText(/\[redacted\]/)).toBeTruthy();
  });
});
