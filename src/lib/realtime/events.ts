import { client, currentToken } from '../api/client';
import { messageView } from '../gateway';
import type { Message } from '../../types';

let ws: ReturnType<typeof client.ws> | undefined;
export function startRealtime(onMessage: (message: Message) => void, onFailure: (error: string) => void): () => void {
  const token = currentToken();
  if (!token) return () => {};
  const seqKey = `opencrew:realtime-seq:${token.slice(0,12)}`;
  ws = client.ws(WebSocket);
  ws.onEvent((event) => {
    localStorage.setItem(seqKey, String(event.seq));
    if (event.type === 'message.created') onMessage(messageView(event.payload as never));
    if (event.type === 'agent.run.failed') onFailure(String(event.payload.error ?? 'Agent response failed'));
  });
  const sequence = Number(localStorage.getItem(seqKey) ?? '0');
  ws.connect({ token, sinceSeq: Number.isSafeInteger(sequence) ? sequence : 0 });
  return () => { ws?.close(); ws = undefined; };
}
export function resubscribeConversations(): void { ws?.reconnect(); }
