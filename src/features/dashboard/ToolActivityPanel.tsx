import { useCallback, useEffect, useState } from 'react';
import type { Agent, ApprovalRequest, ToolExecution } from '@crewly/sdk';
import type { PlatformApi } from './platform-api';
import { riskLabel, riskTone, type Tone } from './tool-labels';
import { useWork } from './useWork';

const STATUS: Record<ToolExecution['status'], { label: string; tone: Tone }> = {
  success: { label: 'Ran', tone: 'is-success' },
  error: { label: 'Failed', tone: 'is-danger' },
  blocked: { label: 'Blocked', tone: 'is-danger' },
  approval_required: { label: 'Asked', tone: 'is-warning' },
};

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '');

/**
 * The audit log: every external tool call an agent made, was refused, or
 * asked a person for, and every approval decision. Arguments arrive already
 * redacted by the server; results are never stored, only their size.
 */
export function ToolActivityPanel({ api, agents }: { api: PlatformApi; agents: Agent[] }) {
  const { busy, error, run } = useWork();
  const [executions, setExecutions] = useState<ToolExecution[]>([]);
  const [decisions, setDecisions] = useState<ApprovalRequest[]>([]);
  const [filter, setFilter] = useState<{ agentId: string; status: '' | ToolExecution['status'] }>({ agentId: '', status: '' });
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => run(async () => {
    if (!api.toolExecutions) return;
    setExecutions(await api.toolExecutions({ agentId: filter.agentId || undefined, status: filter.status || undefined, limit: 200 }));
    if (api.approvalHistory) setDecisions(await api.approvalHistory());
  }), [api, run, filter]);
  useEffect(() => { void load(); }, [load]);

  if (!api.toolExecutions) return <p className="field-description">This server does not keep a tool activity log yet.</p>;
  const agentName = (id: string | null) => agents.find((agent) => agent.id === id)?.name ?? (id ? 'Removed agent' : '—');

  return (
    <div className="dashboard-activity">
      {error && <p role="alert" className="dashboard-error">{error}</p>}
      <div className="tool-row">
        <label><span>Agent </span>
          <select value={filter.agentId} onChange={(event) => setFilter((current) => ({ ...current, agentId: event.target.value }))}>
            <option value="">All agents</option>
            {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </select>
        </label>
        <label><span>Result </span>
          <select value={filter.status} onChange={(event) => setFilter((current) => ({ ...current, status: event.target.value as typeof current.status }))}>
            <option value="">Everything</option>
            {Object.entries(STATUS).map(([id, entry]) => <option key={id} value={id}>{entry.label}</option>)}
          </select>
        </label>
        <button type="button" className="text-button" disabled={busy} onClick={() => void load()}>Refresh</button>
      </div>

      {executions.length === 0 ? (
        <div className="dashboard-empty">
          <strong>No tool activity yet</strong>
          <p>When agents call tools from connectors or MCP servers, each call shows up here: who, what, with which arguments, and how it went.</p>
        </div>
      ) : (
        <table className="dashboard-table stack-on-phone">
          <thead><tr><th>When</th><th>Agent</th><th>Tool</th><th>Result</th><th aria-label="Details" /></tr></thead>
          <tbody>
            {executions.map((entry) => (
              <tr key={entry.id}>
                <td data-label="When"><time dateTime={entry.createdAt}>{time(entry.createdAt)}</time></td>
                <td data-label="Agent">{agentName(entry.agentId)}</td>
                <td data-label="Tool">
                  <strong>{entry.toolRef}</strong>{' '}
                  <span className={`badge ${riskTone(entry.risk)}`}>{riskLabel(entry.risk)}</span>
                  {open === entry.id && (
                    <>
                      <small>{entry.permission} · {entry.connectionKind === 'mcp_server' ? 'MCP server' : 'connector'} · {entry.durationMs} ms{entry.approvalId ? ' · approved' : ''}</small>
                      <pre>{JSON.stringify(entry.arguments, null, 2)}</pre>
                    </>
                  )}
                </td>
                <td data-label="Result">
                  <span className={`badge ${STATUS[entry.status].tone}`}>{STATUS[entry.status].label}</span>
                  {entry.error && <small>{entry.error}</small>}
                </td>
                <td className="dashboard-row-actions">
                  <button type="button" className="text-button" aria-expanded={open === entry.id} onClick={() => setOpen((current) => (current === entry.id ? null : entry.id))}>
                    {open === entry.id ? 'Less' : 'Details'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {decisions.length > 0 && (
        <>
          <h2>Approval decisions</h2>
          <table className="dashboard-table stack-on-phone">
            <thead><tr><th>Decided</th><th>Agent</th><th>Action</th><th>Decision</th></tr></thead>
            <tbody>
              {decisions.map((approval) => (
                <tr key={approval.id}>
                  <td data-label="Decided"><time dateTime={approval.resolvedAt ?? undefined}>{time(approval.resolvedAt)}</time></td>
                  <td data-label="Agent">{agentName(approval.agentId)}</td>
                  <td data-label="Action"><strong>{approval.action}</strong>{approval.execution && <small>{approval.execution.status === 'success' ? 'Ran after approval' : `Did not run: ${approval.execution.status}`}</small>}</td>
                  <td data-label="Decision">
                    <span className={`badge ${approval.status === 'approved' ? 'is-success' : approval.status === 'denied' ? 'is-danger' : ''}`}>
                      {approval.status === 'approved' ? 'Approved' : approval.status === 'denied' ? 'Denied' : 'Expired'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
