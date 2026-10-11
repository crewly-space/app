import { useEffect, useRef, useState } from 'react';
import { CrewlyApiError } from '../../sdk/errors';
import { clientFor, storeServerToken } from '../../lib/servers/session';
import type { RegistryServer } from '../../lib/servers/types';
import { cloudUrl } from './useServerRegistry';

const PENDING_INVITE_KEY = 'crewly:pending-invite';

/**
 * An invite link the app was opened with (`/join?server=…#invite=…`), kept
 * until the person is signed in to their Crewly account and can use it.
 */
export function takeInviteFromUrl(location: Pick<Location, 'pathname' | 'href' | 'hash'> = window.location): void {
  if (location.pathname.replace(/\/+$/, '') !== '/join' || !/(?:^#|&)invite=/.test(location.hash)) return;
  try { sessionStorage.setItem(PENDING_INVITE_KEY, location.href); } catch { /* the person can paste it instead */ }
  const server = new URLSearchParams(window.location.search).get('server');
  window.history.replaceState(null, '', server ? `/?server=${encodeURIComponent(server)}` : '/');
}

/** The invite waiting to be used, once; reading it forgets it. */
export function pendingInvite(): string | null {
  try {
    const value = sessionStorage.getItem(PENDING_INVITE_KEY);
    if (value) sessionStorage.removeItem(PENDING_INVITE_KEY);
    return value;
  } catch {
    return null;
  }
}

async function cloudPost(path: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`${cloudUrl!.replace(/\/+$/, '')}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(result.error ?? `Cloud returned HTTP ${response.status}`));
  return result;
}

/**
 * Joins a server with an invite link: Cloud puts a hosted server in the list
 * as the Cloud server it is, and the server itself redeems the invite. A
 * self-hosted server's invite opens on that server.
 */
async function joinWithInvite(invite: string): Promise<{ server: RegistryServer } | { openedElsewhere: true }> {
  const result = await cloudPost('/api/v1/account/servers/join', { invite });
  if (result.kind === 'self_hosted' && typeof result.openUrl === 'string') {
    window.open(result.openUrl, '_blank', 'noopener');
    return { openedElsewhere: true };
  }
  const server = result.server as RegistryServer;
  const { client } = clientFor(server);
  try {
    const session = await client.auth.cloudHandoff({ token: String(result.token), inviteToken: String(result.inviteCode) });
    storeServerToken(server.id, session.token);
  } catch (reason) {
    if (reason instanceof CrewlyApiError && reason.status === 409) throw new Error('This invite was just used by somebody else.');
    if (reason instanceof CrewlyApiError && [401, 403].includes(reason.status)) {
      throw new Error('The server did not accept this invite. Ask for a new one — or the server may need an update first.');
    }
    throw reason;
  }
  return { server };
}

/**
 * Adds a server somebody runs themselves to their Crewly account.
 *
 * Cloud checks the address before it stores it, so the reasons this can fail
 * are its reasons -- not reachable from the internet, not answering like a
 * Crewly server, already on the account -- and they are shown as given rather
 * than replaced with a generic failure.
 */
export function AddServerDialog({ onClose, onAdded, onJoined, initialInvite }: {
  onClose: () => void;
  onAdded: () => void;
  /** A server joined with an invite, ready to open. */
  onJoined?: (server: RegistryServer) => void;
  /** An invite link to use straight away, from the address the app was opened with. */
  initialInvite?: string | null;
}) {
  const [mode, setMode] = useState<'join' | 'add'>('join');
  const [invite, setInvite] = useState(initialInvite ?? '');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function join(link: string) {
    if (saving || !cloudUrl) return;
    setSaving(true);
    setError('');
    try {
      const joined = await joinWithInvite(link.trim());
      if ('server' in joined) (onJoined ?? (() => onAdded()))(joined.server);
      else onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The invite could not be used');
      setSaving(false);
    }
  }
  const started = useRef(false);
  useEffect(() => {
    if (!initialInvite || started.current) return;
    started.current = true;
    void join(initialInvite);
    // Once, for the link the app was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialInvite]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !cloudUrl) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`${cloudUrl.replace(/\/+$/, '')}/api/v1/account/servers`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), baseUrl: baseUrl.trim() }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(String((body as { error?: unknown }).error ?? `Cloud returned HTTP ${response.status}`));
      }
      onAdded();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The server could not be added');
      setSaving(false);
    }
  }

  return (
    <div className="modal-layer" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="add-server-title">
        <header>
          <div>
            <h2 id="add-server-title">{mode === 'join' ? 'Join a server' : 'Add your own server'}</h2>
            <p>{mode === 'join'
              ? 'Paste the invite link somebody sent you. You join with your Crewly account.'
              : 'A Crewly server you run yourself, listed beside the ones you bought.'}</p>
          </div>
        </header>
        {mode === 'join' ? <form className="form" onSubmit={(event) => { event.preventDefault(); void join(invite); }}>
          <label>
            <span>Invite link</span>
            <input required autoFocus autoComplete="off" spellCheck={false} value={invite}
              onChange={(event) => setInvite(event.target.value)} placeholder="https://app.crewly.space/join?server=…#invite=…" />
          </label>
          {error && <p role="alert">{error}</p>}
          <div className="form-actions">
            <button type="button" className="text-button" onClick={() => { setError(''); setMode('add'); }}>Add a self-hosted server instead</button>
            <button type="button" className="text-button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Joining…' : 'Join'}</button>
          </div>
        </form> : <form className="form" onSubmit={submit}>
          <label>
            <span>Name</span>
            <input required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} placeholder="Home lab" />
          </label>
          <label>
            <span>Address</span>
            <input
              required
              type="url"
              autoComplete="off"
              spellCheck={false}
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://crewly.example.com"
            />
            <small className="field-description">
              Must be reachable over HTTPS. Crewly will detect whether it supports Continue with Crewly, local sign-in, or both.
            </small>
          </label>
          {error && <p role="alert">{error}</p>}
          <div className="form-actions">
            <button type="button" className="text-button" onClick={() => { setError(''); setMode('join'); }}>Have an invite?</button>
            <button type="button" className="text-button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-button" disabled={saving}>
              {saving ? 'Checking…' : 'Add server'}
            </button>
          </div>
        </form>}
      </div>
    </div>
  );
}
