import { useEffect, useState, type ReactNode } from 'react';
import { client, clearToken, currentToken, storeToken, snapshotClient, activeServerId } from '../../lib/api/client';
import { CrewlyApiError } from '../../sdk/errors';
import { consumeHandoffFromUrl } from '../../lib/api/handoff';
import { navigateToServerUrl, safeNavigationUrl } from '../../lib/safe-navigation';
import { PasswordField } from './PasswordField';
import { BrandMark } from '../shell/BrandMark';
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
  const [saving, setSaving] = useState(false);
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
      } catch (reason) {
        if (!active) return;
        if (reason instanceof CrewlyApiError && reason.status === 401) clearToken();
        else { setError(reason instanceof Error ? reason.message : 'Cannot reach the Crewly server. Try again.'); return; }
      }
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
    return frame(<div className="onboarding-card auth-card form">
      <h1>{server} isn't answering</h1>
      <p role="alert">{error}</p>
      <button className="primary-button" type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button>
    </div>);
  }
  if (hosted && !showLocal && phase !== 'loading') {
    return frame(<div className="onboarding-card auth-card form">
      <h1>We couldn't open {server} for you</h1>
      <p>Your Crewly account normally signs you straight in to servers you bought. This time the server didn't accept the sign-in. It may still be starting, or it may have been restored from an older copy.</p>
      <button className="primary-button" type="button" onClick={() => onRetryCrewly ? onRetryCrewly() : setAttempt((value) => value + 1)}>Try again</button>
      {phase === 'login' && <button className="text-button" type="button" onClick={() => setShowLocal(true)}>Sign in with a password on this server instead</button>}
    </div>);
  }
  if (phase === 'loading') return frame(<div className="onboarding-card auth-card form"><div className="auth-brand"><BrandMark />Crewly<span>Your people. Your agents.</span></div><h1>{error ? 'Unable to connect' : 'Opening your workspace'}</h1><p role={error ? 'alert' : 'status'}>{error || 'Checking your sign-in…'}</p>{error && <button className="primary-button" onClick={() => setAttempt(value => value + 1)}>Try again</button>}</div>);
  return frame(<form className="onboarding-card auth-card form" onSubmit={async (event) => {
    event.preventDefault(); if (saving) return; setSaving(true); setError('');
    const originClient = snapshotClient();
    const originId = activeServerId();
    try {
      const result = phase === 'setup'
        ? await originClient.auth.setup({ email: email.trim(), displayName: displayName.trim(), password, ...(claimRequired ? { claimToken: claimToken.trim() } : {}) })
        : await originClient.auth.login({ email: email.trim(), password });
      if (activeServerId() !== originId || snapshotClient() !== originClient) return;
      storeToken(result.token); setSignedInAs(result.user.email); setSigningInToAccept(false); setPhase('ready');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Authentication failed'); } finally { setSaving(false); }
  }}>
    <div className="auth-brand"><BrandMark />Crewly<span>Your people. Your agents.</span></div>
    <h1>{phase === 'setup' ? 'Create your workspace' : server ? `Log in to ${server}` : 'Log in to Crewly'}</h1>
    {phase === 'setup' && <p>Start with your account. You’ll be the first admin of this server.</p>}
    {!server && phase === 'login' && <p>Welcome back. Sign in to continue with your crew.</p>}
    {server && phase === 'login' && <p>{authMode === 'both' ? 'Continue with Crewly, or use a local server account.' : authMode === 'crewly' ? 'This server uses Crewly Identity. Local owner recovery remains available.' : 'This server uses local accounts.'}</p>}
    {phase === 'login' && safeNavigationUrl(crewlySignInUrl) && <>
      <button className={authMode === 'crewly' ? 'primary-button' : 'secondary-button'} type="button" onClick={() => navigateToServerUrl(crewlySignInUrl!)}>Continue with Crewly</button>
      <div className="auth-divider" role="separator">or</div>
    </>}
    {phase === 'setup' && <label>Name<input placeholder="Your full name" disabled={saving} required autoComplete="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></label>}
    <label>Email<input placeholder="you@example.com" disabled={saving} type="email" required autoComplete={phase === 'setup' ? 'email' : 'username'} spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
    <PasswordField id="auth-password" value={password} onChange={setPassword} creating={phase === 'setup'} disabled={saving} />
    {phase === 'setup' && claimRequired && <label>Server setup code<input disabled={saving} required placeholder="Paste your setup code" autoComplete="off" value={claimToken} onChange={(e) => setClaimToken(e.target.value)} /><small>On a hosted server, copy CREWLY_SETUP_TOKEN from your hosting dashboard. For a local install, use the claim-token file in the server data directory.</small></label>}
    {error && <p role="alert">{error}</p>}
    <button className={phase === 'login' && authMode === 'crewly' && safeNavigationUrl(crewlySignInUrl) ? 'secondary-button' : 'primary-button'} type="submit" disabled={saving}>{saving ? 'Signing you in…' : phase === 'setup' ? 'Create workspace' : 'Log in'}</button>
    {hosted && <button type="button" className="text-button" onClick={() => { setShowLocal(false); onRetryCrewly?.(); }}>Back to signing in with Crewly</button>}
  </form>);
}
