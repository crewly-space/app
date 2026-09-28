// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@crewly/sdk';

const users = vi.hoisted(() => ({ updateMe: vi.fn(), changeEmail: vi.fn(), changePassword: vi.fn() }));
vi.mock('../src/lib/api/client', () => ({ client: { users } }));

import { ProfileSection } from '../src/features/settings/ProfileSection';

const me: AuthUser = { id: 'u1', email: 'owner@example.com', role: 'owner', displayName: 'Owner', hasPassword: true, signsInWithCrewly: false };

beforeEach(() => { for (const mock of Object.values(users)) mock.mockReset(); });
afterEach(cleanup);

describe('Profile', () => {
  it('asks for the current password only once the email actually changes', async () => {
    users.changeEmail.mockResolvedValue({});
    const onChanged = vi.fn(async () => {});
    render(<ProfileSection currentUser={me} onChanged={onChanged} onNotify={() => {}} />);
    const emailForm = screen.getByLabelText('Email').closest('form')!;
    expect(emailForm.querySelector('input[type="password"]')).toBeNull();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
    const password = emailForm.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(password, { target: { value: 'super-secret-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change email' }));
    await waitFor(() => expect(users.changeEmail).toHaveBeenCalledWith({ email: 'new@example.com', currentPassword: 'super-secret-1' }));
    expect(onChanged).toHaveBeenCalled();
  });

  it('says where to change the email of an account that signs in only with Crewly', () => {
    render(<ProfileSection currentUser={{ ...me, hasPassword: false, signsInWithCrewly: true }} onChanged={async () => {}} onNotify={() => {}} />);
    expect(screen.getByText(/Change your email in your Crewly account/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Change email' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Change password' })).toBeNull();
  });

  it('shows the server\'s reason when the password is wrong', async () => {
    users.changePassword.mockRejectedValue(new Error('That is not your current password.'));
    render(<ProfileSection currentUser={me} onChanged={async () => {}} onNotify={() => {}} />);
    const passwordForm = screen.getByRole('button', { name: 'Change password' }).closest('form')!;
    const [current, next] = passwordForm.querySelectorAll('input');
    fireEvent.change(current!, { target: { value: 'wrong' } });
    fireEvent.change(next!, { target: { value: 'a-long-new-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect((await screen.findByRole('alert')).textContent).toBe('That is not your current password.');
  });
});
