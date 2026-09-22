import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type {
  Agent,
  Invite,
  ModelInfo,
  ProviderConfigPublic,
  ServerLogEntry,
  ServerStatus,
  UserAccount,
  UserRole,
} from '@crewly/sdk';
import type { DashboardApi } from './api';

type Tab = 'members' | 'invites' | 'agents' | 'providers' | 'server';

const TABS: { id: Tab; label: string }[] = [
  { id: 'members', label: 'Members' },
  { id: 'invites', label: 'Invites' },
  { id: 'agents', label: 'Agents' },
  { id: 'providers', label: 'Providers' },
  { id: 'server', label: 'Server' },
];

/** 128000 reads as noise; 128K is the number people compare. */
function contextLabel(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M context`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K context`;
  return `${tokens} context`;
}

/** What a provider can answer with right now, in words rather than a dot. */
function providerState(provider: ProviderConfigPublic): string {
  if (provider.hasApiKey) return 'API key configured';
  if (provider.baseUrl) return `No API key · ${provider.baseUrl}`;
  return 'No API key';
}

function humanUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

/**
 * Running a server, kept out of the chat.
 *
 * Settings used to be a panel beside a conversation, which is the wrong place
 * to suspend somebody or read what failed last night. The chat stays about
 * messages; this is where the server is administered.
 */
