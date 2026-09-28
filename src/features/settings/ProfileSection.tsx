import { useState, type FormEvent } from "react";
import type { AuthUser } from "@crewly/sdk";
import { client } from "../../lib/api/client";

/**
 * Who you are on this server: your name, the email you sign in with, and your
 * password. What can be changed follows how you sign in -- an account that
 * signs in only through Crewly has its email and password there, not here.
 */
export function ProfileSection({ currentUser, onChanged, onNotify }: {
  currentUser: AuthUser;
  onChanged: () => Promise<void>;
  onNotify: (message: string) => void;
}) {
  const [name, setName] = useState(currentUser.displayName ?? "");
  const [nameBusy, setNameBusy] = useState(false);
  const [nameError, setNameError] = useState("");
  const [email, setEmail] = useState(currentUser.email);
  const [emailPassword, setEmailPassword] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  // Older servers do not say; offer the change and let the server decide.
  const hasPassword = currentUser.hasPassword ?? true;
  const emailChanged = email.trim().toLowerCase() !== currentUser.email.toLowerCase();

  const saveName = async (event: FormEvent) => {
    event.preventDefault();
    setNameBusy(true); setNameError("");
    try {
      await client.users.updateMe({ displayName: name.trim() });
      await onChanged();
      onNotify("Name saved.");
    } catch (reason) { setNameError(reason instanceof Error ? reason.message : "Your name could not be saved."); }
    finally { setNameBusy(false); }
  };
  const saveEmail = async (event: FormEvent) => {
    event.preventDefault();
    setEmailBusy(true); setEmailError("");
    try {
      await client.users.changeEmail({ email: email.trim(), currentPassword: emailPassword });
      setEmailPassword("");
      await onChanged();
      onNotify("Email changed. Use it the next time you sign in.");
    } catch (reason) { setEmailError(reason instanceof Error ? reason.message : "Your email could not be changed."); }
    finally { setEmailBusy(false); }
  };
  const savePassword = async (event: FormEvent) => {
    event.preventDefault();
    setPasswordBusy(true); setPasswordError("");
    try {
      await client.users.changePassword({ currentPassword, newPassword });
      setCurrentPassword(""); setNewPassword("");
      onNotify("Password changed. Other devices were signed out.");
    } catch (reason) { setPasswordError(reason instanceof Error ? reason.message : "Your password could not be changed."); }
    finally { setPasswordBusy(false); }
  };

  return (
    <>
      <form className="form settings-form" onSubmit={(event) => void saveName(event)}>
        <h4 className="settings-subheading">Name</h4>
        <label>
          <span>Display name</span>
          <input maxLength={100} required value={name} autoComplete="name" onChange={(event) => setName(event.target.value)} />
        </label>
        {nameError && <p className="form-error" role="alert">{nameError}</p>}
        <div className="settings-form-actions">
          <button type="submit" className="primary-button" disabled={nameBusy || !name.trim() || name.trim() === currentUser.displayName}>
            {nameBusy ? "Saving…" : "Save name"}
          </button>
        </div>
      </form>

      <form className="form settings-form" onSubmit={(event) => void saveEmail(event)}>
        <h4 className="settings-subheading">Email</h4>
        {!hasPassword ? (
          <p className="field-description">
            You sign in to this server with your Crewly account as <strong>{currentUser.email}</strong>. Change your email in your Crewly account; this server follows it the next time you sign in.
          </p>
        ) : (
          <>
            <p className="field-description">The address you sign in with here{currentUser.signsInWithCrewly ? " with a password. Signing in with Crewly keeps using your Crewly account's email" : ""}.</p>
            <label>
              <span>Email</span>
              <input type="email" required maxLength={320} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            {emailChanged && <label>
              <span>Current password</span>
              <input type="password" required autoComplete="current-password" value={emailPassword} onChange={(event) => setEmailPassword(event.target.value)} />
              <small>To confirm it is you.</small>
            </label>}
            {emailError && <p className="form-error" role="alert">{emailError}</p>}
            <div className="settings-form-actions">
              <button type="submit" className="primary-button" disabled={emailBusy || !emailChanged || !emailPassword}>
                {emailBusy ? "Changing…" : "Change email"}
              </button>
            </div>
          </>
        )}
      </form>

      {hasPassword && <form className="form settings-form" onSubmit={(event) => void savePassword(event)}>
        <h4 className="settings-subheading">Password</h4>
        <label>
          <span>Current password</span>
          <input type="password" required autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
        </label>
        <label>
          <span>New password</span>
          <input type="password" required minLength={12} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
          <small>At least 12 characters. Your other devices will be signed out.</small>
        </label>
        {passwordError && <p className="form-error" role="alert">{passwordError}</p>}
        <div className="settings-form-actions">
          <button type="submit" className="primary-button" disabled={passwordBusy || !currentPassword || newPassword.length < 12}>
            {passwordBusy ? "Changing…" : "Change password"}
          </button>
        </div>
      </form>}
    </>
  );
}
