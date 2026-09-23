import { Hash } from "lucide-react";
import type { Agent, Conversation } from "../../types";
import { Avatar } from "../appearance/Avatar";

export function ConversationRow({
  item,
  agents,
  active,
  onClick,
}: {
  item: Conversation;
  agents: Agent[];
  active: boolean;
  onClick: () => void;
}) {
  const agent = agents.find((candidate) => candidate.id === item.agentIds[0]);
  return (
    <button
      className={`conversation-row ${active ? "active" : ""}`}
      onClick={onClick}
    >
      {item.type === "dm" ? (
        <Avatar agent={agent} size="tiny" />
      ) : (
        <span className="hash-avatar">
          <Hash size={14} />
        </span>
      )}
      <span>{item.name}</span>
      {item.unread ? (
        <small aria-label={`${item.unread} unread`}>{item.unread}</small>
      ) : null}
    </button>
  );
}
