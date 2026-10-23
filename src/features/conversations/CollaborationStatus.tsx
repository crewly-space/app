import { useEffect, useState } from 'react';
import { onAgentWorkChanged, type AgentWorkEvent } from '../../lib/realtime/events';

type Consultation = Extract<AgentWorkEvent, { type: 'consultation' }>;

/** Live consultations stay separate from messages; the lead posts the result. */
export function CollaborationStatus({ conversationId, agents }: { conversationId: string; agents: { id: string; name: string }[] }) {
  const [active, setActive] = useState<Consultation[]>([]);
  useEffect(() => {
    setActive([]);
    return onAgentWorkChanged(event => {
      if (event.type === 'reset') { setActive([]); return; }
      if (event.type === 'finished') { setActive(current => current.filter(item => item.parentRunId !== event.runId)); return; }
      if (event.conversationId !== conversationId) return;
      setActive(current => {
        const rest = current.filter(item => item.parentRunId !== event.parentRunId || item.toAgentId !== event.toAgentId);
        return event.status === 'started' ? [...rest, event] : rest;
      });
    });
  }, [conversationId]);
  const name = (id: string) => agents.find(agent => agent.id === id)?.name ?? 'Another assistant';
  return <>{active.map(item => <div className="chat-agent-state" role="status" key={`${item.parentRunId}:${item.toAgentId}`}>
    <span className="spinner" /><span>{name(item.fromAgentId)} is consulting {name(item.toAgentId)}…</span>
  </div>)}</>;
}
