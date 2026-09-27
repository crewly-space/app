// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isNewServer, needsSetup } from '../src/features/onboarding/Setup';
import type { Bootstrap } from '../src/app-types';

const general = { id: 'c1', name: 'general', type: 'channel' as const, agentIds: [], preview: '', time: '' };

function server(overrides: Partial<Bootstrap> = {}, role: 'owner' | 'admin' | 'member' = 'owner'): Bootstrap {
  return {
    agents: [], conversations: [general], channelCategories: [], messages: [], providers: [], connectors: [],
    approvals: [], devices: [], users: [], people: [],
    currentUser: { id: 'u1', email: 'owner@example.test', role } as Bootstrap['currentUser'],
    serverBranding: { displayName: 'Crew', tagline: '', iconDataUrl: null, updatedAt: null },
    ...overrides,
  } as Bootstrap;
}

describe('server setup', () => {
  it('walks an owner through a server nobody has used', () => {
    expect(isNewServer(server())).toBe(true);
    expect(needsSetup(server(), { started: false, finished: false })).toBe(true);
    expect(needsSetup(server({}, 'admin'), { started: false, finished: false })).toBe(true);
  });

  it('never shows members setup they cannot do', () => {
    expect(needsSetup(server({}, 'member'), { started: false, finished: false })).toBe(false);
  });

  it('leaves a server with history alone, even one without agents', () => {
    const talked = server({ messages: [{ id: 'm1' } as Bootstrap['messages'][number]] });
    expect(isNewServer(talked)).toBe(false);
    const dm = server({ conversations: [general, { ...general, id: 'd1', type: 'dm' }] });
    expect(isNewServer(dm)).toBe(false);
    const channels = server({ conversations: [general, { ...general, id: 'c2', name: 'random' }] });
    expect(needsSetup(channels, { started: false, finished: false })).toBe(false);
  });

  it('resumes a setup started here until it is finished', () => {
    const withAgent = server({ agents: [{ id: 'a1' } as Bootstrap['agents'][number]] });
    expect(needsSetup(withAgent, { started: true, finished: false })).toBe(true);
    expect(needsSetup(server(), { started: true, finished: true })).toBe(false);
  });
});
