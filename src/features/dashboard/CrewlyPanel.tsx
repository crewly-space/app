import { useCallback, useEffect, useState } from 'react';
import { CrewlyApiError, type CrewlyConnection } from '@crewly/sdk';
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
  revoked: 'This server’s link to Crewly no longer works: it was revoked or removed in Crewly. Connect again, or remove the old link.',
};

const DISCONNECTED: CrewlyConnection = {
  status: 'disconnected',
  cloudUrl: null,
  instanceId: null,
  scopes: [],
  credentialVersion: null,
  connectedAt: null,
  lastCheckedAt: null,
  link: null,
};

/** A deleted or stale cloud-side connection is a recoverable disconnected state. */
async function getConnection(api: ServicesApi): Promise<CrewlyConnection> {
  try {
    return await api.crewly();
  } catch (reason) {
    if (reason instanceof CrewlyApiError && reason.status === 404) return DISCONNECTED;
    throw reason;
  }
}

function statusOf(reason: unknown): number | undefined {
  const status = (reason as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}

function explain(reason: unknown, fallback: string): string {
  if (statusOf(reason) === 404) return 'This server does not offer a Crewly connection. Update the server to connect Crewly.';
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

/**
 * Connect Crewly. Optional: nothing here is needed to run the server, and
 * disconnecting removes only the connection, never local data.
 */
export function CrewlyPanel({ api, serverName }: { api: ServicesApi; serverName: string }) {
  const { busy, error, run, setError } = useWork();
  const [connection, setConnection] = useState<CrewlyConnection | null>(null);
  const [loadFailure, setLoadFailure] = useState('');
  const [requested, setRequested] = useState<string[]>(['mail:send']);

  const load = useCallback(async () => {
    setLoadFailure('');
    try {
      setConnection(await getConnection(api));
    } catch (reason) {
      setConnection(null);
      setLoadFailure(explain(reason, 'The Crewly connection could not be loaded.'));
    }
  }, [api]);

  // Always this server's connection: a record read for another server, or
  // one that has since changed, is never shown or acted on.
  useEffect(() => {
    setConnection(null);
    void load();
  }, [load, serverName]);

  const act = (work: () => Promise<CrewlyConnection | void>) => run(async () => {
    try {
      const next = await work();
      setConnection(next ?? await getConnection(api));
    } catch (reason) {
      if (statusOf(reason) === 404 || statusOf(reason) === 409) {
        await load();
        setError(statusOf(reason) === 409 && reason instanceof Error ? reason.message : 'That link had already changed. This is its current state.');
        return;
      }
      throw reason;
    }
  });

  // While the owner approves in Crewly, ask every few seconds whether they have.
  const pending = connection?.status === 'pending' ? connection.link : null;
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      api.pollCrewly().then(setConnection).catch(() => void load());
    }, pending.interval * 1000);
    return () => clearInterval(timer);
  }, [api, pending, load]);

  if (!connection) {
    if (!loadFailure) return <p className="field-description" role="status">Checking this server’s Crewly connection…</p>;
    return (
      <div className="dashboard-crewly">
        <div className="dashboard-card" role="alert">
          <p>{loadFailure}</p>
          <div className="dashboard-actions">
            <button type="button" className="secondary-button" onClick={() => void load()}>Try again</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-crewly">
      {error && <p role="alert" className="dashboard-error">{error}</p>}
      <p className="field-description">{STATUS_TEXT[connection.status]}</p>

      {(connection.status === 'disconnected' || connection.status === 'revoked') && (
        <form className="dashboard-form form" onSubmit={(event) => {
          event.preventDefault();
          void act(() => api.connectCrewly({ name: serverName, scopes: requested }));
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
            <button type="submit" className="primary-button" disabled={busy}>
              {connection.status === 'revoked' ? 'Connect again' : 'Connect Crewly'}
            </button>
            {connection.status === 'revoked' && (
              <button type="button" className="text-button" disabled={busy}
                onClick={() => void act(() => api.disconnectCrewly())}>Remove the old link</button>
            )}
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
              onClick={() => void act(() => api.disconnectCrewly())}>Cancel</button>
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
              onClick={() => void act(() => api.refreshCrewly())}>Check again</button>
            <button type="button" className="secondary-button" disabled={busy}
              onClick={() => void act(() => api.rotateCrewly())}>Rotate credential</button>
            <button type="button" className="text-button danger" disabled={busy}
              onClick={() => void act(() => api.disconnectCrewly())}>Disconnect</button>
          </div>
        </>
      )}
    </div>
  );
}
