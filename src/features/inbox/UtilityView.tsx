import { Activity, ChevronRight, Inbox, MessageCircle, ShieldCheck } from "lucide-react";
import { NotificationsSection } from "../notifications/NotificationsSection";
import type { Agent, Approval, Conversation } from "../../types";
import type { View } from "../../app-types";
import { Avatar } from "../appearance/Avatar";

export function UtilityView({
  view,
  approvals,
  agents,
  conversations,
  onOpenConversation,
}: {
  view: Exclude<View, "messages">;
  approvals: Approval[];
  agents: Agent[];
  conversations: Conversation[];
  onOpenConversation: (id: string) => void;
}) {
  if (view === "inbox") {
    const unread = conversations.filter((item) => item.unread);
    return (
      <section className="utility-view">
        <div className="utility-intro">
          <span className="utility-icon">
            <Inbox size={21} />
          </span>
          <h1>Everything that needs you</h1>
          <p>Approvals and unread conversations, gathered in one place.</p>
        </div>
        <NotificationsSection onOpenConversation={onOpenConversation} />
        {approvals.length > 0 && (
          <div className="utility-section-title">
            <span>Needs attention</span>
            <small>{approvals.length}</small>
          </div>
        )}
        {approvals.map((approval) => {
          const agent = agents.find((item) => item.id === approval.agentId);
          const conversation = conversations.find((item) => item.id === approval.conversationId);
          return (
            <button
              className="inbox-item"
              key={approval.id}
              onClick={() =>
                conversation && onOpenConversation(conversation.id)
              }
            >
              <span className="inbox-symbol">
                <ShieldCheck size={17} />
              </span>
              <span>
                <strong>{agent?.name} needs permission</strong>
                <small>{approval.description}</small>
              </span>
              <em>{approval.expiresIn}</em>
              <ChevronRight size={16} />
            </button>
          );
        })}
        {unread.length > 0 && (
          <div className="utility-section-title">
            <span>Unread</span>
            <small>{unread.length}</small>
          </div>
        )}
        {unread.map((conversation) => (
            <button
              className="inbox-item"
              key={conversation.id}
              onClick={() => onOpenConversation(conversation.id)}
            >
              <span className="inbox-symbol neutral">
                <MessageCircle size={17} />
              </span>
              <span>
                <strong>{conversation.name}</strong>
                <small>{conversation.preview}</small>
              </span>
              <em>{conversation.time}</em>
              <ChevronRight size={16} />
            </button>
        ))}
        {approvals.length === 0 && unread.length === 0 && (
          <p className="utility-empty">
            You are all caught up. Nothing is waiting on you.
          </p>
        )}
      </section>
    );
  }

  const runtimeAgents = agents.filter((agent) => agent.runtime !== "Chat");
  const sessions = runtimeAgents.flatMap((agent) => (agent.runtimeSessions ?? []).map((session) => ({ agent, session })));
  return (
    <section className="utility-view">
      <div className="utility-intro">
        <span className="utility-icon">
          <Activity size={21} />
        </span>
        <h1>Runtime activity</h1>
        <p>Follow active sessions without leaving the conversation.</p>
      </div>
      <div className="activity-summary">
        <div>
          <strong>
            {
              sessions.filter(({ session }) => session.status === "running")
                .length
            }
          </strong>
          <span>Running</span>
        </div>
        <div>
          <strong>{runtimeAgents.length}</strong>
          <span>Configured</span>
        </div>
        <div>
          <strong>{new Set(runtimeAgents.map((agent) => agent.workspace).filter(Boolean)).size}</strong>
          <span>Workspaces</span>
        </div>
      </div>
      {sessions.length > 0 && (
        <div className="utility-section-title">
          <span>Sessions</span>
          <small>Live</small>
        </div>
      )}
      {sessions.map(({ agent, session }) => {
        const conversation = conversations.find((item) =>
          item.id === session.conversationId,
        );
        return (
          <button
            className="session-row"
            key={session.id}
            disabled={!conversation}
            onClick={() => conversation && onOpenConversation(conversation.id)}
          >
            <Avatar agent={agent} />
            <span>
              <strong>{agent.name}</strong>
              <small>
                {conversation?.name ?? 'Conversation unavailable'} · {agent.runtime} · {agent.workspace ?? "No workspace"}
              </small>
            </span>
            <span className={`session-state ${agent.status}`}>
              <i />
              {session.status.replace(/_/g, ' ')}
            </span>
            <ChevronRight size={16} />
          </button>
        );
      })}
      {runtimeAgents.length === 0 && (
        <p className="utility-empty">
          No agent runs on a device yet. Pair one from Settings to see its
          sessions here.
        </p>
      )}
      {runtimeAgents.length > 0 && sessions.length === 0 && <p className="utility-empty">No runtime sessions yet. Message an agent to start one.</p>}
    </section>
  );
}
