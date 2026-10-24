import { useEffect, useRef, useState } from 'react';
import type { AvatarMode } from '@crewly/protocol';
import { Archive, CheckCircle2, MessageSquare, RotateCcw, Send, X } from 'lucide-react';
import type { Agent, Message } from '../../types';
import { useLayer } from '../../lib/layers';
import { gateway } from '../../lib/gateway';
import { onThreadChanged } from '../../lib/realtime/events';
import { Avatar, UserAvatar } from '../appearance/Avatar';
import { MessageBody } from './MessageBody';
import { useRequestScope } from '../../lib/useRequestScope';

type ThreadStatus = 'open' | 'resolved' | 'archived';

export function ThreadPanel({ root, focusMessageId, liveMessages = [], agents, people, onClose, onRootUpdated, onAgentClick }: {
  root: Message;
  focusMessageId?: string | null;
  liveMessages?: Message[];
  agents: Agent[];
  people: {
    byId: Map<string, { name: string; mode: AvatarMode }>;
    me: { id: string; name: string; mode: AvatarMode };
  };
  onClose: () => void;
  onRootUpdated: (root: Message) => void;
  onAgentClick: (agentId: string) => void;
}) {
  const panelRef = useLayer<HTMLElement>(onClose, false);
  const captureScope = useRequestScope(root.id);
  const [messages, setMessages] = useState<Message[]>([root]);
  const [status, setStatus] = useState<ThreadStatus>(root.thread?.status ?? 'open');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const focusedId = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    let revision = 0;
    setBusy(true); setLoading(true); setMessages([root]); setStatus(root.thread?.status ?? 'open'); setError(''); setDraft('');
    const refresh = async () => {
      const requested = ++revision;
      try {
        const result = await gateway.thread(root.id);
        if (!active || requested !== revision) return;
        setMessages(result.messages);
        setStatus(result.thread.status);
        setError('');
      } catch (reason) {
        if (active && requested === revision) setError(reason instanceof Error ? reason.message : 'Thread could not be loaded');
      }
    };
    // Subscribe before loading so replies arriving during the first request are retained.
    const stop = onThreadChanged((id) => { if (id === root.id) void refresh(); });
    void gateway.openThread(root.id).then(refresh)
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : 'Thread could not be opened'))
      .finally(() => { if (active) { setBusy(false); setLoading(false); } });
    return () => { active = false; stop(); };
  }, [root.id]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages.length]);

  const replies = [...new Map([...messages.slice(1), ...liveMessages.filter((message) => message.threadRootId === root.id)].map((message) => [message.id, message])).values()]
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));

  useEffect(() => {
    if (!focusMessageId) { focusedId.current = null; return; }
    if (loading || focusedId.current === focusMessageId) return;
    const entry = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-thread-message-id]') ?? [])
      .find((element) => element.dataset.threadMessageId === focusMessageId);
    if (entry) { entry.scrollIntoView({ block: 'center' }); focusedId.current = focusMessageId; }
  }, [focusMessageId, loading, messages, liveMessages]);

  const totalReplies = Math.max(messages[0]?.thread?.replyCount ?? root.thread?.replyCount ?? 0, replies.length);

  const updateStatus = async (next: ThreadStatus) => {
    const isCurrent = captureScope();
    setBusy(true); setError('');
    try {
      await gateway.setThreadStatus(root.id, next);
      if (!isCurrent()) return;
      setStatus(next);
      onRootUpdated({ ...root, thread: { status: next, replyCount: totalReplies, latestActivityAt: new Date().toISOString(), unread: false } });
    } catch (reason) { if (isCurrent()) setError(reason instanceof Error ? reason.message : 'Thread could not be updated'); }
    finally { if (isCurrent()) setBusy(false); }
  };

  const send = async () => {
    const body = draft.trim(); if (!body || busy || status !== 'open') return;
    const isCurrent = captureScope();
    const lower = body.toLowerCase();
    const mentions = agents.filter((agent) => lower.includes(`@${agent.name.toLowerCase()}`)).map((agent) => ({ targetId: agent.id, targetType: 'agent' as const }));
    setBusy(true); setError('');
    try {
      const message = await gateway.sendThread(root.id, body, mentions);
      if (!isCurrent()) return;
      setMessages((current) => current.some((entry) => entry.id === message.id) ? current : [...current, message]); setDraft('');
    } catch (reason) { if (isCurrent()) setError(reason instanceof Error ? reason.message : 'Reply could not be sent'); }
    finally { if (isCurrent()) setBusy(false); }
  };

  const author = (message: Message) => {
    const agent = agents.find((item) => item.id === message.author);
    if (agent) return { name: agent.name, avatar: <Avatar agent={agent} size="small" />, agent };
    const person = message.userId ? people.byId.get(message.userId) : undefined;
    const mine = message.author === 'you' && (!message.userId || message.userId === people.me.id);
    const name = mine ? 'You' : person?.name ?? (message.author === 'Webhook' ? 'Webhook' : message.author === 'you' ? 'Someone' : 'Agent');
    return {
      name,
      avatar: <UserAvatar id={message.userId ?? people.me.id} name={mine ? people.me.name : person?.name ?? name} mode={mine ? people.me.mode : person?.mode} size="small" />,
      agent: undefined,
    };
  };

  const entry = (message: Message, isRoot: boolean) => {
    const who = author(message);
    return <article data-thread-message-id={message.id} key={message.id} className={`thread-message${isRoot ? ' thread-root' : ''}`}>
      {who.avatar}
      <div className="thread-message-body">
        <div className="thread-message-meta">
          {who.agent ? <button type="button" onClick={() => onAgentClick(who.agent!.id)}>{who.name}</button> : <strong>{who.name}</strong>}
          <time>{message.time}</time>
        </div>
        {message.body && <MessageBody body={message.body} agents={agents} onAgentClick={onAgentClick} />}
      </div>
    </article>;
  };

  const closed = status !== 'open';

  return <aside ref={panelRef} className="thread-panel" aria-label="Message thread">
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
    <div className="thread-messages" ref={listRef} tabIndex={0} role="region" aria-label="Thread messages">
      {entry(messages[0] ?? root, true)}
      <div className="thread-divider"><span>{loading ? 'Loading replies…' : replies.length === 0 ? 'No replies yet' : totalReplies > replies.length ? `${replies.length} of ${totalReplies} replies loaded` : `${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}</span></div>
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
