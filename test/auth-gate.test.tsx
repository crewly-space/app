// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ status: vi.fn(), login: vi.fn(), setup: vi.fn(), store: vi.fn(), me: vi.fn(), token: null as string | null, activeId: null as string | null, clear: vi.fn() }));
vi.mock('../src/lib/api/client', () => {
  const client = { auth: { status: mocks.status, login: mocks.login, setup: mocks.setup, me: mocks.me } };
  return { client, snapshotClient: () => client, activeServerId: () => mocks.activeId,
    currentToken: () => mocks.token, clearToken: mocks.clear, storeToken: mocks.store };
});
vi.mock('../src/lib/api/handoff', () => ({ consumeHandoffFromUrl: async () => false }));
import { AuthGate } from '../src/features/auth/AuthGate';
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); mocks.token = null; mocks.activeId = null; mocks.status.mockResolvedValue({ initialized: true, authMode: 'local' }); });
it('shows a connection error with a retry instead of an unusable login form', async () => {
  mocks.status.mockRejectedValueOnce(new Error('offline'));
  render(<AuthGate><p>Workspace</p></AuthGate>);
  expect(await screen.findByRole('heading', { name: 'Unable to connect' })).toBeTruthy();
  expect(screen.queryByLabelText('Email')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByLabelText('Email')).toBeTruthy();
});
it('prevents duplicate sign-ins, retains the draft after failure, and lets the user retry', async () => {
  let reject!: (reason: Error) => void;
  mocks.login.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  render(<AuthGate><p>Workspace</p></AuthGate>);
  fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'sam@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'my-secret-password' } });
  const submit = screen.getByRole('button', { name: 'Log in', exact: true });
  fireEvent.click(submit); fireEvent.submit(submit.closest('form')!);
  expect(mocks.login).toHaveBeenCalledTimes(1);
  expect((screen.getByLabelText('Email') as HTMLInputElement).disabled).toBe(true);
  reject(new Error('Password is incorrect'));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Password is incorrect');
  expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('my-secret-password');
  mocks.login.mockResolvedValue({ token: 'token', user: { email: 'sam@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Log in', exact: true }));
  await waitFor(() => expect(mocks.store).toHaveBeenCalledWith('token'));
  expect(await screen.findByText('Workspace')).toBeTruthy();
});
it('shows password guidance and toggles visibility without changing the password', async () => {
  mocks.status.mockResolvedValue({ initialized: false, claimRequired: true });
  render(<AuthGate />);
  const password = await screen.findByLabelText('Password') as HTMLInputElement;
  expect(password.minLength).toBe(12);
  fireEvent.change(password, { target: { value: 'memorable secret words' } });
  fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
  expect(password.type).toBe('text');
  expect(password.value).toBe('memorable secret words');
  fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
  expect(password.type).toBe('password');
  expect(screen.getByLabelText(/Server setup code/)).toBeTruthy();
});


it('keeps the session after a transient server failure and offers retry', async () => {
  mocks.token = 'valid-session';
  mocks.me.mockRejectedValueOnce(new Error('Server is restarting'));
  render(<AuthGate><p>Workspace</p></AuthGate>);
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Server is restarting');
  expect(mocks.clear).not.toHaveBeenCalled();
  mocks.me.mockResolvedValue({ email: 'sam@example.com' });
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Workspace')).toBeTruthy();
});

it('does not put a late login response into a different server session', async () => {
  let resolve!: (value: unknown) => void;
  mocks.activeId = 'server-a';
  mocks.login.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  render(<AuthGate><p>Workspace</p></AuthGate>);
  fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'sam@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'my-secret-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Log in', exact: true }));
  mocks.activeId = 'server-b';
  await act(async () => resolve({ token: 'token-a', user: { email: 'sam@example.com' } }));
  expect(mocks.store).not.toHaveBeenCalled();
});
