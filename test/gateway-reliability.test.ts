// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ source: null as any }));
vi.mock('../src/lib/api/client', () => ({
  snapshotClient: () => state.source,
  client: new Proxy({}, { get: (_, prop) => state.source[prop] }),
  clearToken: () => {},
}));
import { gateway } from '../src/lib/gateway';

function source() {
  return {
    realtimeCursor: vi.fn(async () => ({ seq: 10 })),
    auth: { me: vi.fn(async () => ({ id: 'u', role: 'owner' })) },
    agents: { list: vi.fn(async () => []), statuses: vi.fn(async () => ({ statuses: [] })) },
    conversations: { list: vi.fn(async () => [
      { id: 'good', kind: 'group', name: 'Working', participants: [] },
      { id: 'gone', kind: 'group', name: 'Removed', participants: [] },
    ]) },
    devices: { list: vi.fn(async () => []) },
    users: { directory: vi.fn(async () => ({ users: [], agents: [] })), list: vi.fn(async () => []) },
    channels: { list: vi.fn(async () => ({ channels: [], categories: [] })) },
    providers: { list: vi.fn(async () => []) },
    connectors: { list: vi.fn(async () => ({ connectors: [] })) },
    server: { branding: vi.fn(async () => ({ displayName: 'Test' })) },
    approvals: { list: vi.fn(async () => []) },
    messages: { list: vi.fn(async (id: string) => {
      if (id === 'gone') throw new Error('403');
      return [{ id: 'm', conversationId: id, authorType: 'user', authorId: 'u', body: 'Still works', createdAt: '2026-10-22T12:00:00Z' }];
    }) },
  };
}
beforeEach(() => { state.source = source(); });

it('opens a workspace even if a conversation disappears while loading', async () => {
  const workspace = await gateway.bootstrap();
  expect(workspace.messages.map(message => message.body)).toEqual(['Still works']);
  expect(workspace.historyErrors).toEqual(['gone']);
  expect(workspace.currentUser.id).toBe('u');
});

it('keeps every bootstrap round on its starting server during a switch', async () => {
  const first = state.source;
  const second = source();
  let finish!: (value: { seq: number }) => void;
  first.realtimeCursor.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const loading = gateway.bootstrap();
  state.source = second;
  finish({ seq: 20 });
  await loading;
  expect(first.auth.me).toHaveBeenCalledOnce();
  expect(first.providers.list).toHaveBeenCalledOnce();
  expect(second.auth.me).not.toHaveBeenCalled();
  expect(second.providers.list).not.toHaveBeenCalled();
});
