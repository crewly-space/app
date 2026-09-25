import { useEffect, useState } from 'react';
import type {
  Agent,
  AgentRoutingConfig,
  AgentRoutingMode,
  AgentRuntime,
  AgentSkill,
  AgentStatus,
  AgentToolAssignment,
  Channel,
  McpCapability,
  McpServer,
  RuntimeKind,
  RuntimePermissionMode,
  Skill,
} from '@crewly/sdk';
import { statusLabel } from '../../lib/agent-status';
import type { PlatformApi } from './platform-api';
import { useWork } from './useWork';

const RUNTIMES: Array<{ id: RuntimeKind; label: string; detail: string }> = [
  { id: 'native', label: 'Chat', detail: 'Answers through its model provider. Nothing to install.' },
  { id: 'claude-code', label: 'Claude Code', detail: 'Works in a repository on one of your paired devices.' },
  { id: 'codex', label: 'Codex', detail: 'Works in a repository on one of your paired devices.' },
  { id: 'gemini-cli', label: 'Gemini CLI', detail: 'Works in a repository on one of your paired devices.' },
];

const PERMISSIONS: Record<RuntimePermissionMode, string> = {
  ask: 'Ask before editing or running anything',
  auto_edit: 'Edit files freely, ask before running commands',
  read_only: 'Read only',
};

const ROUTING_MODES: Array<{ id: AgentRoutingMode; label: string; detail: string }> = [
  { id: 'mention_only', label: 'Mention only', detail: 'Only explicit @mentions wake it in shared conversations.' },
  { id: 'relevant', label: 'Relevant messages', detail: 'A lightweight profile match filters messages before a run.' },
  { id: 'always', label: 'Always listen', detail: 'Every allowed shared-conversation message can wake it.' },
  { id: 'disabled', label: 'Disabled', detail: 'Only direct messages and explicit mentions wake it.' },
];

/**
 * Everything about one agent that is not its personality: what it runs on,
 * what it may call, which skills it has, who it may hand work to, and
 * whether it can be disturbed. Kept apart so it is clear which is which.
 */
