// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NewConversationDialog } from '../src/features/conversations/NewConversationDialog';

afterEach(cleanup);
const people = [{ id: 'me', displayName: 'Alice', avatarMode: 'name' as const }, { id: 'bob', displayName: 'Bob', avatarMode: 'name' as const }, { id: 'cara', displayName: 'Cara', avatarMode: 'name' as const }];
it('starts a teammate DM and excludes the current user', async () => {
  const onCreate = vi.fn(async () => {});
  render(<NewConversationDialog agents={[]} people={people} currentUserId="me" onClose={vi.fn()} onCreate={onCreate} />);
  expect(screen.queryByRole('checkbox', { name: /Alice/ })).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: /Bob/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Start conversation' }));
  await waitFor(() => expect(onCreate).toHaveBeenCalledWith([{ participantId: 'bob', participantType: 'user' }], ''));
});
it('names a group from its participants and keeps selections after a server error', async () => {
  const onCreate = vi.fn().mockRejectedValueOnce(new Error('Try again')).mockResolvedValue(undefined);
  render(<NewConversationDialog agents={[]} people={people} currentUserId="me" onClose={vi.fn()} onCreate={onCreate} />);
  fireEvent.click(screen.getByRole('checkbox', { name: /Bob/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: /Cara/ }));
  expect((screen.getByRole('button', { name: 'Start conversation' }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Start conversation' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Try again');
  fireEvent.click(screen.getByRole('button', { name: 'Start conversation' }));
  await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(2));
  expect(onCreate).toHaveBeenLastCalledWith([{ participantId: 'bob', participantType: 'user' }, { participantId: 'cara', participantType: 'user' }], 'Bob, Cara');
});
