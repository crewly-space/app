// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { watchBackgroundServers } from '../src/features/servers/unread';
import { storeServerToken } from '../src/lib/servers/session';
import type { RegistryServer } from '../src/lib/servers/types';

const active: RegistryServer = {
  id: 'active-1', kind: 'cloud', name: 'Active', endpoint: 'https://active.example.com',
  status: 'ready', role: 'owner', organizationId: 'org-1', reachable: true,
};
const background: RegistryServer = {
  id: 'background-1', kind: 'self_hosted', name: 'Background', endpoint: 'https://background.example.com',
  status: 'unknown', role: null, organizationId: null, reachable: true,
};

/** A socket a test can push events into, standing in for a real server. */
const sockets: FakeSocket[] = [];
class FakeSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    sockets.push(this);
    queueMicrotask(() => this.onopen?.());
  }

  deliver(event: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }

  close() {
    this.closed = true;
  }
}

const message = (seq: number) => ({
  seq, topic: 'conversation:c1', type: 'message.created',
  ts: new Date().toISOString(), payload: { id: `m${seq}` },
});

beforeEach(() => {
  localStorage.clear();
  sockets.length = 0;
});

describe('what is waiting on the servers you are not looking at', () => {
  it('counts messages arriving on a background server', async () => {
    storeServerToken(background.id, 'background-token');
    const onCount = vi.fn();

    const stop = watchBackgroundServers([active, background], active.id, onCount, FakeSocket as never);
    await Promise.resolve();
    sockets[0].deliver(message(7));
    sockets[0].deliver(message(8));

    expect(onCount).toHaveBeenLastCalledWith(background.id, 2);
    stop();
    expect(sockets[0].closed).toBe(true);
  });

  it('does not watch the server already in front of you', () => {
    storeServerToken(active.id, 'active-token');
    storeServerToken(background.id, 'background-token');

    watchBackgroundServers([active, background], active.id, vi.fn(), FakeSocket as never);

    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toContain('background.example.com');
  });

  it('leaves alone a server there is no session for', () => {
    watchBackgroundServers([active, background], active.id, vi.fn(), FakeSocket as never);
    expect(sockets).toHaveLength(0);
  });

  it('resumes where this browser left off, so a reload does not recount', () => {
    storeServerToken(background.id, 'background-token');
    watchBackgroundServers([active, background], active.id, vi.fn(), FakeSocket as never);
    sockets[0].deliver(message(12));

    // A reload: same storage, a fresh watcher.
    watchBackgroundServers([active, background], active.id, vi.fn(), FakeSocket as never);
    expect(sockets[1].url).toContain('sinceSeq=12');
  });
});
