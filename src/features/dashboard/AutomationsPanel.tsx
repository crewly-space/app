import { useState } from 'react';
import { Activity, Clock, MessageSquare, Plus, Save, Send, Trash2, Webhook, type LucideIcon } from 'lucide-react';
import type { Automation, AutomationInput, AutomationRun } from '@crewly/sdk';

/** Each trigger in words, with the mark it shows in the rule list. */
const TRIGGERS: Record<AutomationInput['triggerType'], { label: string; icon: LucideIcon }> = {
  webhook: { label: 'Incoming webhook', icon: Webhook },
  message: { label: 'Channel message', icon: MessageSquare },
  schedule: { label: 'Schedule', icon: Clock },
  run: { label: 'Agent run event', icon: Activity },
};

const blank: AutomationInput = {
  name: '', description: '', enabled: true, triggerType: 'webhook', triggerConfig: {}, conditions: {},
  actions: [{ type: 'post_message', body: '', conversationId: '' }],
};

export function AutomationsPanel({
  automations, runs, busy, onCreate, onUpdate, onDelete,
}: {
  automations: Automation[];
  runs: AutomationRun[];
  busy: boolean;
  onCreate: (input: AutomationInput) => Promise<{ automation: Automation; webhookSecret?: string }>;
  onUpdate: (id: string, input: AutomationInput) => Promise<Automation>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(automations[0]?.id ?? null);
  const [draft, setDraft] = useState<AutomationInput>(blank);
  const [creating, setCreating] = useState(automations.length === 0);
  const [secret, setSecret] = useState('');
  const selected = automations.find((item) => item.id === selectedId) ?? null;
  const current = creating ? draft : selected ? {
    name: selected.name, description: selected.description, enabled: selected.enabled, triggerType: selected.triggerType,
    triggerConfig: selected.triggerConfig, conditions: selected.conditions, actions: selected.actions,
  } : draft;
  const choose = (automation: Automation) => {
    setCreating(false); setSelectedId(automation.id); setSecret('');
    setDraft({ name: automation.name, description: automation.description, enabled: automation.enabled, triggerType: automation.triggerType, triggerConfig: automation.triggerConfig, conditions: automation.conditions, actions: automation.actions });
  };
  const set = (next: Partial<AutomationInput>) => setDraft((value) => ({ ...value, ...next }));
  const action = current.actions[0]?.type === 'post_message' ? current.actions[0] : { type: 'post_message' as const, body: '', conversationId: '' };
  const save = async () => {
    const input: AutomationInput = { ...current, actions: [{ type: 'post_message', body: action.body, ...(action.conversationId ? { conversationId: action.conversationId } : {}) }] };
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
        <button type="button" className="secondary-button compact" onClick={() => { setCreating(true); setSelectedId(null); setDraft(blank); setSecret(''); }}><Plus size={14} /> New rule</button>
      </div>
      <p className="field-description">Rules react to events and perform bounded actions.</p>
      {automations.map((automation) => {
        const trigger = TRIGGERS[automation.triggerType] ?? { label: automation.triggerType, icon: Activity };
        const Icon = trigger.icon;
        return <button type="button" key={automation.id} className={`automation-list-item ${!creating && selectedId === automation.id ? 'selected' : ''}`} onClick={() => choose(automation)}>
          <span className="automation-list-icon" aria-hidden="true"><Icon size={14} /></span>
          <span><strong>{automation.name}</strong><small>{automation.enabled ? 'Enabled' : 'Disabled'} · {trigger.label}</small></span>
        </button>;
      })}
      {!automations.length && <p className="automations-empty">No rules yet. Create one on the right.</p>}
    </div>
    <div className="automations-editor">
      <div className="section-heading"><div><h3>{creating ? 'Create an automation' : selected?.name ?? 'Automation'}</h3><p>Start with a webhook, message or schedule trigger and a message action.</p></div></div>
      <div className="dashboard-form">
        <label>Name<input value={current.name} disabled={!creating && !selected} onChange={(event) => set({ name: event.target.value })} /></label>
        <label>Description<input value={current.description ?? ''} onChange={(event) => set({ description: event.target.value })} /></label>
        <label>Trigger<select value={current.triggerType} onChange={(event) => set({ triggerType: event.target.value as AutomationInput['triggerType'] })}>{Object.entries(TRIGGERS).map(([value, trigger]) => <option key={value} value={value}>{trigger.label}</option>)}</select></label>
        {current.triggerType === 'schedule' && <label>Every minutes<input type="number" min="1" max="10080" value={Number(current.triggerConfig?.intervalMinutes ?? 60)} onChange={(event) => set({ triggerConfig: { ...current.triggerConfig, intervalMinutes: Number(event.target.value) } })} /></label>}
        <fieldset className="automation-action"><legend><Send size={13} aria-hidden="true" /> Then post a message</legend><label>Conversation ID<input value={action.conversationId ?? ''} onChange={(event) => set({ actions: [{ ...action, conversationId: event.target.value }] })} placeholder="Channel or conversation id" /></label><label>Message<textarea rows={4} placeholder="What to post when this rule runs" value={action.body} onChange={(event) => set({ actions: [{ ...action, body: event.target.value }] })} /></label></fieldset>
        <label className="permission-choice"><input type="checkbox" checked={current.enabled !== false} onChange={(event) => set({ enabled: event.target.checked })} /><span><strong>Enabled</strong><small>Loop protection and event deduplication apply automatically.</small></span></label>
        {secret && <div className="role-preview"><strong>Webhook secret — copy it now</strong><span>{secret}</span></div>}
        <div className="dashboard-actions"><button type="button" className="primary-button" disabled={busy || !current.name.trim() || !action.body.trim()} onClick={() => void save()}><Save size={14} /> Save rule</button>{!creating && selected && <button type="button" className="text-button danger" disabled={busy} onClick={() => void onDelete(selected.id)}><Trash2 size={14} /> Delete</button>}</div>
      </div>
      {!creating && selected && <div className="dashboard-card"><h3>Execution history</h3>{runs.filter((run) => run.automationId === selected.id).slice(0, 10).map((run) => <div className="automation-run" key={run.id}><strong>{run.status}</strong><span>{run.dedupeKey}</span><small>{run.error ?? new Date(run.createdAt).toLocaleString()}</small></div>)}{!runs.some((run) => run.automationId === selected.id) && <p className="field-description">No executions yet.</p>}</div>}
    </div>
  </div>;
}
