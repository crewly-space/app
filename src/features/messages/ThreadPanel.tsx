import { useEffect, useState } from 'react';
import { Archive, CheckCircle2, MessageSquare, X } from 'lucide-react';
import type { Agent, Message } from '../../types';
import { gateway } from '../../lib/gateway';

export function ThreadPanel({ root, agents, onClose, onRootUpdated }: {
  root: Message;
  agents: Agent[];
  onClose: () => void;
  onRootUpdated: (root: Message) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([root]);
  const [status, setStatus] = useState<'open' | 'resolved' | 'archived'>(root.thread?.status ?? 'open');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setBusy(true);
    gateway.openThread(root.id).then(() => gateway.thread(root.id)).then((result) => {
      if (!active) return;
      setMessages(result.messages);
      setStatus(result.thread.status);
    }).catch((reason) => active && setError(reason instanceof Error ? reason.message : 'Thread could not be opened'))
      .finally(() => active && setBusy(false));
    return () => { active = false; };
  }, [root.id]);

  const updateStatus = async (next: 'open' | 'resolved' | 'archived') => {
    setBusy(true); setError('');
    try {
      await gateway.setThreadStatus(root.id, next); setStatus(next);
      onRootUpdated({ ...root, thread: { status: next, replyCount: Math.max(0, messages.length - 1), latestActivityAt: new Date().toISOString(), unread: false } });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Thread could not be updated'); }
    finally { setBusy(false); }
  };

  const send = async (event: React.FormEvent) => {
    event.preventDefault(); const body = draft.trim(); if (!body || busy || status !== 'open') return;
    const lower = body.toLowerCase();
    const mentions = agents.filter((agent) => lower.includes(`@${agent.name.toLowerCase()}`)).map((agent) => ({ targetId: agent.id, targetType: 'agent' as const }));
    setBusy(true); setError('');
    try {
      const message = await gateway.sendThread(root.id, body, mentions); setMessages((current) => [...current, message]); setDraft('');
      onRootUpdated({ ...root, thread: { status, replyCount: messages.length, latestActivityAt: new Date().toISOString(), unread: false } });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Reply could not be sent'); }
    finally { setBusy(false); }
  };

  return <aside className="thread-panel" aria-label="Message thread">
    <header><div><span className="eyebrow">Focused workspace</span><h2><MessageSquare size={18} /> Thread</h2></div><button className="icon-button" onClick={onClose} aria-label="Close thread"><X size={18} /></button></header>
    <div className="thread-actions">
      {status !== 'resolved' && <button disabled={busy} onClick={() => void updateStatus('resolved')}><CheckCircle2 size={14} /> Resolve</button>}
      {status !== 'archived' && <button disabled={busy} onClick={() => void updateStatus('archived')}><Archive size={14} /> Archive</button>}
      {status !== 'open' && <button disabled={busy} onClick={() => void updateStatus('open')}>Reopen</button>}
    </div>
    {error && <p role="alert" className="dashboard-error">{error}</p>}
    <div className="thread-messages">
      {messages.map((message, index) => <article key={message.id} className={index === 0 ? 'thread-root' : ''}>
        <strong>{index === 0 ? 'Root message' : agents.find((agent) => agent.id === message.author)?.name ?? (message.author === 'you' ? 'You' : message.author)}</strong>
        <time>{message.time}</time><p>{message.body}</p>
      </article>)}
      {busy && messages.length === 1 && <p className="field-description">Loading thread…</p>}
    </div>
    <form className="thread-composer" onSubmit={send}>
      <textarea aria-label="Thread reply" placeholder={status === 'open' ? 'Reply in this thread…' : `This thread is ${status}.`} disabled={status !== 'open' || busy} value={draft} onChange={(event) => setDraft(event.target.value)} />
      <button className="primary-button" disabled={!draft.trim() || status !== 'open' || busy}>Reply</button>
    </form>
  </aside>;
}
