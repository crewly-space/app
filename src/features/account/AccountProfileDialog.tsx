import { useState, type FormEvent } from 'react';
import { Check, X } from 'lucide-react';
import type { AvatarMode } from '@crewly/protocol';
import { CloudAccount } from '../../lib/cloud/account';
import type { CloudAccountProfile } from '../../lib/servers/types';
import { AvatarModePicker, UserAvatar } from '../appearance/Avatar';

function authMethodLabel(method: string): string {
  if (method === 'password') return 'Password';
  return method.charAt(0).toUpperCase() + method.slice(1);
}

export function AccountProfileDialog({
  account,
  cloud,
  onSaved,
  onClose,
}: {
  account: CloudAccountProfile;
  cloud: CloudAccount;
  onSaved: (profile: CloudAccountProfile) => void;
  onClose: () => void;
}) {
  const [displayName, setDisplayName] = useState(account.displayName);
  const [avatarMode, setAvatarMode] = useState<AvatarMode>(account.avatarMode ?? 'bloop');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dirty = displayName.trim() !== account.displayName || avatarMode !== (account.avatarMode ?? 'bloop');

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !dirty) return;
    setSaving(true);
    setError('');
    try {
      const updated = await cloud.updateProfile({ displayName: displayName.trim(), avatarMode });
      onSaved(updated);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Your profile could not be saved.');
      setSaving(false);
    }
  }

  return (
    <div className="modal-layer" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <div className="modal account-profile-modal" role="dialog" aria-modal="true" aria-labelledby="account-profile-title">
        <header>
          <div>
            <h2 id="account-profile-title">Profile & account</h2>
            <p>Your Crewly identity follows you across servers. Server roles stay managed by each server.</p>
          </div>
          <button className="icon-button compact" type="button" onClick={onClose} aria-label="Close profile settings"><X size={18} /></button>
        </header>
        <form className="form" onSubmit={(event) => void save(event)}>
          <div className="account-profile-preview">
            <UserAvatar id={account.id} name={displayName || account.email} mode={avatarMode} size="large" />
            <div><strong>{displayName || account.email}</strong><span>{account.email}</span></div>
          </div>
          <label>
            <span>Display name</span>
            <input
              required
              minLength={1}
              maxLength={100}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              autoComplete="name"
            />
          </label>
          <AvatarModePicker
            name="global-account-avatar"
            legend="Profile avatar"
            value={avatarMode}
            onChange={setAvatarMode}
            preview={(mode) => <UserAvatar id={account.id} name={displayName || account.email} mode={mode} />}
            disabled={saving}
          />
          <div className="account-auth-methods">
            <div><strong>Linked sign-in methods</strong><span>Managed by Crewly&rsquo;s existing account-linking flow.</span></div>
            <div className="account-auth-list">
              {(account.authMethods ?? []).map((method) => <span key={method}><Check size={13} /> {authMethodLabel(method)}</span>)}
            </div>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="form-actions">
            <button type="button" className="text-button" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="primary-button" disabled={saving || !dirty}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
