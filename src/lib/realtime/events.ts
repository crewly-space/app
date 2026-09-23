import { client, currentToken } from '../api/client';
import { messageView } from '../gateway';
import type { AgentStatus } from '@crewly/sdk';
import type { Message } from '../../types';

let ws: ReturnType<typeof client.ws> | undefined;
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
): () => void {
  const token = currentToken();
  if (!token) return () => {};
  const seqKey = `crewly:realtime-seq:${token.slice(0,12)}`;
  ws = client.ws(WebSocket);
  ws.onEvent((event) => {
    localStorage.setItem(seqKey, String(event.seq));
    if (event.type === 'message.created') onMessage(messageView(event.payload as never));
    if (event.type === 'agent.run.failed') onFailure(String(event.payload.error ?? 'Agent response failed'));
    // Replayed on reconnect with everything else since the last seen event, so
    // a status that changed while the socket was down is not lost.
    if (event.type === 'agent.status') onAgentStatus(event.payload as unknown as AgentStatus);
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
  const sequence = Number(localStorage.getItem(seqKey) ?? '0');
  ws.connect({ token, sinceSeq: Number.isSafeInteger(sequence) ? sequence : 0 });
  return () => { ws?.close(); ws = undefined; };
}
export function resubscribeConversations(): void { ws?.reconnect(); }
