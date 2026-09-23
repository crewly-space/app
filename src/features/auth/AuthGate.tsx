import { useEffect, useState, type ReactNode } from 'react';
import { client, clearToken, currentToken, storeToken } from '../../lib/api/client';
import { consumeHandoffFromUrl } from '../../lib/api/handoff';

/**
 * A server's own login.
 *
 * Standalone, it is the front door of a self-hosted install and wraps the
 * whole app. Given a `server`, it is one server's login inside the hosted app:
 * it fills the space beside the rail, reports success through `onReady`
 * instead of rendering children, and never tells the visitor to start a
 * server they do not run.
 */
export function AuthGate({ children, server, onReady }: { children?: ReactNode; server?: string; onReady?: () => void }) {
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<'loading' | 'setup' | 'login' | 'ready'>('loading');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [claimToken, setClaimToken] = useState('');
  const [claimRequired, setClaimRequired] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      // Arriving from Cloud: the token in the fragment becomes a session here,
      // so nobody has to copy a setup code to open a server they paid for.
      try {
        if (await consumeHandoffFromUrl()) {
          if (active) { setPhase('ready'); return; }
        }
      } catch { /* fall through to the usual sign-in */ }
      try {
        if (currentToken()) {
          await client.auth.me();
          if (active) { setPhase('ready'); return; }
        }
      } catch { clearToken(); }
      try {
        const status = await client.auth.status();
        if (active) {
          setClaimRequired(Boolean(status.claimRequired));
          setPhase(status.initialized ? 'login' : 'setup');
        }
      } catch {
        if (active) {
          setError(server
            ? `Couldn't reach ${server}. It may be offline or restarting.`
            : 'Cannot reach the Crewly server. Start the server and reload.');
        }
      }
    };
    setError('');
    void refresh();
    const logout = () => { setPhase('login'); setPassword(''); };
    window.addEventListener('crewly:logout', logout);
    return () => { active = false; window.removeEventListener('crewly:logout', logout); };
  }, [server, attempt]);
  useEffect(() => { if (phase === 'ready') onReady?.(); }, [phase, onReady]);
  if (phase === 'ready') return <>{children}</>;
  const frame = (content: ReactNode) => server
    ? <div className="server-pending-body">{content}</div>
    : <div className="onboarding"><div className="onboarding-body">{content}</div></div>;
  if (server && phase === 'loading' && error) {
    return frame(<div className="onboarding-card form">
      <h1>{server} isn't answering</h1>
      <p role="alert">{error}</p>
      <button className="primary-button" type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button>
    </div>);
  }
  return frame(<form className="onboarding-card form" onSubmit={async (event) => {
    event.preventDefault(); setError('');
    try {
      const result = phase === 'setup'
        ? await client.auth.setup({ email, displayName, password, ...(claimRequired ? { claimToken } : {}) })
        : await client.auth.login({ email, password });
      storeToken(result.token); setPhase('ready');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Authentication failed'); }
  }}>
    <h1>{phase === 'setup' ? 'Create first admin' : server ? `Log in to ${server}` : 'Log in to Crewly'}</h1>
    {server && phase === 'login' && <p>This server has its own accounts. Use the email and password you have on it.</p>}
    {phase === 'setup' && <label>Name<input required autoComplete="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></label>}
    <label>Email<input type="email" required autoComplete={phase === 'setup' ? 'email' : 'username'} spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
    <label htmlFor="auth-password">Password</label>
    <input id="auth-password" type="password" required minLength={phase === 'setup' ? 12 : 1} autoComplete={phase === 'setup' ? 'new-password' : 'current-password'} aria-describedby={phase === 'setup' ? 'auth-password-help' : undefined} value={password} onChange={(e) => setPassword(e.target.value)} />
    {phase === 'setup' && <small id="auth-password-help">Use at least 12 characters.</small>}
    {phase === 'setup' && claimRequired && <label>Claim token<input required autoComplete="off" value={claimToken} onChange={(e) => setClaimToken(e.target.value)} /><small>Find this one-time token in the server data directory's claim-token file or in the first startup log.</small></label>}
    {error && <p role="alert">{error}</p>}
    {phase !== 'loading' && <button className="primary-button" type="submit">{phase === 'setup' ? 'Create admin' : 'Log in'}</button>}
    {phase === 'login' && <p>First time here? <button type="button" className="text-button" onClick={() => setPhase('setup')}>Try first admin setup</button></p>}
  </form>);
}
