import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { RunEvent, RunTrace } from '@crewly/sdk';

/** A micro-dollar amount the way people read money. */
export function formatCost(micros: number): string {
  const dollars = micros / 1_000_000;
  if (dollars === 0) return '$0';
  if (dollars < 0.01) return `$${dollars.toFixed(4)}`;
  return `$${dollars.toFixed(2)}`;
}

function duration(ms: number | null): string {
  if (ms === null) return 'still running';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** One trace event in words. The data is metadata only; there is no content to show. */
export function describeEvent(event: RunEvent): string {
  const d = event.data as Record<string, unknown>;
  switch (event.type) {
    case 'run.queued': return 'Queued behind another run';
    case 'run.started': return `Started (${String(d.trigger ?? 'message')}, hop ${String(d.hopCount ?? 0)})`;
    case 'provider.call':
      return d.status === 'ok'
        ? `${String(d.providerId)} · ${String(d.model)}: ${String(d.inputTokens)} in / ${String(d.outputTokens)} out, ${String(d.latencyMs)} ms${d.fallback ? ' (fallback)' : ''}`
        : `${String(d.providerId)} · ${String(d.model)} failed: ${String(d.errorCode)} (attempt ${String(d.attempt)})`;
    case 'provider.retry': return `Retrying after ${String(d.errorCode)} in ${String(d.delayMs)} ms`;
    case 'provider.fallback': {
      const to = d.to as { providerId?: string; model?: string } | undefined;
      return `Fell back to ${to?.providerId ?? '?'} · ${to?.model ?? '?'} (${String(d.reason)})`;
    }
    case 'gateway.blocked': return `Blocked: ${String(d.reason)}`;
    case 'tool.call': return `Tool ${String(d.name)} ${d.status === 'ok' ? 'ran' : 'failed'} in ${String(d.durationMs)} ms`;
    case 'delegation.requested': return `Asked ${String(d.toAgentName ?? d.toAgentId)} for help`;
    case 'delegation.completed': return 'Delegated work came back';
    case 'delegation.failed': return `Delegated work failed (${String(d.code)})`;
    case 'delegation.cancelled': return 'Delegated work was cancelled';
    case 'run.completed': return 'Answered';
    case 'run.failed': return `Failed: ${String(d.code)}${d.message ? ` — ${String(d.message)}` : ''}`;
    case 'run.cancel_requested': return 'Cancellation requested';
    case 'run.cancelled': return 'Cancelled';
    default: return event.type;
  }
}

/**
 * How one reply was made: which model, how long, what it cost, what it
 * called, and what it handed to other agents. Never the prompt or the
 * model's reasoning -- the server does not keep them.
 */
export function RunInspector({
  load,
  onClose,
  onOpenRun,
  onCancel,
}: {
  load: () => Promise<RunTrace>;
  onClose: () => void;
  onOpenRun?: (runId: string) => void;
  onCancel?: (runId: string) => Promise<void>;
}) {
  const [trace, setTrace] = useState<RunTrace | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let current = true;
    load().then((value) => { if (current) setTrace(value); })
      .catch((reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : 'Could not load the run'); });
    return () => { current = false; };
  }, [load]);

  const run = trace?.run;
  const active = run?.status === 'running' || run?.status === 'queued';

  return (
    <aside className="run-inspector" role="dialog" aria-label="Run inspector">
      <header className="dashboard-head">
        <div>
          <p className="eyebrow">Run</p>
          <h1>{run ? `${run.agentName ?? 'Agent'} · ${run.status ?? 'completed'}` : 'Loading…'}</h1>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close the run inspector"><X size={18} /></button>
      </header>
      {error && <p role="alert" className="dashboard-error">{error}</p>}
      {trace && run && (
        <>
          {run.errorMessage && <p role="alert" className="dashboard-error">{run.errorCode}: {run.errorMessage}</p>}
          <dl className="dashboard-facts">
            <div><dt>Model</dt><dd>{trace.summary.provider ? `${trace.summary.provider.providerId} · ${trace.summary.provider.model}` : '—'}</dd></div>
            <div><dt>Duration</dt><dd>{duration(trace.summary.durationMs)}</dd></div>
            <div><dt>Tokens</dt><dd>{trace.summary.inputTokens} in / {trace.summary.outputTokens} out</dd></div>
            <div>
              <dt>Cost</dt>
              <dd>{formatCost(trace.summary.costMicros)}{trace.summary.unpricedCalls ? ' + unpriced' : ''}</dd>
            </div>
            <div><dt>Calls</dt><dd>{trace.summary.providerCalls} ({trace.summary.retries} retries, {trace.summary.fallbacks} fallbacks)</dd></div>
            <div><dt>Tools</dt><dd>{trace.summary.toolCalls}</dd></div>
            <div><dt>Started</dt><dd>{new Date(run.startedAt ?? run.createdAt).toLocaleTimeString()}</dd></div>
            <div><dt>Hop</dt><dd>{run.hopCount}{run.causationId ? ' (delegated)' : ''}</dd></div>
          </dl>

          {active && onCancel && (
            <div className="dashboard-actions">
              <button type="button" className="secondary-button" onClick={() => void onCancel(run.runId).then(() => load().then(setTrace))}>
                Cancel this run
              </button>
            </div>
          )}

          {trace.tree.length > 1 && (
            <section>
              <h2>Delegation</h2>
              <ul className="run-tree">
                {trace.tree.map((node) => (
                  <li key={node.runId} style={{ paddingLeft: `${node.hopCount * 16}px` }}>
                    <button type="button" className="text-button" disabled={!onOpenRun || node.runId === run.runId} onClick={() => onOpenRun?.(node.runId)}>
                      {node.agentName ?? node.agentId}
                    </button>
                    <small> {node.status}{node.runId === run.runId ? ' · this run' : ''}</small>
                  </li>
                ))}
              </ul>
              <p className="field-description">Whole chain: {formatCost(trace.treeCostMicros)}</p>
            </section>
          )}

          <section>
            <h2>What happened</h2>
            <ol className="run-events">
              {trace.events.map((event) => (
                <li key={event.seq}>
                  <time dateTime={event.at}>{new Date(event.at).toLocaleTimeString()}</time>
                  <span>{describeEvent(event)}</span>
                </li>
              ))}
            </ol>
          </section>

          {trace.approvals.length > 0 && (
            <section>
              <h2>Approvals</h2>
              <ul className="run-events">
                {trace.approvals.map((approval) => (
                  <li key={approval.id}><span>{approval.action}</span><small> {approval.status}</small></li>
                ))}
              </ul>
            </section>
          )}

          {trace.runtimeSessions.length > 0 && (
            <section>
              <h2>Runtime sessions</h2>
              <ul className="run-events">
                {trace.runtimeSessions.map((session) => (
                  <li key={session.id}><span>{session.runtimeKind} in {session.workspacePath}</span><small> {session.status}</small></li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </aside>
  );
}
