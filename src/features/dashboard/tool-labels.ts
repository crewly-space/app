import type { ConnectionHealth, ToolPolicyMode, ToolRisk, TrustLevel } from '@crewly/sdk';

/**
 * The words and badge tones every tool screen uses, so "ask every time" or
 * "community" reads the same in agent settings, the MCP list, skills and
 * the activity log.
 */

export type Tone = '' | 'is-success' | 'is-warning' | 'is-danger' | 'is-accent';

export const MODES: Array<{ id: ToolPolicyMode; label: string; detail: string }> = [
  { id: 'always', label: 'Always allowed', detail: 'Runs without asking.' },
  { id: 'ask_once', label: 'Ask once', detail: 'Asks the first time, then runs.' },
  { id: 'ask_every_time', label: 'Ask every time', detail: 'A person approves each call.' },
  { id: 'blocked', label: 'Blocked', detail: 'Never runs, and the agent is not shown it.' },
];

export const modeLabel = (mode: ToolPolicyMode) => MODES.find((entry) => entry.id === mode)?.label ?? mode;
export const modeTone = (mode: ToolPolicyMode): Tone =>
  mode === 'always' ? 'is-success' : mode === 'blocked' ? 'is-danger' : 'is-warning';

const RISKS: Record<ToolRisk, { label: string; tone: Tone }> = {
  read: { label: 'Read', tone: '' },
  write: { label: 'Write', tone: 'is-accent' },
  external_message: { label: 'Sends messages', tone: 'is-warning' },
  delete: { label: 'Deletes', tone: 'is-warning' },
  execute: { label: 'Runs code', tone: 'is-warning' },
  deploy: { label: 'Deploys', tone: 'is-warning' },
  financial: { label: 'Moves money', tone: 'is-danger' },
  admin: { label: 'Admin', tone: 'is-danger' },
  dangerous: { label: 'Dangerous', tone: 'is-danger' },
};
export const riskLabel = (risk: ToolRisk) => RISKS[risk]?.label ?? risk;
export const riskTone = (risk: ToolRisk): Tone => RISKS[risk]?.tone ?? '';

const TRUST: Record<TrustLevel, { label: string; tone: Tone; detail: string }> = {
  official: { label: 'Official', tone: 'is-success', detail: 'Published by the service itself.' },
  verified: { label: 'Crewly verified', tone: 'is-success', detail: 'Reviewed by Crewly or a registry you chose.' },
  community: { label: 'Community', tone: 'is-warning', detail: 'Published by someone else. Its reads ask once; its read-only claims are not believed.' },
  unverified: { label: 'Unverified', tone: 'is-danger', detail: 'Nobody has vouched for it. Its reads ask once; its read-only claims are not believed.' },
};
export const trustLabel = (trust: TrustLevel) => TRUST[trust]?.label ?? trust;
export const trustTone = (trust: TrustLevel): Tone => TRUST[trust]?.tone ?? '';
export const trustDetail = (trust: TrustLevel) => TRUST[trust]?.detail ?? '';
export const TRUST_LEVELS = Object.keys(TRUST) as TrustLevel[];

const HEALTH: Record<ConnectionHealth, { label: string; tone: Tone }> = {
  connected: { label: 'Connected', tone: 'is-success' },
  degraded: { label: 'Degraded', tone: 'is-warning' },
  expired: { label: 'Sign-in expired', tone: 'is-danger' },
  error: { label: 'Failing', tone: 'is-danger' },
  disabled: { label: 'Disabled', tone: '' },
  pending: { label: 'Not tested', tone: '' },
};
export const healthLabel = (health: ConnectionHealth) => HEALTH[health]?.label ?? health;
export const healthTone = (health: ConnectionHealth): Tone => HEALTH[health]?.tone ?? '';

export const permissionLabel = (permission: string) => permission.replace(/[_.]/g, ' ').replace(':', ': ');
