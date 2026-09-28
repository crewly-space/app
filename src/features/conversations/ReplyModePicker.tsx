import { useEffect, useState } from "react";
import type { ConversationReplyMode } from "@crewly/sdk";
import { AtSign, Sparkles, Users } from "lucide-react";
import { gateway } from "../../lib/gateway";

const MODES: { value: ConversationReplyMode; label: string; hint: string; icon: typeof AtSign }[] = [
  { value: "mentions", label: "Mentions & keywords", hint: "@, names and follow-ups, or the agent whose role matches the topic. Free and instant.", icon: AtSign },
  { value: "model", label: "Let a model decide", hint: "A short model call reads the conversation and picks who answers.", icon: Sparkles },
  { value: "open", label: "Everyone hears it", hint: "Every free agent sees it and replies only if it has something to add. Busy agents keep working.", icon: Users },
];

/** Who answers a message nobody addressed, for one conversation. */
export function ReplyModePicker({ conversationId, onNotify }: { conversationId: string; onNotify: (message: string) => void }) {
  const [mode, setMode] = useState<ConversationReplyMode | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    setMode(null);
    // A server from before reply modes has none: the picker stays hidden.
    gateway.replyMode(conversationId).then((value) => active && setMode(value)).catch(() => undefined);
    return () => { active = false; };
  }, [conversationId]);

  if (!mode) return null;

  const choose = async (next: ConversationReplyMode) => {
    if (next === mode || saving) return;
    const previous = mode;
    setMode(next); setSaving(true);
    try {
      await gateway.setReplyMode(conversationId, next);
    } catch (reason) {
      setMode(previous);
      onNotify(reason instanceof Error ? reason.message : "Could not change who answers");
    } finally { setSaving(false); }
  };

  return (
    <fieldset className="reply-mode" disabled={saving}>
      <legend>Who answers</legend>
      <p>For messages that don't @ or name anyone.</p>
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
