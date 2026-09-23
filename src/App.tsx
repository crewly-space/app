import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Blobatar } from "@blobatar/react";
import { crewAvatarSvg, crewVariantFor } from "@crewly/ui/crew-avatar";
import type { AuthUser, DeviceInfo, DevicePairingInfo, UserAccount } from "@crewly/sdk";
import type { ModelInfo } from "@crewly/protocol";
import {
  Activity,
  AtSign,
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  PanelRight,
  Cpu,
  Database,
  Folder,
  Hash,
  Inbox,
  Laptop,
  LockKeyhole,
  Menu,
  MessageCircle,
  Monitor,
  MoreHorizontal,
  Moon,
  Palette,
  Paperclip,
  Plus,
  Reply,
  Search,
  Send,
  Gauge,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  UserRound,
  X,
  Zap,
} from "lucide-react";
import { gateway } from "./lib/gateway";
import { statusLabel, statusTitle, withStatus } from "./lib/agent-status";
import { NotificationsSection } from "./features/notifications/NotificationsSection";
import { RunInspector } from "./features/runs/RunInspector";
import { client } from "./lib/api/client";
import { startRealtime, resubscribeConversations } from "./lib/realtime/events";
import { ServerRail } from "./features/servers/ServerRail";
import { Dashboard } from "./features/dashboard/Dashboard";
import { serverApi } from "./features/dashboard/api";
import { useServerRegistry } from "./features/servers/useServerRegistry";
import { AddServerDialog } from "./features/servers/AddServerDialog";
import { ModelPicker } from "./features/agents/ModelPicker";
import { ProviderConnect, hasPendingProviderOAuth } from "./features/providers/ProviderConnect";
import { ProviderCredentials } from "./features/providers/ProviderCredentials";
import type {
  Agent,
  Approval,
  Conversation,
  Message,
  Provider,
} from "./types";

type Bootstrap = {
  agents: Agent[];
  conversations: Conversation[];
  messages: Message[];
  providers: Provider[];
  approvals: Approval[];
  devices: DeviceInfo[];
  currentUser: AuthUser;
  users: UserAccount[];
};
type Panel = "details" | "settings" | null;
type Toast = { message: string; tone: "info" | "error" };
type AvatarStyle = "crew" | "blobatar" | "initials";
type View = "messages" | "inbox" | "activity";
type CreateAgentInput = Pick<Agent, "name" | "role" | "model" | "runtime"> & {
  providerId: string;
  memoryEnabled: boolean;
  workspace?: string;
  instructions?: string;
};
type Theme = "system" | "light" | "dark";
type MentionOption = {
  id: string;
  label: string;
  description: string;
  color: string;
  kind: "agent" | "everyone" | "here" | "role";
  agent?: Agent;
};

const AVATAR_STYLE_KEY = "crewly:avatar-style";
const THEME_KEY = "crewly:theme";
// Set when someone chooses to look around before connecting a provider, so a
// reload does not drop them back onto the setup screen they just dismissed.
const AVATAR_STYLES: readonly AvatarStyle[] = ["crew", "blobatar", "initials"];
const AvatarStyleContext = createContext<AvatarStyle>("crew");

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

// Open overlays, oldest first. Escape only ever dismisses the top one, so a
// modal opened from a panel does not close both at once.
const layers: { dismiss: () => void }[] = [];

function useLayer<T extends HTMLElement>(onDismiss: () => void, trap: boolean) {
  const ref = useRef<T>(null);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  // Captured during render: by the time effects run React has already honoured
  // any autoFocus inside the dialog, so the trigger would be lost.
  const restoreTo = useRef<HTMLElement | null>(null);
  if (restoreTo.current === null) {
    restoreTo.current = document.activeElement as HTMLElement | null;
  }
  // Set when this effect (re)runs, so the throwaway cleanup StrictMode performs
  // between the two mount passes does not yank focus back out of the dialog.
  const restoreCancelled = useRef(false);

  useEffect(() => {
    restoreCancelled.current = true;
    const layer = { dismiss: () => dismiss.current() };
    layers.push(layer);
    const focusable = () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
      ).filter((element) => element.offsetParent !== null);
    if (trap && !ref.current?.contains(document.activeElement)) {
      (focusable()[0] ?? ref.current)?.focus();
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (layers[layers.length - 1] !== layer) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        layer.dismiss();
        return;
      }
      if (!trap || event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const [first] = items;
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (
        event.shiftKey &&
        (active === first || !ref.current?.contains(active))
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      layers.splice(layers.indexOf(layer), 1);
      if (!trap) return;
      const trigger = restoreTo.current;
      restoreCancelled.current = false;
      // A microtask, not rAF: rAF is throttled to nothing in a hidden tab.
      queueMicrotask(() => {
        if (restoreCancelled.current) return;
        if (trigger && document.contains(trigger)) trigger.focus();
      });
    };
  }, [trap]);

  return ref;
}

const useDialog = (onClose: () => void) =>
  useLayer<HTMLDivElement>(onClose, true);

const isApple = /mac|iphone|ipad/i.test(navigator.userAgent);
const SEARCH_HINT = isApple ? "⌘ K" : "Ctrl K";

