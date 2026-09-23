import { useCallback, useEffect, useState } from 'react';
import { Bell, ChevronRight } from 'lucide-react';
import type { Notification, NotificationChannel, NotificationMode, NotificationPreference, NotificationType } from '@crewly/sdk';
import { client } from '../../lib/api/client';

/** The feed and the preferences behind it, behind one seam for tests. */
export interface NotificationsApi {
  list(): Promise<{ notifications: Notification[]; unread: number }>;
  markRead(id: string): Promise<void>;
  markAllRead(): Promise<void>;
  preferences(): Promise<NotificationPreference[]>;
  setPreference(type: NotificationType, channel: NotificationChannel, mode: NotificationMode): Promise<NotificationPreference[]>;
}

export const notificationsApi: NotificationsApi = {
  list: () => client.notifications.list({ limit: 30 }),
  markRead: (id) => client.notifications.markRead(id),
  markAllRead: async () => { await client.notifications.markAllRead(); },
  preferences: async () => (await client.notifications.preferences()).preferences,
  setPreference: async (type, channel, mode) => (await client.notifications.setPreference(type, channel, mode)).preferences,
};

const CHANNEL_LABELS: Record<NotificationChannel, string> = { in_app: 'In Crewly', email: 'Email' };

/**
 * What Crewly told you about, in the inbox, and what you want to be told
 * about. Security and account mail is listed but cannot be switched off.
 */
export function NotificationsSection({ api = notificationsApi, onOpenConversation }: {
  api?: NotificationsApi;
  onOpenConversation: (id: string) => void;
}) {
  const [feed, setFeed] = useState<{ notifications: Notification[]; unread: number } | null>(null);
  const [preferences, setPreferences] = useState<NotificationPreference[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.list().then(setFeed).catch(() => setFeed({ notifications: [], unread: 0 }));
  }, [api]);
  useEffect(load, [load]);

  const open = (notification: Notification) => {
    if (!notification.readAt) {
      void api.markRead(notification.id).then(load);
    }
    if (notification.conversationId) onOpenConversation(notification.conversationId);
  };

  const change = (type: NotificationType, channel: NotificationChannel, mode: NotificationMode) => {
    setError('');
    api.setPreference(type, channel, mode).then(setPreferences).catch((reason) => setError(reason instanceof Error ? reason.message : 'That did not work'));
  };

  if (!feed) return null;
  return (
    <>
      <div className="utility-section-title">
        <span>Notifications</span>
        <small>{feed.unread}</small>
      </div>
      {feed.notifications.map((notification) => (
        <button className="inbox-item" key={notification.id} onClick={() => open(notification)}>
          <span className={`inbox-symbol${notification.readAt ? ' neutral' : ''}`}>
            <Bell size={17} />
          </span>
          <span>
            <strong>{notification.title}</strong>
            <small>{notification.body}</small>
          </span>
          <em>{new Date(notification.createdAt).toLocaleString()}</em>
          <ChevronRight size={16} />
        </button>
      ))}
      <div className="dashboard-actions">
        {feed.unread > 0 && (
          <button type="button" className="text-button" onClick={() => void api.markAllRead().then(load)}>Mark all read</button>
        )}
        <button type="button" className="text-button" aria-expanded={preferences !== null}
          onClick={() => {
            if (preferences) setPreferences(null);
            else api.preferences().then(setPreferences).catch(() => setError('Could not load your preferences'));
          }}>
          Notification settings
        </button>
      </div>
      {error && <p role="alert" className="dashboard-error">{error}</p>}
      {preferences && (
        <table className="dashboard-table">
          <thead><tr><th>Tell me about</th><th>In Crewly</th><th>Email</th></tr></thead>
          <tbody>
            {preferences.map((preference) => (
              <tr key={preference.type}>
                <td>{preference.label}{preference.mandatory && <small>Always sent</small>}</td>
                {(['in_app', 'email'] as const).map((channel) => {
                  const mode = preference.channels[channel];
                  return (
                    <td key={channel}>
                      {mode === undefined ? '—' : (
                        <input
                          type="checkbox"
                          aria-label={`${preference.label}: ${CHANNEL_LABELS[channel]}`}
                          checked={mode !== 'off'}
                          disabled={preference.mandatory}
                          onChange={(event) => change(preference.type, channel, event.target.checked ? 'instant' : 'off')}
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
