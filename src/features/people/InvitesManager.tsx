import { useCallback, useEffect, useState } from "react";
import { Copy, Mail, Plus, X } from "lucide-react";
import type { Invite, UserRole } from "@crewly/sdk";
import { useDialog } from "../../lib/layers";

type InviteRole = Exclude<UserRole, "owner">;

/**
 * Everything the members screens do with invites, behind one seam so the
 * settings panel, the dashboard and the tests all drive the same thing.
 */
export interface InvitesApi {
  listInvites(): Promise<Invite[]>;
  createInvite(input: { role: InviteRole; email?: string; send?: boolean }): Promise<Invite>;
  resendInvite(inviteId: string): Promise<Invite>;
  revokeInvite(inviteId: string): Promise<void>;
}

export const inviteLink = (code: string) => `${window.location.origin}/join#invite=${code}`;

/** Where an invite stands; servers older than invite states only say whether it was used. */
export function inviteStatus(invite: Invite): NonNullable<Invite["status"]> {
  if (invite.status) return invite.status;
  if (invite.usedAt) return "accepted";
  return new Date(invite.expiresAt).getTime() <= Date.now() ? "expired" : "pending";
}

const STATUS_LABEL: Record<NonNullable<Invite["status"]>, string> = {
  pending: "Pending",
  accepted: "Accepted",
  revoked: "Revoked",
  expired: "Expired",
};

const codeOf = (reason: unknown) => (reason as { code?: unknown } | null)?.code;
const messageOf = (reason: unknown, fallback: string) =>
  reason instanceof Error && reason.message ? reason.message : fallback;

/** A freshly made link, shown once: the code is stored hashed and cannot be read back. */
function FreshLink({ code, emailed }: { code: string; emailed: string | null }) {
  const [copied, setCopied] = useState(false);
  const link = inviteLink(code);
  return (
    <div className="invite-fresh">
      {emailed && <p className="field-description"><Mail size={13} /> Sent to <strong>{emailed}</strong>. You can also share the link yourself.</p>}
      <label>
        <span>Invite link</span>
        <span className="invite-fresh-row">
          <input readOnly aria-label="Invite link" value={link} onFocus={(event) => event.currentTarget.select()} />
          <button type="button" className="secondary-button" onClick={() => {
            void navigator.clipboard?.writeText(link).then(() => setCopied(true)).catch(() => {});
          }}>
            <Copy size={14} /> {copied ? "Copied" : "Copy"}
          </button>
        </span>
      </label>
      <small className="field-description">Copy it now: it cannot be shown again. It works for 7 days.</small>
    </div>
  );
}

/**
 * Inviting somebody: their email and the role they will have. Nobody picks a
 * password for anybody; the person sets their own when they accept.
 */
