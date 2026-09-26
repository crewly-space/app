import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, AtSign, AlertTriangle, Check, ChevronDown, PanelRight, Hash, Inbox, Lock, Menu, MessageCircle, MoreHorizontal, Paperclip, Plus, Reply, Search, Send, Gauge, Settings, UserRound, X } from "lucide-react";
import { gateway } from "./lib/gateway";
import { withStatus } from "./lib/agent-status";
import { RunInspector } from "./features/runs/RunInspector";
import { client } from "./lib/api/client";
import { startRealtime, resubscribeConversations } from "./lib/realtime/events";
import { ServerRail } from "./features/servers/ServerRail";
import { Dashboard } from "./features/dashboard/Dashboard";
import { serverApi } from "./features/dashboard/api";
import { useServerRegistry, type ServerRegistry } from "./features/servers/useServerRegistry";
import { AddServerDialog } from "./features/servers/AddServerDialog";
import { ServerPending } from "./features/servers/ServerPending";
import { hasWorkspace, readWorkspace, writeWorkspace } from "./lib/boot-cache";
import { ProviderConnect, hasPendingProviderOAuth } from "./features/providers/ProviderConnect";
import { FirstRunHome, firstRunStep, useFirstRunSkips } from "./features/onboarding/FirstRun";
import { PairingApproval } from "./features/devices/PairingApproval";
import { SidebarSection } from "./features/shell/SidebarSection";
import { Scrim, layers } from "./lib/layers";
import type { Agent, Approval, Conversation, Message, Provider } from "./types";
import type { Bootstrap, Panel, Toast, View, Theme, MentionOption } from "./app-types";
import { AgentEditor } from "./features/agents/AgentEditor";
import { AgentProfileDialog } from "./features/agents/AgentProfileDialog";
import { Avatar } from "./features/appearance/Avatar";
import { DetailsPanel } from "./features/conversations/DetailsPanel";
import { UtilityView } from "./features/inbox/UtilityView";
import { MessageItem, ApprovalMessage, authorName } from "./features/messages/MessageItem";
import { SearchDialog } from "./features/search/SearchDialog";
import { SettingsPanel } from "./features/settings/SettingsPanel";
import { BrandMark, Loading } from "./features/shell/BrandMark";
import { ConversationRow } from "./features/shell/ConversationRow";
import { ChannelDialog } from "./features/channels/ChannelDialog";
import { AccountProfileDialog } from "./features/account/AccountProfileDialog";
import type { Attachment as ApiAttachment } from "@crewly/sdk";

const THEME_KEY = "crewly:theme";

const isApple = /mac|iphone|ipad/i.test(navigator.userAgent);

const SEARCH_HINT = isApple ? "⌘ K" : "Ctrl K";

/** Swaps in a fresh read of the channels, keeping DMs, groups and every message already here. */
function withChannels(current: Bootstrap, next: Awaited<ReturnType<typeof gateway.channels>>): Bootstrap {
  const known = new Set(current.messages.map((message) => message.id));
  return { ...current,
    conversations: [...current.conversations.filter((item) => item.type !== "channel"), ...next.channels],
    channelCategories: next.categories,
    messages: [...current.messages, ...next.messages.filter((message) => !known.has(message.id))] };
}

/**
 * The app, for whichever server is open.
 *
 * Self-hosted, there is one server and it served the page, so it is always
 * open. Hosted, the account is signed in before this renders but the selected
 * server may not be open yet -- still being built, offline, wanting its own
 * login -- and that is shown beside the rail rather than in place of the app.
 * The workspace mounts only against a connected server: bootstrapping earlier
 * would ask the page's own origin, which on app.crewly.space is Cloud.
 */
export default function App() {
  const registry = useServerRegistry();
  const serverKey = registry.selected?.id ?? "local";
  const connected = registry.connection.state === "connected";
  // A server shown before stays on screen while it reconnects -- its last
  // known sidebar and conversation, marked as such -- instead of the whole
  // workspace being torn down for a loading page (CRE-101). A server never
  // shown yet, or one that failed, gets the pending screen beside the rail.
  const reconnecting = registry.connection.state === "connecting" && hasWorkspace(serverKey);
  if (!connected && !reconnecting) return <ServerPending registry={registry} />;
  return <ServerWorkspace key={serverKey} serverKey={serverKey} connected={connected} registry={registry} />;
}

