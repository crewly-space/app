import { createContext, useContext } from "react";
import { Blobatar } from "@blobatar/react";
import { crewAvatarSvg, crewVariantFor } from "@crewly/ui/crew-avatar";
import { bloopSvg } from "@crewly/ui/bloop";
import { statusLabel, statusTitle } from "../../lib/agent-status";
import type { Agent } from "../../types";
import type { AvatarStyle } from "../../app-types";

export const AVATAR_STYLE_KEY = "crewly:avatar-style";

export const AVATAR_STYLES: readonly AvatarStyle[] = ["bloop", "crew", "blobatar", "initials"];

export const AvatarStyleContext = createContext<AvatarStyle>("bloop");

export function Avatar({
  agent,
  size = "normal",
  style,
}: {
  agent?: Agent;
  size?: "tiny" | "small" | "normal" | "large";
  style?: AvatarStyle;
}) {
  const preferredStyle = useContext(AvatarStyleContext);
  const resolvedStyle = style ?? preferredStyle;
  return (
    <div
      className={`avatar avatar-${size} ${resolvedStyle === "blobatar" ? "avatar-blobatar" : ""} ${resolvedStyle === "crew" ? "avatar-crew" : ""} ${resolvedStyle === "bloop" ? "avatar-bloop" : ""}`}
      style={
        resolvedStyle === "initials"
          ? { background: agent?.color ?? "#777" }
          : undefined
      }
    >
      {resolvedStyle === "bloop" && agent ? (
        <span
          aria-hidden="true"
          // Built from numbers and fixed shapes; the name only seeds them.
          dangerouslySetInnerHTML={{ __html: bloopSvg(agent.name, "agent") }}
        />
      ) : resolvedStyle === "crew" && agent ? (
        <span
          aria-hidden="true"
          // Static markup built from a fixed set of shapes, never from user input.
          dangerouslySetInnerHTML={{
            __html: crewAvatarSvg(crewVariantFor(agent.name)),
          }}
        />
      ) : resolvedStyle === "blobatar" && agent ? (
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
 * A person's avatar. People get a Bloop too -- without the antenna and accent
 * outline that mark an agent -- seeded by their user id so renaming does not
 * change it. Initials, for anyone who chose them for their crew as well.
 */
export function UserAvatar({
  id,
  name,
  size = "normal",
}: {
  id: string;
  name: string;
  size?: "tiny" | "small" | "normal" | "large";
}) {
  const style = useContext(AvatarStyleContext);
  if (style === "initials") {
    return (
      <div className={`avatar avatar-${size} user-avatar`} aria-hidden="true">
        {(name.trim().charAt(0) || "?").toUpperCase()}
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
