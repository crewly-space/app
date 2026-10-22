import { useState } from 'react';
import type { DirectoryUser } from '@crewly/sdk';
import type { Agent } from '../../types';
import { useLayer } from '../../lib/layers';
import { Avatar, UserAvatar } from '../appearance/Avatar';

export function NewConversationDialog({ agents, people, currentUserId, onClose, onCreate }: {
  agents: Agent[];
  people: DirectoryUser[];
  currentUserId: string;
  onClose: () => void;
  onCreate: (participants: { participantId: string; participantType: 'user' | 'agent' }[], name: string) => Promise<void>;
}) {
  const ref = useLayer<HTMLFormElement>(onClose, true);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const candidates = [
    ...people.filter((person) => person.id !== currentUserId).map((person) => ({ key: `user:${person.id}`, id: person.id, kind: 'user' as const, name: person.displayName, avatar: <UserAvatar id={person.id} name={person.displayName} mode={person.avatarMode} size="small" /> })),
    ...agents.map((agent) => ({ key: `agent:${agent.id}`, id: agent.id, kind: 'agent' as const, name: agent.name, avatar: <Avatar agent={agent} size="small" /> })),
  ];
  const create = async () => {
    if (busy || !selected.length) return;
    setBusy(true); setError('');
    try {
      await onCreate(candidates.filter((candidate) => selected.includes(candidate.key)).map((candidate) => ({ participantId: candidate.id, participantType: candidate.kind })), name.trim() || (selected.length === 1 ? '' : candidates.filter((candidate) => selected.includes(candidate.key)).map((candidate) => candidate.name).join(', ').slice(0, 80)));
      onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not start this conversation'); }
    finally { setBusy(false); }
  };
  return <div className="modal-layer" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form ref={ref} className="onboarding-card form new-conversation-dialog" role="dialog" aria-modal="true" aria-labelledby="new-conversation-title" onSubmit={(event) => { event.preventDefault(); void create(); }}>
      <h2 id="new-conversation-title">New message</h2>
      <p>Talk privately with a teammate or agent. Choose several to start a group.</p>
      <label>Find a teammate or agent<input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <div className="conversation-candidates">
        {candidates.filter((candidate) => candidate.name.toLowerCase().includes(query.trim().toLowerCase())).map((candidate) => <label className="conversation-candidate" key={candidate.key}>
          <input type="checkbox" disabled={busy} checked={selected.includes(candidate.key)} onChange={() => setSelected((current) => current.includes(candidate.key) ? current.filter((key) => key !== candidate.key) : [...current, candidate.key])} />
          {candidate.avatar}<span>{candidate.name}<small>{candidate.kind === 'user' ? 'Teammate' : 'Agent'}</small></span>
        </label>)}
        {!candidates.some((candidate) => candidate.name.toLowerCase().includes(query.trim().toLowerCase())) && <p>No teammates or agents found.</p>}
      </div>
      {selected.length > 1 && <label>Group name (optional)<input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} /></label>}
      {error && <p role="alert" className="dashboard-error">{error}</p>}
      <div className="dashboard-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={busy || !selected.length}>{busy ? 'Opening…' : 'Start conversation'}</button></div>
    </form>
  </div>;
}
