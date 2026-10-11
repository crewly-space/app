import { useEffect, useRef, useState } from 'react';
import { Activity, Clock, MessageSquare, Plus, Save, Send, Trash2, Webhook, type LucideIcon } from 'lucide-react';
import type { Agent, Automation, AutomationAction, AutomationInput, AutomationRun } from '@crewly/sdk';

/** Each trigger in words, with the mark it shows in the rule list. */
const TRIGGERS: Record<AutomationInput['triggerType'], { label: string; icon: LucideIcon }> = {
  webhook: { label: 'Incoming webhook', icon: Webhook },
  message: { label: 'Channel message', icon: MessageSquare },
  schedule: { label: 'Schedule', icon: Clock },
  run: { label: 'Agent run event', icon: Activity },
};

const toInput = (automation: Automation): AutomationInput => ({
  name: automation.name, description: automation.description, enabled: automation.enabled, triggerType: automation.triggerType,
  triggerConfig: automation.triggerConfig, conditions: automation.conditions, actions: automation.actions,
});

const blank: AutomationInput = {
  name: '', description: '', enabled: true, triggerType: 'webhook', triggerConfig: {}, conditions: {},
  actions: [{ type: 'post_message', body: '', conversationId: '' }],
};

export function AutomationsPanel({
  automations, runs, busy, targets = [], agents = [], onCreate, onUpdate, onDelete,
}: {
  automations: Automation[];
  runs: AutomationRun[];
  busy: boolean;
  agents?: Pick<Agent, 'id' | 'name'>[];
  targets?: { id: string; name: string }[];
  onCreate: (input: AutomationInput) => Promise<{ automation: Automation; webhookSecret?: string }>;
  onUpdate: (id: string, input: AutomationInput) => Promise<Automation>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(automations[0]?.id ?? null);
  const [draft, setDraft] = useState<AutomationInput>(() => automations[0] ? toInput(automations[0]) : blank);
  const [creating, setCreating] = useState(automations.length === 0);
  const [secret, setSecret] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const previousIds = useRef(new Set(automations.map((automation) => automation.id)));
  const selected = automations.find((item) => item.id === selectedId) ?? null;
  useEffect(() => {
    if (selectedId && previousIds.current.has(selectedId) && !automations.some((item) => item.id === selectedId)) {
      setSelectedId(null); setCreating(true); setDraft(blank); setSecret('');
    }
    previousIds.current = new Set(automations.map((automation) => automation.id));
  }, [automations, selectedId]);
  const current = draft;
  const choose = (automation: Automation) => {
    setCreating(false); setSelectedId(automation.id); setSecret(''); setError('');
    setDraft({ name: automation.name, description: automation.description, enabled: automation.enabled, triggerType: automation.triggerType, triggerConfig: automation.triggerConfig, conditions: automation.conditions, actions: automation.actions });
  };
  const set = (next: Partial<AutomationInput>) => setDraft((value) => ({ ...value, ...next }));
  const updateAction = (index: number, next: AutomationAction) => set({ actions: current.actions.map((action, at) => at === index ? next : action) });
  const valid = current.name.trim().length >= 2 && current.actions.length > 0
    && (current.triggerType !== 'schedule' || (Number.isInteger(current.triggerConfig?.intervalMinutes) && Number(current.triggerConfig?.intervalMinutes) >= 1 && Number(current.triggerConfig?.intervalMinutes) <= 10080))
    && current.actions.every((action) => action.type === 'call_webhook'
      ? /^https:\/\//.test(action.url)
      : (current.triggerType === 'message' || current.triggerType === 'run' || Boolean(action.conversationId))
        && (action.type === 'post_message' ? Boolean(action.body.trim()) : Boolean(action.agentId)));
  const perform = async (work: () => Promise<void>) => {
    if (working || busy) return;
    setWorking(true); setError('');
    try { await work(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'The rule could not be saved'); }
    finally { setWorking(false); }
  };
  const save = async () => {
    const input: AutomationInput = current;
    if (creating) {
      const result = await onCreate(input); setSecret(result.webhookSecret ?? ''); setCreating(false); setSelectedId(result.automation.id); setDraft(input);
    } else if (selected) {
      const updated = await onUpdate(selected.id, input); setSelectedId(updated.id); setDraft(input);
    }
  };
  return <div className="automations-layout">
    <div className="dashboard-card automations-list">
      <div className="automations-list-head">
        <h3>Rules</h3>
        <button type="button" className="secondary-button compact" disabled={working || busy} onClick={() => { setCreating(true); setSelectedId(null); setDraft(blank); setSecret(''); }}><Plus size={14} /> New rule</button>
      </div>
      <p className="field-description">Rules react to events and perform bounded actions.</p>
      {automations.map((automation) => {
        const trigger = TRIGGERS[automation.triggerType] ?? { label: automation.triggerType, icon: Activity };
        const Icon = trigger.icon;
        return <button type="button" key={automation.id} disabled={working || busy} className={`automation-list-item ${!creating && selectedId === automation.id ? 'selected' : ''}`} onClick={() => choose(automation)}>
          <span className="automation-list-icon" aria-hidden="true"><Icon size={14} /></span>
          <span><strong>{automation.name}</strong><small>{automation.enabled ? 'Enabled' : 'Disabled'} · {trigger.label}</small></span>
        </button>;
      })}
      {!automations.length && <p className="automations-empty">No rules yet. Create one on the right.</p>}
    </div>
    <div className="automations-editor">
      <div className="section-heading"><div><h3>{creating ? 'Create an automation' : selected?.name ?? 'Automation'}</h3><p>Choose a trigger, then post messages, ask agents or call webhooks.</p></div></div>
      {error && <p role="alert" className="dashboard-error">{error}</p>}
      <div className="dashboard-form" inert={working || busy}>
        <label>Name<input value={current.name} disabled={!creating && !selected} onChange={(event) => set({ name: event.target.value })} /></label>
        <label>Description<input value={current.description ?? ''} onChange={(event) => set({ description: event.target.value })} /></label>
        <label>Trigger<select value={current.triggerType} onChange={(event) => set({ triggerType: event.target.value as AutomationInput['triggerType'], triggerConfig: event.target.value === 'schedule' ? { intervalMinutes: current.triggerConfig?.intervalMinutes ?? 60 } : {} })}>{Object.entries(TRIGGERS).map(([value, trigger]) => <option key={value} value={value}>{trigger.label}</option>)}</select></label>
        {current.triggerType === 'schedule' && <label>Repeat every (minutes)<input type="number" min="1" max="10080" value={Number(current.triggerConfig?.intervalMinutes ?? 60)} onChange={(event) => set({ triggerConfig: { ...current.triggerConfig, intervalMinutes: Number(event.target.value) } })} /></label>}
        {(current.triggerType === 'message' || current.triggerType === 'run') && <label>Only in conversation<select value={String(current.conditions?.conversationId ?? '')} onChange={(event) => {
          const conditions = { ...current.conditions }; if (event.target.value) conditions.conversationId = event.target.value; else delete conditions.conversationId; set({ conditions });
        }}><option value="">All conversations</option>{targets.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}</select></label>}
        {current.actions.map((action, index) => <fieldset className="automation-action" key={index}>
          <legend><Send size={13} aria-hidden="true" /> Action {index + 1}</legend>
          <label>Do<select value={action.type} onChange={(event) => updateAction(index, event.target.value === 'post_message' ? { type: 'post_message', body: '', conversationId: '' } : event.target.value === 'invoke_agent' ? { type: 'invoke_agent', agentId: '', conversationId: '' } : { type: 'call_webhook', url: '' })}>
            <option value="post_message">Post a message</option><option value="invoke_agent">Ask an agent</option><option value="call_webhook">Call a webhook</option>
          </select></label>
          {action.type !== 'call_webhook' && <label>Conversation<select value={action.conversationId ?? ''} onChange={(event) => updateAction(index, { ...action, conversationId: event.target.value || undefined })}>
            <option value="">Use the triggering conversation</option>{targets.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}
            {action.conversationId && !targets.some((target) => target.id === action.conversationId) && <option value={action.conversationId}>Current destination (unavailable)</option>}
          </select></label>}
          {action.type === 'post_message' && <label>Message<textarea rows={4} placeholder="What to post when this rule runs" value={action.body} onChange={(event) => updateAction(index, { ...action, body: event.target.value })} /></label>}
          {action.type === 'invoke_agent' && <>
            <label>Agent<select value={action.agentId} onChange={(event) => updateAction(index, { ...action, agentId: event.target.value })}><option value="">Choose an agent</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}{action.agentId && !agents.some((agent) => agent.id === action.agentId) && <option value={action.agentId}>Current agent (unavailable)</option>}</select></label>
            <label>Instructions<textarea rows={4} value={action.prompt ?? ''} onChange={(event) => updateAction(index, { ...action, prompt: event.target.value })} placeholder="What the agent should do" /></label>
          </>}
          {action.type === 'call_webhook' && <>
            <label>Webhook URL<input type="url" value={action.url} placeholder="https://example.com/webhook" onChange={(event) => updateAction(index, { ...action, url: event.target.value })} /></label>
            <label>Method<select value={action.method ?? 'POST'} onChange={(event) => updateAction(index, { ...action, method: event.target.value as 'POST' | 'PUT' })}><option>POST</option><option>PUT</option></select></label>
            <p className="field-description">Sends the triggering event to a public HTTPS endpoint.</p>
          </>}
          {current.actions.length > 1 && <button type="button" className="text-button danger" onClick={() => set({ actions: current.actions.filter((_, at) => at !== index) })}>Remove action {index + 1}</button>}
        </fieldset>)}
        <button type="button" className="secondary-button compact" disabled={current.actions.length >= 20} onClick={() => set({ actions: [...current.actions, { type: 'post_message', body: '', conversationId: '' }] })}><Plus size={14} /> Add action</button>
        <label className="permission-choice"><input type="checkbox" checked={current.enabled !== false} onChange={(event) => set({ enabled: event.target.checked })} /><span><strong>Enabled</strong><small>Loop protection and event deduplication apply automatically.</small></span></label>
        {secret && <div className="role-preview"><strong>Webhook secret — copy it now</strong><span>{secret}</span></div>}
        <div className="dashboard-actions"><button type="button" className="primary-button" disabled={busy || working || !valid} onClick={() => void perform(save)}><Save size={14} /> Save rule</button>{!creating && selected && <button type="button" className="text-button danger" disabled={busy || working} onClick={() => void perform(() => onDelete(selected.id))}><Trash2 size={14} /> Delete</button>}</div>
      </div>
      {!creating && selected && <div className="dashboard-card"><h3>Execution history</h3>{runs.filter((run) => run.automationId === selected.id).slice(0, 10).map((run) => <div className="automation-run" key={run.id}><strong>{run.status}</strong><span>{run.dedupeKey}</span><small>{run.error ?? new Date(run.createdAt).toLocaleString()}</small></div>)}{!runs.some((run) => run.automationId === selected.id) && <p className="field-description">No executions yet.</p>}</div>}
    </div>
  </div>;
}