export default function App() {
  const registry = useServerRegistry();
  // Administering a server is its own screen rather than a panel beside a
  // conversation: suspending somebody is not a chat setting. It has its own
  // address, so it can be opened, linked and left with the back button.
  const [dashboardOpen, setDashboardOpen] = useState(
    () => window.location.pathname === "/admin",
  );
  const [addingServer, setAddingServer] = useState(false);
  // Which run the inspector shows: the run behind a message, or one picked from its tree.
  const [inspecting, setInspecting] = useState<{ messageId?: string; runId?: string } | null>(null);
  const [data, setData] = useState<Bootstrap | null>(null);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState("launch");
  const [view, setView] = useState<View>("messages");
  const [panel, setPanel] = useState<Panel>(() => new URLSearchParams(window.location.search).has("pair") ? "settings" : "details");
  const [composer, setComposer] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionSuppressed, setMentionSuppressed] = useState(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [replying, setReplying] = useState<Message | null>(null);
  const [creating, setCreating] = useState(false);
  const [profileAgentId, setProfileAgentId] = useState<string | null>(null);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const notify = useCallback(
    (message: string, tone: Toast["tone"] = "info") =>
      setToast({ message, tone }),
    [],
  );
  const [mobileNav, setMobileNav] = useState(false);
  const [approvalResults, setApprovalResults] = useState<
    Record<string, string>
  >({});
  // A saved choice always wins; the crew is the default for everyone else.
  const [avatarStyle, setAvatarStyle] = useState<AvatarStyle>(() => {
    const saved = localStorage.getItem(AVATAR_STYLE_KEY);
    return AVATAR_STYLES.find((style) => style === saved) ?? "crew";
  });
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  });
  // A provider sign-in navigates away and comes back with a code; only a
  // mounted ProviderConnect redeems it, so reopen one for the return trip.
  const [finishingProviderOAuth, setFinishingProviderOAuth] = useState(hasPendingProviderOAuth);
  // Stable, because ProviderConnect's redeeming effect depends on it and a
  // re-render mid-redemption would otherwise drop the result.
  const providerOAuthDone = useCallback(() => {
    setFinishingProviderOAuth(false);
    void gateway.bootstrap().then(setData);
    notify("Provider saved.");
  }, [notify]);
  const [firstDmFailed, setFirstDmFailed] = useState(false);
  const openingFirstDm = useRef(false);
  const messageListRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    let cancelled = false;
    let stopRealtime = () => {};
    void gateway.bootstrap().then((initial) => {
      if (cancelled) return;
      setData(initial);
      // Replay events after history loads so a reply arriving during bootstrap
      // cannot be discarded while data is still null.
      stopRealtime = startRealtime((message) => setData((current) => current && ({ ...current,
        messages: current.messages.some((m) => m.id === message.id) ? current.messages : [...current.messages, message] })),
        (error) => notify(error, 'error'),
        (presence) => setData((current) => {
          if (!current) return current;
          const known = current.devices.some((device) => device.id === presence.deviceId);
          // A device pairs and connects in the same breath, so a presence event
          // can name one this list has never seen. Reload rather than inventing
          // a row from the little the event carries.
          if (!known) { void gateway.bootstrap().then(setData).catch(() => {}); return current; }
          return { ...current, devices: current.devices.map((device) => device.id === presence.deviceId
            ? { ...device, connected: presence.connected,
                lastSeenAt: presence.connected ? new Date().toISOString() : device.lastSeenAt }
            : device) };
        }),
        (status) => setData((current) => current && ({ ...current,
          agents: current.agents.map((agent) => (agent.id === status.agentId ? withStatus(agent, status) : agent)) })));
    }).catch((error) => { if (!cancelled) setLoadError(String(error)); });
    return () => { cancelled = true; stopRealtime(); };
    // Switching servers reloads everything: agents, conversations and the
    // socket all belong to one server, and showing the previous server's
    // while connected to another would be a lie.
  }, [registry.epoch]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      const resolved = theme === "system" ? (media.matches ? "light" : "dark") : theme;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", resolved === "light" ? "#f6f6f8" : "#0b0b0c");
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    stickToBottomRef.current = true;
    setShowJumpToLatest(false);
  }, [selected]);
  useEffect(() => {
    const list = messageListRef.current;
    if (!list || view !== "messages" || !stickToBottomRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      list.scrollTop = list.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [data?.messages, selected, view, composer, replying]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        // Don't stack search on top of an open dialog.
        if (!layers.length) setSearching(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  // A link from a notification email (?conversation=<id>) opens that
  // conversation once it is known here, then leaves the address clean.
  useEffect(() => {
    if (!data) return;
    const url = new URL(window.location.href);
    const linked = url.searchParams.get("conversation");
    if (!linked) return;
    url.searchParams.delete("conversation");
    window.history.replaceState({}, "", url);
    if (data.conversations.some((item) => item.id === linked)) openConversation(linked);
    // Only on arrival: later changes to the data must not reopen it.
  }, [data !== null]);
  // Someone with agents but no conversation of their own — a member opening the
  // server for the first time, or an owner whose DMs were all cleared — used to
  // land on a page whose only content was a button. Open the DM for them.
  useEffect(() => {
    if (!data || data.conversations.length || !data.agents.length) return;
    if (openingFirstDm.current) return;
    openingFirstDm.current = true;
    const agents = data.agents;
    void gateway.createDm(agents[0].id, agents).then((dm) => {
      resubscribeConversations();
      setData((current) => current && ({ ...current, conversations: [...current.conversations, dm] }));
      setSelected(dm.id);
    }).catch((error) => {
      // Fall back to the creation screen rather than spinning forever.
      setFirstDmFailed(true);
      notify(String(error), "error");
    });
  }, [data, notify]);
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(
      () => setToast(null),
      toast.tone === "error" ? 5200 : 2800,
    );
    return () => window.clearTimeout(timeout);
  }, [toast]);

  if (!data) return loadError ? <div role="alert">{loadError}</div> : <Loading />;
  const pairingCode = new URLSearchParams(window.location.search).get("pair");
  if (pairingCode) return <PairingApproval code={pairingCode} onApproved={async () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("pair");
    window.history.replaceState({}, "", url);
    setData(await gateway.bootstrap());
    notify("Device paired. It can now connect securely.");
  }} />;
  if (finishingProviderOAuth) return <ProviderConnect onConnected={providerOAuthDone}
    onClose={() => setFinishingProviderOAuth(false)} />;
  // No provider is not a reason to hold the app: the server switcher, settings
  // and every other action have to stay reachable, and providers are managed
  // from Settings or the dashboard. The sidebar nudge keeps the gap visible.
  if (!data.conversations.length && panel !== "settings") {
    // A DM is on its way from the effect above; showing "create your first
    // agent" to someone who already has one would be a lie that flashes past.
    if (data.agents.length && !firstDmFailed) return <Loading />;
    // First run lands on the dialog that does the work. The card that used to
    // sit here said nothing the dialog does not, and the only way past it was a
    // button that opened the dialog anyway.
    return <div className="first-run">
      <header>
        <BrandMark />
        <button className="text-button" onClick={() => setPanel("settings")}>Settings</button>
        <button className="text-button" onClick={() => void gateway.logout()}>Log out</button>
      </header>
      <AgentEditor firstRun providers={data.providers} onClose={() => setPanel("settings")} onSubmit={async (input) => {
        const agent = await gateway.createAgent(input);
        const dm = await gateway.createDm(agent.id, [...data.agents, agent]); resubscribeConversations();
        setData((current) => current && ({ ...current, agents: [...current.agents, agent], conversations: [...current.conversations, dm] }));
        setSelected(dm.id);
      }} />
      {toast && <div className={`toast toast-${toast.tone}`} role={toast.tone === "error" ? "alert" : "status"}>{toast.message}</div>}
    </div>;
  }

  if (!data.conversations.length) return <div className="empty-settings-shell">
    <SettingsPanel
    providers={data.providers} devices={data.devices} agents={data.agents} currentUser={data.currentUser} users={data.users}
    avatarStyle={avatarStyle} onAvatarStyleChange={updateAvatarStyle} theme={theme} onThemeChange={updateTheme}
    onNotify={notify} onProvidersChanged={() => gateway.bootstrap().then(setData)}
    onUsersChanged={() => gateway.bootstrap().then(setData)} onDevicesChanged={() => gateway.bootstrap().then(setData)}
    onClose={() => setPanel(null)} />{toast && <div className={`toast toast-${toast.tone}`} role={toast.tone === "error" ? "alert" : "status"}>{toast.message}</div>}</div>;

  const conversation =
    data.conversations.find((item) => item.id === selected) ??
    data.conversations[0];
  const activeAgents = data.agents.filter((agent) =>
    conversation.agentIds.includes(agent.id),
  );
  const visibleMessages = data.messages.filter(
    (message) => message.conversationId === conversation.id,
  );
  const conversationApprovals = data.approvals.filter(
    (approval) => approval.conversationId === conversation.id,
  );
  const pendingApprovals = data.approvals.filter(
    (approval) => !approvalResults[approval.id],
  );
  const mentionMatch = composer.match(/(?:^|\s)@([^@\s]*)$/);
  const mentionQuery = mentionMatch?.[1]?.toLowerCase() ?? "";
  const roleMentions = Array.from(new Set(activeAgents.map((agent) => agent.role))).map(
    (role): MentionOption => ({
      id: `role-${role.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      label: `@${role}`,
      description: `Role · ${activeAgents.filter((agent) => agent.role === role).length} ${activeAgents.filter((agent) => agent.role === role).length === 1 ? "member" : "members"}`,
      color: "#8b7cf6",
      kind: "role",
    }),
  );
  const allMentionOptions: MentionOption[] = [
    {
      id: "everyone",
      label: "@everyone",
      description: "Notify everyone in this conversation",
      color: "#f05b3e",
      kind: "everyone",
    },
    {
      id: "here",
      label: "@here",
      description: "Notify agents currently online",
      color: "#3fb77a",
      kind: "here",
    },
    ...activeAgents.map((agent): MentionOption => ({
      id: `agent-${agent.id}`,
      label: `@${agent.name}`,
      description: agent.role,
      color: agent.color,
      kind: "agent",
      agent,
    })),
    ...roleMentions,
  ];
  const mentionOptions = allMentionOptions.filter((option) =>
    `${option.label} ${option.description}`.toLowerCase().includes(mentionQuery),
  );
  const showMentions = Boolean(
    mentionMatch && mentionOptions.length && !mentionSuppressed,
  );
  const inboxCount =
    pendingApprovals.length +
    data.conversations.filter((item) => item.unread).length;

  async function send() {
    const value = composer.trim();
    if (!value || sending) return;
    stickToBottomRef.current = true;
    setShowJumpToLatest(false);
    composerRef.current?.replaceChildren();
    setComposer("");
    setReplying(null);
    setSending(true);
    try {
      const sent = await gateway.sendMessage(conversation.id, value, replying?.id);
      setData((current) => current && { ...current,
        messages: current.messages.some((m) => m.id === sent.id) ? current.messages : [...current.messages, sent] });
    } catch {
      notify(
        "Message could not be delivered. Your draft was restored.",
        "error",
      );
      setComposer(value);
      requestAnimationFrame(() => {
        if (composerRef.current && !composerRef.current.innerText.trim()) {
          composerRef.current.textContent = value;
        }
      });
    } finally {
      setSending(false);
    }
  }

  function readComposer(editor: HTMLDivElement) {
    return editor.innerText.replace(/\u00a0/g, " ").replace(/\n{3,}/g, "\n\n");
  }

  function jumpToLatest() {
    const list = messageListRef.current;
    if (!list) return;
    stickToBottomRef.current = true;
    setShowJumpToLatest(false);
    list.scrollTop = list.scrollHeight;
  }

  function moveCaretAfter(node: Node) {
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    if (node instanceof Text) {
      range.setStart(node, node.data.length);
    } else {
      range.setStartAfter(node);
    }
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function insertMention(option: MentionOption) {
    const editor = composerRef.current;
    if (!editor) return;
    editor.focus();
    const selection = window.getSelection();
    let range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (!range || !editor.contains(range.startContainer)) {
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    if (range.startContainer.nodeType === Node.TEXT_NODE) {
      const node = range.startContainer as Text;
      const beforeCaret = node.data.slice(0, range.startOffset);
      const query = beforeCaret.match(/@([^@\s]*)$/);
      if (query) {
        range.setStart(node, range.startOffset - query[0].length);
        range.deleteContents();
      }
    }
    const token = document.createElement("span");
    token.className = `mention-token mention-token-${option.kind}`;
    token.contentEditable = "false";
    token.dataset.mentionLabel = option.label;
    token.dataset.mentionKind = option.kind;
    token.style.setProperty("--mention-color", option.color);
    token.textContent = option.label;
    range.insertNode(token);
    const spacer = document.createTextNode(" ");
    token.after(spacer);
    moveCaretAfter(spacer);
    setComposer(readComposer(editor));
    setMentionIndex(0);
    setMentionSuppressed(false);
  }

  function startMention() {
    const editor = composerRef.current;
    if (!editor) return;
    editor.focus();
    if (/(?:^|\s)@([^@\s]*)$/.test(readComposer(editor))) {
      setMentionSuppressed(false);
      return;
    }
    const selection = window.getSelection();
    let range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (!range || !editor.contains(range.startContainer)) {
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    range.deleteContents();
    const current = readComposer(editor);
    const text = document.createTextNode(current && !/\s$/.test(current) ? " @" : "@");
    range.insertNode(text);
    moveCaretAfter(text);
    setComposer(readComposer(editor));
    setMentionIndex(0);
    setMentionSuppressed(false);
  }

  function deleteMentionBeforeCaret(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Backspace") return false;
    const editor = composerRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount || !selection.isCollapsed) return false;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer)) return false;
    let token: HTMLElement | null = null;
    let caretNode: Node = range.startContainer;
    let caretOffset = range.startOffset;
    if (range.startContainer.nodeType === Node.TEXT_NODE) {
      const text = range.startContainer as Text;
      const beforeCaret = text.data.slice(0, range.startOffset);
      const previous = text.previousSibling;
      if (/^\s*$/.test(beforeCaret) && previous instanceof HTMLElement && previous.matches(".mention-token")) {
        token = previous;
        text.data = text.data.slice(range.startOffset);
        caretOffset = 0;
      } else if (range.startOffset === 0 && previous instanceof HTMLElement && previous.matches(".mention-token")) {
        token = previous;
      }
    } else if (range.startContainer instanceof HTMLElement && range.startOffset > 0) {
      const previous = range.startContainer.childNodes[range.startOffset - 1];
      if (previous instanceof HTMLElement && previous.matches(".mention-token")) {
        token = previous;
        caretOffset = range.startOffset - 1;
      } else if (
        previous instanceof Text &&
        /^\s*$/.test(previous.data) &&
        previous.previousSibling instanceof HTMLElement &&
        previous.previousSibling.matches(".mention-token")
      ) {
        token = previous.previousSibling;
        previous.remove();
        caretOffset = range.startOffset - 2;
      }
    }
    if (!token) return false;
    event.preventDefault();
    token.remove();
    const nextRange = document.createRange();
    const maximumOffset =
      caretNode.nodeType === Node.TEXT_NODE
        ? (caretNode as Text).data.length
        : caretNode.childNodes.length;
    nextRange.setStart(caretNode, Math.min(caretOffset, maximumOffset));
    nextRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(nextRange);
    setComposer(readComposer(editor));
    setMentionIndex(0);
    setMentionSuppressed(false);
    return true;
  }

  async function decide(
    approval: Approval,
    decision: "once" | "always" | "deny",
  ) {
    await gateway.approve(approval.id, decision);
    setApprovalResults((current) => ({ ...current, [approval.id]: decision }));
  }

  async function dismissApproval(approval: Approval) {
    await gateway.dismissApproval(approval.id);
    setData(
      (current) =>
        current && {
          ...current,
          approvals: current.approvals.filter(
            (item) => item.id !== approval.id,
          ),
        },
    );
    setApprovalResults((current) => {
      const next = { ...current };
      delete next[approval.id];
      return next;
    });
  }

  function updateAvatarStyle(style: AvatarStyle) {
    localStorage.setItem(AVATAR_STYLE_KEY, style);
    setAvatarStyle(style);
  }

  function updateTheme(nextTheme: Theme) {
    localStorage.setItem(THEME_KEY, nextTheme);
    setTheme(nextTheme);
  }

  async function updateAgent(id: string, updates: Partial<Agent>) {
    const updated = await gateway.updateAgent(id, updates);
    setData(
      (current) =>
        current && {
          ...current,
          agents: current.agents.map((agent) =>
            agent.id === id ? updated : agent,
          ),
          conversations: current.conversations.map((item) =>
            item.type === "dm" && item.agentIds[0] === id
              ? { ...item, name: updated.name }
              : item,
          ),
        },
    );
    return updated;
  }

  function openConversation(id: string) {
    setSelected(id);
    setView("messages");
    setMobileNav(false);
  }

  function openAgentProfile(id: string) {
    setProfileAgentId(id);
    setMobileNav(false);
  }

  async function openAgentConversation(id: string) {
    if (!data) return;
    try {
      const direct = data.conversations.find((item) => item.type === 'dm' && item.agentIds[0] === id);
      const dm = direct ?? await gateway.createDm(id, data.agents);
      if (!direct) {
        resubscribeConversations();
        setData((current) => current && ({ ...current, conversations: [...current.conversations, dm] }));
      }
      openConversation(dm.id);
      setProfileAgentId(null); setPanel(null);
    } catch (error) { notify(String(error), 'error'); }
  }

  return (
    <AvatarStyleContext.Provider value={avatarStyle}>
      <div className={`app-shell ${panel ? "panel-open" : ""} ${registry.multiServer && registry.servers.length > 0 ? "has-rail" : ""}`}>
        {registry.multiServer && registry.servers.length > 0 && (
          <ServerRail
            servers={registry.servers}
            selectedId={registry.selected?.id ?? null}
            onSelect={registry.select}
            onAddServer={() => setAddingServer(true)}
            dashboardUrl={import.meta.env.VITE_CREWLY_DASHBOARD_URL}
            unread={registry.unread}
            failures={registry.failures}
          />
        )}
        {addingServer && (
          <AddServerDialog
            onClose={() => setAddingServer(false)}
            onAdded={() => { setAddingServer(false); void registry.refresh(); }}
          />
        )}
        <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
          <div className="brand">
            <BrandMark />
            <span>Crewly</span>
            <button
              className="icon-button compact mobile-only"
              onClick={() => setMobileNav(false)}
              aria-label="Close navigation"
            >
              <X size={18} />
            </button>
          </div>
          <button
            className="search"
            onClick={() => setSearching(true)}
            aria-keyshortcuts={isApple ? "Meta+K" : "Control+K"}
          >
            <Search size={15} />
            <span>Search</span>
            <kbd>{SEARCH_HINT}</kbd>
          </button>
          <nav className="primary-nav">
            <button
              className={view === "inbox" ? "active" : ""}
              aria-current={view === "inbox" ? "page" : undefined}
              onClick={() => {
                setView("inbox");
                setPanel(null);
                setMobileNav(false);
              }}
            >
              <Inbox size={17} />
              <span>Inbox</span>
              {inboxCount > 0 && (
                <small aria-label={`${inboxCount} needing attention`}>
                  {inboxCount}
                </small>
              )}
            </button>
            <button
              className={view === "messages" ? "active" : ""}
              aria-current={view === "messages" ? "page" : undefined}
              onClick={() => {
                setView("messages");
                setMobileNav(false);
              }}
            >
              <MessageCircle size={17} />
              <span>Messages</span>
            </button>
            <button
              className={view === "activity" ? "active" : ""}
              aria-current={view === "activity" ? "page" : undefined}
              onClick={() => {
                setView("activity");
                setPanel(null);
                setMobileNav(false);
              }}
            >
              <Activity size={17} />
              <span>Activity</span>
            </button>
          </nav>
          <SidebarSection
            title="Direct messages"
            action={() => setCreating(true)}
          >
            {data.conversations
              .filter((item) => item.type === "dm")
              .map((item) => (
                <ConversationRow
                  key={item.id}
                  item={item}
                  agents={data.agents}
                  active={view === "messages" && selected === item.id}
                  onClick={() => openConversation(item.id)}
                />
              ))}
          </SidebarSection>
          <SidebarSection title="Groups">
            {data.conversations
              .filter((item) => item.type === "group")
              .map((item) => (
                <ConversationRow
                  key={item.id}
                  item={item}
                  agents={data.agents}
                  active={view === "messages" && selected === item.id}
                  onClick={() => openConversation(item.id)}
                />
              ))}
          </SidebarSection>
          <div className="sidebar-footer">
            {/* Provider setup never blocks the app, so the consequence has to stay
                visible: without one, every agent reply fails at send time. */}
            {!data.providers.length && (
              <div className="provider-nudge" role="status">
                <strong>No model provider</strong>
                <span>Agents can&rsquo;t reply until you connect one.</span>
                <button
                  onClick={() => {
                    setPanel("settings");
                    setMobileNav(false);
                  }}
                >
                  Connect a provider
                </button>
              </div>
            )}
            <button onClick={() => setCreating(true)}>
              <Plus size={17} />
              <span>New agent</span>
            </button>
            {(data.currentUser.role === "owner" || data.currentUser.role === "admin") && (
              <button
                onClick={() => {
                  setDashboardOpen(true);
                  setMobileNav(false);
                  history.pushState(null, "", "/admin");
                }}
              >
                <Gauge size={17} />
                <span>Server admin</span>
              </button>
            )}
            <button
              onClick={() => {
                setPanel("settings");
                setMobileNav(false);
              }}
            >
              <Settings size={17} />
              <span>Settings</span>
              <i
                className={
                  data.devices.some((device) => device.connected) ? "device-dot online" : "device-dot"
                }
              />
            </button>
          </div>
        </aside>
        {mobileNav && <Scrim onClose={() => setMobileNav(false)} />}

        {dashboardOpen && (
          <div className="dashboard-layer">
            <Dashboard
              api={serverApi}
              currentUser={{
                id: data.currentUser.id,
                email: data.currentUser.email,
                displayName: data.currentUser.email,
                role: data.currentUser.role as "owner" | "admin" | "member",
                createdAt: new Date().toISOString(),
              }}
              serverName={registry.selected?.name ?? "This server"}
              onClose={() => {
                setDashboardOpen(false);
                history.pushState(null, "", "/");
              }}
            />
          </div>
        )}

        {inspecting && (
          <div className="dashboard-layer">
            <RunInspector
              key={inspecting.runId ?? inspecting.messageId}
              load={() => (inspecting.runId ? client.runs.get(inspecting.runId) : client.runs.forMessage(inspecting.messageId!))}
              onClose={() => setInspecting(null)}
              onOpenRun={(runId) => setInspecting({ runId })}
              onCancel={async (runId) => { await client.runs.cancel(runId); }}
            />
          </div>
        )}

        <main className="conversation">
          <header className="conversation-header">
            <button
              className="icon-button compact mobile-only"
              onClick={() => setMobileNav(true)}
              aria-label="Open navigation"
            >
              <Menu size={20} />
            </button>
            <div className="conversation-title">
              {view === "inbox" ? (
                <Inbox size={18} />
              ) : view === "activity" ? (
                <Activity size={18} />
              ) : conversation.type === "group" ? (
                <Hash size={18} />
              ) : (
                <button
                  className="avatar-button"
                  onClick={() => activeAgents[0] && openAgentProfile(activeAgents[0].id)}
                  aria-label={`Open ${activeAgents[0]?.name ?? "agent"} profile`}
                >
                  <Avatar agent={activeAgents[0]} size="small" />
                </button>
              )}
              <div>
                <strong>
                  {view === "inbox"
                    ? "Inbox"
                    : view === "activity"
                      ? "Runtime activity"
                      : conversation.name}
                </strong>
                <span>
                  {view === "inbox"
                    ? "Mentions and requests that need you"
                    : view === "activity"
                      ? "Live work across your crew"
                      : conversation.type === "group"
                        ? `${activeAgents.length} agents · you`
                        : activeAgents[0]?.role}
                </span>
              </div>
            </div>
            <div className="header-actions">
              <button
                className="icon-button compact"
                onClick={() => setSearching(true)}
                aria-label="Search"
              >
                <Search size={18} />
              </button>
              {view === "messages" && (
                <>
                  <button
                    className={`icon-button compact ${panel === "details" ? "selected" : ""}`}
                    onClick={() =>
                      setPanel(panel === "details" ? null : "details")
                    }
                    aria-expanded={panel === "details"}
                    aria-label="Conversation details"
                  >
                    <PanelRight size={18} />
                  </button>
                  <button
                    className="icon-button compact"
                    onClick={() =>
                      notify("More conversation actions are coming soon.")
                    }
                    aria-label="More actions"
                  >
                    <MoreHorizontal size={19} />
                  </button>
                </>
              )}
            </div>
          </header>

          {view === "messages" ? (
            <>
              <section
                className="message-list"
                ref={messageListRef}
                onScroll={(event) => {
                  const list = event.currentTarget;
                  const nearBottom =
                    list.scrollHeight - list.scrollTop - list.clientHeight < 96;
                  stickToBottomRef.current = nearBottom;
                  setShowJumpToLatest(!nearBottom);
                }}
              >
                <div className="conversation-intro">
                  <div className="stacked-avatars">
                    {activeAgents.map((agent) => (
                      <button
                        className="avatar-button"
                        key={agent.id}
                        onClick={() => openAgentProfile(agent.id)}
                        aria-label={`Open ${agent.name}'s profile`}
                      >
                        <Avatar agent={agent} />
                      </button>
                    ))}
                  </div>
                  <h1>
                    {conversation.type === "group"
                      ? `# ${conversation.name}`
                      : conversation.name}
                  </h1>
                  <p>
                    {conversation.type === "group"
                      ? "A shared room for you and your crew. Mention an agent when you want their attention."
                      : `This is the beginning of your conversation with ${conversation.name}.`}
                  </p>
                </div>
                <div className="date-divider">
                  <span>Today</span>
                </div>
                {visibleMessages.map((message) => (
                  <MessageItem
                    key={message.id}
                    message={message}
                    agents={data.agents}
                    allMessages={visibleMessages}
                    onReply={() => setReplying(message)}
                    onAgentClick={openAgentProfile}
                    onInspect={() => setInspecting({ messageId: message.id })}
                  />
                ))}
                {conversationApprovals.map((approval) => {
                  const agent = data.agents.find(
                    (item) => item.id === approval.agentId,
                  );
                  return agent ? (
                    <ApprovalMessage
                      key={approval.id}
                      approval={approval}
                      agent={agent}
                      result={approvalResults[approval.id]}
                      onAgentClick={openAgentProfile}
                      onDecide={(decision) => decide(approval, decision)}
                      onDismiss={() => dismissApproval(approval)}
                    />
                  ) : null;
                })}
              </section>

              <footer className="composer-wrap">
                {showJumpToLatest && (
                  <button
                    type="button"
                    className="jump-to-latest"
                    onClick={jumpToLatest}
                  >
                    <ChevronDown size={15} />
                    Jump to latest
                  </button>
                )}
                {replying && (
                  <div className="reply-banner">
                    <Reply size={14} />
                    <span>
                      Replying to{" "}
                      <strong>
                        {authorName(replying.author, data.agents)}
                      </strong>
                    </span>
                    <button onClick={() => setReplying(null)}>
                      <X size={14} />
                    </button>
                  </div>
                )}
                <div className="composer">
                  <div
                    ref={composerRef}
                    className="composer-editor"
                    contentEditable={!sending}
                    suppressContentEditableWarning
                    onInput={(event) => {
                      setComposer(readComposer(event.currentTarget));
                      setMentionIndex(0);
                      setMentionSuppressed(false);
                    }}
                    onKeyDown={(event) => {
                      if (deleteMentionBeforeCaret(event)) return;
                      if (showMentions && event.key === "ArrowDown") {
                        event.preventDefault();
                        setMentionIndex((index) => (index + 1) % mentionOptions.length);
                        return;
                      }
                      if (showMentions && event.key === "ArrowUp") {
                        event.preventDefault();
                        setMentionIndex((index) =>
                          (index - 1 + mentionOptions.length) % mentionOptions.length,
                        );
                        return;
                      }
                      if (showMentions && (event.key === "Enter" || event.key === "Tab")) {
                        event.preventDefault();
                        insertMention(mentionOptions[mentionIndex]);
                        return;
                      }
                      if (showMentions && event.key === "Escape") {
                        event.preventDefault();
                        setMentionSuppressed(true);
                        return;
                      }
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void send();
                      }
                    }}
                    onPaste={(event) => {
                      event.preventDefault();
                      const text = event.clipboardData.getData("text/plain");
                      const selection = window.getSelection();
                      if (!selection?.rangeCount) return;
                      const range = selection.getRangeAt(0);
                      range.deleteContents();
                      const node = document.createTextNode(text);
                      range.insertNode(node);
                      moveCaretAfter(node);
                      setComposer(readComposer(event.currentTarget));
                    }}
                    data-placeholder={`Message ${conversation.type === "group" ? "#" : ""}${conversation.name}`}
                    aria-expanded={showMentions}
                    aria-controls={showMentions ? "mention-suggestions" : undefined}
                    aria-autocomplete="list"
                    role="combobox"
                    aria-activedescendant={
                      showMentions
                        ? `mention-option-${mentionOptions[mentionIndex]?.id}`
                        : undefined
                    }
                    aria-label={`Message ${conversation.name}`}
                    aria-multiline="true"
                  />
                  {showMentions && (
                    <div className="mention-menu" id="mention-suggestions" role="listbox" aria-label="Mention people and roles">
                      <span>Mentions</span>
                      {mentionOptions.map((option, index) => (
                        <button
                          type="button"
                          role="option"
                          id={`mention-option-${option.id}`}
                          aria-selected={index === mentionIndex}
                          className={index === mentionIndex ? "active" : ""}
                          key={option.id}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => insertMention(option)}
                        >
                          {option.agent ? (
                            <Avatar agent={option.agent} size="small" />
                          ) : (
                            <span
                              className={`mention-symbol mention-symbol-${option.kind}`}
                              style={{ "--mention-color": option.color } as React.CSSProperties}
                            >
                              {option.kind === "role" ? <UserRound size={15} /> : <AtSign size={15} />}
                            </span>
                          )}
                          <span><strong>{option.label}</strong><small>{option.description}</small></span>
                          <kbd>Enter</kbd>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="composer-tools">
                    <div>
                      <button
                        onClick={() =>
                          notify("Attachments are coming in the next preview.")
                        }
                        aria-label="Add attachment"
                      >
                        <Plus size={18} />
                      </button>
                      <button
                        onClick={() =>
                          notify("File uploads are coming in the next preview.")
                        }
                        aria-label="Attach file"
                      >
                        <Paperclip size={17} />
                      </button>
                      <button
                        onClick={startMention}
                        aria-label="Mention people or roles"
                      >
                        <AtSign size={17} />
                      </button>
                    </div>
                    <span>Shift + Enter for new line</span>
                    <button
                      className="send"
                      disabled={!composer.trim() || sending}
                      onClick={() => void send()}
                      aria-label="Send message"
                    >
                      {sending ? (
                        <span className="spinner" />
                      ) : (
                        <Send size={16} />
                      )}
                    </button>
                  </div>
                </div>
              </footer>
            </>
          ) : (
            <UtilityView
              view={view}
              approvals={pendingApprovals}
              agents={data.agents}
              conversations={data.conversations}
              onOpenConversation={openConversation}
            />
          )}
        </main>

        {panel === "details" && (
          <DetailsPanel
            conversation={conversation}
            agents={activeAgents}
            onClose={() => setPanel(null)}
            onNotify={notify}
            onAgentClick={openAgentProfile}
            onUpdateAgent={updateAgent}
          />
        )}
        {panel === "settings" && (
          <SettingsPanel
            providers={data.providers}
            devices={data.devices}
            agents={data.agents}
            currentUser={data.currentUser}
            users={data.users}
            avatarStyle={avatarStyle}
            onAvatarStyleChange={updateAvatarStyle}
            theme={theme}
            onThemeChange={updateTheme}
            onNotify={notify}
            onProvidersChanged={() => gateway.bootstrap().then(setData)}
            onUsersChanged={() => gateway.bootstrap().then(setData)}
            onDevicesChanged={() => gateway.bootstrap().then(setData)}
            onClose={() => setPanel(null)}
          />
        )}
        {creating && (
          <AgentEditor
            onClose={() => setCreating(false)}
            providers={data.providers}
            onSubmit={async (input) => {
              const created = await gateway.createAgent(input);
              const dm = await gateway.createDm(created.id, [...data.agents, created]);
              resubscribeConversations();
              setData((current) => current && ({ ...current,
                agents: [...current.agents, created], conversations: [...current.conversations, dm] }));
              setSelected(dm.id); setView('messages'); setCreating(false);
              notify(`${created.name} joined your crew.`);
            }}
          />
        )}
        {profileAgentId && !editingAgentId && (
          <AgentProfileDialog
            agent={data.agents.find((agent) => agent.id === profileAgentId)!}
            onClose={() => setProfileAgentId(null)}
            onEdit={() => setEditingAgentId(profileAgentId)}
            onMessage={() => openAgentConversation(profileAgentId)}
          />
        )}
        {editingAgentId && (
          <AgentEditor
            agent={data.agents.find((agent) => agent.id === editingAgentId)}
            onClose={() => setEditingAgentId(null)}
            providers={data.providers}
            onSubmit={async (updates) => {
              const updated = await updateAgent(editingAgentId, updates);
              setEditingAgentId(null);
              setProfileAgentId(updated.id);
              notify(`${updated.name}'s profile was updated.`);
            }}
          />
        )}
        {searching && (
          <SearchDialog
            agents={data.agents}
            conversations={data.conversations}
            messages={data.messages}
            onClose={() => setSearching(false)}
            onSelect={(id) => {
              openConversation(id);
              setSearching(false);
            }}
          />
        )}
        {toast && (
          <div
            className={`toast toast-${toast.tone}`}
            role={toast.tone === "error" ? "alert" : "status"}
          >
            {toast.tone === "error" ? (
              <AlertTriangle size={15} />
            ) : (
              <Check size={15} />
            )}{" "}
            {toast.message}
          </div>
        )}
      </div>
    </AvatarStyleContext.Provider>
  );
}

