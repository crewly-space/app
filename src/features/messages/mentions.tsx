import type { CSSProperties } from "react";
import type { Agent } from "../../types";
import type { MentionOption } from "../../app-types";

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
    } as CSSProperties;
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
