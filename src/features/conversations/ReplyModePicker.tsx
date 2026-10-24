import { useEffect, useState } from "react";
import type { ConversationReplyMode } from "@crewly/sdk";
import { AtSign, Sparkles, Users } from "lucide-react";
import { gateway } from "../../lib/gateway";
import { useRequestScope } from "../../lib/useRequestScope";

const MODES: { value: ConversationReplyMode; label: string; hint: string; icon: typeof AtSign }[] = [
  { value: "mentions", label: "Only when asked", hint: "Agents reply to an @mention, their name, a follow-up, or a topic that is plainly their role. Free and instant.", icon: AtSign },
  { value: "model", label: "A model picks who answers", hint: "A short model call reads the conversation and picks the agent to reply.", icon: Sparkles },
  { value: "open", label: "Every agent may answer", hint: "Every free agent sees it and replies only if it has something to add.", icon: Users },
];

/** Who answers a message nobody addressed, for one conversation. */
export function ReplyModePicker({ conversationId, onNotify }: { conversationId: string; onNotify: (message: string) => void }) {
  const [mode, setMode] = useState<ConversationReplyMode | null>(null);
  const [saving, setSaving] = useState(false);
  const captureScope = useRequestScope(conversationId);

  useEffect(() => {
    let active = true;
    setMode(null);
    setSaving(false);
    // A server from before reply modes has none: the picker stays hidden.
    gateway.replyMode(conversationId).then((value) => active && setMode(value)).catch(() => undefined);
    return () => { active = false; };
  }, [conversationId]);

  if (!mode) return null;

  const choose = async (next: ConversationReplyMode) => {
    if (next === mode || saving) return;
    const previous = mode;
    const isCurrent = captureScope();
    setMode(next); setSaving(true);
    try {
      await gateway.setReplyMode(conversationId, next);
    } catch (reason) {
      if (!isCurrent()) return;
      setMode(previous);
      onNotify(reason instanceof Error ? reason.message : "Could not change who answers");
    } finally { if (isCurrent()) setSaving(false); }
  };

  return (
    <fieldset className="reply-mode" disabled={saving}>
      <legend>When no one is @mentioned</legend>
      <p>Who answers a message that doesn't name an agent.</p>
      {MODES.map(({ value, label, hint, icon: Icon }) => (
        <label key={value} className={mode === value ? "selected" : ""}>
          <input type="radio" name={`reply-mode-${conversationId}`} value={value} checked={mode === value} onChange={() => void choose(value)} />
          <Icon size={16} />
          <span><strong>{label}</strong><small>{hint}</small></span>
        </label>
      ))}
    </fieldset>
  );
}
