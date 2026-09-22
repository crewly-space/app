import type { WebSocketConstructor } from '@crewly/sdk';
import { clientFor, readServerToken } from '../../lib/servers/session';
import type { RegistryServer } from '../../lib/servers/types';

/** Where each server's last-seen event number is remembered between visits. */
const seqKey = (serverId: string) => `crewly:seen-seq:${serverId}`;

function readSeq(serverId: string): number {
  try {
    const stored = Number(localStorage.getItem(seqKey(serverId)) ?? '0');
    return Number.isSafeInteger(stored) && stored > 0 ? stored : 0;
  } catch {
    return 0;
  }
}

function writeSeq(serverId: string, seq: number): void {
  try {
    localStorage.setItem(seqKey(serverId), String(seq));
  } catch {
    /* a private window can refuse storage; counts then start from this visit */
  }
}

/**
 * Counts what arrives on the servers nobody is looking at.
 *
 * The rail would otherwise be honest only about the server in front of you:
 * every other one would look idle no matter what was said in it. Each
 * background server keeps its own socket, resumed from the last event this
 * browser saw, so a count survives a reload rather than starting again at
 * zero.
 *
 * The active server is deliberately not watched here -- the app itself is
 * already connected to it, and messages you are reading are not waiting.
 */
export function watchBackgroundServers(
  servers: RegistryServer[],
  activeServerId: string | null,
  onCount: (serverId: string, unread: number) => void,
  WebSocketImpl: WebSocketConstructor = WebSocket as unknown as WebSocketConstructor,
): () => void {
  const sockets = servers
    .filter((server) => server.id !== activeServerId && server.endpoint)
    .flatMap((server) => {
      // No session for it means nothing to listen with. The rail still lists
      // it; it just cannot say what is waiting until somebody signs in.
      const token = readServerToken(server.id);
      if (!token) return [];

      let unread = 0;
      const ws = clientFor(server).client.ws(WebSocketImpl);
      ws.onEvent((event) => {
        if (event.type !== 'message.created') return;
        writeSeq(server.id, event.seq);
        unread += 1;
        onCount(server.id, unread);
      });
      ws.connect({ token, sinceSeq: readSeq(server.id) });
      return [ws];
    });

  return () => { for (const ws of sockets) ws.close(); };
}

/**
 * Marks a server as read up to now. Called when it becomes the one being
 * looked at, so its count does not come back on the next switch.
 */
export function markServerRead(serverId: string, seq: number): void {
  if (seq > 0) writeSeq(serverId, seq);
}
