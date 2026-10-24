import { client, clearToken, currentToken, activeServerId } from '../api/client';
import { messageView } from '../gateway';
import type { AgentStatus } from '@crewly/sdk';
import type { Message } from '../../types';
import { MessageSchema } from '../../protocol/schemas/message';
import { AgentStatusSchema } from '../../protocol/schemas/agent';

let ws: ReturnType<typeof client.ws> | undefined;
export type AgentWorkEvent =
  | { type: 'consultation'; conversationId: string; parentRunId: string; fromAgentId: string; toAgentId: string; status: string }
  | { type: 'finished'; runId: string }
  | { type: 'reset' };
const workListeners = new Set<(event: AgentWorkEvent) => void>();
export function onAgentWorkChanged(listener: (event: AgentWorkEvent) => void): () => void {
  workListeners.add(listener);
  return () => { workListeners.delete(listener); };
}
const publishWork = (event: AgentWorkEvent) => { for (const listener of workListeners) listener(event); };
const threadListeners = new Set<(rootId: string) => void>();
export function onThreadChanged(listener: (rootId: string) => void): () => void {
  threadListeners.add(listener);
  return () => { threadListeners.delete(listener); };
}
export interface DevicePresence {
  deviceId: string;
  connected: boolean;
  name?: string;
  platform?: string;
}

export function startRealtime(
  onMessage: (message: Message) => void,
  onFailure: (error: string) => void,
  onDevice: (presence: DevicePresence) => void = () => {},
  onAgentStatus: (status: AgentStatus) => void = () => {},
  onChannelsChanged: () => void = () => {},
  /** A run ended; anything it asked approval for is waiting now. */
  onRunFinished: () => void = () => {},
  onConversationsChanged: () => void = () => {},
  bootstrapSeq?: number,
  onState: (state: string) => void = () => {},
): () => void {
  const sourceId = activeServerId();
  const token = currentToken();
  if (!token) return () => {};
  const seqKey = `crewly:realtime-seq:${token.slice(0,12)}`;
  const connection = client.ws(WebSocket);
  ws = connection;
  connection.onState((state) => {
    if (state !== 'connected') publishWork({ type: 'reset' });
    onState(state);
    if (state === 'unauthorized' && activeServerId() === sourceId) { onFailure('Your session has expired. Sign in again.'); clearToken(); }
  });
  connection.onEvent((event) => {
    if (!event.payload || typeof event.payload !== 'object' || typeof event.topic !== 'string') return;
    try { localStorage.setItem(seqKey, String(event.seq)); } catch { /* storage may be unavailable */ }
    if (event.type === 'message.created' || event.type === 'thread.updated') {
      const parsed = MessageSchema.safeParse(event.payload);
      if (!parsed.success) { onFailure('A live message could not be loaded. Reconnect live updates to refresh it.'); return; }
      const message = messageView(parsed.data);
      onMessage(message);
      const rootId = message.threadRootId ?? (event.type === 'thread.updated' ? message.id : undefined);
      if (rootId) for (const listener of threadListeners) listener(rootId);
    }
    if (event.type === 'thread.message.created') {
      const parsed = MessageSchema.safeParse(event.payload.message);
      if (!parsed.success) return;
      onMessage(messageView(parsed.data));
      if (typeof event.payload.rootMessageId === 'string') {
        for (const listener of threadListeners) listener(event.payload.rootMessageId);
      }
    }
    if (event.type === 'agent.run.failed') onFailure(String(event.payload.error ?? 'Agent response failed'));
    // Replayed on reconnect with everything else since the last seen event, so
    // a status that changed while the socket was down is not lost.
    if (event.type === 'agent.status') {
      const parsed = AgentStatusSchema.safeParse(event.payload);
      if (parsed.success) onAgentStatus(parsed.data);
    }
    // Names only which channel changed; what this reader may see of it comes from a refetch.
    if (event.type === 'conversations.changed') onConversationsChanged();
    if (event.type === 'channels.changed') onChannelsChanged();
    if (event.type === 'agent.run.finished') {
      onRunFinished();
      if (typeof event.payload.runId === 'string') publishWork({ type: 'finished', runId: event.payload.runId });
    }
    if (event.type === 'agent.delegation') {
      const { parentRunId, fromAgentId, toAgentId, status } = event.payload;
      const conversationId = typeof event.payload.conversationId === 'string' ? event.payload.conversationId
        : event.topic.startsWith('conversation:') ? event.topic.slice('conversation:'.length) : undefined;
      if (conversationId && typeof parentRunId === 'string' && typeof fromAgentId === 'string' && typeof toAgentId === 'string' && typeof status === 'string') {
        publishWork({ type: 'consultation', conversationId, parentRunId, fromAgentId, toAgentId, status });
      }
    }
    // Without these the devices panel only tells the truth on a page load: it
    // shows a freshly paired device as offline, and a stopped one as connected.
    if (event.type === 'device.connected' || event.type === 'device.disconnected') {
      const payload = event.payload as { deviceId?: unknown; name?: unknown; platform?: unknown };
      if (typeof payload.deviceId === 'string') {
        onDevice({
          deviceId: payload.deviceId,
          connected: event.type === 'device.connected',
          name: typeof payload.name === 'string' ? payload.name : undefined,
          platform: typeof payload.platform === 'string' ? payload.platform : undefined,
        });
      }
    }
  });
  let sequence = 0;
  try { sequence = Number(localStorage.getItem(seqKey) ?? '0'); } catch { /* replay from the beginning */ }
  if (bootstrapSeq !== undefined) sequence = bootstrapSeq;
  connection.connect({ token, sinceSeq: Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : 0 });
  const resume = () => { if (document.visibilityState !== 'hidden') connection.reconnect(); };
  window.addEventListener('online', resume);
  document.addEventListener('visibilitychange', resume);
  return () => {
    window.removeEventListener('online', resume);
    document.removeEventListener('visibilitychange', resume);
    connection.close();
    publishWork({ type: 'reset' });
    if (ws === connection) ws = undefined;
  };
}
export function resubscribeConversations(): void { ws?.reconnect(); }