function ServerWorkspace({ registry, serverKey, connected }: { registry: ServerRegistry; serverKey: string; connected: boolean }) {
  // Administering a server is its own screen rather than a panel beside a
  // conversation: suspending somebody is not a chat setting. It has its own
  // address, so it can be opened, linked and left with the back button.
  const [dashboardOpen, setDashboardOpen] = useState(
    () => window.location.pathname === "/admin",
  );
  const [addingServer, setAddingServer] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  // Which run the inspector shows: the run behind a message, or one picked from its tree.
  const [inspecting, setInspecting] = useState<{ messageId?: string; runId?: string } | null>(null);
  const cached = readWorkspace<Bootstrap>(serverKey);
  const [data, setData] = useState<Bootstrap | null>(cached?.data ?? null);
  const [bootAttempt, setBootAttempt] = useState(0);
  const [loadError, setLoadError] = useState('');
  // Each server reopens on the conversation that was open there.
  const [selected, setSelected] = useState(cached?.selected ?? "launch");
  const [view, setView] = useState<View>("messages");
  const [panel, setPanel] = useState<Panel>(() => {
    if (new URLSearchParams(window.location.search).has("pair")) return "settings";
    // Below 1050px the details panel lays over the conversation rather than
    // sitting beside it; opening it unasked there hides what was opened.
    return window.matchMedia("(max-width: 1050px)").matches ? null : "details";
  });
  const [composer, setComposer] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<ApiAttachment[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionSuppressed, setMentionSuppressed] = useState(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [replying, setReplying] = useState<Message | null>(null);
  const [creating, setCreating] = useState(false);
  // The channel dialog: {} creates one, { id } manages that one.
  const [channelDialog, setChannelDialog] = useState<{ id?: string } | null>(null);
  const [profileAgentId, setProfileAgentId] = useState<string | null>(null);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [sending, setSending] = useState(false);
  const [joiningChannelId, setJoiningChannelId] = useState<string | null>(null);
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
  const firstRun = useFirstRunSkips();
  const openingFirstDm = useRef(false);
  const messageListRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    // Not asked until the server is connected: before then there is no
    // session for it, and the last known state is what is on screen.
    if (!connected) return;
    let cancelled = false;
    const workspaceWindow = window;
    const bootstrapStartedAt = workspaceWindow.performance.now();
    const recordBootstrapTiming = (status: 'success' | 'error') => {
      // Use the page's constructor rather than the ambient global. The app can
      // be mounted into another window (the integration test does this with
      // jsdom), where Node's CustomEvent belongs to a different realm and
      // cannot be dispatched by that window.
      workspaceWindow.dispatchEvent(new workspaceWindow.CustomEvent('crewly:bootstrap-timing', {
        detail: { status, durationMs: Math.round(workspaceWindow.performance.now() - bootstrapStartedAt), serverId: registry.selected?.id ?? null },
      }));
    };
    let stopRealtime = () => {};
    // A reconnect replays every channel change it missed; one refetch covers them all.
    let channelRefresh: number | undefined;
    const refreshChannels = () => {
      window.clearTimeout(channelRefresh);
      channelRefresh = window.setTimeout(() => {
        void gateway.channels().then((next) => { if (!cancelled) setData((current) => current && withChannels(current, next)); })
          .catch(() => {});
      }, 150);
    };
    void gateway.bootstrap().then((initial) => {
      recordBootstrapTiming('success');
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
          agents: current.agents.map((agent) => (agent.id === status.agentId ? withStatus(agent, status) : agent)) })),
        refreshChannels);
    }).catch((error) => { recordBootstrapTiming('error'); if (!cancelled) setLoadError(String(error)); });
    return () => { cancelled = true; stopRealtime(); window.clearTimeout(channelRefresh); };
    // Switching servers reloads everything: agents, conversations and the
    // socket all belong to one server, and showing the previous server's
    // while connected to another would be a lie.
  }, [registry.epoch, connected, bootAttempt]);
  // Remember what this server looked like, for switching back to it.
  useEffect(() => {
    if (data) writeWorkspace(serverKey, data, selected);
  }, [data, selected, serverKey]);
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
    const foreign = pendingAttachments.filter((attachment) => attachment.conversationId !== selected);
    if (!foreign.length) return;
    setPendingAttachments((current) => current.filter((attachment) => attachment.conversationId === selected));
    void Promise.all(foreign.map((attachment) => gateway.removeAttachment(attachment.id).catch(() => {})));
  }, [pendingAttachments, selected]);
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
    // Channels are shared rooms, not "a conversation of their own": a server
    // opening on #general still owes a newcomer their DM.
    if (!data || data.conversations.some((item) => item.type !== "channel") || !data.agents.length) return;
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
  // Pin whichever conversation is showing. Falling back to "the first one" on
  // every render meant a reorder, a new channel or a refetch switched rooms
  // under the reader.
  useEffect(() => {
    if (!data?.conversations.length || data.conversations.some((item) => item.id === selected)) return;
    setSelected(data.conversations[0].id);
  }, [data, selected]);
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(
      () => setToast(null),
      toast.tone === "error" ? 5200 : 2800,
    );
    return () => window.clearTimeout(timeout);
  }, [toast]);

  if (!data) {
    const serverName = registry.selected?.name;
    const retry = () => { setLoadError(""); setBootAttempt((value) => value + 1); };
    const content = loadError ? (
      <div className="onboarding-body"><div className="onboarding-card form">
        <h1>{serverName ? `${serverName} couldn't be opened` : "Crewly couldn't be opened"}</h1>
        <p role="alert">{loadError}</p>
        <button className="primary-button" type="button" onClick={retry}>Try again</button>
      </div></div>
    ) : <Loading embedded={registry.multiServer} phase={serverName ? `Opening ${serverName}…` : "Opening your crew…"} onRetry={retry} />;
    // Hosted, the rail stays while one server loads, so the others are still a click away.
    if (!registry.multiServer || !registry.servers.length) return content;
    return <div className="app-shell server-pending">
      <ServerRail servers={registry.servers} selectedId={registry.selected?.id ?? null} onSelect={registry.select}
        onAddServer={() => setAddingServer(true)} dashboardUrl={import.meta.env.VITE_CREWLY_DASHBOARD_URL}
        unread={registry.unread} failures={registry.failures} />
      <main className="server-pending-main">{content}</main>
      {addingServer && <AddServerDialog onClose={() => setAddingServer(false)}
        onAdded={() => { setAddingServer(false); void registry.refresh(); }} />}
    </div>;
  }
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
  const serverBranding = data.serverBranding ?? {
    displayName: registry.selected?.name ?? 'Crewly', tagline: '', iconDataUrl: null, updatedAt: null,
  };
  const ownConversations = data.conversations.filter((item) => item.type !== "channel");
  const hasChannels = data.conversations.length > ownConversations.length;
  const hasLiveChannels = data.conversations.some((item) => item.channel && !item.channel.archivedAt);
  if (!ownConversations.length && panel !== "settings") {
    // A DM is on its way from the effect above; showing "create your first
    // agent" to someone who already has one would be a lie that flashes past.
    if (data.agents.length && !firstDmFailed) return <Loading />;
    // First run is one flow -- provider, then agent, either skippable -- and
    // the step comes from the server's state, so a refresh resumes it and a
    // returning owner with a provider never sees the provider step again.
    const hasConnectedProvider = data.providers.some((provider) => provider.status === "connected");
    const canManageProviders = data.currentUser.role === "owner" || data.currentUser.role === "admin";
    const step = firstRunStep({ hasConnectedProvider, canManageProviders, skipped: firstRun.skipped });
    if (step === "provider") return <ProviderConnect closeLabel="Skip for now"
      onConnected={() => { void gateway.bootstrap().then(setData); notify("Provider saved."); }}
      onClose={() => firstRun.skip("provider")} />;
    // Nothing left to set up for this person: with channels to talk in, the
    // app itself is the useful place, not a page about setting up agents.
    if (!(step === "home" && hasChannels)) return <div className="first-run">
      <header>
        <BrandMark />
        <button className="text-button" onClick={() => setPanel("settings")}>Settings</button>
        <button className="text-button" onClick={() => void gateway.logout()}>Log out</button>
      </header>
      {step === "agent" ? (
        <AgentEditor firstRun providers={data.providers} onProvidersChanged={(data.currentUser.role === "owner" || data.currentUser.role === "admin") ? () => gateway.bootstrap().then(setData) : undefined} onClose={() => firstRun.skip("agent")} onSubmit={async (input) => {
          const agent = await gateway.createAgent(input);
          const dm = await gateway.createDm(agent.id, [...data.agents, agent]); resubscribeConversations();
          setData((current) => current && ({ ...current, agents: [...current.agents, agent], conversations: [...current.conversations, dm] }));
          setSelected(dm.id);
        }} />
      ) : (
        <FirstRunHome
          hasConnectedProvider={hasConnectedProvider}
          canManageProviders={canManageProviders}
          onConnectProvider={() => firstRun.resume("provider")}
          onCreateAgent={() => firstRun.resume("agent")}
          onOpenSettings={() => setPanel("settings")}
        />
      )}
      {toast && <div className={`toast toast-${toast.tone}`} role={toast.tone === "error" ? "alert" : "status"}>{toast.message}</div>}
    </div>;
  }

  if (!data.conversations.length) return <div className="empty-settings-shell">
    <SettingsPanel
    providers={data.providers} connectors={data.connectors} devices={data.devices} agents={data.agents} currentUser={data.currentUser} users={data.users}
    people={data.people} serverBranding={serverBranding} onServerBrandingChanged={updateServerBranding}
    onAvatarModeChange={updateMyAvatar} theme={theme} onThemeChange={updateTheme}
    onNotify={notify} onProvidersChanged={() => gateway.bootstrap().then(setData)} onConnectorsChanged={() => gateway.bootstrap().then(setData)}
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
  // Everyone's name and avatar come from the directory, which members can
  // read too; the reader's own name falls back to their email.
  const people = {
    byId: new Map(data.people.map((person) => [person.id, { name: person.displayName, mode: person.avatarMode }])),
    me: {
      id: data.currentUser.id,
      name: data.currentUser.displayName ?? data.currentUser.email,
      mode: data.currentUser.avatarMode ?? "bloop",
    },
  };
  const canManageChannels = data.currentUser.role === "owner" || data.currentUser.role === "admin";
  const channel = conversation.channel;
  const channelRows = (categoryId: string | null) => data.conversations
    .filter((item) => item.channel && !item.channel.archivedAt && (item.channel.categoryId ?? null) === categoryId)
    .sort((a, b) => a.channel!.position - b.channel!.position)
    .map((item) => (
      <ConversationRow key={item.id} item={item} agents={data.agents}
        active={view === "messages" && selected === item.id} onClick={() => openConversation(item.id)} />
    ));
  const uncategorisedChannels = channelRows(null);
  const directConversations = data.conversations.filter((item) => item.type === "dm");
  const groupConversations = data.conversations.filter((item) => item.type === "group");
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
      color: "var(--oc-info)",
      kind: "role",
    }),
  );
  const allMentionOptions: MentionOption[] = [
    {
      id: "everyone",
      label: "@everyone",
      description: "Notify everyone in this conversation",
      color: "var(--oc-accent)",
      kind: "everyone",
    },
    {
      id: "here",
      label: "@here",
      description: "Notify agents currently online",
      color: "var(--oc-success)",
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

  /**
   * The agents a draft asks for. The server wakes only the agents a message
   * mentions, outside a DM, so the tokens in the composer have to say who.
   */
  function mentionedAgents(editor: HTMLElement | null) {
    const ids = new Set<string>();
    editor?.querySelectorAll<HTMLElement>(".mention-token").forEach((token) => {
      const kind = token.dataset.mentionKind;
      if (kind === "agent" && token.dataset.mentionId) ids.add(token.dataset.mentionId);
      if (kind === "everyone") activeAgents.forEach((agent) => ids.add(agent.id));
      if (kind === "here") activeAgents.filter((agent) => agent.status === "online").forEach((agent) => ids.add(agent.id));
      if (kind === "role") activeAgents.filter((agent) => `@${agent.role}` === token.dataset.mentionLabel).forEach((agent) => ids.add(agent.id));
    });
    return [...ids].map((targetId) => ({ targetId, targetType: "agent" as const }));
  }

  async function addAttachments(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length || uploadingAttachment) return;
    const remaining = 10 - pendingAttachments.length;
    if (remaining < files.length) notify("A message can contain at most 10 attachments.", "error");
    const selectedFiles = files.slice(0, Math.max(0, remaining));
    if (!selectedFiles.length) return;
    setUploadingAttachment(true);
    try {
      for (const file of selectedFiles) {
        const attachment = await gateway.uploadAttachment(conversation.id, file);
        setPendingAttachments((current) => [...current, attachment]);
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "Attachment upload failed.", "error");
    } finally {
      setUploadingAttachment(false);
    }
  }

  async function send() {
    const value = composer.trim();
    if ((!value && !pendingAttachments.length) || sending) return;
    const replyToMessageId = replying?.id;
    const attachmentIds = pendingAttachments.map((attachment) => attachment.id);
    const mentions = mentionedAgents(composerRef.current);
    stickToBottomRef.current = true;
    setShowJumpToLatest(false);
    composerRef.current?.replaceChildren();
    setComposer("");
    setReplying(null);
    setSending(true);
    try {
      const sent = await gateway.sendMessage(conversation.id, value, replyToMessageId, mentions, attachmentIds);
      setData((current) => current && { ...current,
        messages: current.messages.some((m) => m.id === sent.id) ? current.messages : [...current.messages, sent] });
      setPendingAttachments([]);
    } catch {
      notify(
        "Message could not be delivered. Your draft was restored.",
        "error",
      );
      setComposer(value);
      setReplying(replyToMessageId ? replying : null);
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
    if (option.agent) token.dataset.mentionId = option.agent.id;
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

  async function updateMyAvatar(mode: NonNullable<Agent["avatarMode"]>) {
    try {
      await gateway.setMyAvatarMode(mode);
      setData(await gateway.bootstrap());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save your avatar style.";
      notify(message === "Some of those details are not valid. Check the form and try again."
        ? "That avatar style could not be saved. Choose one of the displayed options and try again."
        : message, "error");
    }
  }

  async function updateServerBranding(input: { displayName: string; tagline: string; iconDataUrl: string | null }) {
    const updated = await client.server.updateBranding(input);
    setData((current) => current && ({ ...current, serverBranding: updated }));
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
    <>
      <div className={`app-shell ${panel ? "panel-open" : ""} ${registry.multiServer && registry.servers.length > 0 ? "has-rail" : ""} ${mobileNav ? "nav-open" : ""}`}>
        {registry.multiServer && registry.servers.length > 0 && (
          <ServerRail
            servers={registry.servers}
            selectedId={registry.selected?.id ?? null}
            onSelect={(id) => { registry.select(id); setMobileNav(false); }}
            onAddServer={() => setAddingServer(true)}
            dashboardUrl={import.meta.env.VITE_CREWLY_DASHBOARD_URL}
            account={registry.account}
            onProfile={() => setProfileOpen(true)}
            selectedBranding={serverBranding}
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
        {profileOpen && registry.account && registry.accountClient && (
          <AccountProfileDialog
            account={registry.account}
            cloud={registry.accountClient}
            onClose={() => setProfileOpen(false)}
            onSaved={(profile) => {
              setProfileOpen(false);
              notify("Profile saved.");
              void registry.refresh().catch(() => {});
              // Keep the currently open server in sync as well. This endpoint
              // changes identity fields only; its local role and memberships
              // remain authoritative.
              void client.users.updateMe({ displayName: profile.displayName, avatarMode: profile.avatarMode })
                .then(() => gateway.bootstrap().then(setData))
                .catch(() => {});
            }}
          />
        )}
        <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
          <div className="brand">
            {serverBranding.iconDataUrl
              ? <img className="server-brand-icon" src={serverBranding.iconDataUrl} alt="" />
              : <BrandMark />}
            <span title={serverBranding.tagline || undefined}>{serverBranding.displayName}</span>
            <small>Crewly</small>
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
          {directConversations.length > 0 && <SidebarSection
            title="Direct messages"
            action={() => setCreating(true)}
          >
            {directConversations.map((item) => (
                <ConversationRow
                  key={item.id}
                  item={item}
                  agents={data.agents}
                  active={view === "messages" && selected === item.id}
                  onClick={() => openConversation(item.id)}
                />
              ))}
          </SidebarSection>}
          {groupConversations.length > 0 && <SidebarSection title="Group DMs">
            {groupConversations.map((item) => (
                <ConversationRow
                  key={item.id}
                  item={item}
                  agents={data.agents}
                  active={view === "messages" && selected === item.id}
                  onClick={() => openConversation(item.id)}
                />
              ))}
          </SidebarSection>}
          {(uncategorisedChannels.length > 0 || canManageChannels) && (
            <SidebarSection title="Channels" action={canManageChannels ? () => setChannelDialog({}) : undefined}>
              {uncategorisedChannels.length > 0 ? uncategorisedChannels : (
                <div className="channel-empty-state">
                  <span>No channels yet</span>
                  {canManageChannels && <button type="button" onClick={() => setChannelDialog({})}>Create your first channel</button>}
                </div>
              )}
            </SidebarSection>
          )}
          <SidebarSection
            title="Channels"
            action={() => { setChannelDialog({}); setMobileNav(false); }}
            actionLabel="Create channel"
            actionDisabledReason={canManageChannels ? undefined : "Only admins can create channels"}
          >
            {uncategorisedChannels}
            {!hasLiveChannels && (canManageChannels ? (
              <button className="sidebar-cta" onClick={() => { setChannelDialog({}); setMobileNav(false); }}>
                <Plus size={15} />
                <span>Create your first channel</span>
              </button>
            ) : (
              <p className="sidebar-empty">No channels yet. An admin can create one.</p>
            ))}
          </SidebarSection>
          {data.channelCategories.map((category) => {
            const rows = channelRows(category.id);
            return rows.length > 0 ? <SidebarSection key={category.id} title={category.name}>{rows}</SidebarSection> : null;
          })}
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
              // Everything administered here belongs to one server; switching
              // servers starts it fresh rather than showing the last one's state.
              key={registry.selected?.id ?? "local"}
              api={serverApi}
              currentUser={{
                id: data.currentUser.id,
                email: data.currentUser.email,
                displayName: data.currentUser.email,
                role: data.currentUser.role as "owner" | "admin" | "member",
                createdAt: new Date().toISOString(),
              }}
              serverName={serverBranding.displayName}
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
          {!connected && (
            <div className="server-switching" role="status">
              Showing {registry.selected?.name ?? "this server"} as you left it. Connecting…
            </div>
          )}
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
              ) : channel?.visibility === "private" ? (
                <Lock size={18} />
              ) : conversation.type !== "dm" ? (
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
                      : channel
                        ? channel.topic ?? `${channel.members.filter((m) => m.participantType === "user").length} people · ${activeAgents.length} agents`
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
                      channel
                        ? setChannelDialog({ id: conversation.id })
                        : notify("More conversation actions are coming soon.")
                    }
                    aria-label={channel ? "Channel settings" : "More actions"}
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
                className={`message-list${visibleMessages.length === 0 && conversationApprovals.length === 0 ? " is-empty" : ""}`}
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
                    {conversation.type !== "dm"
                      ? `# ${conversation.name}`
                      : conversation.name}
                  </h1>
                  <p>
                    {channel
                      ? channel.topic ?? `The start of #${channel.name}. Mention an agent in the channel when you want their attention.`
                      : conversation.type === "group"
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
                    people={people}
                    allMessages={visibleMessages}
                    onReply={() => setReplying(message)}
                    onAgentClick={openAgentProfile}
                    onInspect={() => setInspecting({ messageId: message.id })}
                    onAttachmentDownload={(id, filename) => {
                      void gateway.downloadAttachment(id, filename).catch((error) => notify(error instanceof Error ? error.message : "Attachment download failed.", "error"));
                    }}
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
                {channel && !channel.canPost ? (
                  <div className="channel-gate" role="status">
                    {channel.archivedAt ? (
                      <span>This channel is archived. Its history stays here, but nobody can post in it.</span>
                    ) : !channel.joined ? (
                      <>
                        <span>You&rsquo;re reading <strong>#{channel.name}</strong>. Join it to post and get its messages live.</span>
                        <button className="primary-button compact" disabled={joiningChannelId === channel.id} onClick={async () => {
                          if (joiningChannelId === channel.id) return;
                          setJoiningChannelId(channel.id);
                          try {
                            const joined = await gateway.joinChannel(channel.id);
                            setData((current) => current && ({ ...current,
                              conversations: current.conversations.map((item) => item.id === joined.id ? joined : item) }));
                          } catch (error) { notify(String(error instanceof Error ? error.message : error), "error"); }
                          finally { setJoiningChannelId(null); }
                        }}>Join channel</button>
                      </>
                    ) : (
                      <span>Only {channel.postRole === "owner" ? "the owner" : "admins"} can post in <strong>#{channel.name}</strong>.</span>
                    )}
                  </div>
                ) : (
                <div className="composer">
                  <div
                    ref={composerRef}
                    className="composer-editor"
                    contentEditable={!sending && connected}
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
                    data-placeholder={`Message ${conversation.type !== "dm" ? "#" : ""}${conversation.name}`}
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
                        onClick={() => attachmentInputRef.current?.click()}
                        disabled={uploadingAttachment || sending || pendingAttachments.length >= 10}
                        aria-label="Add attachment"
                      >
                        <Plus size={18} />
                      </button>
                      <button
                        onClick={() => attachmentInputRef.current?.click()}
                        disabled={uploadingAttachment || sending || pendingAttachments.length >= 10}
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
                      disabled={(!composer.trim() && !pendingAttachments.length) || sending || uploadingAttachment}
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
                  <input
                    ref={attachmentInputRef}
                    className="attachment-input"
                    type="file"
                    multiple
                    onChange={(event) => void addAttachments(event)}
                    aria-label="Choose attachments"
                  />
                  {pendingAttachments.length > 0 && (
                    <div className="pending-attachments" aria-label="Pending attachments">
                      {pendingAttachments.map((attachment) => (
                        <div className="pending-attachment" key={attachment.id}>
                          <Paperclip size={13} />
                          <span title={attachment.filename}>{attachment.filename}</span>
                          <button
                            type="button"
                            onClick={() => {
                              setPendingAttachments((current) => current.filter((item) => item.id !== attachment.id));
                              void gateway.removeAttachment(attachment.id).catch(() => {});
                            }}
                            aria-label={`Remove ${attachment.filename}`}
                            title="Remove attachment"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                )}
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
          <SettingsPanel serverName={registry.selected?.name}
            providers={data.providers}
            connectors={data.connectors}
            devices={data.devices}
            agents={data.agents}
            currentUser={data.currentUser}
            users={data.users}
            people={data.people}
            serverBranding={serverBranding}
            onServerBrandingChanged={updateServerBranding}
            onAvatarModeChange={updateMyAvatar}
            theme={theme}
            onThemeChange={updateTheme}
            onNotify={notify}
            onProvidersChanged={() => gateway.bootstrap().then(setData)}
            onConnectorsChanged={() => gateway.bootstrap().then(setData)}
            onUsersChanged={() => gateway.bootstrap().then(setData)}
            onDevicesChanged={() => gateway.bootstrap().then(setData)}
            onClose={() => setPanel(null)}
          />
        )}
        {creating && (
          <AgentEditor
            onClose={() => setCreating(false)}
            providers={data.providers}
            onProvidersChanged={(data.currentUser.role === "owner" || data.currentUser.role === "admin") ? () => gateway.bootstrap().then(setData) : undefined}
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
        {channelDialog && (
          <ChannelDialog
            key={channelDialog.id ?? "new"}
            channel={data.conversations.find((item) => item.id === channelDialog.id && item.channel)}
            channels={data.conversations.filter((item) => item.channel)}
            categories={data.channelCategories}
            agents={data.agents}
            people={data.people}
            canManage={canManageChannels}
            onClose={() => setChannelDialog(null)}
            onSaved={(saved) => {
              setData((current) => current && ({ ...current,
                conversations: current.conversations.some((item) => item.id === saved.id)
                  ? current.conversations.map((item) => (item.id === saved.id ? saved : item))
                  : [...current.conversations, saved] }));
              // A new channel opens; an edited one stays open for further changes.
              if (!channelDialog.id) { setChannelDialog(null); openConversation(saved.id); notify(`#${saved.name} is ready.`); }
              // Sections and order live in the list, not the channel: read it back.
              void gateway.channels().then((next) => setData((current) => current && withChannels(current, next))).catch(() => {});
            }}
            onLeft={(id) => {
              setChannelDialog(null);
              void gateway.channels().then((next) => setData((current) => current && withChannels(current, next))).catch(() => {});
              if (selected === id) setSelected(data.conversations.find((item) => item.id !== id)?.id ?? "launch");
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
    </>
  );
}
