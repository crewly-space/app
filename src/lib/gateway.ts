import type { Agent as ApiAgent, Conversation as ApiConversation, DevicePairingInfo, Message as ApiMessage } from '@crewly/sdk';
import { client, clearToken } from './api/client';
import type { Agent, Conversation, Message, Provider } from '../types';
import { withStatus } from './agent-status';
import { deviceProviderAvailability, explain, type DeviceProviderKind } from '../features/providers/availability';

function agentView(agent: ApiAgent, memory: string[] = []): Agent {
  const [role = '', ...instructions] = agent.personality.split('\n');
  return { id: agent.id, name: agent.name, initials: agent.name[0]?.toUpperCase() ?? '?',
    role: role || 'Agent', instructions: instructions.join('\n'), color: '#7857d8', status: 'unknown',
    model: agent.modelPolicy.defaultModel, providerId: agent.modelPolicy.defaultProviderId,
    runtime: 'Chat', memoryEnabled: true, memory };
}
function conversationView(conversation: ApiConversation, agents: Agent[]): Conversation {
  const agentIds = conversation.participants.filter((p) => p.participantType === 'agent').map((p) => p.participantId);
  return { id: conversation.id, name: conversation.kind === 'group' ? conversation.name ?? 'Group'
      : agents.find((a) => a.id === agentIds[0])?.name ?? 'DM',
    type: conversation.kind, agentIds, preview: '', time: '' };
}
export function messageView(message: ApiMessage): Message {
  return { id: message.id, conversationId: message.conversationId,
    author: message.authorType === 'user' ? 'you' : message.authorId,
    ...(message.authorType === 'user' ? { userId: message.authorId } : {}),
    body: message.body, time: new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    replyTo: message.replyToMessageId ?? undefined };
}
export const gateway = {
  async bootstrap() {
    const currentUser = await client.auth.me();
    const canManage = currentUser.role === 'owner' || currentUser.role === 'admin';
    const [apiAgents, apiConversations, apiProviders, users, devices] = await Promise.all([
      client.agents.list(), client.conversations.list(),
      canManage ? client.providers.list() : client.providers.listAvailable(),
      canManage ? client.users.list() : Promise.resolve([]),
      client.devices.list(),
    ]);
    const agents = await Promise.all(apiAgents.map(async (a) =>
      agentView(a, (await client.memory.listFacts(a.id)).map((f) => f.content))));
    const conversations = apiConversations.map((c) => conversationView(c, agents));
    const histories = await Promise.all(apiConversations.map((c) => client.messages.list(c.id, 200)));
    const messages = histories.flat().map(messageView);
    const providers: Provider[] = apiProviders.map((p) => {
      const local = p.kind === 'claude-subscription' || p.kind === 'ollama';
      if (!local) {
        return { id: p.id, name: p.kind, detail: p.hasApiKey ? 'API key configured' : 'No API key',
          status: p.hasApiKey ? 'connected' : 'missing', local };
      }
      // A device-backed provider is as available as the device behind it. The
      // agents on it keep their configuration either way; the reason says
      // what to fix, rather than one "no device" for every way it can fail.
      const availability = deviceProviderAvailability(devices, p.kind as DeviceProviderKind);
      return { id: p.id, name: p.kind, local,
        detail: availability.state === 'ready' ? `Through ${availability.deviceName}` : explain(p.kind as DeviceProviderKind, availability),
        status: availability.state === 'ready' ? 'connected' : 'missing' };
    });
    // An agent is only as available as the provider behind it, and the server
    // now refuses a run without one. Reporting every agent as "unknown" told
    // the reader nothing they could act on.
    const reachable = new Set(providers.filter((p) => p.status === 'connected').map((p) => p.id));
    // The server knows what each agent is doing and why it cannot run; ask it.
    // A server from before canonical status gets the old estimate instead.
    const statuses = await client.agents.statuses().then((result) => result.statuses).catch(() => null);
    const withStatuses = agents.map((agent) => {
      const canonical = statuses?.find((status) => status.agentId === agent.id);
      if (canonical) return withStatus(agent, canonical);
      return {
        ...agent,
        status: agent.providerId && reachable.has(agent.providerId) ? ('online' as const) : ('offline' as const),
      };
    });
    return { agents: withStatuses, conversations, messages, providers,
      approvals: [], currentUser, users, devices };
  },
  async createAgent(input: { name: string; role: string; model: string; providerId: string; instructions?: string }): Promise<Agent> {
    const api = await client.agents.create({ name: input.name,
      personality: [input.role, input.instructions ?? ''].join('\n'),
      modelPolicy: { defaultProviderId: input.providerId, defaultModel: input.model } });
    return agentView(api);
  },
  async updateAgent(id: string, input: Partial<Agent>): Promise<Agent> {
    const list = await client.agents.list();
    const existing = list.find((a) => a.id === id);
    if (!existing) throw new Error('Agent not found');
    const current = agentView(existing);
    const updated = await client.agents.update(id, { name: input.name ?? current.name,
      personality: [input.role ?? current.role, input.instructions ?? current.instructions ?? ''].join('\n'),
      modelPolicy: { defaultProviderId: input.providerId ?? current.providerId!, defaultModel: input.model ?? current.model } });
    if (input.memory) {
      const existingFacts = await client.memory.listFacts(id);
      const desired = new Set(input.memory.map((item) => item.trim()).filter(Boolean));
      for (const fact of existingFacts) if (!desired.has(fact.content)) await client.memory.deleteFact(id, fact.id);
      const existing = new Set(existingFacts.map((fact) => fact.content));
      for (const item of desired) if (!existing.has(item)) await client.memory.createFact(id, { content: item, source: 'manual' });
    }
    return agentView(updated, input.memory ?? current.memory);
  },
  async createDm(agentId: string, agents: Agent[]): Promise<Conversation> {
    const dm = await client.conversations.createDm({ participantId: agentId, participantType: 'agent' });
    return conversationView(dm, agents);
  },
  async sendMessage(id: string, body: string, replyToMessageId?: string): Promise<Message> {
    return messageView(await client.messages.send(id, { body, replyToMessageId }));
  },
  async approve(id: string, decision: 'once' | 'always' | 'deny') {
    await client.approvals.respond(id, decision === 'deny' ? 'deny' : 'approve'); return true;
  },
  async dismissApproval(_id: string) { return false; },
  async createUser(input: { displayName: string; email: string; password: string; role: 'member' | 'admin' }) {
    return client.users.create(input);
  },
  async findDevicePairing(code: string): Promise<DevicePairingInfo> {
    return client.devices.pairingByCode(code.trim().toUpperCase());
  },
  async approveDevicePairing(code: string) {
    return client.devices.approvePairing(code.trim().toUpperCase());
  },
  async logout() { try { await client.auth.logout(); } finally { clearToken(); } },
};