export function Dashboard({
  api,
  currentUser,
  serverName,
  onClose,
}: {
  api: DashboardApi;
  currentUser: UserAccount;
  serverName: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('members');
  const [members, setMembers] = useState<UserAccount[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [logs, setLogs] = useState<ServerLogEntry[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [providers, setProviders] = useState<ProviderConfigPublic[]>([]);
  const [models, setModels] = useState<{ providerId: string; list: ModelInfo[] } | null>(null);
  const [freshInvite, setFreshInvite] = useState<Invite | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const canAdminister = currentUser.role === 'owner' || currentUser.role === 'admin';
  const isOwner = currentUser.role === 'owner';

  const run = useCallback(async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (reason) {
      // Said plainly: the server refuses some of these on purpose, and "it
      // didn't work" would hide which rule was hit.
      setError(reason instanceof Error ? reason.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!canAdminister) return;
    void run(async () => { setMembers(await api.listMembers()); });
  }, [api, canAdminister, run]);

  useEffect(() => {
    if (!canAdminister || tab !== 'invites') return;
    void run(async () => { setInvites(await api.listInvites()); });
  }, [api, canAdminister, run, tab]);

  useEffect(() => {
    if (!canAdminister || tab !== 'agents') return;
    void run(async () => { setAgents(await api.listAgents()); });
  }, [api, canAdminister, run, tab]);

  useEffect(() => {
    if (!canAdminister || tab !== 'providers') return;
    void run(async () => { setProviders(await api.listProviders()); });
  }, [api, canAdminister, run, tab]);

  useEffect(() => {
    if (!canAdminister || tab !== 'server') return;
    void run(async () => {
      const [serverStatus, entries] = await Promise.all([api.status(), api.logs()]);
      setStatus(serverStatus);
      setLogs(entries);
    });
  }, [api, canAdminister, run, tab]);

  if (!canAdminister) {
    return (
      <section className="dashboard">
        <header className="dashboard-head">
          <h1>{serverName}</h1>
          <button className="icon-button" onClick={onClose} aria-label="Close the dashboard"><X size={18} /></button>
        </header>
        <p role="alert" className="field-description">
          Only an owner or admin can manage this server.
        </p>
      </section>
    );
  }

  const owners = members.filter((member) => member.role === 'owner' && !member.suspendedAt);

  return (
    <section className="dashboard">
      <header className="dashboard-head">
        <div>
          <p className="eyebrow">Server</p>
          <h1>{serverName}</h1>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close the dashboard"><X size={18} /></button>
      </header>

      <div className="dashboard-tabs" role="tablist" aria-label="Dashboard sections">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className={tab === entry.id ? 'selected' : ''}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {error && <p role="alert" className="dashboard-error">{error}</p>}

      {tab === 'members' && (
        <table className="dashboard-table">
          <thead>
            <tr><th>Member</th><th>Role</th><th>Access</th><th aria-label="Actions" /></tr>
          </thead>
          <tbody>
            {members.map((member) => {
              // Taking the last owner away would leave the server with nobody
              // who can administer it, so it is never offered.
              const lastOwner = member.role === 'owner' && owners.length <= 1;
              return (
                <tr key={member.id}>
                  <td>
                    <strong>{member.displayName}</strong>
                    <small>{member.email}</small>
                  </td>
                  <td>
                    <select
                      aria-label={`Role for ${member.email}`}
                      value={member.role}
                      disabled={busy || lastOwner || !isOwner}
                      onChange={(event) => {
                        const role = event.target.value as UserRole;
                        void run(async () => {
                          const updated = await api.setRole(member.id, role);
                          setMembers((current) => current.map((row) => (row.id === updated.id ? updated : row)));
                        });
                      }}
                    >
                      <option value="owner">Owner</option>
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                    </select>
                  </td>
                  <td>{member.suspendedAt ? 'Suspended' : 'Active'}</td>
                  <td className="dashboard-row-actions">
                    {!lastOwner && (
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        aria-label={`${member.suspendedAt ? 'Restore' : 'Suspend'} ${member.email}`}
                        onClick={() => void run(async () => {
                          const updated = await api.setSuspended(member.id, !member.suspendedAt);
                          setMembers((current) => current.map((row) => (row.id === updated.id ? updated : row)));
                        })}
                      >
                        {member.suspendedAt ? 'Restore' : 'Suspend'}
                      </button>
                    )}
                    {!lastOwner && (
                      <button
                        type="button"
                        className="text-button danger"
                        disabled={busy}
                        aria-label={`Remove ${member.email}`}
                        onClick={() => void run(async () => {
                          await api.removeMember(member.id);
                          setMembers((current) => current.filter((row) => row.id !== member.id));
                        })}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {tab === 'invites' && (
        <div className="dashboard-invites">
          <div className="dashboard-actions">
            <button
              type="button"
              className="primary-button"
              disabled={busy}
              onClick={() => void run(async () => {
                const invite = await api.createInvite({ role: 'member' });
                setFreshInvite(invite);
                setInvites((current) => [invite, ...current]);
              })}
            >
              Create invite
            </button>
            {isOwner && (
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => void run(async () => {
                  const invite = await api.createInvite({ role: 'admin' });
                  setFreshInvite(invite);
                  setInvites((current) => [invite, ...current]);
                })}
              >
                Create admin invite
              </button>
            )}
          </div>

          {freshInvite?.code && (
            <label className="dashboard-fresh-invite">
              <span>Invite link</span>
              <input
                readOnly
                aria-label="Invite link"
                value={`${window.location.origin}/join#invite=${freshInvite.code}`}
                onFocus={(event) => event.currentTarget.select()}
              />
              <small className="field-description">
                Copy it now — the code is stored hashed and cannot be shown again.
              </small>
            </label>
          )}

          <table className="dashboard-table">
            <thead>
              <tr><th>Role</th><th>Created</th><th>Status</th><th aria-label="Actions" /></tr>
            </thead>
            <tbody>
              {invites.map((invite) => (
                <tr key={invite.id}>
                  <td>{invite.role}</td>
                  <td>{new Date(invite.createdAt).toLocaleDateString()}</td>
                  <td>
                    {invite.usedAt
                      ? 'Used'
                      : new Date(invite.expiresAt).getTime() < Date.now()
                        ? 'Expired'
                        : 'Open'}
                  </td>
                  <td>
                    {!invite.usedAt && (
                      <button
                        type="button"
                        className="text-button danger"
                        disabled={busy}
                        aria-label={`Revoke invite ${invite.id}`}
                        onClick={() => void run(async () => {
                          await api.revokeInvite(invite.id);
                          setInvites((current) => current.filter((row) => row.id !== invite.id));
                        })}
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'agents' && (
        <table className="dashboard-table">
          <thead>
            <tr><th>Agent</th><th>Model</th><th>Provider</th></tr>
          </thead>
          <tbody>
            {agents.map((agent) => (
              <tr key={agent.id}>
                <td>
                  <strong>{agent.name}</strong>
                  <small>{agent.personality.split('\n')[0]}</small>
                </td>
                <td>{agent.modelPolicy.defaultModel}</td>
                <td>{agent.modelPolicy.defaultProviderId}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tab === 'providers' && (
        <div className="dashboard-providers">
          <table className="dashboard-table">
            <thead>
              <tr><th>Provider</th><th>State</th><th aria-label="Actions" /></tr>
            </thead>
            <tbody>
              {providers.map((provider) => (
                <tr key={provider.id}>
                  <td>
                    <strong>{provider.kind}</strong>
                    <small>{provider.id}</small>
                  </td>
                  <td>{providerState(provider)}</td>
                  <td className="dashboard-row-actions">
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      aria-label={`Models from ${provider.id}`}
                      onClick={() => void run(async () => {
                        setModels({ providerId: provider.id, list: await api.listModels(provider.id) });
                      })}
                    >
                      Browse models
                    </button>
                    <button
                      type="button"
                      className="text-button danger"
                      disabled={busy}
                      aria-label={`Remove ${provider.id}`}
                      onClick={() => void run(async () => {
                        await api.removeProvider(provider.id);
                        setProviders((current) => current.filter((row) => row.id !== provider.id));
                        setModels((current) => (current?.providerId === provider.id ? null : current));
                      })}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {models && (
            <section className="dashboard-models">
              <h2>Models from {models.providerId}</h2>
              {models.list.length === 0 ? (
                <p className="field-description">This provider listed no models.</p>
              ) : (
                <ul>
                  {models.list.map((model) => (
                    <li key={model.id}>
                      <strong>{model.displayName}</strong>
                      <small>{model.id}</small>
                      <small>{contextLabel(model.contextWindow)}</small>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      )}

      {tab === 'server' && status && (
        <div className="dashboard-server">
          <dl className="dashboard-facts">
            <div><dt>Version</dt><dd>{status.version}</dd></div>
            <div><dt>Uptime</dt><dd>{humanUptime(status.uptimeSeconds)}</dd></div>
            <div><dt>Members</dt><dd>{status.usage.users}</dd></div>
            <div><dt>Agents</dt><dd>{status.usage.agents}</dd></div>
            <div><dt>Conversations</dt><dd>{status.usage.conversations}</dd></div>
            <div><dt>Messages</dt><dd>{status.usage.messages}</dd></div>
            <div><dt>Providers</dt><dd>{status.usage.providers}</dd></div>
            <div><dt>Work waiting</dt><dd>{status.jobs.pending}</dd></div>
            <div><dt>Work failed</dt><dd>{status.jobs.failed}</dd></div>
            <div><dt>Approvals waiting</dt><dd>{status.approvals.pending}</dd></div>
          </dl>

          <h2>Recent failures</h2>
          {logs.length === 0 ? (
            <p className="field-description">Nothing has failed lately.</p>
          ) : (
            <ul className="dashboard-logs">
              {logs.map((entry) => (
                <li key={`${entry.at}-${entry.subject}`}>
                  <time dateTime={entry.at}>{new Date(entry.at).toLocaleString()}</time>
                  <strong>{entry.subject}</strong>
                  <span>{entry.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
