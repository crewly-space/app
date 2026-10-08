import { useEffect, useState } from 'react';
import type { Agent, AgentRun } from '@crewly/sdk';
import { RunInspector } from '../runs/RunInspector';
import type { PlatformApi } from './platform-api';
import { useWork } from './useWork';

const STATUS: Record<string, string> = {
  queued: 'Queued', running: 'Running', completed: 'Done', failed: 'Failed', cancelled: 'Cancelled',
};

/**
 * Recent runs, newest first, each one a click away from its trace.
 *
 * This listed failures only, under a heading promising "what agents did":
 * after a day of good replies it said "No run has failed" and looked broken.
 */
export function RunsPanel({ api, agents }: { api: PlatformApi; agents: Agent[] }) {
  const { error, run } = useWork();
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    void run(async () => setRuns(await api.recentRuns()));
  }, [api, run]);

  if (open) {
    return <RunInspector key={open} load={() => api.run(open)} onClose={() => setOpen(null)} onOpenRun={setOpen} />;
  }

  return (
    <div className="dashboard-runs">
      {error && <p role="alert" className="dashboard-error">{error}</p>}
      {runs.length === 0 ? (
        <p className="field-description">No runs yet. One appears here each time an agent replies or works on something.</p>
      ) : (
        <table className="dashboard-table">
          <thead><tr><th>Agent</th><th>Status</th><th>When</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {runs.map((entry) => (
              <tr key={entry.runId}>
                <td><strong>{agents.find((agent) => agent.id === entry.agentId)?.name ?? 'Agent'}</strong></td>
                <td>{entry.status ? STATUS[entry.status] ?? entry.status : '—'}{entry.status === 'failed' && <small>{entry.errorCode}{entry.errorMessage ? `: ${entry.errorMessage}` : ''}</small>}</td>
                <td>{new Date(entry.finishedAt ?? entry.createdAt).toLocaleString()}</td>
                <td className="dashboard-row-actions">
                  <button type="button" className="text-button" onClick={() => setOpen(entry.runId)}>Inspect</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
