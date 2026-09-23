import { useEffect, useState } from "react";
import { Bot, ChevronRight, Cpu, Database, Folder, X } from "lucide-react";
import { statusLabel } from "../../lib/agent-status";
import type { Agent, Conversation } from "../../types";
import type { View } from "../../app-types";
import { Avatar } from "../appearance/Avatar";

export function DetailsPanel({
  conversation,
  agents,
  onClose,
  onNotify,
  onAgentClick,
  onUpdateAgent,
}: {
  conversation: Conversation;
  agents: Agent[];
  onClose: () => void;
  onNotify: (message: string) => void;
  onAgentClick: (agentId: string) => void;
  onUpdateAgent: (id: string, updates: Partial<Agent>) => Promise<Agent>;
}) {
  const [tab, setTab] = useState<"people" | "memory">("people");
  const [memoryAgentId, setMemoryAgentId] = useState(agents[0]?.id ?? "");
  const agentIds = agents.map((agent) => agent.id).join(",");
  const memoryAgent =
    agents.find((agent) => agent.id === memoryAgentId) ?? agents[0];
  const [memory, setMemory] = useState(memoryAgent?.memory.join("\n") ?? "");
  const [savingMemory, setSavingMemory] = useState(false);
  useEffect(() => {
    setMemoryAgentId(agents[0]?.id ?? "");
  }, [conversation.id, agentIds]);
  useEffect(() => {
    setMemory(memoryAgent?.memory.join("\n") ?? "");
  }, [memoryAgent]);
  return (
    <aside className="detail-panel" aria-label="Conversation details">
      <header>
        <strong>
          {conversation.type === "channel" ? "Channel" : conversation.type === "group" ? "Conversation" : "Agent"} details
        </strong>
        <button
          className="icon-button compact"
          onClick={onClose}
          aria-label="Close details"
        >
          <X size={18} />
        </button>
      </header>
      <div className="detail-tabs">
        <button
          className={tab === "people" ? "active" : ""}
          onClick={() => setTab("people")}
        >
          People
        </button>
        <button
          className={tab === "memory" ? "active" : ""}
          onClick={() => setTab("memory")}
        >
          Memory
        </button>
      </div>
      {tab === "people" ? (
        <div className="details-content">
          {!agents.length && (
            <p className="detail-empty">
              No agents here yet.{conversation.type === "channel" ? " An admin can add one from the channel's settings." : ""}
            </p>
          )}
          {agents.map((agent) => (
            <button
              className="agent-profile"
              key={agent.id}
              onClick={() => onAgentClick(agent.id)}
              aria-label={`Open ${agent.name}'s profile`}
            >
              <Avatar agent={agent} size="large" />
              <h3>{agent.name}</h3>
              <p>{agent.role}</p>
              <span className="online-label">
                <i className={`status ${agent.status}`} /> {statusLabel(agent)}
              </span>
              <div className="profile-grid">
                <span>
                  <Bot size={15} /> Model
                </span>
                <strong>{agent.model}</strong>
                <span>
                  <Cpu size={15} /> Runtime
                </span>
                <strong>{agent.runtime}</strong>
                {agent.workspace && (
                  <>
                    <span>
                      <Folder size={15} /> Workspace
                    </span>
                    <strong>{agent.workspace}</strong>
                  </>
                )}
              </div>
              <span className="profile-open">
                View profile <ChevronRight size={14} />
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="memory-editor">
          {agents.length > 1 && (
            <label className="memory-agent-picker">
              Agent
              <select
                value={memoryAgent?.id}
                onChange={(event) => setMemoryAgentId(event.target.value)}
              >
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="memory-heading">
            <Database size={18} />
            <div>
              <strong id="memory-heading">Working memory</strong>
              <span>{memoryAgent?.name} uses this across conversations.</span>
            </div>
          </div>
          <textarea
            aria-labelledby="memory-heading"
            value={memory}
            onChange={(event) => setMemory(event.target.value)}
            placeholder="Add one memory per line…"
          />
          <div className="memory-footer">
            <span>{memory.split("\n").filter(Boolean).length} memories</span>
            <button
              disabled={savingMemory}
              onClick={async () => {
                if (!memoryAgent) return;
                setSavingMemory(true);
                try {
                  await onUpdateAgent(memoryAgent.id, {
                    memory: memory
                      .split("\n")
                      .map((item) => item.trim())
                      .filter(Boolean),
                  });
                  onNotify(`Memory saved for ${memoryAgent.name}.`);
                } finally {
                  setSavingMemory(false);
                }
              }}
            >
              {savingMemory ? "Saving…" : "Save memory"}
            </button>
          </div>
          <p className="muted-copy">
            You control what this agent remembers. Conversation history is
            managed separately.
          </p>
        </div>
      )}
    </aside>
  );
}
