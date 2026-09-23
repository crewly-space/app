import { useEffect, useState } from 'react';
import type { MailDelivery, MailOverview, MailProvider, MailSettingsInput } from '@crewly/sdk';
import type { ServicesApi } from './services-api';
import { useWork } from './useWork';

const PROVIDER_LABELS: Record<MailProvider, string> = {
  disabled: 'Off',
  crewly: 'Crewly Mail',
  smtp: 'SMTP',
  resend: 'Resend',
  postmark: 'Postmark',
};

const STATUS_LABELS: Record<MailDelivery['status'], string> = {
  queued: 'Queued',
  sent: 'Sent',
  retrying: 'Retrying',
  failed: 'Failed',
};

interface Draft {
  provider: MailProvider;
  fromAddress: string;
  host: string;
  port: string;
  security: 'tls' | 'starttls' | 'none';
  username: string;
  secret: string;
}

function draftFrom(overview: MailOverview): Draft {
  const { settings } = overview;
  return {
    provider: settings.provider,
    fromAddress: settings.fromAddress ?? '',
    host: settings.config.host ?? '',
    port: settings.config.port ? String(settings.config.port) : '587',
    security: settings.config.security ?? 'starttls',
    username: settings.config.username ?? '',
    secret: '',
  };
}

/**
 * Outbound email: which provider, a test send, and every delivery with why it
 * failed. The password or API key is typed once and never shown again.
 */
export function MailPanel({ api }: { api: ServicesApi }) {
  const { busy, error, run } = useWork();
  const [overview, setOverview] = useState<MailOverview | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deliveries, setDeliveries] = useState<MailDelivery[]>([]);
  const [testTo, setTestTo] = useState('');

  useEffect(() => {
    void run(async () => {
      const [loaded, log] = await Promise.all([api.mail(), api.deliveries()]);
      setOverview(loaded);
      setDraft(draftFrom(loaded));
      setDeliveries(log);
    });
  }, [api, run]);

  if (!overview || !draft) return error ? <p role="alert" className="dashboard-error">{error}</p> : null;

  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const needsKey = draft.provider === 'resend' || draft.provider === 'postmark' || draft.provider === 'smtp';
  const sameProvider = draft.provider === overview.settings.provider;
  const replaceDelivery = (updated: MailDelivery) =>
    setDeliveries((current) => [updated, ...current.filter((row) => row.id !== updated.id)]);

  const save = () => run(async () => {
    const input: MailSettingsInput = { provider: draft.provider };
    if (draft.provider !== 'disabled' && draft.provider !== 'crewly') input.fromAddress = draft.fromAddress || null;
    if (draft.provider === 'smtp') {
      input.config = { host: draft.host, port: Number(draft.port), security: draft.security, ...(draft.username ? { username: draft.username } : {}) };
    }
    if (draft.secret) input.secret = draft.secret;
    const settings = await api.updateMail(input);
    setOverview({ ...overview, settings });
    setDraft({ ...draft, secret: '' });
  });

  return (
    <div className="dashboard-mail">
      {error && <p role="alert" className="dashboard-error">{error}</p>}

      <form className="dashboard-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label>
          Provider
          <select value={draft.provider} onChange={(event) => set({ provider: event.target.value as MailProvider, secret: '' })}>
            {overview.providers.map((provider) => <option key={provider} value={provider}>{PROVIDER_LABELS[provider]}</option>)}
          </select>
        </label>

        {draft.provider === 'crewly' && !overview.crewlyMailAvailable && (
          <p className="field-description">Crewly Mail needs this server connected to Crewly with the email service granted. See the Crewly tab.</p>
        )}

        {needsKey && (
          <label>
            From address
            <input value={draft.fromAddress} placeholder="Crewly <crew@example.com>" onChange={(event) => set({ fromAddress: event.target.value })} />
          </label>
        )}

        {draft.provider === 'smtp' && (
          <>
            <label>Host<input value={draft.host} placeholder="smtp.example.com" onChange={(event) => set({ host: event.target.value })} /></label>
            <label>Port<input value={draft.port} inputMode="numeric" onChange={(event) => set({ port: event.target.value.replace(/\D/g, '') })} /></label>
            <label>
              Security
              <select value={draft.security} onChange={(event) => set({ security: event.target.value as Draft['security'] })}>
                <option value="starttls">STARTTLS (587)</option>
                <option value="tls">TLS (465)</option>
                <option value="none">None (local relay only)</option>
              </select>
            </label>
            <label>Username<input value={draft.username} autoComplete="off" onChange={(event) => set({ username: event.target.value })} /></label>
          </>
        )}

        {needsKey && (
          <label>
            {draft.provider === 'smtp' ? 'Password' : 'API key'}
            <input
              type="password"
              autoComplete="off"
              value={draft.secret}
              placeholder={sameProvider && overview.settings.hasSecret ? 'Stored. Type to replace it' : ''}
              onChange={(event) => set({ secret: event.target.value })}
            />
          </label>
        )}

        <div className="dashboard-actions">
          <button type="submit" className="primary-button" disabled={busy}>Save</button>
        </div>
      </form>

      {overview.settings.provider !== 'disabled' && (
        <form className="dashboard-actions" onSubmit={(event) => {
          event.preventDefault();
          void run(async () => replaceDelivery(await api.testMail(testTo)));
        }}>
          <input aria-label="Send a test to" type="email" placeholder="you@example.com" value={testTo} onChange={(event) => setTestTo(event.target.value)} />
          <button type="submit" className="secondary-button" disabled={busy || !testTo}>Send test</button>
        </form>
      )}

      <h2>Deliveries</h2>
      {deliveries.length === 0 ? (
        <p className="field-description">Nothing sent yet.</p>
      ) : (
        <table className="dashboard-table">
          <thead><tr><th>To</th><th>What</th><th>Status</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {deliveries.map((delivery) => (
              <tr key={delivery.id}>
                <td><strong>{delivery.recipient}</strong><small>{new Date(delivery.createdAt).toLocaleString()}</small></td>
                <td>{delivery.subject}<small>{PROVIDER_LABELS[delivery.provider]}</small></td>
                <td>
                  {STATUS_LABELS[delivery.status]}{delivery.attempts > 1 ? ` after ${delivery.attempts} attempts` : ''}
                  {delivery.lastError && <small>{delivery.lastError}</small>}
                </td>
                <td className="dashboard-row-actions">
                  {(delivery.status === 'failed' || delivery.status === 'retrying') && (
                    <button type="button" className="text-button" disabled={busy} aria-label={`Retry email to ${delivery.recipient}`}
                      onClick={() => void run(async () => replaceDelivery(await api.retryDelivery(delivery.id)))}>Retry now</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
