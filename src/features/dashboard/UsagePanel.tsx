import { useEffect, useState } from 'react';
import type { Agent, Budget, BudgetAction, ProviderHealth, UsageGrouping, UsageReport } from '@crewly/sdk';
import { formatCost } from '../runs/RunInspector';
import type { PlatformApi } from './platform-api';
import { useWork } from './useWork';

const ACTIONS: Record<BudgetAction, string> = {
  warn: 'Warn only',
  block: 'Stop runs',
  fallback: 'Switch to fallback model',
};

/** What the server's agents spend, the limits on it, and how each provider is doing. */
export function UsagePanel({ api, agents }: { api: PlatformApi; agents: Agent[] }) {
  const { busy, error, run } = useWork();
  const [groupBy, setGroupBy] = useState<UsageGrouping>('agent');
  const [report, setReport] = useState<UsageReport | null>(null);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [health, setHealth] = useState<ProviderHealth[]>([]);
  const [draft, setDraft] = useState({ scope: 'server', agentId: '', period: 'monthly', limitUsd: '50', action: 'warn' as BudgetAction });

  useEffect(() => {
    void run(async () => setReport(await api.usage(groupBy)));
  }, [api, groupBy, run]);
  useEffect(() => {
    void run(async () => {
      const [list, providers] = await Promise.all([api.budgets(), api.providerHealth()]);
      setBudgets(list);
      setHealth(providers);
    });
  }, [api, run]);

  const agentName = (id: string | null) => agents.find((agent) => agent.id === id)?.name ?? 'Deleted agent';

  return (
    <div className="dashboard-usage">
      {error && <p role="alert" className="dashboard-error">{error}</p>}
      {report && (
        <>
          <dl className="dashboard-facts">
            <div><dt>Spent (30 days)</dt><dd>{formatCost(report.totals.costMicros)}</dd></div>
            <div><dt>Model calls</dt><dd>{report.totals.calls}</dd></div>
            <div><dt>Failed calls</dt><dd>{report.totals.errors}</dd></div>
            <div><dt>Tokens</dt><dd>{report.totals.inputTokens + report.totals.outputTokens}</dd></div>
          </dl>
          {report.totals.unpricedCalls > 0 && (
            <p className="field-description">
              {report.totals.unpricedCalls} calls used models with no known price, so the cost above leaves them out.
            </p>
          )}
          <div className="dashboard-actions">
            <label>
              Group by{' '}
              <select aria-label="Group usage by" value={groupBy} onChange={(event) => setGroupBy(event.target.value as UsageGrouping)}>
                <option value="agent">Agent</option>
                <option value="provider">Provider</option>
                <option value="model">Model</option>
                <option value="day">Day</option>
              </select>
            </label>
          </div>
          <table className="dashboard-table">
            <thead><tr><th>{groupBy}</th><th>Calls</th><th>Tokens in / out</th><th>Cost</th></tr></thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.key}>
                  <td><strong>{row.label}</strong></td>
                  <td>{row.calls}{row.errors ? ` (${row.errors} failed)` : ''}</td>
                  <td>{row.inputTokens} / {row.outputTokens}</td>
                  <td>{formatCost(row.costMicros)}{row.unpricedCalls ? ' + unpriced' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h2>Budgets</h2>
      <table className="dashboard-table">
        <thead><tr><th>For</th><th>Spent</th><th>At the limit</th><th aria-label="Actions" /></tr></thead>
        <tbody>
          {budgets.map((budget) => (
            <tr key={budget.id}>
              <td>
                <strong>{budget.scope === 'server' ? 'Whole server' : agentName(budget.agentId)}</strong>
                <small>{budget.period === 'daily' ? 'Per day' : 'Per month'}</small>
              </td>
              <td className={budget.exceeded ? 'dashboard-error' : undefined}>
                {formatCost(budget.spentMicros)} of {formatCost(budget.limitMicros)} ({Math.round(budget.ratio * 100)}%)
              </td>
              <td>{ACTIONS[budget.action]}</td>
              <td className="dashboard-row-actions">
                <button
                  type="button"
                  className="text-button danger"
                  disabled={busy}
                  aria-label={`Remove budget for ${budget.scope === 'server' ? 'the server' : agentName(budget.agentId)}`}
                  onClick={() => void run(async () => {
                    await api.deleteBudget(budget.id);
                    setBudgets((current) => current.filter((row) => row.id !== budget.id));
                  })}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form
        className="dashboard-actions"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            const created = await api.createBudget({
              scope: draft.scope as 'server' | 'agent',
              agentId: draft.scope === 'agent' ? draft.agentId : undefined,
              period: draft.period as 'daily' | 'monthly',
              limitUsd: Number(draft.limitUsd),
              action: draft.action,
            });
            setBudgets((current) => [...current, created]);
          });
        }}
      >
        <select aria-label="Budget for" value={draft.scope === 'server' ? 'server' : draft.agentId} onChange={(event) => {
          const value = event.target.value;
          setDraft((current) => (value === 'server' ? { ...current, scope: 'server', agentId: '' } : { ...current, scope: 'agent', agentId: value }));
        }}>
          <option value="server">Whole server</option>
          {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
        </select>
        <select aria-label="Budget period" value={draft.period} onChange={(event) => setDraft((current) => ({ ...current, period: event.target.value }))}>
          <option value="monthly">per month</option>
          <option value="daily">per day</option>
        </select>
        <input aria-label="Limit in dollars" type="number" min="0.01" step="0.01" value={draft.limitUsd}
          onChange={(event) => setDraft((current) => ({ ...current, limitUsd: event.target.value }))} />
        <select aria-label="At the limit" value={draft.action} onChange={(event) => setDraft((current) => ({ ...current, action: event.target.value as BudgetAction }))}>
          {Object.entries(ACTIONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <button type="submit" className="primary-button" disabled={busy || !(Number(draft.limitUsd) > 0)}>Add budget</button>
      </form>

      <h2>Providers</h2>
      <table className="dashboard-table">
        <thead><tr><th>Provider</th><th>Last hour</th><th>State</th></tr></thead>
        <tbody>
          {health.map((provider) => (
            <tr key={provider.providerId}>
              <td><strong>{provider.providerId}</strong><small>{provider.kind}</small></td>
              <td>
                {provider.window.calls} calls, {provider.window.errors} failed
                {provider.window.averageLatencyMs !== null ? `, ${provider.window.averageLatencyMs} ms avg` : ''}
              </td>
              <td title={provider.reason}>
                {provider.status.replace('_', ' ')}
                {provider.rateLimit?.requestsRemaining !== undefined ? ` · ${provider.rateLimit.requestsRemaining} requests left` : ''}
                {provider.reason ? <small>{provider.reason}</small> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
