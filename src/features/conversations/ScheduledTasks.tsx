import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock3, Plus, RefreshCw, X } from 'lucide-react';
import type { CreateScheduledTaskInput, ScheduledTask } from '@crewly/sdk';
import { client, snapshotClient } from '../../lib/api/client';
import { useLayer } from '../../lib/layers';

function scheduleLabel(task: ScheduledTask): string {
  const date = new Date(task.runAt);
  const interval = task.intervalMinutes;
  const now = Date.now();
  const next = interval && date.getTime() < now ? new Date(date.getTime() + Math.ceil((now - date.getTime()) / (interval * 60_000)) * interval * 60_000) : date;
  return `${next.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}${interval ? ` · every ${interval % 1440 === 0 ? `${interval / 1440} day(s)` : interval % 60 === 0 ? `${interval / 60} hour(s)` : `${interval} min`}` : ''}`;
}

export function ScheduledTasks({ conversationId, onClose, onExample, agents = [] }: {
  agents?: { id: string; name: string }[]; conversationId: string; onClose: () => void; onExample: (text: string) => void;
}) {
  const ref = useLayer<HTMLDivElement>(onClose, true);
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState(false);
  const [kind, setKind] = useState<'reminder' | 'task'>('reminder');
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [agentId, setAgentId] = useState(agents[0]?.id ?? '');
  const localTime = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const [when, setWhen] = useState(() => localTime(new Date(Date.now() + 600000)));
  const [repeat, setRepeat] = useState('');
  const [saving, setSaving] = useState(false);
  const pending = useRef<{ signature: string; id: string } | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (saving) return;
    const date = new Date(when);
    if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) { setError('Choose a time in the future.'); return; }
    const details: Omit<CreateScheduledTaskInput, 'requestId'> = { kind, name: name.trim(), body: body.trim(), agentId,
      runAt: date.toISOString(), ...(repeat ? { intervalMinutes: Number(repeat) } : {}) };
    const signature = JSON.stringify(details);
    if (pending.current?.signature !== signature) pending.current = { signature, id: crypto.randomUUID() };
    setSaving(true); setError('');
    const source = snapshotClient();
    try {
      await source.conversations.createScheduledTask(conversationId, { ...details, requestId: pending.current.id });
      if (!mounted.current) return;
      setEditing(false); setName(''); setBody(''); pending.current = null; refresh();
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : 'Could not save this task. Retry to check the saved result.'); }
    finally { if (mounted.current) setSaving(false); }
  }
  function template(preset: 'reminder' | 'priorities' | 'review') {
    setEditing(true); setError('');
    setKind(preset === 'reminder' ? 'reminder' : 'task');
    setName(preset === 'review' ? 'Weekly review' : preset === 'priorities' ? 'Daily priorities' : 'Reminder');
    setRepeat(preset === 'review' ? '10080' : preset === 'priorities' ? '1440' : '');
    setBody(preset === 'review' ? 'Review this conversation: summarize completed work, unresolved questions and the next three actions. Cite the relevant messages. Say when context is missing; do not invent progress.'
      : preset === 'priorities' ? 'Using the work discussed in this conversation, suggest my three priorities and the first concrete action for each. Flag blockers. Do not invent new information or claim to have checked external systems.' : '');
  }

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
  const active = tasks.filter((task) => task.enabled || task.lastRun?.status === 'running');
  const previous = tasks.filter((task) => !task.enabled && task.lastRun?.status !== 'running');
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
      <small>{task.lastRun?.status === 'running' ? 'Running now' : task.lastRun?.status === 'failed' ? `Last attempt failed: ${task.lastRun.error ?? 'Unknown error'}` : task.enabled ? task.kind === 'task' ? 'Agent task · scheduled' : 'Reminder · scheduled' : task.lastRun?.status === 'succeeded' ? 'Completed' : 'Cancelled'}</small>
    </div>{task.enabled && <button className="text-button" disabled={Boolean(cancelling)} onClick={() => void cancel(task.id)}>{cancelling === task.id ? 'Cancelling…' : 'Cancel'}</button>}</li>;
  }
  return <div className="modal-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={ref} className="scheduled-dialog" role="dialog" aria-modal="true" aria-labelledby="scheduled-title">
      <header><div><span className="eyebrow">THIS CONVERSATION</span><h2 id="scheduled-title">Your scheduled tasks</h2></div><button className="icon-button" onClick={onClose} aria-label="Close scheduled tasks"><X size={19} /></button></header>
      <p>Ask in the chat to set a reminder or give this agent work for later. Tasks run while the Crewly server is online, even if you close this app.</p>
      <div className="scheduled-toolbar"><span>{active.length} active · times in {Intl.DateTimeFormat().resolvedOptions().timeZone}</span><button className="text-button" disabled={loading} onClick={refresh}><RefreshCw size={14} />Refresh</button></div>
      {error && <p role="alert" className="dashboard-error">{error}</p>}
      {agents.length > 0 && !editing && <div className="scheduled-presets" aria-label="Create scheduled work">
        <button className="primary-button" onClick={() => template('reminder')}><Plus size={15} />New reminder</button>
        <button className="secondary-button" onClick={() => template('priorities')}>Daily priorities</button>
        <button className="secondary-button" onClick={() => template('review')}>Weekly review</button>
      </div>}
      {editing && <form className="scheduled-editor form" onSubmit={event => void save(event)}>
        <h3>Work that comes back to you</h3>
        <label>Type<select value={kind} disabled={saving} onChange={event => setKind(event.target.value as typeof kind)}><option value="reminder">Deliver a reminder</option><option value="task">Have an assistant do the work</option></select></label>
        <label>Task name<input required minLength={2} maxLength={80} value={name} disabled={saving} onChange={event => setName(event.target.value)} /></label>
        <label>{kind === 'reminder' ? 'Reminder message' : 'Instructions'}<textarea required maxLength={100000} rows={4} value={body} disabled={saving} onChange={event => setBody(event.target.value)} /></label>
        <label>Assistant<select required value={agentId} disabled={saving} onChange={event => setAgentId(event.target.value)}>{agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
        <div className="scheduled-fields"><label>First delivery<input type="datetime-local" required value={when} disabled={saving} onChange={event => setWhen(event.target.value)} /></label>
          <label>Repeat<select value={repeat} disabled={saving} onChange={event => setRepeat(event.target.value)}><option value="">Once</option><option value="60">Every hour</option><option value="1440">Every 24 hours</option><option value="10080">Every 7 days</option></select></label></div>
        <small>Times use {Intl.DateTimeFormat().resolvedOptions().timeZone}. Repeats use fixed intervals. {kind === 'task' ? 'Assistant work uses your model provider credits.' : 'Reminders do not call a model.'} The server must be online; delivery can be up to a minute late.</small>
        <div className="scheduled-presets"><button className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save schedule'}</button><button type="button" className="text-button" disabled={saving} onClick={() => setEditing(false)}>Back to tasks</button></div>
      </form>}
      {loading ? <p role="status">Loading your tasks…</p> : <>
        {active.length > 0 ? <ul className="scheduled-list">{active.map(row)}</ul> : !error && <div className="scheduled-empty"><Clock3 size={30} /><h3>Nothing scheduled yet</h3><p>Try a small reminder and see it arrive here.</p><button className="secondary-button" onClick={() => { onExample('Remind me in 10 minutes to take a break.'); onClose(); }}>Write a reminder</button></div>}
        {previous.length > 0 && <details><summary>Completed and cancelled ({previous.length})</summary><ul className="scheduled-list">{previous.map(row)}</ul></details>}
      </>}
    </div>
  </div>;
}
