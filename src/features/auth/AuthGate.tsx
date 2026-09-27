import { useEffect, useState, type ReactNode } from 'react';
import { client, clearToken, currentToken, storeToken } from '../../lib/api/client';
import { consumeHandoffFromUrl } from '../../lib/api/handoff';
import { navigateToServerUrl, safeNavigationUrl } from '../../lib/safe-navigation';
import { JoinInvite, leaveInvitePage, readInviteCode } from './JoinInvite';

/**
 * A server's own login.
 *
 * Standalone, it is the front door of a self-hosted install and wraps the
 * whole app. Given a `server`, it is one server's login inside the hosted app:
 * it fills the space beside the rail, reports success through `onReady`
 * instead of rendering children, and never tells the visitor to start a
 * server they do not run.
 */
export function AuthGate({ children, server, onReady, hosted, onRetryCrewly }: {
  children?: ReactNode;
  server?: string;
  onReady?: () => void;
  /** A server bought on Crewly Cloud: the account normally opens it, so this form is only a fallback. */
  hosted?: boolean;
  /** Asks Cloud again for a sign-in to this server. */
  onRetryCrewly?: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<'loading' | 'setup' | 'login' | 'ready'>('loading');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [claimToken, setClaimToken] = useState('');
  const [claimRequired, setClaimRequired] = useState(false);
  const [authMode, setAuthMode] = useState<'local' | 'crewly' | 'both'>('local');
  const [crewlySignInUrl, setCrewlySignInUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  // An invite link opened on this server's own address. The hosted app's
  // per-server gates (`server` set) never see one: the link is to the server.
  const [inviteCode, setInviteCode] = useState(() => (server ? null : readInviteCode()));
  const [signingInToAccept, setSigningInToAccept] = useState(false);
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  // Hosted, the password form is a recovery path, not the way in.
  const [showLocal, setShowLocal] = useState(!hosted);
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
          const me = await client.auth.me();
          if (active) { setSignedInAs(me.email); setPhase('ready'); return; }
        }
      } catch { clearToken(); }
      try {
        const status = await client.auth.status();
        if (active) {
          setClaimRequired(Boolean(status.claimRequired));
          setAuthMode(status.authMode ?? 'local');
          setCrewlySignInUrl(status.crewlySignInUrl ?? null);
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
  if (inviteCode && phase !== 'loading' && phase !== 'setup' && !(phase === 'login' && signingInToAccept)) {
    return <JoinInvite
      code={inviteCode}
      signedInAs={phase === 'ready' ? signedInAs ?? email : null}
      onSignIn={() => setSigningInToAccept(true)}
      onJoined={(token) => {
        storeToken(token);
        leaveInvitePage();
        setInviteCode(null);
        setPhase('ready');
      }}
    />;
  }
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
  if (hosted && !showLocal && phase !== 'loading') {
    return frame(<div className="onboarding-card form">
      <h1>We couldn't open {server} for you</h1>
      <p>Your Crewly account normally signs you straight in to servers you bought. This time the server didn't accept the sign-in. It may still be starting, or it may have been restored from an older copy.</p>
      <button className="primary-button" type="button" onClick={() => onRetryCrewly ? onRetryCrewly() : setAttempt((value) => value + 1)}>Try again</button>
      {phase === 'login' && <button className="text-button" type="button" onClick={() => setShowLocal(true)}>Sign in with a password on this server instead</button>}
    </div>);
  }
  return frame(<form className="onboarding-card form" onSubmit={async (event) => {
    event.preventDefault(); setError('');
    try {
      const result = phase === 'setup'
        ? await client.auth.setup({ email, displayName, password, ...(claimRequired ? { claimToken } : {}) })
        : await client.auth.login({ email, password });
      storeToken(result.token); setSignedInAs(result.user.email); setSigningInToAccept(false); setPhase('ready');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Authentication failed'); }
  }}>
    <h1>{phase === 'setup' ? 'Create first admin' : server ? `Log in to ${server}` : 'Log in to Crewly'}</h1>
    {server && phase === 'login' && <p>{authMode === 'both' ? 'Continue with Crewly, or use a local server account.' : authMode === 'crewly' ? 'This server uses Crewly Identity. Local owner recovery remains available.' : 'This server uses local accounts.'}</p>}
    {phase === 'login' && safeNavigationUrl(crewlySignInUrl) && <button className="primary-button" type="button" onClick={() => navigateToServerUrl(crewlySignInUrl!)}>Continue with Crewly</button>}
    {phase === 'setup' && <label>Name<input required autoComplete="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></label>}
    <label>Email<input type="email" required autoComplete={phase === 'setup' ? 'email' : 'username'} spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
    <label htmlFor="auth-password">Password</label>
    <input id="auth-password" type="password" required minLength={phase === 'setup' ? 12 : 1} autoComplete={phase === 'setup' ? 'new-password' : 'current-password'} aria-describedby={phase === 'setup' ? 'auth-password-help' : undefined} value={password} onChange={(e) => setPassword(e.target.value)} />
    {phase === 'setup' && <small id="auth-password-help">Use at least 12 characters.</small>}
    {phase === 'setup' && claimRequired && <label>Claim token<input required autoComplete="off" value={claimToken} onChange={(e) => setClaimToken(e.target.value)} /><small>Find this one-time token in the server data directory's claim-token file or in the first startup log.</small></label>}
    {error && <p role="alert">{error}</p>}
    {phase !== 'loading' && <button className="primary-button" type="submit">{phase === 'setup' ? 'Create admin' : 'Log in'}</button>}
    {phase === 'login' && !hosted && <p>First time here? <button type="button" className="text-button" onClick={() => setPhase('setup')}>Try first admin setup</button></p>}
    {hosted && <button type="button" className="text-button" onClick={() => { setShowLocal(false); onRetryCrewly?.(); }}>Back to signing in with Crewly</button>}
  </form>);
}
