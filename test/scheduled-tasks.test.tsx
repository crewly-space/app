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

it('retries a lost save with the same request ID and keeps the schedule inputs', async () => {
  vi.spyOn(client.conversations, 'scheduledTasks').mockResolvedValue({ tasks: [] });
  const save = vi.spyOn(client.conversations, 'createScheduledTask').mockRejectedValueOnce(new Error('Connection interrupted')).mockResolvedValue({ task: { id: 'saved' } as ScheduledTask });
  render(<ScheduledTasks conversationId="room" agents={[{ id: 'helper', name: 'Helper' }]} onClose={vi.fn()} onExample={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Daily priorities' }));
  expect((screen.getByLabelText('Repeat') as HTMLSelectElement).value).toBe('1440');
  fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Connection interrupted');
  const first = save.mock.calls[0]![1];
  expect(first).toMatchObject({ kind: 'task', agentId: 'helper', intervalMinutes: 1440, name: 'Daily priorities' });
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse(first.runAt) + 60000);
  fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1]![1].requestId).toBe(first.requestId);
});

it('saves proactive follow-ups with a time zone and daily limit, and lets the user pause them', async () => {
  let tasks: ScheduledTask[] = [];
  vi.spyOn(client.conversations, 'scheduledTasks').mockImplementation(async () => ({ tasks }));
  const save = vi.spyOn(client.conversations, 'createScheduledTask').mockImplementation(async (_conversation, input) => {
    const task: ScheduledTask = { ...input, id: 'followup', enabled: true, intervalMinutes: 1440, lastRun: { status: 'skipped', error: null, createdAt: new Date().toISOString() } };
    tasks = [task]; return { task };
  });
  const cancel = vi.spyOn(client.conversations, 'cancelScheduledTask').mockImplementation(async () => { tasks = []; });
  render(<ScheduledTasks conversationId="room" agents={[{ id: 'helper', name: 'Helper' }]} onClose={vi.fn()} onExample={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Proactive follow-ups' }));
  expect((screen.getByLabelText('Repeat') as HTMLSelectElement).value).toBe('1440');
  expect(screen.queryByRole('option', { name: 'Every hour' })).toBeNull();
  expect(screen.getByText(/Checks at most once per 24 hours/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
  await screen.findByText('Last check stayed quiet · still enabled');
  expect(save.mock.calls[0]![1]).toMatchObject({ kind: 'followup', intervalMinutes: 1440, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
  await waitFor(() => expect(cancel).toHaveBeenCalledWith('room', 'followup'));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull());
});

it('uses a disclosed UTC fallback when the browser cannot detect its time zone', async () => {
  const format = Intl.DateTimeFormat;
  vi.spyOn(Intl, 'DateTimeFormat').mockImplementation((locales, options) => {
    const instance = new format(locales, options);
    const resolved = instance.resolvedOptions();
    instance.resolvedOptions = () => ({ ...resolved, timeZone: 'Etc/Unknown' });
    return instance;
  });
  vi.spyOn(client.conversations, 'scheduledTasks').mockResolvedValue({ tasks: [] });
  const save = vi.spyOn(client.conversations, 'createScheduledTask').mockResolvedValue({ task: { id: 'saved' } as ScheduledTask });
  render(<ScheduledTasks conversationId="room" agents={[{ id: 'helper', name: 'Helper' }]} onClose={vi.fn()} onExample={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Proactive follow-ups' }));
  expect(screen.getByText(/Follow-up quiet hours use UTC/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0]![1].timeZone).toBe('UTC');
});
