import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { CloudAccount } from '../../lib/cloud/account';
import { Loading } from '../shell/BrandMark';

const LAST_SERVER_KEY = 'crewly:last-server';

/** Where people create servers and manage billing, when it is not this app. */
const dashboardUrl: string | undefined = import.meta.env.VITE_CREWLY_DASHBOARD_URL;

type Phase =
  | { name: 'loading' }
  | { name: 'signed_out' }
  | { name: 'ready' }
  | { name: 'error'; message: string };

/**
 * The dashboard opens a server with ?server=<id>. It becomes the remembered
 * choice -- the one the rail then shows -- and leaves the address.
 */
function takeRequestedServer(): void {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get('server');
  if (!requested) return;
  try {
    localStorage.setItem(LAST_SERVER_KEY, requested);
  } catch { /* storage can be refused; the first ready server is then shown */ }
  params.delete('server');
  const query = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
}

/**
 * The front door of the hosted app.
 *
 * Served from Crewly Cloud, the app is nobody's server: the person signs in to
 * their Crewly account and nothing else. Which server they open, and whether
 * it answers, is the app's business once they are in -- a server that is
 * offline, still being built or wanting its own login is shown as that
 * server's state beside the rail, never in place of the whole app.
 */
export function CloudGate({ account, cloudUrl, children }: { account: CloudAccount; cloudUrl: string; children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>({ name: 'loading' });
  const [providers, setProviders] = useState<Array<{ id: string; label: string }>>([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const base = cloudUrl.replace(/\/+$/, '');

  const enter = useCallback(async () => {
    setPhase({ name: 'loading' });
    try {
      setPhase(await account.me() ? { name: 'ready' } : { name: 'signed_out' });
    } catch {
      setPhase({ name: 'error', message: 'Crewly is not answering. Try again in a moment.' });
    }
  }, [account]);

  useEffect(() => {
    takeRequestedServer();
    void enter();
    fetch(`${base}/api/v1/auth/oauth/providers`, { credentials: 'include' })
      .then((response) => (response.ok ? response.json() : { providers: [] }))
      .then((body: { providers?: Array<{ id: string; label: string }> }) => setProviders(body.providers ?? []))
      .catch(() => setProviders([]));
    // A provider sign-in comes back with its outcome in the query; the app has
    // no use for it once read.
    const params = new URLSearchParams(window.location.search);
    const failed = params.get('sign_in_error');
    if (failed) setError(failed);
    if (failed || params.has('signed_in')) {
      params.delete('sign_in_error');
      params.delete('signed_in');
      const query = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
    }
  }, [enter, base]);

  if (phase.name === 'ready') return <>{children}</>;

  const card = (content: ReactNode) => (
    <div className="onboarding"><div className="onboarding-body"><div className="onboarding-card form">{content}</div></div></div>
  );
  // The shell's shape with the brand, not a card that only says "Connecting".
  if (phase.name === 'loading') return <Loading phase="Signing you in…" onRetry={() => void enter()} />;
  if (phase.name === 'error') {
    return card(<>
      <h1>Can't reach Crewly</h1>
      <p role="alert">{phase.message}</p>
      <button className="primary-button" type="button" onClick={() => void enter()}>Try again</button>
    </>);
  }

  return <div className="onboarding"><div className="onboarding-body"><form className="onboarding-card form" onSubmit={async (event) => {
    event.preventDefault();
    setError('');
    try {
      const response = await fetch(`${base}/api/v1/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(response.status === 401 ? 'That email and password do not match.' : body.error ?? 'Sign-in failed');
        return;
      }
      setPassword('');
      await enter();
    } catch {
      setError('Crewly is not answering. Try again in a moment.');
    }
  }}>
    <h1>Sign in to Crewly</h1>
    {providers.map((provider) => (
      <a key={provider.id} className="primary-button" href={`${base}/api/v1/auth/oauth/${provider.id}/start`}>Continue with {provider.label}</a>
    ))}
    <label>Email<input type="email" required autoComplete="username" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
    <label htmlFor="cloud-password">Password</label>
    <input id="cloud-password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
    {error && <p role="alert">{error}</p>}
    <button className="primary-button" type="submit">Sign in</button>
    {dashboardUrl && <p>New to Crewly? <a className="text-button" href={dashboardUrl}>Create an account</a></p>}
  </form></div></div>;
}
