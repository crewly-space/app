import { useCallback, useEffect, useState } from 'react';
import type {
  Agent,
  ServerLogEntry,
  ServerStatus,
  UserAccount,
  UserRole,
  RolesCatalog,
  Automation,
  AutomationRun,
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
import { RolesPanel } from './RolesPanel';
import { AutomationsPanel } from './AutomationsPanel';
import { RegistryPanel } from './RegistryPanel';
import { FederationPanel } from './FederationPanel';

/** The Settings sections that administer the server rather than the person. */
export type AdminSectionId =
  | 'people' | 'roles' | 'agents' | 'status'
  | 'tools' | 'skills' | 'secrets' | 'mail' | 'cloud' | 'federation'
  | 'usage' | 'runs' | 'automations';

/** The sections that need the agent list, to name agents or choose them. */
const NEEDS_AGENTS: AdminSectionId[] = ['agents', 'usage', 'runs', 'secrets'];

function humanUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

/**
 * One server-administration section of Settings.
 *
 * This used to be a screen of its own ("Server admin") with its own tabs, next
 * to a Settings dialog that did half the same things differently. Settings now
 * owns the navigation; this renders whichever section is open and loads only
 * what that section needs.
 */
export function AdminSection({
  section,
  api,
  platform = platformApi,
  services = servicesApi,
  currentUser,
  serverName,
}: {
  section: AdminSectionId;
  api: DashboardApi;
  platform?: PlatformApi;
  services?: ServicesApi;
  currentUser: { role: string };
  serverName: string;
}) {
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [members, setMembers] = useState<UserAccount[]>([]);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [logs, setLogs] = useState<ServerLogEntry[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [roleCatalog, setRoleCatalog] = useState<RolesCatalog | null>(null);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [automationRuns, setAutomationRuns] = useState<AutomationRun[]>([]);

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
    if (!canAdminister || (section !== 'people' && section !== 'roles')) return;
    void run(async () => { setMembers(await api.listMembers()); });
  }, [api, canAdminister, run, section]);

  useEffect(() => {
    if (!canAdminister || section !== 'automations') return;
    void run(async () => { const [rules, runs] = await Promise.all([api.listAutomations(), api.listAutomationRuns()]); setAutomations(rules); setAutomationRuns(runs); });
  }, [api, canAdminister, run, section]);

  useEffect(() => {
    if (!canAdminister || section !== 'roles') return;
    void run(async () => { setRoleCatalog(await api.listRoles()); });
  }, [api, canAdminister, run, section]);

  useEffect(() => {
    if (!canAdminister || !NEEDS_AGENTS.includes(section)) return;
    void run(async () => { setAgents(await api.listAgents()); });
  }, [api, canAdminister, run, section]);

  useEffect(() => {
    if (!canAdminister || section !== 'status') return;
    void run(async () => {
      const [serverStatus, entries] = await Promise.all([api.status(), api.logs()]);
      setStatus(serverStatus);
      setLogs(entries);
    });
  }, [api, canAdminister, run, section]);

  if (!canAdminister) {
    return <p role="alert" className="field-description">Only an owner or admin can manage this server.</p>;
  }

  const owners = members.filter((member) => member.role === 'owner' && !member.suspendedAt);

  return (
    <div className="admin-section">
      {error && <p role="alert" className="dashboard-error">{error}</p>}

      {section === 'people' && (
        <>
          <table className="dashboard-table stack-on-phone">
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
                    <td data-label="Role">
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
                    <td data-label="Access">{member.suspendedAt ? 'Suspended' : 'Active'}</td>
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
          <div className="dashboard-invites">
            <InvitesManager api={api} allowAdmin={isOwner} />
          </div>
        </>
      )}

      {section === 'roles' && roleCatalog && (
        <RolesPanel
          catalog={roleCatalog}
          members={members}
          busy={busy}
          onCreate={async (input) => { const role = await api.createRole(input); setRoleCatalog(await api.listRoles()); return role; }}
          onUpdate={async (id, input) => { const role = await api.updateRole(id, input); setRoleCatalog(await api.listRoles()); return role; }}
          onDelete={async (id) => { await api.removeRole(id); setRoleCatalog(await api.listRoles()); }}
          onAssign={async (roleId, userId) => { await api.assignRole(roleId, userId); setRoleCatalog(await api.listRoles()); }}
          onUnassign={async (roleId, userId) => { await api.unassignRole(roleId, userId); setRoleCatalog(await api.listRoles()); }}
        />
      )}

      {section === 'automations' && <AutomationsPanel automations={automations} runs={automationRuns} busy={busy}
        onCreate={async (input) => { const result = await api.createAutomation(input); setAutomations(await api.listAutomations()); setAutomationRuns(await api.listAutomationRuns()); return result; }}
        onUpdate={async (id, input) => { const result = await api.updateAutomation(id, input); setAutomations(await api.listAutomations()); setAutomationRuns(await api.listAutomationRuns()); return result; }}
        onDelete={async (id) => { await api.removeAutomation(id); setAutomations(await api.listAutomations()); setAutomationRuns(await api.listAutomationRuns()); }} />}

      {section === 'agents' && configuring && agents.some((agent) => agent.id === configuring) && (
        <AgentSettings
          api={platform}
          agent={agents.find((agent) => agent.id === configuring)!}
          agents={agents}
          onBack={() => setConfiguring(null)}
        />
      )}

      {section === 'agents' && !configuring && (
        agents.length === 0 ? (
          <div className="dashboard-empty">
            <strong>No agents yet</strong>
            <p>Create an agent from the sidebar with New agent, then give it a runtime, tools and skills here.</p>
          </div>
        ) : (
          <table className="dashboard-table stack-on-phone">
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
                  <td data-label="Model">{agent.modelPolicy.defaultModel}</td>
                  <td data-label="Provider">{agent.modelPolicy.defaultProviderId}</td>
                  <td className="dashboard-row-actions">
                    <button type="button" className="text-button" aria-label={`Settings for ${agent.name}`} onClick={() => setConfiguring(agent.id)}>
                      Runtime, tools & skills
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}

      {section === 'usage' && <UsagePanel api={platform} agents={agents} />}
      {section === 'runs' && <RunsPanel api={platform} agents={agents} />}
      {section === 'tools' && <ToolsPanel api={platform} />}
      {section === 'skills' && <><SkillsPanel api={platform} /><RegistryPanel api={platform} /></>}
      {section === 'secrets' && <SecretsPanel api={platform} agents={agents} />}
      {section === 'mail' && <MailPanel api={services} />}
      {section === 'cloud' && <CrewlyPanel api={services} serverName={serverName} />}
      {section === 'federation' && <FederationPanel api={platform} />}

      {section === 'status' && status && (
        <div className="dashboard-server">
          <h2>Health</h2>
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
    </div>
  );
}
