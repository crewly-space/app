import { useCallback, useEffect, useState } from 'react';
import type { AgentToolAccess as Access, ToolPolicy, ToolPolicyMode } from '@crewly/sdk';
import type { PlatformApi } from './platform-api';
import { MODES, modeLabel, modeTone, riskLabel, riskTone } from './tool-labels';
import { useWork } from './useWork';

/**
 * What an agent may do with each tool it has -- from native connectors and
 * MCP servers alike -- and why. Changing one writes a rule for that exact
 * tool; financial and destructive tools keep asking whatever the rule says,
 * and the server explains that in the reason.
 */
export function AgentToolAccess({ api, agentId, agentName, refreshKey }: { api: PlatformApi; agentId: string; agentName: string; refreshKey?: string }) {
  const { busy, error, run } = useWork();
  const [access, setAccess] = useState<Access[]>([]);
  const [policies, setPolicies] = useState<ToolPolicy[]>([]);

  const load = useCallback(() => run(async () => {
    if (!api.agentToolAccess) return;
    const [nextAccess, nextPolicies] = await Promise.all([
      api.agentToolAccess(agentId),
      api.agentToolPolicies ? api.agentToolPolicies(agentId) : Promise.resolve([]),
    ]);
    setAccess(nextAccess);
    setPolicies(nextPolicies);
  }), [api, agentId, run]);
  useEffect(() => { void load(); }, [load, refreshKey]);

  if (!api.agentToolAccess) return null;

  const setMode = (ref: string, mode: ToolPolicyMode | 'default') => void run(async () => {
    // Keep every other rule; replace only this tool's.
    const others = policies.filter((policy) => !(policy.selectorType === 'tool' && policy.selector === ref))
      .map(({ selectorType, selector, mode: kept }) => ({ selectorType, selector, mode: kept }));
    const next = mode === 'default' ? others : [...others, { selectorType: 'tool' as const, selector: ref, mode }];
    setPolicies(await api.setAgentToolPolicies!(agentId, next));
    setAccess(await api.agentToolAccess!(agentId));
  });

  const byConnection = new Map<string, Access[]>();
  for (const entry of access) {
    const key = entry.tool.source.connectionName;
    byConnection.set(key, [...(byConnection.get(key) ?? []), entry]);
  }

  return (
    <section className="dashboard-card">
      <h3>Tool permissions</h3>
      <p className="field-description">
        Every tool {agentName} has, from connectors and MCP servers, and what happens when it calls one.
        Asking sends an approval to the agent's owner; the approved call then runs exactly as asked.
      </p>
      {error && <p role="alert" className="dashboard-error">{error}</p>}
      {access.length === 0 && <p className="field-description">No tools yet. Give it some above, in Connectors, or by authorizing a skill.</p>}
      {[...byConnection].map(([connection, entries]) => (
        <fieldset key={connection}>
          <legend>{connection}</legend>
          <ul className="dashboard-toggles">
            {entries.map((entry) => {
              const rule = policies.find((policy) => policy.selectorType === 'tool' && policy.selector === entry.tool.ref);
              return (
                <li key={entry.tool.ref} className="tool-row">
                  <div className="tool-row-main">
                    <strong>{entry.tool.name}</strong>{' '}
                    <span className={`badge ${riskTone(entry.tool.risk)}`} title={entry.tool.permission}>{riskLabel(entry.tool.risk)}</span>{' '}
                    <span className={`badge ${modeTone(entry.mode)}`}>{modeLabel(entry.mode)}</span>
                    <small> {entry.reason}</small>
                  </div>
                  <select aria-label={`When ${agentName} uses ${entry.tool.ref}`} disabled={busy || !api.setAgentToolPolicies}
                    value={rule?.mode ?? 'default'} onChange={(event) => setMode(entry.tool.ref, event.target.value as ToolPolicyMode | 'default')}>
                    <option value="default">Default</option>
                    {MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
                  </select>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ))}
    </section>
  );
}
