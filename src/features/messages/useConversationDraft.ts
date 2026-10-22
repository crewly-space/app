import { useCallback, useRef, useState } from 'react';
import type { Message } from '../../types';

export interface ConversationDraft {
  text: string;
  replying: Message | null;
  nodes: Node[];
}

// Page-local drafts preserve mention tokens without writing conversations to disk.
const drafts = new Map<string, ConversationDraft>();
let generation = 0;
export function clearConversationDrafts(): void { drafts.clear(); generation++; }
window.addEventListener('crewly:logout', clearConversationDrafts);
window.addEventListener('crewly:account-logout', clearConversationDrafts);
const keyFor = (server: string, conversation: string) => JSON.stringify([server, conversation]);

export function useConversationDraft(server: string, conversation: string) {
  const [composer, setComposer] = useState('');
  const [replying, setReplying] = useState<Message | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const latest = useRef({ composer, replying });
  latest.current = { composer, replying };
  const key = keyFor(server, conversation);
  const scope = useRef(key);
  scope.current = key;
  const born = useRef(generation);

  const captureDraft = useCallback((): ConversationDraft => ({
    text: latest.current.composer,
    replying: latest.current.replying,
    nodes: Array.from(composerRef.current?.childNodes ?? []).map((node) => node.cloneNode(true)),
  }), []);

  const bindComposer = useCallback((node: HTMLDivElement | null) => {
    if (!node) {
      if (composerRef.current && born.current === generation) drafts.set(key, captureDraft());
      composerRef.current = null;
      return;
    }
    composerRef.current = node;
    const draft = drafts.get(key);
    node.replaceChildren(...(draft?.nodes ?? []).map((entry) => entry.cloneNode(true)));
    latest.current = { composer: draft?.text ?? '', replying: draft?.replying ?? null };
    setComposer(latest.current.composer);
    setReplying(latest.current.replying);
  }, [key, captureDraft]);

  const restoreDraft = useCallback((id: string, draft: ConversationDraft) => {
    if (born.current !== generation) return;
    drafts.set(keyFor(server, id), draft);
    if (scope.current !== keyFor(server, id)) return;
    latest.current = { composer: draft.text, replying: draft.replying };
    setComposer(draft.text);
    setReplying(draft.replying);
    composerRef.current?.replaceChildren(...draft.nodes.map((node) => node.cloneNode(true)));
  }, [server]);

  return { composer, setComposer, replying, setReplying, composerRef, bindComposer, captureDraft, restoreDraft };
}