export function AgentSettings({
  api,
  agent,
  agents,
  onBack,
}: {
  api: PlatformApi;
  agent: Agent;
  agents: Agent[];
  onBack: () => void;
}) {
  const { busy, error, run } = useWork();
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [runtime, setRuntime] = useState<AgentRuntime | null>(null);
  const [runtimeDraft, setRuntimeDraft] = useState<{ kind: RuntimeKind; deviceId: string; workspaceId: string; permissionMode: RuntimePermissionMode }>({
    kind: 'native', deviceId: '', workspaceId: '', permissionMode: 'ask',
  });
  const [servers, setServers] = useState<McpServer[]>([]);
  const [tools, setTools] = useState<AgentToolAssignment[]>([]);
  const [acknowledged, setAcknowledged] = useState<McpCapability[]>([]);
  const [library, setLibrary] = useState<Skill[]>([]);
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [delegates, setDelegates] = useState<string[]>([]);
  const [routing, setRouting] = useState<AgentRoutingConfig | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);

  useEffect(() => {
    void run(async () => {
      const [nextStatus, nextRuntime, nextRouting, nextChannels, nextServers, nextTools, nextLibrary, nextSkills, nextDelegates] = await Promise.all([
        api.agentStatus(agent.id),
        api.agentRuntime(agent.id),
        api.agentRouting(agent.id),
        api.channels().catch(() => []),
        api.mcpServers().catch(() => []),
        api.agentTools(agent.id),
        api.skills(),
        api.agentSkills(agent.id),
        api.delegates(agent.id),
      ]);
      setStatus(nextStatus);
      setRuntime(nextRuntime);
      setRouting(nextRouting);
      setChannels(nextChannels);
      setRuntimeDraft({
        kind: nextRuntime.runtimeKind,
        deviceId: nextRuntime.binding?.deviceId ?? '',
        workspaceId: nextRuntime.binding?.workspaceId ?? '',
        permissionMode: nextRuntime.binding?.options.permissionMode ?? 'ask',
      });
      setServers(nextServers);
      setTools(nextTools);
      setLibrary(nextLibrary);
      setSkills(nextSkills);
      setDelegates(nextDelegates.map((entry) => entry.agentId));
    });
  }, [agent.id, api, run]);

  const coding = runtimeDraft.kind !== 'native';
  const device = runtime?.devices.find((candidate) => candidate.id === runtimeDraft.deviceId);
  const hasTool = (serverId: string, toolName: string) => tools.some((tool) => tool.serverId === serverId && tool.toolName === toolName);

  const saveTools = (next: Array<{ serverId: string; toolName: string }>) => run(async () => {
    setTools(await api.setAgentTools(agent.id, next, acknowledged));
  });

  const saveRouting = (mode: AgentRoutingMode | 'inherit', conversationId: string | null = null) => run(async () => {
    setRouting(await api.setAgentRouting(agent.id, { mode, conversationId }));
  });

  return (
    <div className="dashboard-agent">
      <button type="button" className="text-button" onClick={onBack}>← All agents</button>
      <h2>{agent.name}</h2>
      {status && (
        <p className="field-description" role="status">
          {statusLabel(status)}{status.reason ? ` — ${status.reason}` : ''}
        </p>
      )}
      {error && <p role="alert" className="dashboard-error">{error}</p>}

      <section className="dashboard-card">
        <h3>Availability</h3>
        <label>
          <input type="checkbox" checked={status?.availability === 'dnd'} disabled={busy} onChange={(event) => void run(async () => {
            setStatus(await api.setAvailability(agent.id, event.target.checked ? 'dnd' : 'auto'));
          })} /> Do not disturb
        </label>
        <p className="field-description">Other agents and automations will not wake it. People can still message it directly.</p>
      </section>

      <section className="dashboard-card">
        <h3>Message routing</h3>
        <p className="field-description">Choose when this agent joins shared conversations. Direct messages and explicit @mentions always route unless the channel blocks the agent.</p>
        <label className="dashboard-form">
          <span>Default for shared conversations</span>
          <select aria-label="Default message routing" disabled={busy || !routing} value={routing?.defaultMode ?? 'mention_only'}
            onChange={(event) => void saveRouting(event.target.value as AgentRoutingMode)}>
            {ROUTING_MODES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <p className="field-description">{ROUTING_MODES.find((option) => option.id === routing?.defaultMode)?.detail}</p>
        {channels.length > 0 && (
          <fieldset>
            <legend>Channel overrides</legend>
            {channels.map((channel) => {
              const override = routing?.overrides.find((entry) => entry.conversationId === channel.id);
              return (
                <label key={channel.id} className="dashboard-form">
                  <span>{channel.name}</span>
                  <select aria-label={`Routing in ${channel.name}`} disabled={busy || !routing} value={override?.mode ?? 'inherit'}
                    onChange={(event) => void saveRouting(event.target.value as AgentRoutingMode | 'inherit', channel.id)}>
                    <option value="inherit">Use default</option>
                    {ROUTING_MODES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                </label>
              );
            })}
          </fieldset>
        )}
      </section>

      <section className="dashboard-card">
        <h3>Runtime</h3>
        <p className="field-description">Where the agent works. Its model and personality are set in the agent editor.</p>
        {runtime && (
          <p role="status" className={runtime.health.available ? 'field-description' : 'dashboard-error'}>
            {runtime.health.available ? 'Ready to run' : runtime.health.reason}
          </p>
        )}
        <div className="dashboard-choices" role="radiogroup" aria-label="Runtime">
          {RUNTIMES.map((option) => (
            <label key={option.id}>
              <input type="radio" name="runtime" checked={runtimeDraft.kind === option.id}
                onChange={() => setRuntimeDraft((current) => ({ ...current, kind: option.id }))} />
              <strong>{option.label}</strong> <small>{option.detail}</small>
            </label>
          ))}
        </div>
        {coding && runtime && (
          runtime.devices.length === 0 ? (
            <div className="field-description">
              <p>Coding runtimes run on a computer you pair with this server. On that computer:</p>
              <ol>
                <li><code>crewly connect</code> — pair it</li>
                <li><code>crewly runtime install</code> — install and sign in to Claude Code, Codex or Gemini CLI</li>
                <li><code>crewly workspace add ~/code/your-repo</code> — choose what it may work on</li>
              </ol>
            </div>
          ) : (
            <div className="dashboard-form">
              <select aria-label="Device" value={runtimeDraft.deviceId}
                onChange={(event) => setRuntimeDraft((current) => ({ ...current, deviceId: event.target.value, workspaceId: '' }))}>
                <option value="">Choose a device…</option>
                {runtime.devices.map((candidate) => {
                  const offers = candidate.runtimes.find((entry) => entry.id === runtimeDraft.kind);
                  return (
                    <option key={candidate.id} value={candidate.id} disabled={!offers}>
                      {candidate.name}{candidate.connected ? '' : ' (offline)'}
                      {!offers ? ' — not installed' : offers.authenticated ? '' : ' — not signed in'}
                    </option>
                  );
                })}
              </select>
              {device && (
                device.workspaces.length === 0 ? (
                  <p className="field-description">{device.name} has no workspaces. Run <code>crewly workspace add &lt;path&gt;</code> there.</p>
                ) : (
                  <select aria-label="Workspace" value={runtimeDraft.workspaceId}
                    onChange={(event) => setRuntimeDraft((current) => ({ ...current, workspaceId: event.target.value }))}>
                    <option value="">Choose a workspace…</option>
                    {device.workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
                  </select>
                )
              )}
              <select aria-label="What it may do" value={runtimeDraft.permissionMode}
                onChange={(event) => setRuntimeDraft((current) => ({ ...current, permissionMode: event.target.value as RuntimePermissionMode }))}>
                {Object.entries(PERMISSIONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
          )
        )}
        <button type="button" className="primary-button" disabled={busy || (coding && (!runtimeDraft.deviceId || !runtimeDraft.workspaceId))}
          onClick={() => void run(async () => {
            setRuntime(await api.setAgentRuntime(agent.id, {
              runtimeKind: runtimeDraft.kind,
              ...(coding ? { deviceId: runtimeDraft.deviceId, workspaceId: runtimeDraft.workspaceId } : {}),
              options: { permissionMode: runtimeDraft.permissionMode },
            }));
            setStatus(await api.agentStatus(agent.id));
          })}>
          Save runtime
        </button>
        {runtime && runtime.sessions.length > 0 && (
          <ul className="run-events" aria-label="Runtime sessions">
            {runtime.sessions.map((session) => (
              <li key={session.id}><span>{session.status}</span><small>{new Date(session.updatedAt).toLocaleString()}</small></li>
            ))}
          </ul>
        )}
      </section>

      <section className="dashboard-card">
        <h3>Tools</h3>
        <p className="field-description">Things it can call, from the MCP servers connected in Tools.</p>
        {servers.filter((server) => server.enabled && server.availableTools.length).length === 0 && (
          <p className="field-description">No MCP server offers tools yet.</p>
        )}
        {servers.filter((server) => server.enabled && server.availableTools.length).map((server) => (
          <fieldset key={server.id}>
            <legend>{server.name}{server.capabilities.length ? ` — can use ${server.capabilities.join(', ')}` : ''}</legend>
            {server.capabilities.length > 0 && (
              <label>
                <input type="checkbox" checked={server.capabilities.every((capability) => acknowledged.includes(capability))}
                  onChange={(event) => setAcknowledged((current) => event.target.checked
                    ? [...new Set([...current, ...server.capabilities])]
                    : current.filter((capability) => !server.capabilities.includes(capability)))} />
                {' '}I understand {agent.name} will be able to use {server.capabilities.join(', ')}
              </label>
            )}
            {server.availableTools.map((toolName) => (
              <label key={toolName}>
                <input type="checkbox" checked={hasTool(server.id, toolName)} disabled={busy} onChange={(event) => {
                  const current = tools.map(({ serverId, toolName: name }) => ({ serverId, toolName: name }));
                  void saveTools(event.target.checked
                    ? [...current, { serverId: server.id, toolName }]
                    : current.filter((tool) => !(tool.serverId === server.id && tool.toolName === toolName)));
                }} /> {toolName}
              </label>
            ))}
          </fieldset>
        ))}
      </section>

      <section className="dashboard-card">
        <h3>Skills</h3>
        <p className="field-description">How it works: shared instructions from the Skills library.</p>
        {library.map((skill) => {
          const assigned = skills.find((entry) => entry.skillId === skill.id);
          return (
            <label key={skill.id}>
              <input type="checkbox" checked={Boolean(assigned?.enabled)} disabled={busy} onChange={(event) => void run(async () => {
                const others = skills.filter((entry) => entry.skillId !== skill.id)
                  .map((entry) => ({ skillId: entry.skillId, enabled: entry.enabled, config: entry.config }));
                const next = event.target.checked
                  ? [...others, { skillId: skill.id, enabled: true, config: assigned?.config ?? {} }]
                  : others;
                setSkills(await api.setAgentSkills(agent.id, next));
              })} /> <strong>{skill.name}</strong> <small>{skill.description}</small>
            </label>
          );
        })}
        {library.length === 0 && <p className="field-description">The Skills library is empty.</p>}
      </section>

      <section className="dashboard-card">
        <h3>Can hand work to</h3>
        <p className="field-description">Agents it may delegate a subtask to. They see only the task, never this conversation.</p>
        {agents.filter((candidate) => candidate.id !== agent.id).map((candidate) => (
          <label key={candidate.id}>
            <input type="checkbox" checked={delegates.includes(candidate.id)} disabled={busy} onChange={(event) => void run(async () => {
              const next = event.target.checked ? [...delegates, candidate.id] : delegates.filter((id) => id !== candidate.id);
              setDelegates((await api.setDelegates(agent.id, next)).map((entry) => entry.agentId));
            })} /> {candidate.name}
          </label>
        ))}
      </section>
    </div>
  );
}
