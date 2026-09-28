import { useEffect, useState } from 'react';
import type { Agent, McpCapability, Skill, SkillPlan } from '@crewly/sdk';
import type { PlatformApi } from './platform-api';
import { permissionLabel, riskLabel, riskTone } from './tool-labels';
import { useWork } from './useWork';

const capabilityLabel = (capability: string) => capability.replaceAll('_', ' ').replace(/^./, (first) => first.toUpperCase());

/**
 * Installing a skill on an agent, with nothing hidden: which capabilities it
 * needs and what supplies them, the exact tools each permission maps to,
 * what will always ask, and what it would accept on the agent's behalf.
 */
export function SkillPlanCard({ api, skill, agents, onAuthorized }: { api: PlatformApi; skill: Skill; agents: Agent[]; onAuthorized?: (agentName: string) => void }) {
  const { busy, error, run } = useWork();
  const [plan, setPlan] = useState<SkillPlan | null>(null);
  const [agentId, setAgentId] = useState(agents[0]?.id ?? '');
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (!api.skillPlan) return;
    void run(async () => setPlan(await api.skillPlan!(skill.id)));
  }, [api, skill.id, run]);

  if (!api.skillPlan) return null;
  if (!plan) return error ? <p role="alert" className="dashboard-error">{error}</p> : null;

  const routine = plan.permissions.filter((entry) => !entry.approval);
  const asking = plan.permissions.filter((entry) => entry.approval);
  const local = [...new Set(plan.permissions.flatMap((entry) => entry.tools.flatMap((tool) => tool.serverCapabilities)))] as McpCapability[];

  return (
    <div className="skill-plan">
      {error && <p role="alert" className="dashboard-error">{error}</p>}
      <h4>Requires</h4>
      <ul className="catalog-list">
        {plan.requirements.map((requirement) => (
          <li key={requirement.capability}>
            <span className={`badge ${requirement.satisfiedBy.length ? 'is-success' : requirement.required ? 'is-danger' : ''}`}>
              {requirement.satisfiedBy.length ? 'Connected' : requirement.required ? 'Missing' : 'Optional'}
            </span>{' '}
            <strong>{capabilityLabel(requirement.capability)}</strong>{' '}
            <small>
              {requirement.satisfiedBy.length
                ? requirement.satisfiedBy.map((entry) => entry.connectionName).join(', ')
                : `Connect one of: ${requirement.candidates.map((candidate) => candidate.name).join(', ') || 'any provider'}`}
            </small>
          </li>
        ))}
      </ul>

      {routine.length > 0 && <>
        <h4>Allowed without asking</h4>
        <PermissionList entries={routine} />
      </>}
      {asking.length > 0 && <>
        <h4>Always asks for approval</h4>
        <PermissionList entries={asking} />
      </>}
      {plan.unavailable.length > 0 && (
        <p className="field-description">Nothing connected provides {plan.unavailable.map(permissionLabel).join(', ')}; the skill works without {plan.unavailable.length === 1 ? 'it' : 'them'}.</p>
      )}

      {plan.ready ? (
        api.authorizeSkill && agents.length > 0 && (
          <form className="dashboard-form form" onSubmit={(event) => {
            event.preventDefault();
            const agent = agents.find((candidate) => candidate.id === agentId);
            void run(async () => {
              await api.authorizeSkill!(agentId, skill.id, acknowledged ? local : []);
              onAuthorized?.(agent?.name ?? 'the agent');
            });
          }}>
            <label><span>Give it to</span>
              <select value={agentId} onChange={(event) => setAgentId(event.target.value)}>
                {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
              </select>
            </label>
            {local.length > 0 && (
              <label>
                <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
                {' '}I understand these tools use {local.join(', ')} access
              </label>
            )}
            <div className="form-actions">
              <button type="submit" className="primary-button" disabled={busy || !agentId || (local.length > 0 && !acknowledged)}>Authorize and install</button>
            </div>
          </form>
        )
      ) : (
        <p className="callout">Connect {plan.missing.map(capabilityLabel).join(' and ')} first, in Connectors or MCP tools.</p>
      )}
    </div>
  );
}

function PermissionList({ entries }: { entries: SkillPlan['permissions'] }) {
  return (
    <ul className="catalog-list">
      {entries.map((entry) => (
        <li key={entry.permission}>
          <strong>{permissionLabel(entry.permission)}</strong>{' '}
          {entry.tools.length === 0
            ? <small>not available</small>
            : entry.tools.map((tool) => (
              <span key={tool.ref} className={`badge ${riskTone(tool.risk as never)}`} title={`${tool.connectionName} · ${riskLabel(tool.risk as never)}`}>{tool.ref}</span>
            ))}
        </li>
      ))}
    </ul>
  );
}
