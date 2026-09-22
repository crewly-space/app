// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { consumeHandoffFromUrl } from '../src/lib/api/handoff';
import { client, currentToken } from '../src/lib/api/client';

describe('arriving from Cloud', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('turns a token in the fragment into a session, and clears it', async () => {
    const cloudHandoff = vi.spyOn(client.auth, 'cloudHandoff').mockResolvedValue({
      token: 'server-session',
      user: { id: 'u1', email: 'buyer@example.com', role: 'owner' },
    });
    const clear = vi.fn();

    expect(await consumeHandoffFromUrl({ hash: '#handoff=abc.def.ghi' }, clear)).toBe(true);
    expect(cloudHandoff).toHaveBeenCalledWith({ token: 'abc.def.ghi' });
    expect(currentToken()).toBe('server-session');
    // Cleared before it is spent, so a reload cannot replay it.
    expect(clear).toHaveBeenCalled();
  });

  it('does nothing when there is no token in the URL', async () => {
    const cloudHandoff = vi.spyOn(client.auth, 'cloudHandoff');
    expect(await consumeHandoffFromUrl({ hash: '' }, vi.fn())).toBe(false);
    expect(cloudHandoff).not.toHaveBeenCalled();
  });

  it('falls back to the sign-in form when the token is refused', async () => {
    vi.spyOn(client.auth, 'cloudHandoff').mockRejectedValue(new Error('invalid_handoff'));
    expect(await consumeHandoffFromUrl({ hash: '#handoff=stale' }, vi.fn())).toBe(false);
    expect(currentToken()).toBeNull();
  });
});
