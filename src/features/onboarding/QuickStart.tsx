import { useState } from 'react';
import { ArrowRight, Check, MessageCircle } from 'lucide-react';
import type { Agent, Provider } from '../../types';
import { gateway } from '../../lib/gateway';
import { ProviderConnect } from '../providers/ProviderConnect';
import { ModelPicker } from '../agents/ModelPicker';
import { BrandMark } from '../shell/BrandMark';

/** The first useful result is a conversation, not a configured workspace. */
export function QuickStart({ providers, onRefresh, onReady, onSkip, onSettings, serverName = 'Crewly', serverIcon }: {
  providers: Provider[];
  serverName?: string;
  serverIcon?: string | null;
  onRefresh: () => Promise<unknown>;
  onReady: (agent: Agent, conversation: Awaited<ReturnType<typeof gateway.createDm>>) => void;
  onSkip: () => void;
  onSettings: () => void;
}) {
  const connected = providers.filter((provider) => provider.status === 'connected');
  const [providerId, setProviderId] = useState(connected[0]?.id ?? '');
  const [model, setModel] = useState('');
  const [name, setName] = useState('Assistant');
  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // If opening the DM fails, retry that step without creating another agent.
  const [created, setCreated] = useState<Agent | null>(null);
  const selectedProvider = connected.some((provider) => provider.id === providerId) ? providerId : connected[0]?.id ?? '';
  async function start(event: React.FormEvent) {
    event.preventDefault();
    if (busy || (!created && (!selectedProvider || !model.trim()))) return;
    setBusy(true); setError('');
    try {
      const agent = created ?? await gateway.createAgent({ name: name.trim() || 'Assistant', role: 'Personal assistant',
        providerId: selectedProvider, model: model.trim(), avatarMode: 'bloop' });
      setCreated(agent);
      const conversation = await gateway.createDm(agent.id, [agent]);
      onReady(agent, conversation);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not open your conversation. Try again.'); }
    finally { setBusy(false); }
  }
  if (connecting) return <ProviderConnect onConnected={() => {
    void onRefresh().then(() => setConnecting(false)).catch((reason) => { setError(String(reason)); setConnecting(false); });
  }} onClose={() => setConnecting(false)} />;
  return <div className="quick-start">
    <header><div className="quick-brand">{serverIcon ? <img className="server-brand-icon" src={serverIcon} alt="" /> : <BrandMark />}<strong>{serverName}</strong></div><button className="text-button" onClick={onSettings}>Settings</button></header>
    <main>
      <div className="quick-story"><span className="eyebrow">YOUR FIRST CONVERSATION</span>
        <h1>Your assistant.<br />Ready when you are.</h1>
        <p>One assistant to think with, work with, and come back to.</p>
        <ul><li><MessageCircle size={18} /><span><strong>Pick up where you left off</strong>Keep the conversation and its context together.</span></li>
          <li><Check size={18} /><span><strong>Get something done</strong>Draft, work through a problem, or ask for a reminder.</span></li></ul>
        <small>Add people, more agents, and shared rooms whenever you need them.</small>
      </div>
      <form className="quick-card form" onSubmit={(event) => void start(event)}>
        <span className="eyebrow">LET’S GET YOU TALKING</span><h2>Meet your assistant</h2>
        <p>Choose the model it uses. You can change its name and instructions later.</p>
        {!connected.length ? <div className="quick-connect"><p>Connect a model provider to get your first reply.</p><button className="primary-button" type="button" onClick={() => setConnecting(true)}>Connect a model provider <ArrowRight size={16} /></button></div> : <>
          <label>Assistant name<input value={name} maxLength={80} disabled={busy || Boolean(created)} onChange={(event) => setName(event.target.value)} /></label>
          <label>Model provider<select value={selectedProvider} disabled={busy || Boolean(created)} onChange={(event) => { setProviderId(event.target.value); setModel(''); }}>{connected.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>
          {!created && <ModelPicker providerId={selectedProvider} value={model} onChange={setModel} />}
          {error && <p role="alert" className="dashboard-error">{error}</p>}
          <button className="primary-button quick-submit" disabled={busy || (!created && !model.trim())}>{busy ? 'Opening your chat…' : created ? 'Retry opening chat' : 'Start chatting'}<ArrowRight size={16} /></button>
        </>}
        {!connected.length && error && <p role="alert" className="dashboard-error">{error}</p>}
        <button className="text-button" type="button" disabled={busy} onClick={onSkip}>Explore the workspace first</button>
      </form>
    </main>
  </div>;
}
