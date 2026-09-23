import { useEffect, useState } from 'react';
import type { CrewlyConnection } from '@crewly/sdk';
import type { ServicesApi } from './services-api';
import { useWork } from './useWork';

/** What each capability lets this server do, in words. */
const SERVICES: Array<{ scope: string; label: string }> = [
  { scope: 'mail:send', label: 'Send email through Crewly Mail' },
  { scope: 'mail:receive', label: 'Receive email replies through Crewly Mail' },
  { scope: 'inference', label: 'Run Crewly AI models' },
  { scope: 'models:read', label: 'List Crewly models' },
  { scope: 'identity', label: 'Sign in with Crewly' },
];

const STATUS_TEXT: Record<CrewlyConnection['status'], string> = {
  disconnected: 'Not connected. This server runs entirely on its own.',
  pending: 'Waiting for approval in Crewly.',
  connected: 'Connected to Crewly.',
  revoked: 'Crewly revoked this server. Connect again to use Crewly services.',
};

/**
 * Connect Crewly. Optional: nothing here is needed to run the server, and
 * disconnecting removes only the connection, never local data.
 */
export function CrewlyPanel({ api, serverName }: { api: ServicesApi; serverName: string }) {
  const { busy, error, run } = useWork();
  const [connection, setConnection] = useState<CrewlyConnection | null>(null);
  const [requested, setRequested] = useState<string[]>(['mail:send']);

  useEffect(() => {
    void run(async () => setConnection(await api.crewly()));
  }, [api, run]);

  // While the owner approves in Crewly, ask every few seconds whether they have.
  const pending = connection?.status === 'pending' ? connection.link : null;
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      api.pollCrewly().then(setConnection).catch(async () => setConnection(await api.crewly()));
    }, pending.interval * 1000);
    return () => clearInterval(timer);
  }, [api, pending]);

  if (!connection) return error ? <p role="alert" className="dashboard-error">{error}</p> : null;

  return (
    <div className="dashboard-crewly">
      {error && <p role="alert" className="dashboard-error">{error}</p>}
      <p className="field-description">{STATUS_TEXT[connection.status]}</p>

      {(connection.status === 'disconnected' || connection.status === 'revoked') && (
        <form className="dashboard-form" onSubmit={(event) => {
          event.preventDefault();
          void run(async () => setConnection(await api.connectCrewly({ name: serverName, scopes: requested })));
        }}>
          <fieldset>
            <legend>Services to ask for</legend>
            {SERVICES.map((service) => (
              <label key={service.scope}>
                <input
                  type="checkbox"
                  checked={requested.includes(service.scope)}
                  onChange={(event) => setRequested((current) => event.target.checked
                    ? [...current, service.scope]
                    : current.filter((scope) => scope !== service.scope))}
                />
                {service.label}
              </label>
            ))}
          </fieldset>
          <div className="dashboard-actions">
            <button type="submit" className="primary-button" disabled={busy}>Connect Crewly</button>
          </div>
        </form>
      )}

      {pending && (
        <div className="dashboard-card">
          <p>Approve this server in Crewly with the code</p>
          <strong aria-label="Link code">{pending.userCode}</strong>
          <div className="dashboard-actions">
            <a className="primary-button" href={pending.verificationUrl} target="_blank" rel="noopener noreferrer">Open Crewly</a>
            <button type="button" className="text-button" disabled={busy}
              onClick={() => void run(async () => { await api.disconnectCrewly(); setConnection(await api.crewly()); })}>Cancel</button>
          </div>
        </div>
      )}

      {connection.status === 'connected' && (
        <>
          <dl className="dashboard-facts">
            <div><dt>Instance</dt><dd>{connection.instanceId}</dd></div>
            <div><dt>Crewly</dt><dd>{connection.cloudUrl}</dd></div>
            <div><dt>Credential</dt><dd>Version {connection.credentialVersion}</dd></div>
            <div><dt>Last checked</dt><dd>{connection.lastCheckedAt ? new Date(connection.lastCheckedAt).toLocaleString() : 'Never'}</dd></div>
          </dl>
          <p className="field-description">
            Services: {connection.scopes.length
              ? connection.scopes.map((scope) => SERVICES.find((service) => service.scope === scope)?.label ?? scope).join(', ')
              : 'none yet. Grant them from Connected servers in Crewly.'}
          </p>
          <div className="dashboard-actions">
            <button type="button" className="secondary-button" disabled={busy}
              onClick={() => void run(async () => setConnection(await api.refreshCrewly()))}>Check again</button>
            <button type="button" className="secondary-button" disabled={busy}
              onClick={() => void run(async () => setConnection(await api.rotateCrewly()))}>Rotate credential</button>
            <button type="button" className="text-button danger" disabled={busy}
              onClick={() => void run(async () => { await api.disconnectCrewly(); setConnection(await api.crewly()); })}>Disconnect</button>
          </div>
        </>
      )}
    </div>
  );
}