function MessageItem({
  message,
  agents,
  allMessages,
  onReply,
  onAgentClick,
  onInspect,
}: {
  message: Message;
  agents: Agent[];
  allMessages: Message[];
  onReply: () => void;
  onAgentClick: (agentId: string) => void;
  onInspect?: () => void;
}) {
  const agent = agents.find((item) => item.id === message.author);
  const replied = allMessages.find((item) => item.id === message.replyTo);
  return (
    <article className={`message ${message.streaming ? "streaming" : ""}`}>
      {message.author === "you" ? (
        <div className="avatar user-avatar">Y</div>
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
            <strong>You</strong>
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

function ApprovalMessage({
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

function DetailsPanel({
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
          {conversation.type === "group" ? "Conversation" : "Agent"} details
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

function PairingApproval({ code, onApproved }: { code: string; onApproved: () => Promise<void> }) {
  const [pairing, setPairing] = useState<DevicePairingInfo | null>(null);
  const [error, setError] = useState("");
  const [approving, setApproving] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void gateway.findDevicePairing(code).then((result) => {
      if (!cancelled) setPairing(result);
    }).catch(() => {
      if (!cancelled) setError("This pairing code is invalid or has expired.");
    });
    return () => { cancelled = true; };
  }, [code]);
  return <div className="onboarding"><div className="onboarding-body"><div className="onboarding-card pairing-card">
    <div className="device-illustration"><Laptop size={24} /></div>
    <h1>Pair this device?</h1>
    {error ? <p role="alert">{error}</p> : !pairing ? <p>Checking pairing code…</p> : <>
      <p><strong>{pairing.deviceName}</strong> wants to connect to this Crewly server.</p>
      <p className="muted-copy">{pairing.platform ?? "Unknown platform"} · Code {code.toUpperCase()}</p>
      <div className="security-note"><LockKeyhole size={15} /><span>Only approve a device you recognize. Its private key never leaves that computer.</span></div>
      <div className="pairing-actions">
        <button className="primary-button" disabled={approving} onClick={async () => {
          setApproving(true); setError("");
          try { await gateway.approveDevicePairing(code); await onApproved(); }
          catch { setError("Could not approve this device. Request a new pairing code and try again."); setApproving(false); }
        }}>{approving ? "Approving…" : "Approve device"}</button>
        {/* A screen that asks you to recognise a device has to let you say no.
            Closing the tab was the only refusal available. */}
        <button className="secondary-button" disabled={approving} onClick={() => {
          window.history.replaceState(null, "", window.location.pathname);
          window.location.reload();
        }}>Not this device</button>
      </div>
    </>}
  </div></div></div>;

}

function SettingsPanel({
  providers,
  devices,
  agents,
  currentUser,
  users,
  avatarStyle,
  onAvatarStyleChange,
  theme,
  onThemeChange,
  onNotify,
  onProvidersChanged,
  onUsersChanged,
  onDevicesChanged,
  onClose,
}: {
  providers: Provider[];
  devices: DeviceInfo[];
  agents: Agent[];
  currentUser: AuthUser;
  users: UserAccount[];
  avatarStyle: AvatarStyle;
  onAvatarStyleChange: (style: AvatarStyle) => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  onNotify: (message: string) => void;
  onProvidersChanged: () => Promise<void>;
  onUsersChanged: () => Promise<void>;
  onDevicesChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [section, setSection] = useState<
    "providers" | "members" | "devices" | "appearance"
  >("providers");
  const [addingProvider, setAddingProvider] = useState(false);
  const [managingProvider, setManagingProvider] = useState<Provider | null>(null);
  const [addingUser, setAddingUser] = useState(false);
  const [pairingCode, setPairingCode] = useState("");
  const [pairing, setPairing] = useState<DevicePairingInfo | null>(null);
  const [pairingError, setPairingError] = useState("");
  const [pairingBusy, setPairingBusy] = useState(false);
  const canManageServer = currentUser.role === 'owner' || currentUser.role === 'admin';
  return (
    <aside className="detail-panel settings-panel">
      <header>
        <strong>Settings</strong>
        <button
          className="icon-button compact"
          onClick={onClose}
          aria-label="Close settings"
        >
          <X size={18} />
        </button>
      </header>
      <div className="settings-nav">
        <button
          className={section === "providers" ? "active" : ""}
          onClick={() => setSection("providers")}
        >
          <Cpu size={16} /> Providers
        </button>
        {canManageServer && <button
            className={section === "members" ? "active" : ""}
            onClick={() => setSection("members")}
          >
            <UserRound size={16} /> People
          </button>}
        <button
          className={section === "devices" ? "active" : ""}
          onClick={() => setSection("devices")}
        >
          <Laptop size={16} /> Devices
        </button>
        <button
          className={section === "appearance" ? "active" : ""}
          onClick={() => setSection("appearance")}
        >
          <Palette size={16} /> Appearance
        </button>
      </div>
      <div className="settings-content">
        {section === "providers" ? (
          <>
            <div className="section-heading">
              <div>
                <h3>Model providers</h3>
                <p>Models your agents can use.</p>
              </div>
              {canManageServer && <button onClick={() => setAddingProvider(true)}>
                <Plus size={15} /> Add
              </button>}
            </div>
            {providers.map((provider) => (
              <div className="setting-row" key={provider.id}>
                <ProviderLogo provider={provider.name} small />
                <div>
                  <strong>{provider.name}</strong>
                  <span>{provider.detail}</span>
                </div>
                {!canManageServer ? <span className="connected-label"><Check size={13} /> Ready</span> : provider.status === "available" ? (
                  <button
                    className="use-button"
                    onClick={() =>
                      onNotify(`${provider.name} is ready to use.`)
                    }
                  >
                    Use
                  </button>
                ) : <button className="use-button" onClick={() => setManagingProvider(provider)}>Manage</button>}
              </div>
            ))}
            <div className="local-note">
              <LockKeyhole size={15} />
              <span>Provider credentials are stored on the Crewly server.</span>
            </div>
          </>
        ) : section === "members" ? (
          <>
            <div className="section-heading">
              <div>
                <h3>People</h3>
                <p>People who can sign in to this server.</p>
              </div>
              <button onClick={() => setAddingUser(true)}>
                <Plus size={15} /> Add
              </button>
            </div>
            {users.map((user) => (
              <div className="setting-row" key={user.id}>
                <span className="provider-logo small"><UserRound size={16} /></span>
                <div>
                  <strong>{user.displayName}</strong>
                  <span>{user.email}</span>
                </div>
                <span className="device-status-chip">{user.role}</span>
              </div>
            ))}
            <div className="security-note">
              <LockKeyhole size={15} />
              <span>Share the temporary password through a secure channel.</span>
            </div>
          </>
        ) : section === "devices" ? (
          <>
            <div className="section-heading">
              <div>
                <h3>Connected devices</h3>
                <p>Computers that can run local agents.</p>
              </div>
            </div>
            <div className="pairing-form">
              <label htmlFor="device-pairing-code">Pairing code</label>
              <div>
                <input id="device-pairing-code" value={pairingCode} placeholder="A1B2C3D4" autoComplete="off" autoCapitalize="characters" spellCheck={false}
                  onChange={(event) => { setPairingCode(event.target.value.toUpperCase()); setPairing(null); setPairingError(""); }} />
                <button disabled={pairingBusy || !pairingCode.trim()} onClick={async () => {
                  setPairingBusy(true); setPairingError("");
                  try { setPairing(await gateway.findDevicePairing(pairingCode)); }
                  catch { setPairingError("That pairing code is invalid or expired."); }
                  finally { setPairingBusy(false); }
                }}>{pairingBusy ? "Checking…" : "Continue"}</button>
              </div>
              {pairingError && <p role="alert">{pairingError}</p>}
              {pairing && <div className="pairing-review">
                <div><strong>{pairing.deviceName}</strong><span>{pairing.platform ?? "Unknown platform"}</span></div>
                <button disabled={pairingBusy} onClick={async () => {
                  setPairingBusy(true); setPairingError("");
                  try {
                    await gateway.approveDevicePairing(pairingCode);
                    await onDevicesChanged();
                    setPairing(null); setPairingCode("");
                    onNotify("Device paired. It can now connect securely.");
                  } catch { setPairingError("Could not approve this device. Request a new pairing code."); }
                  finally { setPairingBusy(false); }
                }}>Approve device</button>
              </div>}
            </div>
            {devices.length ? devices.map((device) => (
              <div className="device-card" key={device.id}>
                <div className="device-illustration"><Laptop size={23} /></div>
                <div>
                  <strong>{device.name}</strong>
                  <span>{device.platform ?? "Unknown platform"}</span>
                  <small><i className={`device-dot ${device.connected ? "online" : ""}`} /> {device.connected
                    ? "Connected now"
                    : device.lastSeenAt ? `Last seen ${new Date(device.lastSeenAt).toLocaleString()}` : "Not connected yet"}</small>
                </div>
                <span className="device-status-chip">{device.connected ? "Connected" : "Trusted"}</span>
              </div>
            )) : (
              <div className="empty-state">
                <Laptop size={24} />
                <strong>No trusted devices yet</strong>
                <p>Run <code>crewly connect {window.location.origin}</code> on a computer, then enter its code above.</p>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="section-heading">
              <div>
                <h3>Appearance</h3>
                <p>Make Crewly comfortable in your environment.</p>
              </div>
            </div>
            <fieldset className="theme-options">
              <legend>Color theme</legend>
              {([
                ["system", Monitor, "System"],
                ["light", Sun, "Light"],
                ["dark", Moon, "Dark"],
              ] as const).map(([value, Icon, label]) => (
                <label className={theme === value ? "selected" : ""} key={value}>
                  <input
                    type="radio"
                    name="color-theme"
                    value={value}
                    checked={theme === value}
                    onChange={() => onThemeChange(value)}
                  />
                  <Icon size={17} />
                  <span>{label}</span>
                  <i>{theme === value && <Check size={13} />}</i>
                </label>
              ))}
            </fieldset>
            <div className="preference-divider" />
            <div className="preference-heading">
              <strong>Agent avatars</strong>
              <span>Choose how your crew appears.</span>
            </div>
            <fieldset className="avatar-options">
              <legend>Avatar style</legend>
              <label className={avatarStyle === "crew" ? "selected" : ""}>
                <input
                  type="radio"
                  name="avatar-style"
                  value="crew"
                  checked={avatarStyle === "crew"}
                  onChange={() => onAvatarStyleChange("crew")}
                />
                <span className="avatar-option-preview">
                  {agents.slice(0, 3).map((agent) => (
                    <Avatar key={agent.id} agent={agent} style="crew" />
                  ))}
                </span>
                <span>
                  <strong>Crew</strong>
                  <small>
                    Black characters with a red outline, one face per agent
                    name.
                  </small>
                </span>
                <i>{avatarStyle === "crew" && <Check size={13} />}</i>
              </label>
              <label className={avatarStyle === "blobatar" ? "selected" : ""}>
                <input
                  type="radio"
                  name="avatar-style"
                  value="blobatar"
                  checked={avatarStyle === "blobatar"}
                  onChange={() => onAvatarStyleChange("blobatar")}
                />
                <span className="avatar-option-preview">
                  {agents.slice(0, 3).map((agent) => (
                    <Avatar key={agent.id} agent={agent} style="blobatar" />
                  ))}
                </span>
                <span>
                  <strong>Blobatar</strong>
                  <small>
                    Unique geometric faces generated from each agent's name.
                  </small>
                </span>
                <i>{avatarStyle === "blobatar" && <Check size={13} />}</i>
              </label>
              <label className={avatarStyle === "initials" ? "selected" : ""}>
                <input
                  type="radio"
                  name="avatar-style"
                  value="initials"
                  checked={avatarStyle === "initials"}
                  onChange={() => onAvatarStyleChange("initials")}
                />
                <span className="avatar-option-preview">
                  {agents.slice(0, 3).map((agent) => (
                    <Avatar key={agent.id} agent={agent} style="initials" />
                  ))}
                </span>
                <span>
                  <strong>Initials</strong>
                  <small>The classic colored initials used previously.</small>
                </span>
                <i>{avatarStyle === "initials" && <Check size={13} />}</i>
              </label>
            </fieldset>
            <p className="avatar-privacy-note">
              Avatars are generated locally and stay consistent for each agent
              name.
            </p>
          </>
        )}
      </div>
      <button className="secondary-button" onClick={() => void gateway.logout()}>Log out</button>
      {addingProvider && <ProviderConnect onClose={() => setAddingProvider(false)} onConnected={() => {
        setAddingProvider(false); onProvidersChanged(); onNotify('Provider saved.');
      }} />}
      {managingProvider && <ProviderCredentials
        provider={managingProvider}
        usedByAgents={agents.filter((agent) => agent.providerId === managingProvider.id).length}
        onClose={() => setManagingProvider(null)}
        onChanged={async (message) => {
          await onProvidersChanged(); setManagingProvider(null); onNotify(message);
        }}
      />}
      {addingUser && <AddUserDialog
        allowAdmin={currentUser.role === 'owner'}
        onClose={() => setAddingUser(false)}
        onCreated={async () => {
          await onUsersChanged();
          setAddingUser(false);
          onNotify('Person added. They can sign in now.');
        }}
      />}
    </aside>
  );
}

function AddUserDialog({
  allowAdmin,
  onClose,
  onCreated,
}: {
  allowAdmin: boolean;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const dialogRef = useDialog(onClose);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  return <div className="modal-layer" onMouseDown={(event) => {
    if (event.currentTarget === event.target) onClose();
  }}>
    <div ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="add-person-title">
      <header>
        <div>
          <span className="eyebrow">Server access</span>
          <h2 id="add-person-title">Add a person</h2>
          <p>Create a sign-in for this Crewly server.</p>
        </div>
        <button type="button" className="icon-button compact" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </header>
      <form id="add-person-form" className="form agent-form" onSubmit={async (event) => {
        event.preventDefault();
        if (saving) return;
        setSaving(true);
        setError('');
        try {
          await gateway.createUser({ displayName: displayName.trim(), email: email.trim(), password, role });
          await onCreated();
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : 'Could not add this person.');
          setSaving(false);
        }
      }}>
        <label><span>Name <em>Required</em></span><input autoFocus required autoComplete="name" maxLength={100} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
        <label><span>Email <em>Required</em></span><input required type="email" autoComplete="email" spellCheck={false} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label><span>Temporary password <em>12+ characters</em></span><input required minLength={12} maxLength={256} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {allowAdmin && <label><span>Role</span><select value={role} onChange={(event) => setRole(event.target.value as 'member' | 'admin')}><option value="member">Member</option><option value="admin">Admin</option></select></label>}
        {error && <div className="form-error" role="alert">{error}</div>}
      </form>
      <footer>
        <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
        <button type="submit" form="add-person-form" className="primary-button" disabled={saving}>{saving ? 'Adding…' : 'Add person'}</button>
      </footer>
    </div>
  </div>;
}

function UtilityView({
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
        <NotificationsSection onOpenConversation={onOpenConversation} />
        {approvals.length > 0 && (
          <div className="utility-section-title">
            <span>Needs attention</span>
            <small>{approvals.length}</small>
          </div>
        )}
        {approvals.map((approval) => {
          const agent = agents.find((item) => item.id === approval.agentId);
          const conversation = conversations.find((item) =>
            item.agentIds.includes(approval.agentId),
          );
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
        {approvals.length === 0 && unread.length === 0 && (
          <p className="utility-empty">
            You are all caught up. Nothing is waiting on you.
          </p>
        )}
      </section>
    );
  }

  const runtimeAgents = agents.filter((agent) => agent.runtime !== "Chat");
  return (
    <section className="utility-view">
      <div className="utility-intro">
        <span className="utility-icon">
          <Activity size={21} />
        </span>
        <h1>Runtime activity</h1>
        <p>Follow active sessions without leaving the conversation.</p>
      </div>
      <div className="activity-summary">
        <div>
          <strong>
            {
              runtimeAgents.filter((agent) => agent.status === "thinking")
                .length
            }
          </strong>
          <span>Running</span>
        </div>
        <div>
          <strong>{runtimeAgents.length}</strong>
          <span>Configured</span>
        </div>
        <div>
          <strong>1</strong>
          <span>Workspace</span>
        </div>
      </div>
      {runtimeAgents.length > 0 && (
        <div className="utility-section-title">
          <span>Sessions</span>
          <small>Live</small>
        </div>
      )}
      {runtimeAgents.map((agent) => {
        const conversation = conversations.find((item) =>
          item.agentIds.includes(agent.id),
        );
        return (
          <button
            className="session-row"
            key={agent.id}
            onClick={() => conversation && onOpenConversation(conversation.id)}
          >
            <Avatar agent={agent} />
            <span>
              <strong>{agent.name}</strong>
              <small>
                {agent.runtime} · {agent.workspace ?? "No workspace"}
              </small>
            </span>
            <span className={`session-state ${agent.status}`}>
              <i />
              {agent.status === "thinking"
                ? "Running"
                : agent.status === "online"
                  ? "Ready"
                  : "Offline"}
            </span>
            <ChevronRight size={16} />
          </button>
        );
      })}
      {runtimeAgents.length === 0 && (
        <p className="utility-empty">
          No agent runs on a device yet. Pair one from Settings to see its
          sessions here.
        </p>
      )}
    </section>
  );
}

function SearchDialog({
  agents,
  conversations,
  messages,
  onClose,
  onSelect,
}: {
  agents: Agent[];
  conversations: Conversation[];
  messages: Message[];
  onClose: () => void;
  onSelect: (conversationId: string) => void;
}) {
  const dialogRef = useDialog(onClose);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  // Searching names alone cannot find a phrase you remember saying, which is
  // what people actually reach for search to do.
  const spoken = useMemo(() => {
    const byConversation = new Map<string, string>();
    for (const message of messages) {
      const seen = byConversation.get(message.conversationId) ?? "";
      byConversation.set(message.conversationId, `${seen} ${message.body}`);
    }
    return byConversation;
  }, [messages]);
  const results = conversations.filter((conversation) => {
    const people = conversation.agentIds
      .map((id) => agents.find((agent) => agent.id === id)?.name ?? "")
      .join(" ");
    return `${conversation.name} ${conversation.preview} ${people} ${spoken.get(conversation.id) ?? ""}`
      .toLowerCase()
      .includes(needle);
  });
  return (
    <div
      className="modal-layer search-layer"
      onMouseDown={(event) => event.currentTarget === event.target && onClose()}
    >
      <div
        ref={dialogRef}
        className="search-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Search conversations"
      >
        <div className="search-input">
          <Search size={18} />
          <input
            autoFocus
            type="search"
            aria-label="Search conversations"
            spellCheck={false}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a conversation or agent…"
          />
          <kbd>Esc</kbd>
        </div>
        <div className="search-results">
          <label>
            {query
              ? `${results.length} ${results.length === 1 ? "result" : "results"}`
              : "Recent conversations"}
          </label>
          {results.map((conversation) => {
            const agent = agents.find(
              (item) => item.id === conversation.agentIds[0],
            );
            return (
              <button
                key={conversation.id}
                onClick={() => onSelect(conversation.id)}
              >
                {conversation.type === "dm" ? (
                  <Avatar agent={agent} size="small" />
                ) : (
                  <span className="hash-avatar">
                    <Hash size={14} />
                  </span>
                )}
                <span>
                  <strong>{conversation.name}</strong>
                  <small>{conversation.preview}</small>
                </span>
                <em>{conversation.time}</em>
              </button>
            );
          })}
          {results.length === 0 && (
            <div className="empty-search">
              <Search size={22} />
              <strong>No conversations found</strong>
              <span>Try an agent name, or a phrase from the conversation.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AgentProfileDialog({
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

export function AgentEditor({
  providers,
  agent,
  firstRun,
  onClose,
  onSubmit,
  loadModels,
}: {
  agent?: Agent;
  providers: Provider[];
  /** First run: this dialog is the whole screen, so it has nothing to close to. */
  firstRun?: boolean;
  onClose: () => void;
  onSubmit: (agent: CreateAgentInput) => Promise<void>;
  /** The provider's model list. Injected so a test needs no provider behind it. */
  loadModels?: (providerId: string) => Promise<ModelInfo[]>;
}) {
  const dialogRef = useDialog(onClose);
  const [name, setName] = useState(agent?.name ?? "");
  const [role, setRole] = useState(agent?.role ?? "");
  const [advanced, setAdvanced] = useState(
    Boolean(agent?.workspace || agent?.instructions),
  );
  const [model, setModel] = useState(agent?.model ?? "");
  // The select below lists only connected providers, so the default has to come from the same list.
  const connectedProviders = providers.filter((p) => p.status === 'connected');
  const [providerId, setProviderId] = useState(agent?.providerId ?? connectedProviders[0]?.id ?? "");
  const [runtime, setRuntime] = useState(agent?.runtime ?? "Chat");
  const [workspace, setWorkspace] = useState(agent?.workspace ?? "");
  const [instructions, setInstructions] = useState(agent?.instructions ?? "");
  const [memoryEnabled, setMemoryEnabled] = useState(
    agent?.memoryEnabled !== false,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const roleRef = useRef<HTMLInputElement>(null);
  const editing = Boolean(agent);
  const templates = [
    ["Product", "Product strategist", "Turn ambiguous ideas into concise plans, tradeoffs, and next steps."],
    ["Engineering", "Staff engineer", "Work carefully, explain important decisions, and verify changes."],
    ["Research", "Research partner", "Find reliable evidence and distinguish facts from inference."],
  ] as const;
  const previewAgent: Agent = {
    id: agent?.id ?? "agent-preview",
    name: name.trim() || "New agent",
    initials: (name.trim().charAt(0) || "N").toUpperCase(),
    role: role.trim() || "Add a clear role",
    color: agent?.color ?? "#7857d8",
    status: agent?.status ?? "online",
    model,
    providerId,
    runtime,
    workspace: workspace || undefined,
    memory: agent?.memory ?? [],
    memoryEnabled,
    instructions,
  };

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (!name.trim()) { nameRef.current?.focus(); return; }
    if (!role.trim()) { roleRef.current?.focus(); return; }
    // The provider comes first: without one there is no model list to choose
    // from, so asking for a model would be asking for something impossible.
    if (!providerId) {
      setError("Connect a provider in Settings before creating an agent.");
      return;
    }
    if (!model.trim()) {
      setError("Choose a model for this agent.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSubmit({
        name: name.trim(),
        role: role.trim(),
        model: model.trim(),
        providerId,
        runtime,
        memoryEnabled,
        workspace: runtime === "Chat" ? undefined : workspace || undefined,
        instructions: instructions.trim() || undefined,
      });
    } catch {
      setError(`The agent could not be ${editing ? "updated" : "created"}. Check the provider and model ID.`);
      setSaving(false);
    }
  }
  return (
    <div
      className={`modal-layer${firstRun ? " modal-layer-plain" : ""}`}
      onMouseDown={(event) => {
        if (!firstRun && event.currentTarget === event.target) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="modal agent-editor-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-editor-title"
      >
        <header>
          <div>
            <span className="eyebrow">{editing ? "Agent settings" : "New teammate"}</span>
            <h2 id="agent-editor-title">{editing ? `Edit ${agent?.name}` : "Create an agent"}</h2>
            <p>{editing ? "Changes apply everywhere this agent appears." : "Choose a clear role now. Fine-tune the rest whenever you need."}</p>
          </div>
          {!firstRun && <button
            className="icon-button compact"
            onClick={onClose}
            aria-label={editing ? "Close agent editor" : "Close agent creation"}
          >
            <X size={18} />
          </button>}
        </header>
        <form id="agent-editor-form" className="form agent-form" onSubmit={submit}>
          <div className="agent-draft-card">
            <Avatar agent={previewAgent} size="large" />
            <div>
              <strong>{previewAgent.name}</strong>
              <span>{previewAgent.role}</span>
            </div>
            <small>{model}</small>
          </div>
          {!editing && (
            <div className="template-picker">
              <span>Start with a role</span>
              <div>
                {templates.map(([label, templateRole, templateInstructions]) => (
                  <button
                    type="button"
                    key={label}
                    onClick={() => {
                      setRole(templateRole);
                      setInstructions(templateInstructions);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="form-section-label">Identity</div>
          <label>
            <span>Name <em>Required</em></span>
            <input
              ref={nameRef}
              autoFocus
              required
              autoComplete="off"
              spellCheck={false}
              maxLength={48}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Maya"
            />
          </label>
          <label>
            <span>Role <em>Required</em></span>
            <input
              ref={roleRef}
              required
              autoComplete="off"
              maxLength={72}
              value={role}
              onChange={(event) => setRole(event.target.value)}
              placeholder="e.g. Product strategist"
            />
            <small className="field-description">A short title people will recognize in conversations.</small>
          </label>
          <div className="form-section-label">How this agent works</div>
          <div className="simple-options">
            <label>Provider<select value={providerId} onChange={(event) => setProviderId(event.target.value)}>
              {connectedProviders.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}
            </select></label>
            <ModelPicker providerId={providerId} value={model} onChange={setModel} loadModels={loadModels} />
          </div>
          {!connectedProviders.length && <small className="field-description">No connected provider. Connect one in Settings first.</small>}
          <button
            type="button"
            className="advanced-toggle"
            aria-expanded={advanced}
            onClick={() => setAdvanced(!advanced)}
          >
            <ChevronDown size={16} className={advanced ? "rotated" : ""} />{" "}
            Advanced options
          </button>
          {advanced && (
            <div className="advanced-options">
              <label>
                Working instructions
                <textarea
                  value={instructions}
                  onChange={(event) => setInstructions(event.target.value)}
                  placeholder="Priorities, working style, and boundaries…"
                />
              </label>
            </div>
          )}
          {error && <div className="form-error" role="alert">{error}</div>}
        </form>
        <footer>
          {!firstRun && <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>}
          <button
            type="submit"
            form="agent-editor-form"
            className="primary-button"
            disabled={saving}
          >
            {saving
              ? editing
                ? "Saving…"
                : "Creating…"
              : editing
                ? "Save changes"
                : "Create agent"}
            {editing ? <Check size={16} /> : <Sparkles size={16} />}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Scrim({ onClose }: { onClose: () => void }) {
  const ref = useLayer<HTMLButtonElement>(onClose, false);
  return (
    <button
      ref={ref}
      className="scrim"
      onClick={onClose}
      aria-label="Close navigation"
    />
  );
}

function SidebarSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="sidebar-section">
      <div className="sidebar-label">
        <span>{title}</span>
        {action && (
          <button onClick={action} aria-label={`Add ${title.toLowerCase()}`}>
            <Plus size={14} />
          </button>
        )}
      </div>
      {children}
    </section>
  );
}
function ConversationRow({
  item,
  agents,
  active,
  onClick,
}: {
  item: Conversation;
  agents: Agent[];
  active: boolean;
  onClick: () => void;
}) {
  const agent = agents.find((candidate) => candidate.id === item.agentIds[0]);
  return (
    <button
      className={`conversation-row ${active ? "active" : ""}`}
      onClick={onClick}
    >
      {item.type === "dm" ? (
        <Avatar agent={agent} size="tiny" />
      ) : (
        <span className="hash-avatar">
          <Hash size={14} />
        </span>
      )}
      <span>{item.name}</span>
      {item.unread ? (
        <small aria-label={`${item.unread} unread`}>{item.unread}</small>
      ) : null}
    </button>
  );
}
function Avatar({
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
      className={`avatar avatar-${size} ${resolvedStyle === "blobatar" ? "avatar-blobatar" : ""} ${resolvedStyle === "crew" ? "avatar-crew" : ""}`}
      style={
        resolvedStyle === "initials"
          ? { background: agent?.color ?? "#777" }
          : undefined
      }
    >
      {resolvedStyle === "crew" && agent ? (
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
function BrandMark() {
  return (
    <span className="brand-mark">
      <i />
      <b />
    </span>
  );
}

function ProviderLogo({
  provider,
  small = false,
}: {
  provider: string;
  small?: boolean;
}) {
  const normalized = provider.toLowerCase();
  const className = `provider-logo${small ? " small" : ""}`;

  if (normalized.includes("claude") || normalized.includes("anthropic")) {
    return (
      <div className={className} aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z" />
        </svg>
      </div>
    );
  }

  if (normalized.includes("openai")) {
    return (
      <div className={className} aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z" />
        </svg>
      </div>
    );
  }

  if (normalized.includes("ollama")) {
    return (
      <div className={className} aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M7.905 1.09c.216.085.411.225.588.41.295.306.544.744.734 1.263.191.522.315 1.1.362 1.68a5.054 5.054 0 012.049-.636l.051-.004c.87-.07 1.73.087 2.48.474.101.053.2.11.297.17.05-.569.172-1.134.36-1.644.19-.52.439-.957.733-1.264a1.67 1.67 0 01.589-.41c.257-.1.53-.118.796-.042.401.114.745.368 1.016.737.248.337.434.769.561 1.287.23.934.27 2.163.115 3.645l.053.04.026.019c.757.576 1.284 1.397 1.563 2.35.435 1.487.216 3.155-.534 4.088l-.018.021.002.003c.417.762.67 1.567.724 2.4l.002.03c.064 1.065-.2 2.137-.814 3.19l-.007.01.01.024c.472 1.157.62 2.322.438 3.486l-.006.039a.651.651 0 01-.747.536.648.648 0 01-.54-.742c.167-1.033.01-2.069-.48-3.123a.643.643 0 01.04-.617l.004-.006c.604-.924.854-1.83.8-2.72-.046-.779-.325-1.544-.8-2.273a.644.644 0 01.18-.886l.009-.006c.243-.159.467-.565.58-1.12a4.229 4.229 0 00-.095-1.974c-.205-.7-.58-1.284-1.105-1.683-.595-.454-1.383-.673-2.38-.61a.653.653 0 01-.632-.371c-.314-.665-.772-1.141-1.343-1.436a3.288 3.288 0 00-1.772-.332c-1.245.099-2.343.801-2.67 1.686a.652.652 0 01-.61.425c-1.067.002-1.893.252-2.497.703-.522.39-.878.935-1.066 1.588a4.07 4.07 0 00-.068 1.886c.112.558.331 1.02.582 1.269l.008.007c.212.207.257.53.109.785-.36.622-.629 1.549-.673 2.44-.05 1.018.186 1.902.719 2.536l.016.019a.643.643 0 01.095.69c-.576 1.236-.753 2.252-.562 3.052a.652.652 0 01-1.269.298c-.243-1.018-.078-2.184.473-3.498l.014-.035-.008-.012a4.339 4.339 0 01-.598-1.309l-.005-.019a5.764 5.764 0 01-.177-1.785c.044-.91.278-1.842.622-2.59l.012-.026-.002-.002c-.293-.418-.51-.953-.63-1.545l-.005-.024a5.352 5.352 0 01.093-2.49c.262-.915.777-1.701 1.536-2.269.06-.045.123-.09.186-.132-.159-1.493-.119-2.73.112-3.67.127-.518.314-.95.562-1.287.27-.368.614-.622 1.015-.737.266-.076.54-.059.797.042zm4.116 9.09c.936 0 1.8.313 2.446.855.63.527 1.005 1.235 1.005 1.94 0 .888-.406 1.58-1.133 2.022-.62.375-1.451.557-2.403.557-1.009 0-1.871-.259-2.493-.734-.617-.47-.963-1.13-.963-1.845 0-.707.398-1.417 1.056-1.946.668-.537 1.55-.849 2.485-.849zm0 .896a3.07 3.07 0 00-1.916.65c-.461.37-.722.835-.722 1.25 0 .428.21.829.61 1.134.455.347 1.124.548 1.943.548.799 0 1.473-.147 1.932-.426.463-.28.7-.686.7-1.257 0-.423-.246-.89-.683-1.256-.484-.405-1.14-.643-1.864-.643zm.662 1.21l.004.004c.12.151.095.37-.056.49l-.292.23v.446a.375.375 0 01-.376.373.375.375 0 01-.376-.373v-.46l-.271-.218a.347.347 0 01-.052-.49.353.353 0 01.494-.051l.215.172.22-.174a.353.353 0 01.49.051zm-5.04-1.919c.478 0 .867.39.867.871a.87.87 0 01-.868.871.87.87 0 01-.867-.87.87.87 0 01.867-.872zm8.706 0c.48 0 .868.39.868.871a.87.87 0 01-.868.871.87.87 0 01-.867-.87.87.87 0 01.867-.872zM7.44 2.3l-.003.002a.659.659 0 00-.285.238l-.005.006c-.138.189-.258.467-.348.832-.17.692-.216 1.631-.124 2.782.43-.128.899-.208 1.404-.237l.01-.001.019-.034c.046-.082.095-.161.148-.239.123-.771.022-1.692-.253-2.444-.134-.364-.297-.65-.453-.813a.628.628 0 00-.107-.09L7.44 2.3zm9.174.04l-.002.001a.628.628 0 00-.107.09c-.156.163-.32.45-.453.814-.29.794-.387 1.776-.23 2.572l.058.097.008.014h.03a5.184 5.184 0 011.466.212c.086-1.124.038-2.043-.128-2.722-.09-.365-.21-.643-.349-.832l-.004-.006a.659.659 0 00-.285-.239h-.004z" />
        </svg>
      </div>
    );
  }

  return (
    <div className={className} aria-hidden="true">
      {provider.trim().charAt(0).toUpperCase()}
    </div>
  );
}
function Loading() {
  return (
    <div className="loading" role="status" aria-live="polite">
      <BrandMark />
      <span>Opening your crew…</span>
    </div>
  );
}
function authorName(id: string, agents: Agent[]) {
  return id === "you"
    ? "You"
    : (agents.find((agent) => agent.id === id)?.name ?? "Agent");
}
function renderMentions(
  body: string,
  agents: Agent[],
  onAgentClick: (agentId: string) => void,
) {
  const roleOptions = Array.from(new Set(agents.map((agent) => agent.role))).map(
    (role): MentionOption => ({
      id: `role-${role}`,
      label: `@${role}`,
      description: "Role",
      color: "#8b7cf6",
      kind: "role",
    }),
  );
  const options: MentionOption[] = [
    {
      id: "everyone",
      label: "@everyone",
      description: "Everyone",
      color: "#f05b3e",
      kind: "everyone",
    },
    {
      id: "here",
      label: "@here",
      description: "Online now",
      color: "#3fb77a",
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
