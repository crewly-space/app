import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AuthGate } from '../auth/AuthGate';
import { activateServer } from '../../lib/api/client';
import type { CloudAccount } from '../../lib/cloud/account';
import { connectToServer } from '../../lib/servers/connect';
import type { RegistryServer } from '../../lib/servers/types';

const LAST_SERVER_KEY = 'crewly:last-server';

/** Where people create servers and manage billing, when it is not this app. */
const dashboardUrl: string | undefined = import.meta.env.VITE_CREWLY_DASHBOARD_URL;

type Phase =
  | { name: 'loading' }
  | { name: 'signed_out' }
  | { name: 'no_servers' }
  | { name: 'not_ready'; server: RegistryServer }
  | { name: 'local_login' }
  | { name: 'ready' }
  | { name: 'error'; message: string };

function rememberedServer(): string | null {
  try {
    return localStorage.getItem(LAST_SERVER_KEY);
  } catch {
    return null;
  }
}

/**
 * The front door of the hosted app.
 *
 * Served from Crewly Cloud, the app is nobody's server: the person signs in to
 * their Crewly account, and the server they open is one that account owns.
 * The first server is entered with a Cloud handoff; one that does not know
 * Cloud falls back to its own login.
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
      if (!(await account.me())) {
        setPhase({ name: 'signed_out' });
        return;
      }
      const servers = await account.servers();
      const server = servers.find((candidate) => candidate.id === rememberedServer())
        ?? servers.find((candidate) => candidate.status === 'ready')
        ?? servers[0];
      if (!server) {
        setPhase({ name: 'no_servers' });
        return;
      }
      activateServer(server);
      const result = await connectToServer(server, account);
      if (result.state === 'connected') setPhase({ name: 'ready' });
      else if (result.state === 'not_ready') setPhase({ name: 'not_ready', server });
      else setPhase({ name: 'local_login' });
    } catch {
      setPhase({ name: 'error', message: 'Crewly Cloud is not answering. Try again in a moment.' });
    }
  }, [account]);

  useEffect(() => {
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
  if (phase.name === 'local_login') return <AuthGate>{children}</AuthGate>;

  const card = (content: ReactNode) => (
    <div className="onboarding"><div className="onboarding-body"><div className="onboarding-card form">{content}</div></div></div>
  );
  const dashboardLink = dashboardUrl
    ? <a className="primary-button" href={dashboardUrl}>Open the dashboard</a>
    : null;

  if (phase.name === 'loading') return card(<p>Connecting to Crewly…</p>);
  if (phase.name === 'error') {
    return card(<>
      <h1>Can't reach Crewly</h1>
      <p role="alert">{phase.message}</p>
      <button className="primary-button" type="button" onClick={() => void enter()}>Try again</button>
    </>);
  }
  if (phase.name === 'no_servers') {
    return card(<>
      <h1>No servers yet</h1>
      <p>Your crew lives on a server. Create one in the dashboard, then come back here.</p>
      {dashboardLink}
      <button className="text-button" type="button" onClick={() => void enter()}>I've created one</button>
    </>);
  }
  if (phase.name === 'not_ready') {
    return card(<>
      <h1>{phase.server.name} isn't ready</h1>
      <p>This server is {phase.server.status}. A new server usually takes under a minute.</p>
      <button className="primary-button" type="button" onClick={() => void enter()}>Check again</button>
      {dashboardUrl && <a className="text-button" href={dashboardUrl}>Open the dashboard</a>}
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
      setError('Crewly Cloud is not answering. Try again in a moment.');
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
