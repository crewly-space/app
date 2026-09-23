import { useMemo, useState } from "react";
import { Hash, Search } from "lucide-react";
import { useDialog } from "../../lib/layers";
import type { Agent, Conversation, Message } from "../../types";
import { Avatar } from "../appearance/Avatar";

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
  onSelect: (conversationId: string) => void;
}) {
  const dialogRef = useDialog(onClose);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
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
      .includes(needle);
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
            placeholder="Find a conversation or agent…"
          />
          <kbd>Esc</kbd>
        </div>
        <div className="search-results">
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
                onClick={() => onSelect(conversation.id)}
              >
                {conversation.type === "dm" ? (
                  <Avatar agent={agent} size="small" />
                ) : (
                  <span className="hash-avatar">
                    <Hash size={14} />
                  </span>
                )}
                <span>
                  <strong>{conversation.name}</strong>
                  <small>{conversation.preview}</small>
                </span>
                <em>{conversation.time}</em>
              </button>
            );
          })}
          {results.length === 0 && (
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
