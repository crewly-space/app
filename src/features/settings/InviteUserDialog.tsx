import { useState } from "react";
import type { FormEvent } from "react";
import { X } from "lucide-react";
import { gateway } from "../../lib/gateway";
import { useDialog } from "../../lib/layers";

export function InviteUserDialog({
  allowAdmin,
  onClose,
  onCreated,
}: {
  allowAdmin: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const dialogRef = useDialog(onClose);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const result = await gateway.createInvite({
        role,
        ...(email.trim() ? { email: email.trim() } : {}),
      });
      setInviteLink(result.invite.code
        ? `${window.location.origin}/join#invite=${result.invite.code}`
        : null);
      onCreated();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create this invite.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="modal-layer" onMouseDown={(event) => {
    if (event.currentTarget === event.target) onClose();
  }}>
    <div ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="invite-person-title">
      <header>
        <div>
          <span className="eyebrow">Server access</span>
          <h2 id="invite-person-title">Invite someone</h2>
          <p>They set their own password when they accept the invite.</p>
        </div>
        <button type="button" className="icon-button compact" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </header>
      <form id="invite-person-form" className="form agent-form" onSubmit={createInvite}>
        <label>
          <span>Email <em>Optional — send the link by email</em></span>
          <input type="email" autoFocus autoComplete="email" spellCheck={false} value={email}
            onChange={(event) => setEmail(event.target.value)} placeholder="person@example.com" />
        </label>
        {allowAdmin && <label>
          <span>Role</span>
          <select value={role} onChange={(event) => setRole(event.target.value as "member" | "admin")}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </label>}
        {inviteLink && <label>
          <span>Invite link <em>Copy it now — it is shown once</em></span>
          <input readOnly aria-label="Invite link" value={inviteLink}
            onFocus={(event) => event.currentTarget.select()} />
        </label>}
        {error && <div className="form-error" role="alert">{error}</div>}
      </form>
      <footer>
        <button type="button" className="secondary-button" onClick={onClose}>Close</button>
        {!inviteLink && <button type="submit" form="invite-person-form" className="primary-button" disabled={saving}>
          {saving ? "Creating…" : "Create invite"}
        </button>}
      </footer>
    </div>
  </div>;
}
