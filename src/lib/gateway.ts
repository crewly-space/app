import type { Agent as ApiAgent, ApprovalRequest, Attachment as ApiAttachment, Channel, ChannelCategory, Conversation as ApiConversation, ConversationReplyMode, CreateChannelInput, DevicePairingInfo, DirectoryAgent, DirectoryUser, Message as ApiMessage, UpdateChannelInput } from '@crewly/sdk';
import { client, clearToken } from './api/client';
import type { Agent, Approval, Conversation, Message, Provider } from '../types';
import { withStatus } from './agent-status';
import { deviceProviderAvailability, explain, type DeviceProviderKind } from '../features/providers/availability';

function agentView(agent: ApiAgent, memory: string[] = []): Agent {
  const [role = '', ...instructions] = agent.personality.split('\n');
  return { id: agent.id, ownerUserId: agent.ownerUserId, name: agent.name, avatarMode: agent.avatarMode ?? 'bloop', initials: agent.name[0]?.toUpperCase() ?? '?',
    role: role || 'Agent', instructions: instructions.join('\n'), color: '#7857d8', status: 'unknown',
    model: agent.modelPolicy.defaultModel, providerId: agent.modelPolicy.defaultProviderId,
    runtime: 'Chat', memoryEnabled: true, memory };
}
/** Someone else's agent: only its name and avatar are the reader's to see. */
function directoryAgentView(agent: DirectoryAgent): Agent {
  return { id: agent.id, name: agent.name, avatarMode: agent.avatarMode ?? 'bloop', initials: agent.name[0]?.toUpperCase() ?? '?',
    role: 'Agent', instructions: '', color: '#7857d8', status: 'unknown', model: '', providerId: '', runtime: 'Chat', memoryEnabled: false, memory: [] };
}
function conversationView(conversation: ApiConversation, agents: Agent[], people: DirectoryUser[] = [], currentUserId?: string): Conversation {
  const agentIds = conversation.participants.filter((p) => p.participantType === 'agent').map((p) => p.participantId);
  const personIds = conversation.participants.filter((p) => p.participantType === 'user' && p.participantId !== currentUserId).map((p) => p.participantId);
  const peer = !agentIds.length && conversation.kind === 'dm' ? people.find((person) => person.id === personIds[0]) : undefined;
  return { personIds, ...(peer ? { peer } : {}), id: conversation.id, name: conversation.kind === 'group' ? conversation.name ?? 'Group DM'
      : agents.find((a) => a.id === agentIds[0])?.name ?? peer?.displayName ?? 'Direct message',
    type: conversation.kind, agentIds, preview: '', time: '' };
}
/** A channel is a conversation to the rest of the app; the channel rides along for what only channels have. */
export function channelView(channel: Channel): Conversation {
  return { id: channel.id, name: channel.name, type: 'channel', channel, preview: '', time: '',
    agentIds: channel.members.filter((m) => m.participantType === 'agent').map((m) => m.participantId) };
}
/** Whether the reader can see a channel's history: any public one, or a private one they are in. */
const readable = (channel: Channel) => channel.joined || channel.visibility === 'public';
/**
 * A pending approval as the conversation shows it. A tool approval says what
 * would run, where, how risky it is and why it asked; the arguments come
 * already redacted by the server.
 */
