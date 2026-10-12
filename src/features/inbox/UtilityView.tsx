import { useEffect, useState } from "react";
import { Activity, ChevronRight, Inbox, MessageCircle, ShieldCheck } from "lucide-react";
import type { AgentRun } from "@crewly/sdk";
import { NotificationsSection } from "../notifications/NotificationsSection";
import type { Agent, Approval, Conversation } from "../../types";
import type { View } from "../../app-types";
import { Avatar } from "../appearance/Avatar";
import { client } from "../../lib/api/client";
import { relativeTime } from "../../lib/relative-time";

const RUN_STATUS: Record<string, string> = {
  queued: "Queued", running: "Working", completed: "Replied", failed: "Failed", cancelled: "Stopped",
};

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
  // Hooks first: the inbox and the activity page are one component.
  const [notificationCount, setNotificationCount] = useState<number | null>(null);
  const [runs, setRuns] = useState<AgentRun[] | null>(null);
  useEffect(() => {
    if (view !== "activity") return;
    let active = true;
    // Admins see every run; anyone else is refused the server-wide list and
    // sees the device sessions below instead.
    client.runs.list({ limit: 30 }).then(({ runs: recent }) => { if (active) setRuns(recent); })
      .catch(() => { if (active) setRuns([]); });
    return () => { active = false; };
  }, [view]);
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
        <NotificationsSection onOpenConversation={onOpenConversation} onLoaded={setNotificationCount} />
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
        {approvals.length === 0 && unread.length === 0 && notificationCount === 0 && (
          <p className="utility-empty">
            You are all caught up. Mentions, replies and requests for your approval land here.
          </p>
        )}
      </section>
    );
  }

  const runtimeAgents = agents.filter((agent) => agent.runtime !== "Chat");
  const sessions = runtimeAgents.flatMap((agent) => (agent.runtimeSessions ?? []).map((session) => ({ agent, session })));
  const running = sessions.filter(({ session }) => session.status === "running").length;
  return (
    <section className="utility-view">
      <div className="utility-intro">
        <span className="utility-icon">
          <Activity size={21} />
        </span>
        <h1>Agent activity</h1>
        <p>What your agents worked on, newest first. Open one to see the conversation.</p>
      </div>
      {runs && runs.length > 0 && (
        <div className="utility-section-title">
          <span>Recent work</span>
        </div>
      )}
      {runs?.map((run) => {
        const agent = agents.find((item) => item.id === run.agentId);
        const conversation = conversations.find((item) => item.id === run.conversationId);
        const status = run.status ? RUN_STATUS[run.status] ?? run.status : "Started";
        return (
          <button
            className="session-row"
            key={run.runId}
            disabled={!conversation}
            onClick={() => conversation && onOpenConversation(conversation.id)}
          >
            <Avatar agent={agent} />
            <span>
              <strong>{agent?.name ?? "Agent"}</strong>
              <small>
                {status} {conversation ? `in ${conversation.type === "dm" ? "your DM" : `#${conversation.name}`}` : ""}
                {run.status === "failed" && run.errorMessage ? ` · ${run.errorMessage}` : ""}
              </small>
            </span>
            <span className={`session-state ${run.status === "failed" ? "offline" : run.status === "running" || run.status === "queued" ? "thinking" : "online"}`}>
              <i />
              {relativeTime(run.finishedAt ?? run.startedAt ?? run.createdAt)}
            </span>
            <ChevronRight size={16} />
          </button>
        );
      })}
      {runtimeAgents.length > 0 && (
        <>
          <div className="utility-section-title">
            <span>On your devices</span>
            <small>{running} running</small>
          </div>
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
          {sessions.length === 0 && <p className="utility-empty">No device sessions yet. Message an agent that runs on a device to start one.</p>}
        </>
      )}
      {runs && runs.length === 0 && runtimeAgents.length === 0 && (
        <p className="utility-empty">
          Nothing yet. Each time an agent replies or works on something, it shows up here.
        </p>
      )}
    </section>
  );
}
