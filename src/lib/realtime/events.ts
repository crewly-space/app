import { client, currentToken } from '../api/client';
import { messageView } from '../gateway';
import type { AgentStatus } from '@crewly/sdk';
import type { Message } from '../../types';

let ws: ReturnType<typeof client.ws> | undefined;
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
): () => void {
  const token = currentToken();
  if (!token) return () => {};
  const seqKey = `crewly:realtime-seq:${token.slice(0,12)}`;
  const connection = client.ws(WebSocket);
  ws = connection;
  connection.onEvent((event) => {
    try { localStorage.setItem(seqKey, String(event.seq)); } catch { /* storage may be unavailable */ }
    if (event.type === 'message.created' || event.type === 'thread.updated') {
      const message = messageView(event.payload as never);
      onMessage(message);
      const rootId = message.threadRootId ?? (event.type === 'thread.updated' ? message.id : undefined);
      if (rootId) for (const listener of threadListeners) listener(rootId);
    }
    if (event.type === 'thread.message.created') {
      onMessage(messageView(event.payload.message as never));
      if (typeof event.payload.rootMessageId === 'string') {
        for (const listener of threadListeners) listener(event.payload.rootMessageId);
      }
    }
    if (event.type === 'agent.run.failed') onFailure(String(event.payload.error ?? 'Agent response failed'));
    // Replayed on reconnect with everything else since the last seen event, so
    // a status that changed while the socket was down is not lost.
    if (event.type === 'agent.status') onAgentStatus(event.payload as unknown as AgentStatus);
    // Names only which channel changed; what this reader may see of it comes from a refetch.
    if (event.type === 'conversations.changed') onConversationsChanged();
    if (event.type === 'channels.changed') onChannelsChanged();
    if (event.type === 'agent.run.finished') onRunFinished();
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
  return () => { connection.close(); if (ws === connection) ws = undefined; };
}
export function resubscribeConversations(): void { ws?.reconnect(); }