export function InviteDialog({
  api,
  allowAdmin,
  onClose,
  onInvited,
  onCreateLocalAccount,
}: {
  api: InvitesApi;
  allowAdmin: boolean;
  onClose: () => void;
  onInvited: (invite: Invite) => void;
  /** Self-hosted fallback: making a local sign-in directly. Absent where it does not apply. */
  onCreateLocalAccount?: () => void;
}) {
  const dialogRef = useDialog(onClose);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("member");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ invite: Invite; emailed: string | null; note?: string } | null>(null);

  async function create(withEmail: boolean) {
    setSaving(true);
    setError("");
    const address = email.trim();
    try {
      let invite: Invite;
      let emailed: string | null = null;
      let note: string | undefined;
      try {
        invite = await api.createInvite({ role, ...(withEmail && address ? { email: address, send: true } : {}) });
        emailed = withEmail && address ? address : null;
      } catch (reason) {
        // Mail is off on this server: the invite is still the right thing,
        // it just travels as a link the admin sends themselves.
        if (codeOf(reason) !== "mail_disabled") throw reason;
        invite = await api.createInvite({ role, email: address, send: false });
        note = "Email is not set up on this server, so nothing was sent. Share the link below with them.";
      }
      setCreated({ invite, emailed, note });
      onInvited(invite);
    } catch (reason) {
      setError(messageOf(reason, "The invite could not be created."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-layer" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <div ref={dialogRef} className="modal invite-modal" role="dialog" aria-modal="true" aria-labelledby="invite-title">
        <header>
          <div>
            <span className="eyebrow">Server access</span>
            <h2 id="invite-title">Invite a person</h2>
            <p>They join with their own account and password. You only choose their role.</p>
          </div>
          <button type="button" className="icon-button compact" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        {created ? (
          <div className="form agent-form">
            {created.note && <p className="field-description" role="status">{created.note}</p>}
            {created.invite.code && <FreshLink code={created.invite.code} emailed={created.emailed} />}
          </div>
        ) : (
          <form id="invite-form" className="form agent-form" onSubmit={(event) => { event.preventDefault(); void create(true); }}>
            <label>
              <span>Email</span>
              <input autoFocus type="email" autoComplete="off" spellCheck={false} maxLength={320}
                placeholder="name@company.com" value={email} onChange={(event) => setEmail(event.target.value)} />
              <small className="field-description">Only this address can accept the invite.</small>
            </label>
            <label>
              <span>Role</span>
              <select value={role} onChange={(event) => setRole(event.target.value as InviteRole)}>
                <option value="member">Member</option>
                {allowAdmin && <option value="admin">Admin</option>}
              </select>
            </label>
            {error && <div className="form-error" role="alert">{error}</div>}
            {onCreateLocalAccount && (
              <details className="invite-advanced">
                <summary>Advanced: local account</summary>
                <p className="field-description">
                  For a self-hosted server without Crewly accounts, you can create a sign-in on this server
                  directly and hand over a temporary password. Prefer an invite whenever you can.
                </p>
                <button type="button" className="text-button" onClick={onCreateLocalAccount}>Create a local account instead</button>
              </details>
            )}
          </form>
        )}
        <footer>
          {created ? (
            <button type="button" className="primary-button" onClick={onClose}>Done</button>
          ) : (
            <>
              <button type="button" className="secondary-button" disabled={saving} onClick={() => void create(false)}>
                Create link only
              </button>
              <button type="submit" form="invite-form" className="primary-button" disabled={saving || !email.trim()}>
                {saving ? "Inviting…" : "Send invite"}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

/** The invites a server has sent, where each stands, and what can still be done with it. */
export function InvitesManager({
  api,
  allowAdmin,
  onCreateLocalAccount,
  onNotify,
}: {
  api: InvitesApi;
  allowAdmin: boolean;
  onCreateLocalAccount?: () => void;
  onNotify?: (message: string) => void;
}) {
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [inviting, setInviting] = useState(false);
  const [fresh, setFresh] = useState<Invite | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try { setInvites(await api.listInvites()); setError(""); }
    catch (reason) { setError(messageOf(reason, "Invites could not be loaded.")); setInvites([]); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  const act = async (work: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await work(); } catch (reason) { setError(messageOf(reason, "That did not work.")); await load(); }
    finally { setBusy(false); }
  };

  const visible = invites ?? [];
  return (
    <div className="invites-manager">
      <div className="section-heading">
        <div>
          <h3>Invites</h3>
          <p>People join with their own account. Invites expire after 7 days.</p>
        </div>
        <button onClick={() => setInviting(true)}><Plus size={15} /> Invite</button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {fresh?.code && <FreshLink code={fresh.code} emailed={null} />}
      {invites && visible.length === 0 && (
        <p className="field-description">No invites yet. Invite someone by email, or create a link to share.</p>
      )}
      <ul className="invite-list" aria-label="Invites">
        {visible.map((invite) => {
          const status = inviteStatus(invite);
          const open = status === "pending" || status === "expired";
          return (
            <li key={invite.id} className="setting-row">
              <span className="provider-logo small"><Mail size={15} /></span>
              <div>
                <strong>{invite.email ?? "Anyone with the link"}</strong>
                <span>{invite.role === "admin" ? "Admin" : "Member"} · {status === "pending"
                  ? `expires ${new Date(invite.expiresAt).toLocaleDateString()}`
                  : `created ${new Date(invite.createdAt).toLocaleDateString()}`}</span>
              </div>
              <span className={`device-status-chip invite-${status}`}>{STATUS_LABEL[status]}</span>
              {open && (
                <span className="invite-actions">
                  <button type="button" className="text-button" disabled={busy}
                    aria-label={`Resend invite${invite.email ? ` to ${invite.email}` : ""}`}
                    onClick={() => void act(async () => {
                      const renewed = await api.resendInvite(invite.id);
                      setFresh(renewed);
                      setInvites((current) => current && current.map((row) => row.id === invite.id ? renewed : row));
                      onNotify?.(invite.email ? `Invite sent again to ${invite.email}.` : "A new invite link is ready.");
                    })}>Resend</button>
                  {status === "pending" && (
                    <button type="button" className="text-button danger" disabled={busy}
                      aria-label={`Revoke invite${invite.email ? ` to ${invite.email}` : ""}`}
                      onClick={() => void act(async () => {
                        await api.revokeInvite(invite.id);
                        setInvites((current) => current && current.map((row) => row.id === invite.id
                          ? { ...row, status: "revoked", revokedAt: new Date().toISOString() } : row));
                      })}>Revoke</button>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {inviting && (
        <InviteDialog
          api={api}
          allowAdmin={allowAdmin}
          onClose={() => setInviting(false)}
          onInvited={(invite) => setInvites((current) => [invite, ...(current ?? [])])}
          onCreateLocalAccount={onCreateLocalAccount && (() => { setInviting(false); onCreateLocalAccount(); })}
        />
      )}
    </div>
  );
}
