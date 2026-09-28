import { useEffect, useRef, useState } from 'react';
import type { AvatarMode } from '@crewly/protocol';
import { Archive, CheckCircle2, MessageSquare, RotateCcw, Send, X } from 'lucide-react';
import type { Agent, Message } from '../../types';
import { gateway } from '../../lib/gateway';
import { Avatar, UserAvatar } from '../appearance/Avatar';
import { renderMentions } from './MessageItem';

type ThreadStatus = 'open' | 'resolved' | 'archived';

export function ThreadPanel({ root, agents, people, onClose, onRootUpdated, onAgentClick }: {
  root: Message;
  agents: Agent[];
  people: {
    byId: Map<string, { name: string; mode: AvatarMode }>;
    me: { id: string; name: string; mode: AvatarMode };
  };
  onClose: () => void;
  onRootUpdated: (root: Message) => void;
  onAgentClick: (agentId: string) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([root]);
  const [status, setStatus] = useState<ThreadStatus>(root.thread?.status ?? 'open');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    setBusy(true); setLoading(true); setMessages([root]);
    gateway.openThread(root.id).then(() => gateway.thread(root.id)).then((result) => {
      if (!active) return;
      setMessages(result.messages);
      setStatus(result.thread.status);
    }).catch((reason) => active && setError(reason instanceof Error ? reason.message : 'Thread could not be opened'))
      .finally(() => { if (active) { setBusy(false); setLoading(false); } });
    return () => { active = false; };
  }, [root.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  const replies = messages.slice(1);

  const updateStatus = async (next: ThreadStatus) => {
    setBusy(true); setError('');
    try {
      await gateway.setThreadStatus(root.id, next); setStatus(next);
      onRootUpdated({ ...root, thread: { status: next, replyCount: replies.length, latestActivityAt: new Date().toISOString(), unread: false } });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Thread could not be updated'); }
    finally { setBusy(false); }
  };

  const send = async () => {
    const body = draft.trim(); if (!body || busy || status !== 'open') return;
    const lower = body.toLowerCase();
    const mentions = agents.filter((agent) => lower.includes(`@${agent.name.toLowerCase()}`)).map((agent) => ({ targetId: agent.id, targetType: 'agent' as const }));
    setBusy(true); setError('');
    try {
      const message = await gateway.sendThread(root.id, body, mentions); setMessages((current) => [...current, message]); setDraft('');
      onRootUpdated({ ...root, thread: { status, replyCount: replies.length + 1, latestActivityAt: new Date().toISOString(), unread: false } });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Reply could not be sent'); }
    finally { setBusy(false); }
  };

  const author = (message: Message) => {
    const agent = agents.find((item) => item.id === message.author);
    if (agent) return { name: agent.name, avatar: <Avatar agent={agent} size="small" />, agent };
    const person = message.userId ? people.byId.get(message.userId) : undefined;
    const mine = !message.userId || message.userId === people.me.id;
    const name = mine ? 'You' : person?.name ?? 'Someone';
    return {
      name,
      avatar: <UserAvatar id={message.userId ?? people.me.id} name={mine ? people.me.name : person?.name ?? name} mode={mine ? people.me.mode : person?.mode} size="small" />,
      agent: undefined,
    };
  };

  const entry = (message: Message, isRoot: boolean) => {
    const who = author(message);
    return <article key={message.id} className={`thread-message${isRoot ? ' thread-root' : ''}`}>
      {who.avatar}
      <div className="thread-message-body">
        <div className="thread-message-meta">
          {who.agent ? <button type="button" onClick={() => onAgentClick(who.agent!.id)}>{who.name}</button> : <strong>{who.name}</strong>}
          <time>{message.time}</time>
        </div>
        {message.body && <p>{renderMentions(message.body, agents, onAgentClick)}</p>}
      </div>
    </article>;
  };

  const closed = status !== 'open';

  return <aside className="thread-panel" aria-label="Message thread">
    <header className="thread-header">
      <div className="thread-title">
        <MessageSquare size={16} />
        <h2>Thread</h2>
        {closed && <span className={`thread-status thread-status-${status}`}>{status === 'resolved' ? 'Resolved' : 'Archived'}</span>}
      </div>
      <div className="thread-header-actions">
        {status === 'open' && <>
          <button type="button" className="icon-button compact" disabled={busy} onClick={() => void updateStatus('resolved')} aria-label="Resolve thread" title="Resolve"><CheckCircle2 size={16} /></button>
          <button type="button" className="icon-button compact" disabled={busy} onClick={() => void updateStatus('archived')} aria-label="Archive thread" title="Archive"><Archive size={16} /></button>
        </>}
        <button type="button" className="icon-button compact" onClick={onClose} aria-label="Close thread" title="Close"><X size={16} /></button>
      </div>
    </header>
    {error && <p role="alert" className="thread-error">{error}</p>}
    <div className="thread-messages" ref={listRef}>
      {entry(messages[0] ?? root, true)}
      <div className="thread-divider"><span>{loading ? 'Loading replies…' : replies.length === 0 ? 'No replies yet' : `${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}</span></div>
      {replies.map((message) => entry(message, false))}
    </div>
    {closed ? (
      <div className="thread-closed">
        <span>This thread is {status}.</span>
        <button type="button" className="secondary-button compact" disabled={busy} onClick={() => void updateStatus('open')}><RotateCcw size={14} /> Reopen</button>
      </div>
    ) : (
      <form className="thread-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <div className="composer">
          <textarea
            aria-label="Thread reply"
            placeholder="Reply in thread…"
            rows={1}
            disabled={loading}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); }
            }}
          />
          <div className="composer-tools">
            <span>Enter to send · Shift+Enter for a new line</span>
            <button type="submit" className="send" disabled={!draft.trim() || busy} aria-label="Send reply"><Send size={16} /></button>
          </div>
        </div>
      </form>
    )}
  </aside>;
}
