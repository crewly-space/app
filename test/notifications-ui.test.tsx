// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Notification, NotificationPreference } from '@crewly/sdk';
import { NotificationsSection, type NotificationsApi } from '../src/features/notifications/NotificationsSection';

afterEach(cleanup);

const mention: Notification = {
  id: 'n1', type: 'mention.created', title: 'Ada mentioned you in builds', body: '@Grace can you look?', url: null,
  conversationId: 'c1', createdAt: '2026-09-23T15:00:00.000Z', readAt: null,
};

const preferences: NotificationPreference[] = [
  { type: 'auth.magic_link', label: 'Sign-in links', mandatory: true, channels: { email: 'instant' } },
  { type: 'mention.created', label: 'Mentions', mandatory: false, channels: { in_app: 'instant', email: 'instant' } },
];

function api(overrides: Partial<NotificationsApi> = {}): NotificationsApi {
  return {
    list: vi.fn(async () => ({ notifications: [mention], unread: 1 })),
    markRead: vi.fn(async () => {}),
    markAllRead: vi.fn(async () => {}),
    preferences: vi.fn(async () => preferences),
    setPreference: vi.fn(async (type, channel, mode) => preferences.map((entry) => entry.type === type ? { ...entry, channels: { ...entry.channels, [channel]: mode } } : entry)),
    digestSchedule: vi.fn(async () => ({ frequency: 'daily' as const, hourUtc: 8, weekday: null })),
    setDigestSchedule: vi.fn(async (schedule) => schedule),
    ...overrides,
  };
}

describe('notifications in the inbox', () => {
  it('opens the conversation a notification is about and marks it read', async () => {
    const notifications = api();
    const opened = vi.fn();
    render(<NotificationsSection api={notifications} onOpenConversation={opened} />);
    fireEvent.click(await screen.findByText('Ada mentioned you in builds'));
    expect(opened).toHaveBeenCalledWith('c1');
    await waitFor(() => expect(notifications.markRead).toHaveBeenCalledWith('n1'));
  });

  it('changes a preference, and cannot switch off mandatory mail', async () => {
    const notifications = api();
    render(<NotificationsSection api={notifications} onOpenConversation={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Notification settings' }));
    const mandatory = await screen.findByLabelText('Sign-in links: Email');
    expect((mandatory as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Mentions: Email'), { target: { value: 'digest' } });
    await waitFor(() => expect(notifications.setPreference).toHaveBeenCalledWith('mention.created', 'email', 'digest'));
    await waitFor(() => expect((screen.getByLabelText('Mentions: Email') as HTMLSelectElement).value).toBe('digest'));
    fireEvent.click(screen.getByLabelText('Mentions: In Crewly'));
    await waitFor(() => expect(notifications.setPreference).toHaveBeenCalledWith('mention.created', 'in_app', 'off'));
  });

  it('sets the digest schedule', async () => {
    const notifications = api();
    render(<NotificationsSection api={notifications} onOpenConversation={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Notification settings' }));
    fireEvent.change(await screen.findByLabelText('Digest frequency'), { target: { value: 'weekly' } });
    await waitFor(() => expect(notifications.setDigestSchedule).toHaveBeenCalledWith({ frequency: 'weekly', hourUtc: 8, weekday: 1 }));
    fireEvent.change(await screen.findByLabelText('Digest day'), { target: { value: '5' } });
    await waitFor(() => expect(notifications.setDigestSchedule).toHaveBeenLastCalledWith({ frequency: 'weekly', hourUtc: 8, weekday: 5 }));
  });
});
