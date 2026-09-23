import { useEffect, useState } from 'react';
import type { MailDomain } from '@crewly/sdk';
import type { ServicesApi } from './services-api';
import { useWork } from './useWork';

const STATE: Record<MailDomain['status'], string> = { pending: 'Waiting for DNS', verified: 'Verified', failed: 'Failed' };

/**
 * Crewly Mail from a domain of your own. The records are the ones Crewly's
 * mail provider asked for; nothing is sent from the domain until it verifies.
 */
export function SendingDomains({ api }: { api: ServicesApi }) {
  const { busy, error, run } = useWork();
  const [domains, setDomains] = useState<MailDomain[]>([]);
  const [draft, setDraft] = useState('');
  const [senders, setSenders] = useState<Record<string, string>>({});

  useEffect(() => {
    void run(async () => setDomains(await api.mailDomains()));
  }, [api, run]);

  const replace = (updated: MailDomain) => setDomains((current) => current.map((row) => (row.id === updated.id ? updated : row)));

  return (
    <section className="dashboard-card">
      <h2>Sending domain</h2>
      {error && <p role="alert" className="dashboard-error">{error}</p>}
      {domains.length === 0 && <p className="field-description">Crewly Mail sends from Crewly's shared address until you verify a domain of your own.</p>}

      {domains.map((domain) => (
        <div key={domain.id}>
          <p><strong>{domain.domain}</strong> · {STATE[domain.status]}</p>
          {domain.failureReason && <p className="field-description">{domain.failureReason}</p>}
          {domain.status !== 'verified' && (
            <table className="dashboard-table">
              <thead><tr><th>Type</th><th>Name</th><th>Value</th><th>For</th></tr></thead>
              <tbody>
                {domain.records.map((record) => (
                  <tr key={`${record.type}-${record.name}`}>
                    <td>{record.type}{record.priority !== undefined ? ` ${record.priority}` : ''}</td>
                    <td><code>{record.name}</code></td>
                    <td><code>{record.value}</code></td>
                    <td>{record.purpose}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <form className="dashboard-actions" onSubmit={(event) => {
            event.preventDefault();
            const list = (senders[domain.id] ?? '').split(',').map((entry) => entry.trim()).filter(Boolean).map((localPart) => ({ localPart }));
            void run(async () => replace(await api.setMailDomainSenders(domain.id, list)));
          }}>
            <input
              aria-label={`Senders on ${domain.domain}`}
              placeholder={domain.senders.map((sender) => sender.localPart).join(', ')}
              value={senders[domain.id] ?? ''}
              onChange={(event) => setSenders((current) => ({ ...current, [domain.id]: event.target.value }))}
            />
            <button type="submit" className="secondary-button" disabled={busy || !(senders[domain.id] ?? '').trim()}>Save senders</button>
            <button type="button" className="secondary-button" disabled={busy}
              onClick={() => void run(async () => replace(await api.checkMailDomain(domain.id)))}>Check again</button>
            <button type="button" className="text-button danger" disabled={busy} aria-label={`Remove ${domain.domain}`}
              onClick={() => void run(async () => {
                await api.removeMailDomain(domain.id);
                setDomains((current) => current.filter((row) => row.id !== domain.id));
              })}>Remove</button>
          </form>
          <p className="field-description">
            Sends as {domain.senders.map((sender) => `${sender.localPart}@${domain.domain}`).join(', ')}; the first is the default.
          </p>
        </div>
      ))}

      {domains.length === 0 && (
        <form className="dashboard-actions" onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            setDomains([await api.addMailDomain(draft)]);
            setDraft('');
          });
        }}>
          <input aria-label="Domain" placeholder="example.com" value={draft} onChange={(event) => setDraft(event.target.value)} />
          <button type="submit" className="primary-button" disabled={busy || !draft}>Add domain</button>
        </form>
      )}
    </section>
  );
}
