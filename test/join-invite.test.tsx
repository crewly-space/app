// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const previewInvite = vi.fn();
const acceptInvite = vi.fn();
vi.mock('../src/lib/api/client', () => ({
  client: { users: { previewInvite: (...args: unknown[]) => previewInvite(...args), acceptInvite: (...args: unknown[]) => acceptInvite(...args) } },
}));

const { JoinInvite, readInviteCode } = await import('../src/features/auth/JoinInvite');

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('an invite link', () => {
  it('is read only from /join with an invite in the fragment', () => {
    expect(readInviteCode({ pathname: '/join', hash: '#invite=abc123' })).toBe('abc123');
    expect(readInviteCode({ pathname: '/', hash: '#invite=abc123' })).toBeNull();
    expect(readInviteCode({ pathname: '/join', hash: '' })).toBeNull();
  });

  it('lets someone already signed in join as themselves, without a new password', async () => {
    previewInvite.mockResolvedValue({ role: 'admin', email: null, expiresAt: '2026-10-01T00:00:00.000Z' });
    acceptInvite.mockResolvedValue({ token: 'tok', user: { email: 'lee@example.com' } });
    const onJoined = vi.fn();
    render(<JoinInvite code="abc" signedInAs="lee@example.com" onJoined={onJoined} onSignIn={vi.fn()} />);
    expect(await screen.findByText(/as an admin/)).toBeTruthy();
    expect(screen.queryByLabelText('Password')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Accept invite' }));
    await waitFor(() => expect(onJoined).toHaveBeenCalledWith('tok'));
    expect(acceptInvite).toHaveBeenCalledWith('abc', undefined);
  });

  it('offers signing in first to someone who already has an account', async () => {
    previewInvite.mockResolvedValue({ role: 'member', email: 'sam@example.com', expiresAt: '2026-10-01T00:00:00.000Z' });
    const onSignIn = vi.fn();
    render(<JoinInvite code="abc" signedInAs={null} onJoined={vi.fn()} onSignIn={onSignIn} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in to accept' }));
    expect(onSignIn).toHaveBeenCalled();
  });

  it('explains a dead invite instead of showing a sign-up form', async () => {
    previewInvite.mockRejectedValue(new Error('This invite has expired, was revoked, or was already used.'));
    render(<JoinInvite code="abc" signedInAs={null} onJoined={vi.fn()} onSignIn={vi.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/expired, was revoked/);
    expect(screen.queryByLabelText('Password')).toBeNull();
  });
});
