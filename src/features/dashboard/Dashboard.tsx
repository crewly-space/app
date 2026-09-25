import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type {
  Agent,
  ModelInfo,
  ProviderConfigPublic,
  ServerLogEntry,
  ServerStatus,
  UserAccount,
  UserRole,
} from '@crewly/sdk';
import type { DashboardApi } from './api';
import { platformApi, type PlatformApi } from './platform-api';
import { AgentSettings } from './AgentSettings';
import { RunsPanel } from './RunsPanel';
import { SecretsPanel } from './SecretsPanel';
import { SkillsPanel } from './SkillsPanel';
import { ToolsPanel } from './ToolsPanel';
import { UsagePanel } from './UsagePanel';
import { CrewlyPanel } from './CrewlyPanel';
import { InvitesManager } from '../people/InvitesManager';
import { MailPanel } from './MailPanel';
import { servicesApi, type ServicesApi } from './services-api';

type Tab = 'members' | 'invites' | 'agents' | 'providers' | 'usage' | 'runs' | 'tools' | 'skills' | 'secrets' | 'mail' | 'crewly' | 'server';

/*
 * Twelve equal tabs in one row said nothing about how they relate, and ran
 * off the edge at laptop widths. Grouped, a person looks for the job to do.
 */
const GROUPS: { label: string; tabs: { id: Tab; label: string }[] }[] = [
  { label: 'People & access', tabs: [{ id: 'members', label: 'Members' }, { id: 'invites', label: 'Invites' }] },
  { label: 'Agents & AI', tabs: [
    { id: 'agents', label: 'Agents' }, { id: 'providers', label: 'Providers' },
    { id: 'tools', label: 'Tools' }, { id: 'skills', label: 'Skills' },
  ] },
  { label: 'Integrations', tabs: [{ id: 'mail', label: 'Mail' }, { id: 'crewly', label: 'Crewly' }, { id: 'secrets', label: 'Secrets' }] },
  { label: 'Usage & operations', tabs: [{ id: 'usage', label: 'Usage' }, { id: 'runs', label: 'Runs' }, { id: 'server', label: 'Server' }] },
];

/** The sections that need the agent list, to name agents or choose them. */
const NEEDS_AGENTS: Tab[] = ['agents', 'usage', 'runs', 'secrets'];

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
  platform = platformApi,
  services = servicesApi,
  currentUser,
  serverName,
  onClose,
}: {
  api: DashboardApi;
  platform?: PlatformApi;
  services?: ServicesApi;
  currentUser: UserAccount;
  serverName: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('members');
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [members, setMembers] = useState<UserAccount[]>([]);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [logs, setLogs] = useState<ServerLogEntry[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [providers, setProviders] = useState<ProviderConfigPublic[]>([]);
  const [models, setModels] = useState<{ providerId: string; list: ModelInfo[] } | null>(null);
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
    if (!canAdminister || !NEEDS_AGENTS.includes(tab)) return;
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

      <nav className="dashboard-nav" aria-label="Dashboard sections">
        {GROUPS.map((group) => (
          <div className="dashboard-nav-group" key={group.label}>
            <span className="dashboard-nav-label">{group.label}</span>
            <div className="dashboard-tabs" role="tablist" aria-label={group.label}>
              {group.tabs.map((entry) => (
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
          </div>
        ))}
      </nav>

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
          <InvitesManager api={api} allowAdmin={isOwner} />
        </div>
      )}

      {tab === 'agents' && configuring && agents.some((agent) => agent.id === configuring) && (
        <AgentSettings
          api={platform}
          agent={agents.find((agent) => agent.id === configuring)!}
          agents={agents}
          onBack={() => setConfiguring(null)}
        />
      )}

      {tab === 'usage' && <UsagePanel api={platform} agents={agents} />}
      {tab === 'runs' && <RunsPanel api={platform} agents={agents} />}
      {tab === 'tools' && <ToolsPanel api={platform} />}
      {tab === 'skills' && <SkillsPanel api={platform} />}
      {tab === 'secrets' && <SecretsPanel api={platform} agents={agents} />}
      {tab === 'mail' && <MailPanel api={services} />}
      {tab === 'crewly' && <CrewlyPanel api={services} serverName={serverName} />}

      {tab === 'agents' && !configuring && (
        <table className="dashboard-table">
          <thead>
            <tr><th>Agent</th><th>Model</th><th>Provider</th><th aria-label="Actions" /></tr>
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
                <td className="dashboard-row-actions">
                  <button type="button" className="text-button" aria-label={`Settings for ${agent.name}`} onClick={() => setConfiguring(agent.id)}>
                    Runtime, tools & skills
                  </button>
                </td>
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
