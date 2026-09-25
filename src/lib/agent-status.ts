import type { AgentStatus } from '@crewly/sdk';
import type { Agent } from '../types';

const PRESENCE: Record<AgentStatus['presence'], string> = {
  online: 'Online',
  idle: 'Idle',
  dnd: 'Do not disturb',
  offline: 'Offline',
};

const EXECUTION: Record<AgentStatus['execution'], string> = {
  ready: 'Ready',
  working: 'Working',
  waiting_approval: 'Waiting for approval',
  queued: 'Queued',
  error: 'Error',
  runtime_unavailable: 'Runtime unavailable',
  provider_unavailable: 'Provider unavailable',
};

/**
 * An agent with the server's canonical status applied. The coarse `status`
 * the existing badges style themselves with is derived from it, so every
 * badge in the app shows the same thing.
 */
export function withStatus(agent: Agent, status: AgentStatus): Agent {
  const busy = status.execution === 'working' || status.execution === 'queued' || status.execution === 'waiting_approval';
  const blocked = status.execution === 'error' || status.execution === 'runtime_unavailable' || status.execution === 'provider_unavailable';
  return {
    ...agent,
    status: status.presence === 'offline' || blocked ? 'offline' : busy ? 'thinking' : 'online',
    presence: status.presence,
    execution: status.execution,
    statusReason: status.reason ?? undefined,
    availability: status.availability,
    activeRunId: status.activeRunId ?? undefined,
  };
}

/** "Online · Working", "Do not disturb · Ready" -- or the old wording for a server that does not say. */
export function statusLabel(agent: Partial<Pick<Agent, 'status' | 'presence' | 'execution'>>): string {
  const blocked = agent.execution === 'error' || agent.execution === 'runtime_unavailable' || agent.execution === 'provider_unavailable';
  if (agent.presence && agent.execution) {
    return blocked && agent.presence !== 'offline'
      ? `${EXECUTION[agent.execution]} · ${PRESENCE[agent.presence]}`
      : `${PRESENCE[agent.presence]} · ${EXECUTION[agent.execution]}`;
  }
  if (blocked && agent.execution) return EXECUTION[agent.execution];
  if (agent.status === 'online') return 'Ready';
  if (agent.status === 'thinking') return 'Working';
  if (agent.status === 'offline') return 'No model provider';
  return 'Status unknown';
}

/** The label with its reason, for a tooltip: "Offline · Provider unavailable — Claude device offline". */
export function statusTitle(agent: Partial<Pick<Agent, 'status' | 'presence' | 'execution' | 'statusReason'>>): string {
  return agent.statusReason ? `${statusLabel(agent)} — ${agent.statusReason}` : statusLabel(agent);
}
