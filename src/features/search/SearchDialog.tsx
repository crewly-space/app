import { useEffect, useMemo, useState } from "react";
import { Hash, Search } from "lucide-react";
import { useDialog } from "../../lib/layers";
import type { Agent, Conversation, Message } from "../../types";
import { Avatar, UserAvatar } from "../appearance/Avatar";
import { gateway } from "../../lib/gateway";

export function SearchDialog({
  agents,
  conversations,
  messages,
  onClose,
  onSelect,
}: {
  agents: Agent[];
  conversations: Conversation[];
  messages: Message[];
  onClose: () => void;
  onSelect: (conversationId: string, message?: Message) => void;
}) {
  const dialogRef = useDialog(onClose);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const [history, setHistory] = useState<{ query: string; messages: Message[] }>({ query: '', messages: [] });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setError('');
    setPending(Boolean(needle));
    if (!needle) return;
    const timer = window.setTimeout(() => {
      void gateway.searchMessages(query.trim()).then((found) => {
        if (active) setHistory({ query: needle, messages: found });
      }).catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : 'History search could not be completed');
      }).finally(() => { if (active) setPending(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [needle]);
  const matches = history.query === needle ? history.messages : [];
  // Searching names alone cannot find a phrase you remember saying, which is
  // what people actually reach for search to do.
  const spoken = useMemo(() => {
    const byConversation = new Map<string, string>();
    for (const message of messages) {
      const seen = byConversation.get(message.conversationId) ?? "";
      byConversation.set(message.conversationId, `${seen} ${message.body}`);
    }
    return byConversation;
  }, [messages]);
  const results = conversations.filter((conversation) => {
    const people = conversation.agentIds
      .map((id) => agents.find((agent) => agent.id === id)?.name ?? "")
      .join(" ");
    return `${conversation.name} ${conversation.preview} ${people} ${spoken.get(conversation.id) ?? ""}`
      .toLowerCase()
      .includes(needle) || matches.some((message) => message.conversationId === conversation.id);
  });
  return (
    <div
      className="modal-layer search-layer"
      onMouseDown={(event) => event.currentTarget === event.target && onClose()}
    >
      <div
        ref={dialogRef}
        className="search-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Search conversations"
      >
        <div className="search-input">
          <Search size={18} />
          <input
            autoFocus
            type="search"
            aria-label="Search conversations"
            spellCheck={false}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search messages, conversations and agents…"
          />
          <kbd>Esc</kbd>
        </div>
        <div className="search-results">
          {pending && <p role="status">Searching message history…</p>}
          {error && <p role="alert">{error}</p>}
          <label>
            {query
              ? `${results.length} ${results.length === 1 ? "result" : "results"}`
              : "Recent conversations"}
          </label>
          {results.map((conversation) => {
            const agent = agents.find(
              (item) => item.id === conversation.agentIds[0],
            );
            return (
              <button
                key={conversation.id}
                onClick={() => onSelect(conversation.id, needle ? matches.find((message) => message.conversationId === conversation.id) ?? messages.find((message) => message.conversationId === conversation.id && message.body.toLowerCase().includes(needle)) : undefined)}
              >
                {conversation.type === "dm" ? (
                  conversation.peer ? <UserAvatar id={conversation.peer.id} name={conversation.peer.displayName} mode={conversation.peer.avatarMode} size="small" /> : <Avatar agent={agent} size="small" />
                ) : (
                  <span className="hash-avatar">
                    <Hash size={14} />
                  </span>
                )}
                <span>
                  <strong>{conversation.name}</strong>
                  <small>{matches.find((message) => message.conversationId === conversation.id)?.body ?? conversation.preview}</small>
                </span>
                <em>{conversation.time}</em>
              </button>
            );
          })}
          {results.length === 0 && !pending && !error && (
            <div className="empty-search">
              <Search size={22} />
              <strong>No conversations found</strong>
              <span>Try an agent name, or a phrase from the conversation.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
