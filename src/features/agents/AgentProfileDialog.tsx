import { Bot, Cpu, Database, Folder, MessageCircle, X } from "lucide-react";
import { statusLabel, statusTitle } from "../../lib/agent-status";
import { useDialog } from "../../lib/layers";
import type { Agent, Message } from "../../types";
import { Avatar } from "../appearance/Avatar";

export function AgentProfileDialog({
  agent,
  onClose,
  onEdit,
  onMessage,
}: {
  agent: Agent;
  onClose: () => void;
  onEdit: () => void;
  onMessage: () => void;
}) {
  const dialogRef = useDialog(onClose);
  return (
    <div
      className="modal-layer"
      onMouseDown={(event) => event.currentTarget === event.target && onClose()}
    >
      <div
        ref={dialogRef}
        className="modal profile-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-profile-title"
      >
        <header className="compact-modal-header">
          <div>
            <span className="eyebrow">Agent profile</span>
            <h2 id="agent-profile-title">{agent.name}</h2>
          </div>
          <button className="icon-button compact" onClick={onClose} aria-label="Close profile">
            <X size={18} />
          </button>
        </header>
        <div className="profile-modal-body">
          <div className="profile-hero">
            <Avatar agent={agent} size="large" />
            <div>
              <h3>{agent.name}</h3>
              <p>{agent.role}</p>
              <span className="online-label">
                <i className={`status ${agent.status}`} title={statusTitle(agent)} /> {statusLabel(agent)}
              </span>
            </div>
          </div>
          <dl className="agent-facts">
            <div><dt><Bot size={15} /> Model</dt><dd>{agent.model}</dd></div>
            <div><dt><Cpu size={15} /> Runtime</dt><dd>{agent.runtime}</dd></div>
            <div><dt><Folder size={15} /> Workspace</dt><dd>{agent.workspace ?? "Not connected"}</dd></div>
            <div><dt><Database size={15} /> Memory</dt><dd>{agent.memoryEnabled === false ? "Off" : `${agent.memory.length} saved`}</dd></div>
          </dl>
          {agent.instructions && (
            <section className="profile-instructions">
              <span>Working instructions</span>
              <p>{agent.instructions}</p>
            </section>
          )}
        </div>
        <footer>
          <button className="secondary-button" onClick={onEdit}>Edit profile</button>
          <button className="primary-button" onClick={onMessage}>
            <MessageCircle size={16} /> Message {agent.name}
          </button>
        </footer>
      </div>
    </div>
  );
}