export function approvalView(approval: ApprovalRequest, now = Date.now()): Approval {
  const details = approval.details as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  const connection = (details.connection ?? {}) as { name?: string; trust?: string };
  const tool = details.kind === 'tool';
  const args = tool && details.arguments && typeof details.arguments === 'object' && Object.keys(details.arguments).length
    ? JSON.stringify(details.arguments) : '';
  const reason = text(details.reason);
  const left = approval.expiresAt ? Date.parse(approval.expiresAt) - now : NaN;
  const minutes = Math.max(0, Math.round(left / 60_000));
  return {
    id: approval.id,
    conversationId: text(details.conversationId),
    agentId: approval.agentId,
    capability: approval.action,
    description: tool
      ? [`Wants to ${text(details.title) || approval.action}.`, reason && `Asked because of ${reason}.`, args && `With ${args.length > 400 ? `${args.slice(0, 400)}…` : args}`].filter(Boolean).join(' ')
      : `Needs ${text(details.capability) || approval.action}.`,
    workspace: tool
      ? [connection.name, text(details.risk).replace('_', ' '), connection.trust].filter(Boolean).join(' · ')
      : 'This server',
    requestedAt: new Date(approval.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    expiresIn: Number.isNaN(left) ? '' : minutes >= 120 ? `${Math.round(minutes / 60)}h` : `${minutes}m`,
  };
}

export function messageView(message: ApiMessage): Message {
  return { id: message.id, conversationId: message.conversationId,
    author: message.authorType === 'user' ? 'you' : message.authorType === 'integration' ? 'Webhook' : message.authorId,
    ...(message.authorType === 'user' ? { userId: message.authorId } : {}),
    body: message.body, createdAt: message.createdAt, time: new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    attachments: message.attachments ?? [],
    replyTo: message.replyToMessageId ?? undefined,
    threadRootId: message.threadRootId ?? undefined,
    thread: message.thread ?? null };
}
/** How long the last bootstraps took, newest last. Read from the console as `crewlyBootTimings`. */
export const bootTimings: Array<{ at: string; firstRoundMs: number; secondRoundMs: number }> = [];
function recordBootTiming(timing: { firstRoundMs: number; secondRoundMs: number }): void {
  bootTimings.push({ at: new Date().toISOString(), ...timing });
  if (bootTimings.length > 20) bootTimings.shift();
  (globalThis as { crewlyBootTimings?: typeof bootTimings }).crewlyBootTimings = bootTimings;
  try {
    performance.measure?.('crewly:bootstrap', { start: 0, duration: timing.firstRoundMs + timing.secondRoundMs });
  } catch { /* measuring is best effort */ }
}

export const gateway = {
  async agentRuntime(agentId: string) {
    const runtime = await client.agents.runtime(agentId);
    return { runtime: runtime.runtimeKind === 'native' ? 'Chat' : runtime.runtimeKind,
      workspace: runtime.binding?.workspaceName || undefined, runtimeSessions: runtime.sessions };
  },
  async messageContext(messageId: string): Promise<Message[]> {
    return (await client.messages.context(messageId)).messages.map(messageView);
  },
  async history(conversationId: string, before?: string): Promise<Message[]> {
    return (await client.messages.list(conversationId, 200, before)).map(messageView);
  },
  async searchMessages(query: string): Promise<Message[]> {
    return (await client.messages.search(query)).messages.map(messageView);
  },
  /*
   * Everything one server's workspace needs, in two rounds instead of five.
   *
   * The first round asks for everything that does not depend on anything
   * else -- who is signed in, agents, conversations, channels, devices,
   * statuses -- at once. The second asks for what does: the lists only an
   * admin may read, each agent's memory, and each conversation's history.
   * How long each round took is recorded, so a slow start can be measured.
  */
  async bootstrap() {
    const started = performance.now();
    // Capture changes during bootstrap without replaying all old messages.
    const realtimeSeq = await client.realtimeCursor().then((result) => result.seq).catch(() => undefined);
    const [currentUser, apiAgents, apiConversations, devices, directory, channelList, statuses] = await Promise.all([
      client.auth.me(),
      client.agents.list(),
      client.conversations.list(),
      client.devices.list(),
      // Everyone's name and avatar, for drawing who wrote what. A server from
      // before the directory gives nothing, and people fall back to defaults.
      client.users.directory().catch(() => ({ users: [] as DirectoryUser[], agents: [] as DirectoryAgent[] })),
      client.channels.list().catch(() => ({ channels: [] as Channel[], categories: [] as ChannelCategory[] })),
      client.agents.statuses().then((result) => result.statuses).catch(() => null),
    ]);
    const firstRound = performance.now();
    const people = directory.users;
    const canManage = currentUser.role === 'owner' || currentUser.role === 'admin';
    const [apiProviders, users, apiConnectors, serverBranding, memories, histories, pendingApprovals, runtimes] = await Promise.all([
      canManage ? client.providers.list() : client.providers.listAvailable(),
      canManage ? client.users.list() : Promise.resolve([]),
      canManage ? client.connectors.list().then((result) => result.connectors).catch(() => []) : Promise.resolve([]),
      client.server.branding().catch(() => ({ displayName: 'Crewly', tagline: '', iconDataUrl: null, updatedAt: null })),
      Promise.all(apiAgents.map((agent) => canManage || agent.ownerUserId === currentUser.id
        ? client.memory.listFacts(agent.id).catch(() => []) : Promise.resolve([]))),
      Promise.all([
        ...apiConversations.map((c) => client.messages.list(c.id, 200)),
        ...channelList.channels.filter(readable).map((c) => client.messages.list(c.id, 200)),
      ]),
      client.approvals.list().catch(() => [] as ApprovalRequest[]),
      Promise.all(apiAgents.map((agent) => (canManage || agent.ownerUserId === currentUser.id) ? client.agents.runtime(agent.id).catch(() => null) : Promise.resolve(null))),
    ]);
    recordBootTiming({ firstRoundMs: firstRound - started, secondRoundMs: performance.now() - firstRound });
    const agents = apiAgents.map((a, index) => {
      const agent = agentView(a, memories[index]!.map((f) => f.content));
      const runtime = runtimes[index];
      if (!runtime) return agent;
      return { ...agent, runtime: runtime.runtimeKind === 'native' ? 'Chat' : runtime.runtimeKind,
        workspace: runtime.binding?.workspaceName || undefined, runtimeSessions: runtime.sessions };
    });
    const conversations = [...apiConversations.map((c) => conversationView(c, agents, people, currentUser.id)), ...channelList.channels.map(channelView)];
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
    const withStatuses = agents.map((agent) => {
      const canonical = statuses?.find((status) => status.agentId === agent.id);
      if (canonical) return withStatus(agent, canonical);
      return {
        ...agent,
        status: agent.providerId && reachable.has(agent.providerId) ? ('online' as const) : ('offline' as const),
      };
    });
    const own = new Set(agents.map((agent) => agent.id));
    const otherAgents = (directory.agents ?? []).filter((agent) => !own.has(agent.id)).map((entry) => {
      const canonical = statuses?.find((status) => status.agentId === entry.id);
      return canonical ? withStatus(directoryAgentView(entry), canonical) : directoryAgentView(entry);
    });
    return { realtimeSeq, agents: withStatuses, otherAgents, conversations, channelCategories: channelList.categories, messages, providers,
      approvals: pendingApprovals.map((approval) => approvalView(approval)), currentUser, users, devices, people, connectors: apiConnectors, serverBranding };
  },
  async createAgent(input: { name: string; role: string; model: string; providerId: string; instructions?: string; avatarMode?: Agent['avatarMode'] }): Promise<Agent> {
    const api = await client.agents.create({ name: input.name, avatarMode: input.avatarMode,
      personality: [input.role, input.instructions ?? ''].join('\n'),
      modelPolicy: { defaultProviderId: input.providerId, defaultModel: input.model } });
    return agentView(api);
  },
  async updateAgent(id: string, input: Partial<Agent>): Promise<Agent> {
    const list = await client.agents.list();
    const existing = list.find((a) => a.id === id);
    if (!existing) throw new Error('Agent not found');
    const current = agentView(existing);
    const updated = await client.agents.update(id, { name: input.name ?? current.name, avatarMode: input.avatarMode,
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
  /** Changes the signed-in person's own avatar, for everyone on this server. */
  async setMyAvatarMode(avatarMode: NonNullable<Agent['avatarMode']>): Promise<void> {
    await client.users.updateMe({ avatarMode });
  },
  async conversations(agents: Agent[], people: DirectoryUser[], currentUserId: string): Promise<Conversation[]> {
    return (await client.conversations.list()).filter((conversation) => conversation.kind !== 'channel')
      .map((conversation) => conversationView(conversation, agents, people, currentUserId));
  },
  async createConversation(participants: { participantId: string; participantType: 'user' | 'agent' }[], name: string, agents: Agent[], people: DirectoryUser[], currentUserId: string): Promise<Conversation> {
    const conversation = participants.length === 1
      ? await client.conversations.createDm(participants[0])
      : await client.conversations.createGroup({ name, participants });
    return conversationView(conversation, agents, people, currentUserId);
  },
  async createDm(agentId: string, agents: Agent[]): Promise<Conversation> {
    const dm = await client.conversations.createDm({ participantId: agentId, participantType: 'agent' });
    return conversationView(dm, agents);
  },
  /** Channels and their categories, with each readable channel's history. */
  async channels() {
    const list = await client.channels.list();
    const histories = await Promise.all(list.channels.filter(readable).map((c) => client.messages.list(c.id, 200)));
    return { channels: list.channels.map(channelView), categories: list.categories, messages: histories.flat().map(messageView) };
  },
  createChannel: (input: CreateChannelInput) => client.channels.create(input).then(channelView),
  updateChannel: (id: string, input: UpdateChannelInput) => client.channels.update(id, input).then(channelView),
  joinChannel: (id: string) => client.channels.join(id).then(channelView),
  leaveChannel: (id: string) => client.channels.leave(id),
  addChannelMember: (id: string, participantId: string, participantType: 'user' | 'agent') =>
    client.channels.addMember(id, { participantId, participantType }).then(channelView),
  removeChannelMember: (id: string, participantId: string, participantType: 'user' | 'agent') =>
    client.channels.removeMember(id, { participantId, participantType }).then(channelView),
  setChannelAgentBlocked: (id: string, agentId: string, blocked: boolean) =>
    (blocked ? client.channels.blockAgent(id, agentId) : client.channels.unblockAgent(id, agentId)).then(channelView),
  orderChannels: (categoryId: string | null, channelIds: string[]) => client.channels.order(categoryId, channelIds),
  createChannelCategory: (name: string) => client.channels.createCategory(name),
  async sendMessage(id: string, body: string, replyToMessageId?: string,
    mentions: { targetId: string; targetType: 'user' | 'agent' }[] = [], attachmentIds: string[] = []): Promise<Message> {
    return messageView(await client.messages.send(id, { body, replyToMessageId, mentions, attachmentIds }));
  },
  async openThread(messageId: string) { return client.messages.openThread(messageId); },
  async thread(rootMessageId: string) {
    const result = await client.messages.thread(rootMessageId);
    return { thread: result.thread, messages: result.messages.map(messageView) };
  },
  async sendThread(rootMessageId: string, body: string, mentions: { targetId: string; targetType: 'user' | 'agent' }[] = []) {
    return messageView(await client.messages.sendThread(rootMessageId, { body, mentions }));
  },
  replyMode: (conversationId: string) => client.conversations.replyMode(conversationId).then((result) => result.replyMode),
  setReplyMode: (conversationId: string, replyMode: ConversationReplyMode) =>
    client.conversations.setReplyMode(conversationId, { replyMode }).then((result) => result.replyMode),
  setThreadStatus: (rootMessageId: string, status: 'open' | 'resolved' | 'archived') => client.messages.setThreadStatus(rootMessageId, status),
  async uploadAttachment(conversationId: string, file: File): Promise<ApiAttachment> {
    const dataBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error('Could not read attachment'));
      reader.onload = () => {
        const result = String(reader.result ?? '');
        const comma = result.indexOf(',');
        resolve(comma === -1 ? result : result.slice(comma + 1));
      };
      reader.readAsDataURL(file);
    });
    return client.attachments.upload({ conversationId, filename: file.name, mimeType: file.type || 'application/octet-stream', dataBase64 });
  },
  removeAttachment: (id: string) => client.attachments.remove(id),
  async downloadAttachment(id: string, filename: string): Promise<void> {
    const blob = await client.attachments.download(id);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
  /** Approving a tool call runs it; "always" also stops this agent asking for that tool again. */
  async approve(id: string, decision: 'once' | 'always' | 'deny') {
    await client.approvals.respond(id, decision === 'deny' ? 'deny' : 'approve', decision === 'always' ? { remember: true } : {}); return true;
  },
  async approvals(): Promise<Approval[]> {
    return (await client.approvals.list()).map((approval) => approvalView(approval));
  },
  async dismissApproval(_id: string) { return false; },
  async createUser(input: { displayName: string; email: string; password: string; role: 'member' | 'admin' }) {
    return client.users.create(input);
  },
  async createInvite(input: { role: 'member' | 'admin'; email?: string }) {
    return client.users.createInvite(input);
  },
  async findDevicePairing(code: string): Promise<DevicePairingInfo> {
    return client.devices.pairingByCode(code.trim().toUpperCase());
  },
  async approveDevicePairing(code: string) {
    return client.devices.approvePairing(code.trim().toUpperCase());
  },
  async logout() { try { await client.auth.logout(); } finally { clearToken(); } },
};
