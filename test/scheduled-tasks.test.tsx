// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ScheduledTasks } from '../src/features/conversations/ScheduledTasks';
import { client } from '../src/lib/api/client';
import type { ScheduledTask } from '@crewly/sdk';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('keeps a task cancellable after a failed request and shows the server-confirmed cancellation', async () => {
  const task: ScheduledTask = { id: 'task1', name: 'Take a break', enabled: true, runAt: '2030-01-01T12:00:00Z', intervalMinutes: null, agentId: 'helper', kind: 'reminder', body: 'Stand up', lastRun: null };
  vi.spyOn(client.conversations, 'scheduledTasks').mockResolvedValueOnce({ tasks: [task] }).mockResolvedValue({ tasks: [{ ...task, enabled: false }] });
  const cancel = vi.spyOn(client.conversations, 'cancelScheduledTask').mockRejectedValueOnce(new Error('Connection interrupted')).mockResolvedValue(undefined);
  render(<ScheduledTasks conversationId="room" onClose={vi.fn()} onExample={vi.fn()} />);
  await screen.findByText('Take a break');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Connection interrupted');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull());
  fireEvent.click(await screen.findByText('Completed and cancelled (1)'));
  expect(screen.getByText('Cancelled', { exact: true })).toBeTruthy();
  expect(cancel).toHaveBeenLastCalledWith('room', 'task1');
});
