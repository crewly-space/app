import { useEffect, useState, type ReactNode } from 'react';
import { client, clearToken, currentToken, storeToken } from '../../lib/api/client';
import { consumeHandoffFromUrl } from '../../lib/api/handoff';

export function AuthGate({ children }: { children: ReactNode }) {
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
      } catch { if (active) setError('Cannot reach the Crewly server. Start the server and reload.'); }
    };
    void refresh();
    const logout = () => { setPhase('login'); setPassword(''); };
    window.addEventListener('crewly:logout', logout);
    return () => { active = false; window.removeEventListener('crewly:logout', logout); };
  }, []);
  if (phase === 'ready') return <>{children}</>;
  return <div className="onboarding"><div className="onboarding-body"><form className="onboarding-card form" onSubmit={async (event) => {
    event.preventDefault(); setError('');
    try {
      const result = phase === 'setup'
        ? await client.auth.setup({ email, displayName, password, ...(claimRequired ? { claimToken } : {}) })
        : await client.auth.login({ email, password });
      storeToken(result.token); setPhase('ready');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Authentication failed'); }
  }}>
    <h1>{phase === 'setup' ? 'Create first admin' : 'Log in to Crewly'}</h1>
    {phase === 'setup' && <label>Name<input required autoComplete="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></label>}
    <label>Email<input type="email" required autoComplete={phase === 'setup' ? 'email' : 'username'} spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
    <label htmlFor="auth-password">Password</label>
    <input id="auth-password" type="password" required minLength={phase === 'setup' ? 12 : 1} autoComplete={phase === 'setup' ? 'new-password' : 'current-password'} aria-describedby={phase === 'setup' ? 'auth-password-help' : undefined} value={password} onChange={(e) => setPassword(e.target.value)} />
    {phase === 'setup' && <small id="auth-password-help">Use at least 12 characters.</small>}
    {phase === 'setup' && claimRequired && <label>Claim token<input required autoComplete="off" value={claimToken} onChange={(e) => setClaimToken(e.target.value)} /><small>Find this one-time token in the server data directory's claim-token file or in the first startup log.</small></label>}
    {error && <p role="alert">{error}</p>}
    {phase !== 'loading' && <button className="primary-button" type="submit">{phase === 'setup' ? 'Create admin' : 'Log in'}</button>}
    {phase === 'login' && <p>First time here? <button type="button" className="text-button" onClick={() => setPhase('setup')}>Try first admin setup</button></p>}
  </form></div></div>;
}
