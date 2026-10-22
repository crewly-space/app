import { useCallback, useEffect, useState } from 'react';
import { Clock3, RefreshCw, X } from 'lucide-react';
import type { ScheduledTask } from '@crewly/sdk';
import { client } from '../../lib/api/client';
import { useLayer } from '../../lib/layers';

function scheduleLabel(task: ScheduledTask): string {
  const date = new Date(task.runAt);
  const interval = task.intervalMinutes;
  const now = Date.now();
  const next = interval && date.getTime() < now ? new Date(date.getTime() + Math.ceil((now - date.getTime()) / (interval * 60_000)) * interval * 60_000) : date;
  return `${next.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}${interval ? ` · every ${interval % 1440 === 0 ? `${interval / 1440} day(s)` : interval % 60 === 0 ? `${interval / 60} hour(s)` : `${interval} min`}` : ''}`;
}

export function ScheduledTasks({ conversationId, onClose, onExample }: {
  conversationId: string; onClose: () => void; onExample: (text: string) => void;
}) {
  const ref = useLayer<HTMLDivElement>(onClose, true);
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void client.conversations.scheduledTasks(conversationId).then(({ tasks }) => {
      if (active) setTasks(tasks);
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load scheduled tasks.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [conversationId, attempt]);
  const refresh = useCallback(() => setAttempt((value) => value + 1), []);
  const active = tasks.filter((task) => task.enabled);
  const previous = tasks.filter((task) => !task.enabled);
  async function cancel(id: string) {
    if (cancelling) return;
    setCancelling(id); setError('');
    try { await client.conversations.cancelScheduledTask(conversationId, id); refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not cancel this task.'); }
    finally { setCancelling(null); }
  }
  function row(task: ScheduledTask) {
    return <li key={task.id} className="scheduled-task"><Clock3 size={18} /><div><strong>{task.name}</strong><p>{task.body}</p>
      <time dateTime={task.runAt}>{scheduleLabel(task)}</time>
      <small>{task.lastRun?.status === 'failed' ? `Last attempt failed: ${task.lastRun.error ?? 'Unknown error'}` : task.enabled ? task.kind === 'task' ? 'Agent task · scheduled' : 'Reminder · scheduled' : task.lastRun?.status === 'succeeded' ? 'Completed' : task.lastRun?.status === 'running' ? 'Running' : 'Cancelled'}</small>
    </div>{task.enabled && <button className="text-button" disabled={Boolean(cancelling)} onClick={() => void cancel(task.id)}>{cancelling === task.id ? 'Cancelling…' : 'Cancel'}</button>}</li>;
  }
  return <div className="modal-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={ref} className="scheduled-dialog" role="dialog" aria-modal="true" aria-labelledby="scheduled-title">
      <header><div><span className="eyebrow">THIS CONVERSATION</span><h2 id="scheduled-title">Your scheduled tasks</h2></div><button className="icon-button" onClick={onClose} aria-label="Close scheduled tasks"><X size={19} /></button></header>
      <p>Ask in the chat to set a reminder or give this agent work for later. Tasks run while the Crewly server is online, even if you close this app.</p>
      <div className="scheduled-toolbar"><span>{active.length} scheduled · times in {Intl.DateTimeFormat().resolvedOptions().timeZone}</span><button className="text-button" disabled={loading} onClick={refresh}><RefreshCw size={14} />Refresh</button></div>
      {error && <p role="alert" className="dashboard-error">{error}</p>}
      {loading ? <p role="status">Loading your tasks…</p> : <>
        {active.length > 0 ? <ul className="scheduled-list">{active.map(row)}</ul> : !error && <div className="scheduled-empty"><Clock3 size={30} /><h3>Nothing scheduled yet</h3><p>Try a small reminder and see it arrive here.</p><button className="secondary-button" onClick={() => { onExample('Remind me in 10 minutes to take a break.'); onClose(); }}>Write a reminder</button></div>}
        {previous.length > 0 && <details><summary>Completed and cancelled ({previous.length})</summary><ul className="scheduled-list">{previous.map(row)}</ul></details>}
      </>}
    </div>
  </div>;
}
