import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { Blobatar } from "@blobatar/react";
import { bloopSvg } from "@crewly/bloop";
import type { AvatarMode } from "@crewly/protocol";
import { statusLabel, statusTitle } from "../../lib/agent-status";
import type { Agent } from "../../types";

/*
 * Avatars, drawn the way each person or agent chose.
 *
 * The mode is stored on the server with the identity, so everyone sees the
 * same face for the same person. The face itself is generated here, from the
 * name or id, and never fetched: nothing about anyone goes to an avatar
 * service.
 */

export const AVATAR_MODES: ReadonlyArray<{ mode: AvatarMode; label: string; detail: string }> = [
  { mode: "bloop", label: "Bloop", detail: "Crewly's soft faces. Agents wear the antenna." },
  { mode: "blobatar", label: "Blobatar", detail: "Geometric faces generated from the name." },
  { mode: "name", label: "Name icon", detail: "The first letter of the name." },
];

type Size = "tiny" | "small" | "normal" | "large";

export function Avatar({
  agent,
  size = "normal",
  mode,
}: {
  agent?: Agent;
  size?: Size;
  /** Overrides the agent's own mode, for previews. */
  mode?: AvatarMode;
}) {
  const resolved = mode ?? agent?.avatarMode ?? "bloop";
  return (
    <div
      className={`avatar avatar-${size} ${resolved === "blobatar" ? "avatar-blobatar" : ""} ${resolved === "bloop" ? "avatar-bloop" : ""}`}
      style={resolved === "name" ? { background: agent?.color ?? "#777" } : undefined}
    >
      {resolved === "bloop" && agent ? (
        <span
          aria-hidden="true"
          // Built from numbers and fixed shapes; the name only seeds them.
          dangerouslySetInnerHTML={{ __html: bloopSvg(agent.name, "agent") }}
        />
      ) : resolved === "blobatar" && agent ? (
        <Blobatar name={agent.name} aria-hidden="true" />
      ) : (
        (agent?.initials ?? "?")
      )}
      {agent && (
        <i
          className={`status ${agent.status}`}
          role="img"
          aria-label={statusLabel(agent)}
          title={statusTitle(agent)}
        />
      )}
    </div>
  );
}

/**
 * A person's avatar, in the mode they chose. A person's Bloop has no antenna
 * and no accent outline, so nobody is mistaken for an agent. Seeded by user id
 * so renaming does not change the face.
 */
export function UserAvatar({
  id,
  name,
  mode = "bloop",
  size = "normal",
}: {
  id: string;
  name: string;
  mode?: AvatarMode;
  size?: Size;
}) {
  if (mode === "name") {
    return (
      <div className={`avatar avatar-${size} user-avatar`} aria-hidden="true">
        {(name.trim().charAt(0) || "?").toUpperCase()}
      </div>
    );
  }
  if (mode === "blobatar") {
    return (
      <div className={`avatar avatar-${size} avatar-blobatar user-avatar`} aria-hidden="true">
        <Blobatar name={id} aria-hidden="true" />
      </div>
    );
  }
  return (
    <div
      className={`avatar avatar-${size} avatar-bloop user-avatar`}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: bloopSvg(id, "user") }}
    />
  );
}

/** Choosing a mode, with each option drawn as it would look. */
export function AvatarModePicker({
  name,
  legend,
  value,
  onChange,
  preview,
  disabled,
}: {
  /** The radio group's name; unique per picker on the page. */
  name: string;
  legend: string;
  value: AvatarMode;
  onChange: (mode: AvatarMode) => void;
  preview: (mode: AvatarMode) => ReactNode;
  disabled?: boolean;
}) {
  return (
    <fieldset className="avatar-options" disabled={disabled}>
      <legend>{legend}</legend>
      {AVATAR_MODES.map(({ mode, label, detail }) => (
        <label key={mode} className={value === mode ? "selected" : ""}>
          <input type="radio" name={name} value={mode} checked={value === mode} onChange={() => onChange(mode)} />
          <span className="avatar-option-preview">{preview(mode)}</span>
          <span>
            <strong>{label}</strong>
            <small>{detail}</small>
          </span>
          <i>{value === mode && <Check size={13} />}</i>
        </label>
      ))}
    </fieldset>
  );
}
