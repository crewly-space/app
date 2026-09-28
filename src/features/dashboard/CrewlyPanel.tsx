import { useCallback, useEffect, useState } from 'react';
import { Check, Cloud, Copy, ExternalLink, LoaderCircle } from 'lucide-react';
import { CrewlyApiError, type AuthMode, type AuthSettings, type CrewlyConnection } from '@crewly/sdk';
import type { ServicesApi } from './services-api';
import { useWork } from './useWork';
import { safeNavigationUrl } from '../../lib/safe-navigation';

/**
 * What each service lets this server do, in words, and the scopes behind it.
 * AI Gateway needs two (run models, list them) but is one thing to a person.
 */
const SERVICES: Array<{ id: string; scopes: string[]; label: string }> = [
  { id: 'gateway', scopes: ['inference', 'models:read'], label: 'AI Gateway: models for agents, billed to your Crewly account' },
  { id: 'mail-send', scopes: ['mail:send'], label: 'Send email through Crewly Mail' },
  { id: 'mail-receive', scopes: ['mail:receive'], label: 'Receive email replies through Crewly Mail' },
  { id: 'identity', scopes: ['identity'], label: 'Sign in with Crewly' },
];
const GATEWAY_SCOPES = SERVICES[0]!.scopes;

/** The services a set of scopes amounts to, in words; scopes no service claims are named as they are. */
function describeScopes(scopes: string[]): string[] {
  const named = SERVICES.filter((service) => service.scopes.every((scope) => scopes.includes(scope)));
  const claimed = new Set(named.flatMap((service) => service.scopes));
  return [...named.map((service) => service.label.split(':')[0]!), ...scopes.filter((scope) => !claimed.has(scope))];
}

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

/** Copies the link code, for approving from another device. */
function CopyCode({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  if (typeof navigator === 'undefined' || !navigator.clipboard) return null;
  return (
    <button type="button" className="icon-button compact" aria-label={copied ? 'Copied' : 'Copy the code'} title={copied ? 'Copied' : 'Copy the code'}
      onClick={() => void navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => undefined)}>
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

/**
 * Connect Crewly. Optional: nothing here is needed to run the server, and
 * disconnecting removes only the connection, never local data.
 */
export function CrewlyPanel({ api, serverName }: { api: ServicesApi; serverName: string }) {
  const { busy, error, run, setError } = useWork();
  const [connection, setConnection] = useState<CrewlyConnection | null>(null);
  const [loadFailure, setLoadFailure] = useState('');
  const [requested, setRequested] = useState<string[]>([...GATEWAY_SCOPES, 'mail:send']);
  const [authSettings, setAuthSettings] = useState<AuthSettings | null>(null);

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

  useEffect(() => {
    if (connection?.status !== 'connected' || !connection.scopes.includes('identity') || typeof api.authSettings !== 'function') { setAuthSettings(null); return; }
    api.authSettings().then(setAuthSettings).catch(() => setAuthSettings(null));
  }, [api, connection]);

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
      {!pending && <p className="field-description">{STATUS_TEXT[connection.status]}</p>}

      {(connection.status === 'disconnected' || connection.status === 'revoked') && (
        <form className="dashboard-form form" onSubmit={(event) => {
          event.preventDefault();
          void act(() => api.connectCrewly({ name: serverName, scopes: requested }));
        }}>
          <fieldset>
            <legend>Services to ask for</legend>
            {SERVICES.map((service) => (
              <label key={service.id}>
                <input
                  type="checkbox"
                  checked={service.scopes.every((scope) => requested.includes(scope))}
                  onChange={(event) => setRequested((current) => event.target.checked
                    ? [...new Set([...current, ...service.scopes])]
                    : current.filter((scope) => !service.scopes.includes(scope)))}
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
        <div className="dashboard-card crewly-link-card">
          <span className="crewly-link-icon" aria-hidden="true"><Cloud size={18} /></span>
          <div className="crewly-link-body">
            <span className="crewly-link-status" role="status"><LoaderCircle size={12} aria-hidden="true" /> {STATUS_TEXT.pending}</span>
            <strong>Approve this server in Crewly</strong>
            <p>Open Crewly and check that it shows this code before you approve.</p>
            <div className="crewly-link-code-row">
              <code className="crewly-link-code" aria-label="Link code">{pending.userCode}</code>
              <CopyCode value={pending.userCode} />
            </div>
            <div className="dashboard-actions">
              {safeNavigationUrl(pending.verificationUrl) && <a className="primary-button" href={safeNavigationUrl(pending.verificationUrl)!} target="_blank" rel="noopener noreferrer">Open Crewly <ExternalLink size={14} aria-hidden="true" /></a>}
              <button type="button" className="text-button" disabled={busy}
                onClick={() => void act(() => api.disconnectCrewly())}>Cancel</button>
            </div>
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
              ? describeScopes(connection.scopes).join(', ')
              : 'none yet. Grant them from Connected servers in Crewly.'}
          </p>
          {!GATEWAY_SCOPES.every((scope) => connection.scopes.includes(scope)) && (
            <p className="field-description">
              To use Crewly Gateway for agents, allow this server AI Gateway under Connected servers in Crewly, then Check again.
            </p>
          )}
          <div className="dashboard-actions">
            <button type="button" className="secondary-button" disabled={busy}
              onClick={() => void act(() => api.refreshCrewly())}>Check again</button>
            <button type="button" className="secondary-button" disabled={busy}
              onClick={() => void act(() => api.rotateCrewly())}>Rotate credential</button>
            <button type="button" className="text-button danger" disabled={busy}
              onClick={() => void act(() => api.disconnectCrewly())}>Disconnect</button>
          </div>
          {connection.scopes.includes('identity') && authSettings && (
            <section className="dashboard-card">
              <h2>Sign in with Crewly</h2>
              <p className="field-description">Choose whether this self-hosted server accepts local passwords, Crewly identity, or both. A local owner/admin password remains available for recovery.</p>
              <label className="dashboard-form">
                <span>Authentication mode</span>
                <select value={authSettings.mode} disabled={busy} onChange={(event) => {
                  const mode = event.target.value as AuthMode;
                  void run(async () => setAuthSettings(await api.updateAuthSettings(mode)));
                }}>
                  <option value="local">Local passwords only</option>
                  <option value="both">Local passwords and Crewly</option>
                  <option value="crewly">Crewly (local admin recovery only)</option>
                </select>
              </label>
            </section>
          )}
        </>
      )}
    </div>
  );
}
