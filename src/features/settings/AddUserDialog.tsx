import { useState } from "react";
import { X } from "lucide-react";
import { gateway } from "../../lib/gateway";
import { useDialog } from "../../lib/layers";

export function AddUserDialog({
  allowAdmin,
  onClose,
  onCreated,
}: {
  allowAdmin: boolean;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const dialogRef = useDialog(onClose);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  return <div className="modal-layer" onMouseDown={(event) => {
    if (event.currentTarget === event.target) onClose();
  }}>
    <div ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="add-person-title">
      <header>
        <div>
          <span className="eyebrow">Server access</span>
          <h2 id="add-person-title">Add a person</h2>
          <p>Create a sign-in for this Crewly server.</p>
        </div>
        <button type="button" className="icon-button compact" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </header>
      <form id="add-person-form" className="form agent-form" onSubmit={async (event) => {
        event.preventDefault();
        if (saving) return;
        setSaving(true);
        setError('');
        try {
          await gateway.createUser({ displayName: displayName.trim(), email: email.trim(), password, role });
          await onCreated();
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : 'Could not add this person.');
          setSaving(false);
        }
      }}>
        <label><span>Name <em>Required</em></span><input autoFocus required autoComplete="name" maxLength={100} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
        <label><span>Email <em>Required</em></span><input required type="email" autoComplete="email" spellCheck={false} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label><span>Temporary password <em>12+ characters</em></span><input required minLength={12} maxLength={256} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {allowAdmin && <label><span>Role</span><select value={role} onChange={(event) => setRole(event.target.value as 'member' | 'admin')}><option value="member">Member</option><option value="admin">Admin</option></select></label>}
        {error && <div className="form-error" role="alert">{error}</div>}
      </form>
      <footer>
        <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
        <button type="submit" form="add-person-form" className="primary-button" disabled={saving}>{saving ? 'Adding…' : 'Add person'}</button>
      </footer>
    </div>
  </div>;
}
