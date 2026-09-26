import { useEffect, useState } from "react";
import type { InvitePreview } from "@crewly/sdk";
import { client } from "../../lib/api/client";

/** The invite code an invite link carries (`/join#invite=<code>`), if this page was opened from one. */
export function readInviteCode(location: Pick<Location, "pathname" | "hash"> = window.location): string | null {
  if (location.pathname.replace(/\/+$/, "") !== "/join") return null;
  const code = new URLSearchParams(location.hash.replace(/^#/, "")).get("invite");
  return code && code.trim() ? code.trim() : null;
}

/** Leaves the invite page for the app, so a reload does not try to spend the code again. */
export function leaveInvitePage(): void {
  window.history.replaceState(null, "", "/");
}

/**
 * Where an invite link lands. Signed in, the person joins as the account they
 * already have. Signed out, they create an account with a password only they
 * know -- or sign in first, and come back here to accept.
 */
export function JoinInvite({
  code,
  signedInAs,
  onJoined,
  onSignIn,
}: {
  code: string;
  /** The account this browser is signed in with here, if any. */
  signedInAs: string | null;
  onJoined: (token: string) => void;
  onSignIn: () => void;
}) {
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [problem, setProblem] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    client.users.previewInvite(code).then((result) => {
      if (!active) return;
      setPreview(result);
      if (result.email) setEmail(result.email);
    }).catch((reason) => {
      if (active) setProblem(reason instanceof Error && reason.message ? reason.message : "This invite cannot be used.");
    });
    return () => { active = false; };
  }, [code]);

  const role = preview?.role === "admin" ? "an admin" : "a member";
  const accept = async (input?: { email: string; displayName: string; password: string }) => {
    setSaving(true); setError("");
    try {
      const result = await client.users.acceptInvite(code, input);
      onJoined(result.token);
    } catch (reason) {
      setError(reason instanceof Error && reason.message ? reason.message : "The invite could not be accepted.");
      setSaving(false);
    }
  };

  const frame = (content: React.ReactNode) => (
    <div className="onboarding"><div className="onboarding-body">{content}</div></div>
  );

  if (problem) {
    return frame(<div className="onboarding-card form">
      <h1>This invite can’t be used</h1>
      <p role="alert">{problem}</p>
      <p>Ask whoever invited you to send a new one.</p>
      <button type="button" className="secondary-button" onClick={() => { leaveInvitePage(); window.location.reload(); }}>Go to Crewly</button>
    </div>);
  }
  if (!preview) return frame(<div className="onboarding-card form"><p role="status">Checking your invite…</p></div>);

  if (signedInAs) {
    return frame(<div className="onboarding-card form">
      <h1>You’re invited</h1>
      <p>Join this Crewly server as {role} with the account you’re signed in with, <strong>{signedInAs}</strong>.</p>
      {preview.email && preview.email !== signedInAs.toLowerCase() && (
        <p className="field-description">This invite is for <strong>{preview.email}</strong>. Sign in with that account to accept it.</p>
      )}
      {error && <p role="alert">{error}</p>}
      <button type="button" className="primary-button" disabled={saving} onClick={() => void accept()}>
        {saving ? "Joining…" : "Accept invite"}
      </button>
    </div>);
  }

  return frame(<form className="onboarding-card form" onSubmit={(event) => {
    event.preventDefault();
    void accept({ email: email.trim(), displayName: displayName.trim(), password });
  }}>
    <h1>You’re invited</h1>
    <p>Create your account to join this Crewly server as {role}. You choose your own password.</p>
    <label>Name<input required autoComplete="name" maxLength={100} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
    <label>Email<input required type="email" autoComplete="email" spellCheck={false} readOnly={Boolean(preview.email)}
      value={email} onChange={(event) => setEmail(event.target.value)} /></label>
    <label htmlFor="join-password">Password</label>
    <input id="join-password" type="password" required minLength={12} autoComplete="new-password"
      aria-describedby="join-password-help" value={password} onChange={(event) => setPassword(event.target.value)} />
    <small id="join-password-help">Use at least 12 characters.</small>
    {error && <p role="alert">{error}</p>}
    <button className="primary-button" type="submit" disabled={saving}>{saving ? "Joining…" : "Create account and join"}</button>
    <p>Already have an account here? <button type="button" className="text-button" onClick={onSignIn}>Sign in to accept</button></p>
  </form>);
}
