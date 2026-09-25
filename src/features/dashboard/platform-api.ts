import type {
  AgentRuntime,
  AgentRoutingConfig,
  AgentRun,
  AgentSkill,
  AgentStatus,
  AgentToolAssignment,
  Budget,
  CreateBudgetInput,
  McpCapability,
  McpServer,
  McpServerInput,
  McpTestResult,
  ProviderHealth,
  RunTrace,
  Secret,
  SecretGrant,
  SetAgentRuntimeInput,
  Skill,
  SkillInput,
  UsageGrouping,
  UsageReport,
  Channel,
} from '@crewly/sdk';
import { client } from '../../lib/api/client';

/**
 * The dashboard's newer sections -- spend, runs, secrets, tools, skills and
 * per-agent settings -- behind one seam, so each can be tested without a
 * server, the way the members and invites screens are.
 */
export interface PlatformApi {
  usage(groupBy: UsageGrouping): Promise<UsageReport>;
  budgets(): Promise<Budget[]>;
  createBudget(input: CreateBudgetInput): Promise<Budget>;
  deleteBudget(id: string): Promise<void>;
  providerHealth(): Promise<ProviderHealth[]>;

  failedRuns(): Promise<AgentRun[]>;
  run(runId: string): Promise<RunTrace>;

  secrets(): Promise<Secret[]>;
  createSecret(input: { name: string; value: string; description?: string }): Promise<Secret>;
  rotateSecret(id: string, value: string): Promise<Secret>;
  revokeSecret(id: string): Promise<Secret>;
  setSecretGrants(id: string, grants: SecretGrant[]): Promise<Secret>;
  deleteSecret(id: string, force?: boolean): Promise<void>;

  mcpServers(): Promise<McpServer[]>;
  createMcpServer(input: McpServerInput): Promise<McpServer>;
  testMcpServer(id: string): Promise<McpTestResult>;
  setDisabledTools(id: string, disabled: string[]): Promise<McpServer>;
  deleteMcpServer(id: string): Promise<void>;

  skills(): Promise<Skill[]>;
  createSkill(input: SkillInput): Promise<Skill>;
  installSkill(manifest: string): Promise<Skill>;
  deleteSkill(id: string): Promise<void>;

  agentStatus(agentId: string): Promise<AgentStatus>;
  setAvailability(agentId: string, availability: 'auto' | 'dnd'): Promise<AgentStatus>;
  agentRouting(agentId: string): Promise<AgentRoutingConfig>;
  setAgentRouting(agentId: string, input: { mode: AgentRoutingConfig['defaultMode'] | 'inherit'; conversationId?: string | null }): Promise<AgentRoutingConfig>;
  channels(): Promise<Channel[]>;
  agentRuntime(agentId: string): Promise<AgentRuntime>;
  setAgentRuntime(agentId: string, input: SetAgentRuntimeInput): Promise<AgentRuntime>;
  agentTools(agentId: string): Promise<AgentToolAssignment[]>;
  setAgentTools(agentId: string, tools: Array<{ serverId: string; toolName: string }>, acknowledge: McpCapability[]): Promise<AgentToolAssignment[]>;
  agentSkills(agentId: string): Promise<AgentSkill[]>;
  setAgentSkills(agentId: string, skills: Array<{ skillId: string; enabled: boolean; config: Record<string, string> }>): Promise<AgentSkill[]>;
  delegates(agentId: string): Promise<Array<{ agentId: string; name: string }>>;
  setDelegates(agentId: string, agentIds: string[]): Promise<Array<{ agentId: string; name: string }>>;
}

export const platformApi: PlatformApi = {
  usage: (groupBy) => client.usage.report({ groupBy }),
  budgets: async () => (await client.usage.budgets()).budgets,
  createBudget: (input) => client.usage.createBudget(input),
  deleteBudget: (id) => client.usage.deleteBudget(id),
  providerHealth: async () => (await client.providers.health()).providers,

  failedRuns: async () => (await client.runs.list({ status: 'failed', limit: 50 })).runs,
  run: (runId) => client.runs.get(runId),

  secrets: async () => (await client.secrets.list()).secrets,
  createSecret: (input) => client.secrets.create(input),
  rotateSecret: (id, value) => client.secrets.rotate(id, value),
  revokeSecret: (id) => client.secrets.revoke(id),
  setSecretGrants: (id, grants) => client.secrets.setGrants(id, grants),
  deleteSecret: (id, force) => client.secrets.delete(id, { force }),

  mcpServers: async () => (await client.mcp.list()).servers,
  createMcpServer: (input) => client.mcp.create(input),
  testMcpServer: (id) => client.mcp.test(id),
  setDisabledTools: (id, disabled) => client.mcp.setDisabledTools(id, disabled),
  deleteMcpServer: (id) => client.mcp.delete(id),

  skills: async () => (await client.skills.list()).skills,
  createSkill: (input) => client.skills.create(input),
  installSkill: (manifest) => client.skills.install(manifest),
  deleteSkill: (id) => client.skills.delete(id),

  agentStatus: (agentId) => client.agents.status(agentId),
  setAvailability: (agentId, availability) => client.agents.setAvailability(agentId, availability),
  agentRouting: (agentId) => client.agents.routing(agentId),
  setAgentRouting: (agentId, input) => client.agents.setRouting(agentId, input),
  channels: async () => (await client.channels.list()).channels,
  agentRuntime: (agentId) => client.agents.runtime(agentId),
  setAgentRuntime: (agentId, input) => client.agents.setRuntime(agentId, input),
  agentTools: async (agentId) => (await client.mcp.agentTools(agentId)).tools,
  setAgentTools: async (agentId, tools, acknowledge) => (await client.mcp.setAgentTools(agentId, tools, acknowledge)).tools,
  agentSkills: async (agentId) => (await client.skills.forAgent(agentId)).skills,
  setAgentSkills: async (agentId, skills) => (await client.skills.setForAgent(agentId, skills)).skills,
  delegates: async (agentId) => (await client.agents.delegates(agentId)).delegates,
  setDelegates: async (agentId, agentIds) => (await client.agents.setDelegates(agentId, agentIds)).delegates,
};
