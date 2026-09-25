import type { AvatarMode } from "@crewly/protocol";
import { Activity, Check, Download, Folder, Paperclip, Reply, ShieldCheck, X } from "lucide-react";
import { statusLabel, statusTitle } from "../../lib/agent-status";
import type { Agent, Approval, Message } from "../../types";
import type { MentionOption } from "../../app-types";
import { Avatar, UserAvatar } from "../appearance/Avatar";

export function MessageItem({
  message,
  agents,
  people,
  allMessages,
  onReply,
  onAgentClick,
  onInspect,
  onAttachmentDownload,
}: {
  message: Message;
  agents: Agent[];
  /** Who wrote user messages, by user id, for their avatar. */
  people: {
    byId: Map<string, { name: string; mode: AvatarMode }>;
    me: { id: string; name: string; mode: AvatarMode };
  };
  allMessages: Message[];
  onReply: () => void;
  onAgentClick: (agentId: string) => void;
  onInspect?: () => void;
  onAttachmentDownload: (id: string, filename: string) => void;
}) {
  const agent = agents.find((item) => item.id === message.author);
  const replied = allMessages.find((item) => item.id === message.replyTo);
  // Every person's message arrives as "you"; in a group or channel most are not.
  const someoneElse = message.author === "you" && message.userId && message.userId !== people.me.id
    ? people.byId.get(message.userId)?.name ?? "Someone"
    : null;
  return (
    <article className={`message ${message.streaming ? "streaming" : ""}`}>
      {message.author === "you" ? (
        <UserAvatar
          id={message.userId ?? people.me.id}
          name={(message.userId && people.byId.get(message.userId)?.name) || people.me.name}
          mode={(message.userId && people.byId.get(message.userId)?.mode) || people.me.mode}
        />
      ) : (
        <button
          className="avatar-button message-avatar-button"
          onClick={() => agent && onAgentClick(agent.id)}
          aria-label={`Open ${agent?.name ?? "agent"} profile`}
        >
          <Avatar agent={agent} />
        </button>
      )}
      <div className="message-content">
        {replied && (
          <div className="reply-reference">
            <Reply size={12} />
            <strong>{authorName(replied.author, agents)}</strong>
            <span>{replied.body}</span>
          </div>
        )}
        <div className="message-meta">
          {agent ? (
            <button onClick={() => onAgentClick(agent.id)}>{agent.name}</button>
          ) : (
            <strong>{someoneElse ?? "You"}</strong>
          )}
          {agent && (
            <span
              className={`status ${agent.status}`}
              role="img"
              aria-label={statusLabel(agent)}
              title={statusTitle(agent)}
            />
          )}
          {agent && <em>{agent.role}</em>}
          <time>{message.time}</time>
          {agent && onInspect && (
            <button
              type="button"
              className="message-inspect"
              onClick={onInspect}
              aria-label={`How ${agent.name} made this reply`}
              title="Inspect this run"
            >
              <Activity size={12} />
            </button>
          )}
        </div>
        <p>
          {renderMentions(message.body, agents, onAgentClick)}
          {message.streaming && <i className="cursor" />}
        </p>
        {message.attachments.length > 0 && (
          <div className="message-attachments" aria-label="Message attachments">
            {message.attachments.map((attachment) => (
              <div className="message-attachment" key={attachment.id}>
                <Paperclip size={15} />
                <span className="message-attachment-info">
                  <strong title={attachment.filename}>{attachment.filename}</strong>
                  <small>{formatBytes(attachment.sizeBytes)} · {attachment.mimeType}</small>
                </span>
                <button
                  type="button"
                  className="message-attachment-download"
                  onClick={() => onAttachmentDownload(attachment.id, attachment.filename)}
                  aria-label={`Download ${attachment.filename}`}
                  title="Download attachment"
                >
                  <Download size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        {message.activity && (
          <div className="runtime-card">
            <div className="runtime-icon">
              <Activity size={16} />
            </div>
            <div>
              <strong>{message.activity.label}</strong>
              <span>{message.activity.detail}</span>
            </div>
            <div className="runtime-state">
              <span className="spinner" /> Live
            </div>
          </div>
        )}
      </div>
      <button
        className="message-reply"
        onClick={onReply}
        aria-label={`Reply to ${message.author === "you" ? "your message" : (agent?.name ?? "this message")}`}
      >
        <Reply size={15} />
      </button>
    </article>
  );
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function ApprovalMessage({
  approval,
  agent,
  result,
  onAgentClick,
  onDecide,
  onDismiss,
}: {
  approval: Approval;
  agent: Agent;
  result?: string;
  onAgentClick: (agentId: string) => void;
  onDecide: (decision: "once" | "always" | "deny") => void;
  onDismiss: () => void;
}) {
  return (
    <article className="message approval-message">
      <button
        className="avatar-button message-avatar-button"
        onClick={() => onAgentClick(agent.id)}
        aria-label={`Open ${agent.name}'s profile`}
      >
        <Avatar agent={agent} />
      </button>
      <div className="message-content">
        <div className="message-meta">
          <button onClick={() => onAgentClick(agent.id)}>{agent.name}</button>
          <span
            className={`status ${agent.status}`}
            role="img"
            aria-label={statusLabel(agent)}
              title={statusTitle(agent)}
          />
          <em>{agent.role}</em>
          <time>{approval.requestedAt}</time>
        </div>
        <div className="approval-card">
          <div className="approval-head">
            <div className="approval-icon">
              <ShieldCheck size={18} />
            </div>
            <div>
              <strong>Permission requested</strong>
              <span>{agent.name} needs your approval</span>
            </div>
            <time title="Time remaining">{approval.expiresIn}</time>
            <button
              className="approval-dismiss"
              onClick={onDismiss}
              aria-label="Dismiss permission request"
              title="Dismiss"
            >
              <X size={15} />
            </button>
          </div>
          <div className="approval-command">
            <code>{approval.capability}</code>
            <p>{approval.description}</p>
            <span>
              <Folder size={14} /> {approval.workspace}
            </span>
          </div>
          {result ? (
            <div className="approval-result">
              <Check size={16} />{" "}
              {result === "deny"
                ? "Request denied"
                : result === "always"
                  ? "Allowed for this workspace"
                  : "Allowed once"}
            </div>
          ) : (
            <div className="approval-actions">
              <button onClick={() => onDecide("deny")}>Deny</button>
              <button onClick={() => onDecide("always")}>Always allow</button>
              <button className="approve" onClick={() => onDecide("once")}>
                Allow once
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export function authorName(id: string, agents: Agent[]) {
  return id === "you"
    ? "You"
    : (agents.find((agent) => agent.id === id)?.name ?? "Agent");
}

export function renderMentions(
  body: string,
  agents: Agent[],
  onAgentClick: (agentId: string) => void,
) {
  const roleOptions = Array.from(new Set(agents.map((agent) => agent.role))).map(
    (role): MentionOption => ({
      id: `role-${role}`,
      label: `@${role}`,
      description: "Role",
      color: "var(--oc-info)",
      kind: "role",
    }),
  );
  const options: MentionOption[] = [
    {
      id: "everyone",
      label: "@everyone",
      description: "Everyone",
      color: "var(--oc-accent)",
      kind: "everyone",
    },
    {
      id: "here",
      label: "@here",
      description: "Online now",
      color: "var(--oc-success)",
      kind: "here",
    },
    ...agents.map((agent) => ({
      id: `agent-${agent.id}`,
      label: `@${agent.name}`,
      description: agent.role,
      color: agent.color,
      kind: "agent" as const,
      agent,
    })),
    ...roleOptions,
  ];
  const escapedLabels = options
    .map((option) => option.label.slice(1))
    .sort((a, b) => b.length - a.length)
    .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const matcher = new RegExp(
    `(@(?:${escapedLabels.join("|")}))(?![\\p{L}\\p{N}_-])`,
    "giu",
  );
  return body.split(matcher).map((part, index) => {
    const option = options.find(
      (item) => item.label.toLowerCase() === part.toLowerCase(),
    );
    if (!option) return part;
    const mentionStyle = {
      "--mention-color": option.color,
    } as React.CSSProperties;
    return option.agent ? (
      <button
        type="button"
        className={`mention mention-${option.kind}`}
        style={mentionStyle}
        key={`${option.id}-${index}`}
        onClick={() => onAgentClick(option.agent!.id)}
      >
        {part}
      </button>
    ) : (
      <mark
        className={`mention mention-${option.kind}`}
        style={mentionStyle}
        key={`${option.id}-${index}`}
      >
        {part}
      </mark>
    );
  });
}
