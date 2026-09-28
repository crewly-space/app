import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Check, Copy, Hash, Mail, Plus, Sparkles, UsersRound, X } from "lucide-react";
import type { Invite } from "@crewly/sdk";
import { client, activeServerId } from "../../lib/api/client";
import { gateway } from "../../lib/gateway";
import { ProviderConnect } from "../providers/ProviderConnect";
import { ProviderLogo } from "../providers/ProviderLogo";
import { providerConnectionLabel } from "../providers/labels";
import { ModelPicker } from "../agents/ModelPicker";
import { Avatar } from "../appearance/Avatar";
import { BrandMark } from "../shell/BrandMark";
import { inviteLink } from "../people/InvitesManager";
import type { Agent } from "../../types";
import type { Bootstrap } from "../../app-types";

/**
 * Setting up a server its owner has just opened, as one guided flow: a model
 * provider, a first crew of agents, the channels they talk in, and the
 * people who join them.
 *
 * Whether a step is done is read from the server -- a connected provider, an
 * agent, a second channel, a second person -- so a refresh or another device
 * shows the same ticks. What only this browser knows is where the owner was
 * and whether they finished, kept per server like the first-run skips.
 */
export type SetupStep = "welcome" | "provider" | "agents" | "channels" | "people" | "ready";

const STEPS: Array<{ id: SetupStep; title: string; hint: string }> = [
  { id: "welcome", title: "Welcome", hint: "Your new server" },
  { id: "provider", title: "Model provider", hint: "What agents think with" },
  { id: "agents", title: "Agents", hint: "Start from templates" },
  { id: "channels", title: "Channels", hint: "Rooms for the crew" },
  { id: "people", title: "People", hint: "Invite your team" },
  { id: "ready", title: "Ready", hint: "Start talking" },
];

type SetupState = { step?: SetupStep; finished?: boolean };

const storageKey = () => `crewly:setup:${activeServerId() ?? "local"}`;

function readState(): SetupState {
  try {
    const raw = localStorage.getItem(storageKey());
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" ? (parsed as SetupState) : {};
  } catch {
    // Storage refused or garbled: setup is simply offered again.
    return {};
  }
}

function writeState(state: SetupState): void {
  try { localStorage.setItem(storageKey(), JSON.stringify(state)); } catch { /* holds until the page is reloaded */ }
}

/** Where the open server's setup stands in this browser, and ways to move it. */
export function useSetupState() {
  const [state, setState] = useState<SetupState>(readState);
  const update = useCallback((change: SetupState) => {
    setState((current) => {
      const next = { ...current, ...change };
      writeState(next);
      return next;
    });
  }, []);
  return {
    /** Started here before: resumed even once agents exist. */
    started: Boolean(state.step),
    finished: Boolean(state.finished),
    step: state.step ?? "welcome",
    go: useCallback((step: SetupStep) => update({ step }), [update]),
    finish: useCallback(() => update({ finished: true }), [update]),
    reopen: useCallback(() => update({ finished: false, step: "welcome" }), [update]),
  };
}

export type SetupControls = ReturnType<typeof useSetupState>;

/**
 * A server nobody has used yet: no agents, no conversations of anyone's own,
 * nothing said, and no channel beyond the #general every server starts with.
 * A server with history is somebody's workspace, whatever it is missing.
 */
export function isNewServer(data: Bootstrap): boolean {
  const channels = data.conversations.filter((item) => item.type === "channel");
  return data.agents.length === 0
    && data.messages.length === 0
    && channels.length <= 1
    && channels.length === data.conversations.length;
}

/**
 * Whether an owner or admin should be walked through setup: a new server, or
 * one they started setting up here, which is resumed until they finish.
 * Members never see it; they cannot change most of what it sets up.
 */
export function needsSetup(data: Bootstrap, setup: { started: boolean; finished: boolean }): boolean {
  const canManage = data.currentUser.role === "owner" || data.currentUser.role === "admin";
  if (!canManage || setup.finished) return false;
  return setup.started || isNewServer(data);
}

/** A first crew, each a real starting point rather than a blank form. */
export const CREW_TEMPLATES = [
  {
    id: "assistant", name: "Assistant", role: "Everyday assistant",
    blurb: "Answers questions, drafts messages and keeps the team unblocked.",
    instructions: "Be concise and practical. Ask one clarifying question when a request is ambiguous, otherwise act. Prefer short answers with clear next steps.",
  },
  {
    id: "engineer", name: "Engineer", role: "Staff engineer",
    blurb: "Reviews code, plans changes and explains technical tradeoffs.",
    instructions: "Work carefully, explain important decisions, and verify changes. Call out risks, edge cases and how to test.",
  },
  {
    id: "researcher", name: "Researcher", role: "Research partner",
    blurb: "Digs into questions and separates evidence from inference.",
    instructions: "Find reliable evidence and distinguish facts from inference. Cite sources when you have them and say plainly when you are unsure.",
  },
  {
    id: "product", name: "Strategist", role: "Product strategist",
    blurb: "Turns fuzzy ideas into plans, priorities and tradeoffs.",
    instructions: "Turn ambiguous ideas into concise plans, tradeoffs, and next steps. Keep the user and the goal in view.",
  },
  {
    id: "writer", name: "Writer", role: "Writer and editor",
    blurb: "Drafts and tightens docs, posts and announcements.",
    instructions: "Write clearly and plainly. Match the requested tone, cut filler, and keep the reader's time in mind.",
  },
  {
    id: "support", name: "Support", role: "Support lead",
    blurb: "Drafts friendly, accurate replies to customer questions.",
    instructions: "Be warm, accurate and brief. Acknowledge the problem, give the fix or the next step, and never invent policy.",
  },
] as const;

type ChannelSuggestion = { name: string; topic: string | null; adminsPost?: boolean };

const CHANNEL_SUGGESTIONS: ChannelSuggestion[] = [
  { name: "announcements", topic: "News and updates for everyone", adminsPost: true },
  { name: "random", topic: "Everything else" },
  { name: "engineering", topic: "Building and shipping" },
  { name: "product", topic: "Plans, ideas and feedback" },
  { name: "support", topic: "Customer questions" },
  { name: "research", topic: "Questions worth digging into" },
];

const channelSlug = (value: string) => value.toLowerCase().trim().replace(/^#+/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const messageOf = (reason: unknown, fallback: string) => reason instanceof Error && reason.message ? reason.message : fallback;

const HEADINGS: Record<Exclude<SetupStep, "welcome" | "ready">, { title: string; lead: string }> = {
  provider: { title: "Connect a model provider", lead: "Agents need a model to think with. Use Crewly Gateway through your Crewly account, a provider's API key, or a subscription on your own device." },
  agents: { title: "Build your first crew", lead: "Pick the agents to start with. They share one model for now; each can have its own later." },
  channels: { title: "Set up your channels", lead: "Channels are shared rooms where people and agents talk. #general is already here." },
  people: { title: "Invite your team", lead: "They join with their own account and see the channels and agents you set up." },
};

export function SetupWizard({
  data,
  serverName,
  setup,
  onRefresh,
  onFinish,
  onLogout,
}: {
  data: Bootstrap;
  serverName: string;
  setup: SetupControls;
  /** Reads the server again; every step's tick comes from it. */
  onRefresh: () => Promise<void>;
  /** Leaves setup, opening a conversation when one was chosen. */
  onFinish: (conversationId?: string) => void;
  onLogout: () => void;
}) {
  const step = setup.step;
  const index = Math.max(0, STEPS.findIndex((item) => item.id === step));
  const connectedProviders = data.providers.filter((provider) => provider.status === "connected");
  const channels = data.conversations.filter((item) => item.channel && !item.channel.archivedAt);
  const [invited, setInvited] = useState(0);
  // Steps that act -- create agents, create channels -- put their button in
  // the pinned footer, so it is never below a long list.
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const countInvite = useCallback(() => setInvited((count) => count + 1), []);
  const done: Record<SetupStep, boolean> = {
    welcome: index > 0,
    provider: connectedProviders.length > 0,
    agents: data.agents.length > 0,
    channels: channels.length > 1,
    people: data.users.length > 1 || invited > 0,
    ready: false,
  };
  const { go, started } = setup;
  const next = () => go(STEPS[Math.min(index + 1, STEPS.length - 1)].id);
  const back = () => go(STEPS[Math.max(index - 1, 0)].id);
  const finish = (conversationId?: string) => { setup.finish(); onFinish(conversationId); };

  // Remember that setup started, so a refresh after the first agent resumes it.
  useEffect(() => { if (!started) go("welcome"); }, [started, go]);

  let body: ReactNode = null;
  let primary: ReactNode = <button type="button" className="primary-button" onClick={next}>Continue <ArrowRight size={16} /></button>;
  switch (step) {
    case "welcome":
      body = <Welcome data={data} serverName={serverName} onStart={next} />;
      break;
    case "provider":
      body = <ProviderStep providers={connectedProviders} onConnected={onRefresh} />;
      if (!done.provider) primary = null;
      break;
    case "agents":
      body = <AgentsStep data={data} slot={slot} onGoToProvider={() => go("provider")}
        onCreated={async (complete) => { await onRefresh().catch(() => {}); if (complete) next(); }} />;
      if (!done.agents) primary = null;
      break;
    case "channels":
      body = <ChannelsStep data={data} slot={slot} channels={channels} onRefresh={onRefresh} onDone={next} />;
      if (!done.channels) primary = null;
      break;
    case "people":
      body = <PeopleStep data={data} onInvited={countInvite} />;
      primary = <button type="button" className="primary-button" onClick={next}>{done.people ? "Continue" : "Done inviting"} <ArrowRight size={16} /></button>;
      break;
    case "ready":
      body = <ReadyStep data={data} serverName={serverName} done={done} onOpen={finish} />;
      primary = null;
      break;
  }
  const guided = step !== "welcome" && step !== "ready";
  // Each step starts at its top. The scroller is shared by every step, so
  // without this a step opened from the bottom of the last one began part way
  // down, its heading hidden under the step counter.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { scroller.current?.scrollTo?.({ top: 0 }); }, [step]);

  return <div className="setup">
    <aside className="setup-rail" aria-label="Setup progress">
      <div className="setup-rail-brand"><BrandMark /></div>
      <div className="setup-rail-server">
        <span className="eyebrow">Setting up</span>
        <strong>{serverName}</strong>
      </div>
      <ol className="setup-steps">
        {STEPS.map((item, position) => {
          const state = item.id === step ? "current" : done[item.id] ? "done" : "todo";
          return <li key={item.id}>
            <button type="button" className={`setup-step is-${state}`} aria-current={item.id === step ? "step" : undefined}
              onClick={() => go(item.id)}>
              <span className="setup-step-mark">{state === "done" ? <Check size={13} strokeWidth={3} /> : position + 1}</span>
              <span className="setup-step-text"><strong>{item.title}</strong><small>{item.hint}</small></span>
            </button>
          </li>;
        })}
      </ol>
      <div className="setup-rail-foot">
        <span title={data.currentUser.email}>Signed in as {data.currentUser.email}</span>
        <button type="button" className="text-button" onClick={onLogout}>Log out</button>
      </div>
    </aside>
    <main className="setup-main">
      <div className="setup-progress" aria-hidden="true"><i style={{ width: `${((index + 1) / STEPS.length) * 100}%` }} /></div>
      <div className="setup-top">
        <span>Step {index + 1} of {STEPS.length}</span>
        {step !== "ready" && <button type="button" className="text-button" onClick={() => finish()}>Skip setup</button>}
      </div>
      <div className="setup-scroll" ref={scroller}>
        <section className="setup-panel" aria-labelledby="setup-title">
          {guided && <header className="setup-head">
            <span className="eyebrow">{STEPS[index].hint}</span>
            <h1 id="setup-title">{HEADINGS[step as keyof typeof HEADINGS].title}</h1>
            <p>{HEADINGS[step as keyof typeof HEADINGS].lead}</p>
          </header>}
          {body}
        </section>
      </div>
      {guided && <footer className="setup-actions">
        <button type="button" className="secondary-button" onClick={back}><ArrowLeft size={16} /> Back</button>
        <span className="setup-actions-gap" />
        {!done[step] && <button type="button" className="text-button" onClick={next}>Skip this step</button>}
        <span ref={setSlot} className="setup-actions-slot" />
        {primary}
      </footer>}
    </main>
  </div>;
}

function Welcome({ data, serverName, onStart }: { data: Bootstrap; serverName: string; onStart: () => void }) {
  const firstName = (data.currentUser.displayName ?? "").trim().split(/\s+/)[0];
  const items = [
    { icon: <Sparkles size={17} />, title: "Connect a model provider", text: "Crewly Gateway, an OpenAI, Anthropic or OpenRouter key, or your own subscription." },
    { icon: <UsersRound size={17} />, title: "Pick a crew of agents", text: "Start from templates: an assistant, an engineer, a researcher and more." },
    { icon: <Hash size={17} />, title: "Open some channels", text: "Rooms where your team and your agents work together." },
    { icon: <Mail size={17} />, title: "Invite your team", text: "Send invites by email or share a link." },
  ];
  return <div className="setup-welcome">
    <span className="setup-badge"><Check size={13} strokeWidth={3} /> {data.currentUser.role === "owner" ? "You own this server" : "You're an admin here"}</span>
    <h1 id="setup-title">Welcome to {serverName}{firstName ? `, ${firstName}` : ""}</h1>
    <p className="setup-lead">Your server is running and you're signed in {data.currentUser.signsInWithCrewly
      ? "with your Crewly account"
      : <>as <strong>{data.currentUser.email}</strong></>}. A few minutes here and your crew is ready to work.</p>
    <ul className="setup-welcome-list">
      {items.map((item) => <li key={item.title}>
        <span className="setup-welcome-icon">{item.icon}</span>
        <span><strong>{item.title}</strong><small>{item.text}</small></span>
      </li>)}
    </ul>
    <button type="button" className="primary-button large" onClick={onStart} autoFocus>Let's set it up <ArrowRight size={16} /></button>
    <p className="setup-note">You can skip any step and change it later in Settings.</p>
  </div>;
}

function ProviderStep({ providers, onConnected }: { providers: Bootstrap["providers"]; onConnected: () => Promise<void> }) {
  const [adding, setAdding] = useState(providers.length === 0);
  // Once the first one lands, show it rather than the whole catalogue again.
  useEffect(() => { if (providers.length) setAdding(false); }, [providers.length]);
  const connected = useCallback(() => { void onConnected(); }, [onConnected]);
  return <div className="setup-provider">
    {providers.length > 0 && <ul className="setup-list">
      {providers.map((provider) => <li key={provider.id}>
        <ProviderLogo provider={provider.name} small />
        <span><strong>{providerConnectionLabel(provider)}</strong><small>{provider.detail || "Ready for agents"}</small></span>
        <span className="setup-pill"><Check size={12} strokeWidth={3} /> Connected</span>
      </li>)}
    </ul>}
    {adding
      ? <ProviderConnect embedded onConnected={connected} />
      : <button type="button" className="secondary-button" onClick={() => setAdding(true)}><Plus size={15} /> Connect another provider</button>}
  </div>;
}

function AgentsStep({ data, slot, onCreated, onGoToProvider }: {
  data: Bootstrap;
  slot: HTMLElement | null;
  /** `complete` is false when only some of the picked agents were made. */
  onCreated: (complete: boolean) => Promise<void>;
  onGoToProvider: () => void;
}) {
  const connected = data.providers.filter((provider) => provider.status === "connected");
  const firstConnected = connected[0]?.id ?? "";
  const [providerId, setProviderId] = useState(firstConnected);
  const [model, setModel] = useState("");
  const taken = new Set(data.agents.map((agent) => agent.name.toLowerCase()));
  const [picked, setPicked] = useState<Set<string>>(() => new Set(data.agents.length ? [] : ["assistant", "engineer"]));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  // A model that failed the check and was kept anyway; asking twice would only nag.
  const [unverified, setUnverified] = useState("");
  useEffect(() => { if (!providerId && firstConnected) setProviderId(firstConnected); }, [providerId, firstConnected]);

  if (!connected.length) {
    return <div className="setup-empty">
      <Sparkles size={20} />
      <p>Agents need a model provider first. Connect one and come straight back.</p>
      <button type="button" className="primary-button" onClick={onGoToProvider}>Connect a provider</button>
    </div>;
  }
  const toggle = (id: string) => setPicked((current) => {
    const nextSet = new Set(current);
    if (nextSet.has(id)) nextSet.delete(id); else nextSet.add(id);
    return nextSet;
  });
  const chosen = CREW_TEMPLATES.filter((template) => picked.has(template.id) && !taken.has(template.name.toLowerCase()));

  async function create() {
    if (!chosen.length || saving) return;
    if (!model.trim()) { setError("Choose a model for your crew first."); return; }
    const key = `${providerId}/${model.trim()}`;
    // Prove the model answers before the crew depends on it, rather than on its first reply.
    if (unverified !== key) {
      setChecking(true); setError("");
      try {
        await client.providers.verify(providerId, model.trim());
      } catch (reason) {
        // A server that cannot verify (older) or an account that may not is no verdict on the model.
        const status = (reason as { status?: number }).status;
        if (status !== 404 && status !== 403) {
          setUnverified(key);
          setError(`${messageOf(reason, "That model did not answer.")} Choose another model, or create the crew anyway.`);
          setChecking(false);
          return;
        }
      }
      setChecking(false);
    }
    setSaving(true); setError("");
    let made = 0;
    try {
      for (const template of chosen) {
        await gateway.createAgent({
          name: template.name, role: template.role, instructions: template.instructions,
          model: model.trim(), providerId, avatarMode: "bloop",
        });
        made += 1;
      }
      setPicked(new Set());
      await onCreated(true);
    } catch (reason) {
      setError(messageOf(reason, "The agents could not be created. Check the provider and model."));
      if (made) await onCreated(false);
    } finally {
      setSaving(false);
    }
  }

  return <div className="setup-agents">
    {data.agents.length > 0 && <div className="setup-block">
      <span className="setup-label">On your crew</span>
      <div className="setup-chips">{data.agents.map((agent) => <span key={agent.id} className="setup-chip"><Avatar agent={agent} size="tiny" />{agent.name}</span>)}</div>
    </div>}
    <div className="setup-block setup-model form">
      {connected.length > 1 && <label>
        <span>Provider</span>
        <select value={providerId} onChange={(event) => { setProviderId(event.target.value); setModel(""); }}>
          {connected.map((provider) => <option key={provider.id} value={provider.id}>{providerConnectionLabel(provider)}</option>)}
        </select>
      </label>}
      <div className="setup-model-picker">
        <ModelPicker providerId={providerId} value={model} onChange={setModel} />
      </div>
    </div>
    <div className="setup-block">
      <span className="setup-label">Templates <em>{chosen.length} selected</em></span>
      <div className="setup-grid" role="group" aria-label="Agent templates">
        {CREW_TEMPLATES.map((template) => {
          const exists = taken.has(template.name.toLowerCase());
          const on = picked.has(template.id) && !exists;
          const preview: Agent = { id: `template-${template.id}`, name: template.name, initials: template.name[0], role: template.role, color: "#7857d8", status: "online", model: "", runtime: "Chat", memory: [], avatarMode: "bloop" };
          return <button key={template.id} type="button" className={`setup-option${on ? " is-on" : ""}`} aria-pressed={on}
            disabled={exists} onClick={() => toggle(template.id)}>
            <Avatar agent={preview} size="small" />
            <span className="setup-option-text">
              <strong>{template.name} <em>{template.role}</em></strong>
              <small>{exists ? "Already on your crew" : template.blurb}</small>
            </span>
            <span className="setup-check" aria-hidden="true">{(on || exists) && <Check size={12} strokeWidth={3} />}</span>
          </button>;
        })}
      </div>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {slot && chosen.length > 0 && createPortal(
      <button type="button" className="primary-button" disabled={saving || checking} onClick={() => void create()}>
        {checking ? "Checking the model answers…" : saving ? "Creating your crew…"
          : `${unverified === `${providerId}/${model.trim()}` ? "Create anyway: " : "Create "}${chosen.length} agent${chosen.length === 1 ? "" : "s"}`} <ArrowRight size={16} />
      </button>, slot)}
  </div>;
}

function ChannelsStep({ data, slot, channels, onRefresh, onDone }: {
  data: Bootstrap;
  slot: HTMLElement | null;
  channels: Bootstrap["conversations"];
  onRefresh: () => Promise<void>;
  onDone: () => void;
}) {
  const existing = new Set(channels.map((item) => item.channel!.name.toLowerCase()));
  const [picked, setPicked] = useState<Set<string>>(() => new Set(existing.size > 1 ? [] : ["announcements", "random"]));
  const [custom, setCustom] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [withAgents, setWithAgents] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const general = channels.find((item) => item.channel!.name.toLowerCase() === "general");
  const missingFromGeneral = general ? data.agents.filter((agent) => !general.agentIds.includes(agent.id)) : [];
  const suggestions = CHANNEL_SUGGESTIONS.filter((item) => !existing.has(item.name));

  const toggle = (name: string) => setPicked((current) => {
    const nextSet = new Set(current);
    if (nextSet.has(name)) nextSet.delete(name); else nextSet.add(name);
    return nextSet;
  });
  const addCustom = () => {
    const slug = channelSlug(draft);
    if (!slug) return;
    if (suggestions.some((item) => item.name === slug)) setPicked((current) => new Set([...current, slug]));
    else if (!existing.has(slug) && !custom.includes(slug)) setCustom([...custom, slug]);
    setDraft("");
  };
  const toCreate: ChannelSuggestion[] = [
    ...suggestions.filter((item) => picked.has(item.name)),
    ...custom.map((name) => ({ name, topic: null })),
  ];
  const addAgents = withAgents && data.agents.length > 0;
  const fillGeneral = addAgents && missingFromGeneral.length > 0;

  async function apply() {
    if (saving) return;
    if (!toCreate.length && !fillGeneral) { onDone(); return; }
    setSaving(true); setError("");
    const members = addAgents ? data.agents.map((agent) => ({ participantId: agent.id, participantType: "agent" as const })) : [];
    try {
      for (const item of toCreate) {
        await gateway.createChannel({
          name: item.name, topic: item.topic, visibility: "public",
          postRole: item.adminsPost ? "admin" : "member", members,
        });
      }
      if (fillGeneral && general) {
        for (const agent of missingFromGeneral) await gateway.addChannelMember(general.id, agent.id, "agent");
      }
      setCustom([]);
      await onRefresh();
      onDone();
    } catch (reason) {
      setError(messageOf(reason, "Some channels could not be created."));
      await onRefresh().catch(() => {});
    } finally {
      setSaving(false);
    }
  }

  return <div className="setup-channels">
    <div className="setup-grid" role="group" aria-label="Channels">
      {channels.map((item) => <div key={item.id} className="setup-option is-fixed">
        <span className="setup-option-icon"><Hash size={16} /></span>
        <span className="setup-option-text"><strong>{item.channel!.name}</strong><small>{item.channel!.topic || "Already here"}</small></span>
        <span className="setup-check is-set" aria-hidden="true"><Check size={12} strokeWidth={3} /></span>
      </div>)}
      {suggestions.map((item) => {
        const on = picked.has(item.name);
        return <button key={item.name} type="button" className={`setup-option${on ? " is-on" : ""}`} aria-pressed={on} onClick={() => toggle(item.name)}>
          <span className="setup-option-icon"><Hash size={16} /></span>
          <span className="setup-option-text"><strong>{item.name}</strong><small>{item.topic}{item.adminsPost ? " · admins post" : ""}</small></span>
          <span className="setup-check" aria-hidden="true">{on && <Check size={12} strokeWidth={3} />}</span>
        </button>;
      })}
      {custom.map((name) => <div key={name} className="setup-option is-on">
        <span className="setup-option-icon"><Hash size={16} /></span>
        <span className="setup-option-text"><strong>{name}</strong><small>Your channel</small></span>
        <button type="button" className="icon-button compact" aria-label={`Remove ${name}`} onClick={() => setCustom(custom.filter((entry) => entry !== name))}><X size={14} /></button>
      </div>)}
    </div>
    <form className="setup-add-row" onSubmit={(event) => { event.preventDefault(); addCustom(); }}>
      <span className="setup-add-input"><Hash size={15} /><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Add your own channel" aria-label="New channel name" maxLength={60} spellCheck={false} /></span>
      <button type="submit" className="secondary-button" disabled={!channelSlug(draft)}><Plus size={15} /> Add</button>
    </form>
    {data.agents.length > 0 && <label className="setup-toggle">
      <input type="checkbox" checked={withAgents} onChange={(event) => setWithAgents(event.target.checked)} />
      <span><strong>Bring your agents along</strong><small>Adds {data.agents.map((agent) => agent.name).join(", ")} to {general ? "#general and " : ""}the new channels, so anyone can @mention them there.</small></span>
    </label>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {slot && createPortal(
      <button type="button" className="primary-button" disabled={saving} onClick={() => void apply()}>
        {saving ? "Setting up channels…"
          : toCreate.length ? `Create ${toCreate.length} channel${toCreate.length === 1 ? "" : "s"}`
          : fillGeneral ? "Add agents to #general" : "Continue"} <ArrowRight size={16} />
      </button>, slot)}
  </div>;
}

function PeopleStep({ data, onInvited }: { data: Bootstrap; onInvited: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<Array<{ invite: Invite; email: string | null; delivered: boolean }>>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const others = data.users.filter((user) => user.id !== data.currentUser.id);
  // Invites made before a refresh, or elsewhere, are listed too. Their codes
  // are stored hashed, so only fresh ones can be copied.
  useEffect(() => {
    let active = true;
    client.users.listInvites()
      .then(({ invites }) => {
        if (!active) return;
        const pending = invites.filter((item) => (item.status ?? (item.usedAt ? "accepted" : "pending")) === "pending");
        setSent((current) => [...current, ...pending
          .filter((item) => !current.some((entry) => entry.invite.id === item.id))
          .map((item) => ({ invite: item, email: item.email ?? null, delivered: true }))]);
        if (pending.length) onInvited();
      })
      .catch(() => { /* the list is a convenience; inviting still works */ });
    return () => { active = false; };
  }, [onInvited]);

  async function invite(withEmail: boolean) {
    if (saving) return;
    const address = email.trim();
    if (withEmail && !address) return;
    setSaving(true); setError("");
    try {
      let result;
      try {
        result = await client.users.createInvite({ role, ...(withEmail ? { email: address } : {}) });
      } catch (reason) {
        // A server with no mail set up still invites them: the invite is
        // kept for that address and the owner sends the link themselves.
        if (!(withEmail && (reason as { code?: unknown } | null)?.code === "mail_disabled")) throw reason;
        result = await client.users.createInvite({ role, email: address, send: false });
      }
      const delivered = Boolean(result.delivery && result.delivery.status !== "failed");
      setSent((current) => [{ invite: result.invite, email: withEmail ? address : null, delivered }, ...current]);
      if (withEmail) setEmail("");
      onInvited();
    } catch (reason) {
      setError(messageOf(reason, "The invite could not be created."));
    } finally {
      setSaving(false);
    }
  }
  const copy = (code: string) => {
    void navigator.clipboard?.writeText(inviteLink(code))
      .then(() => { setCopied(code); window.setTimeout(() => setCopied(null), 1800); })
      .catch(() => {});
  };

  return <div className="setup-people">
    <form className="form setup-invite" onSubmit={(event) => { event.preventDefault(); void invite(true); }}>
      <div className="setup-invite-row">
        <input type="email" autoComplete="off" spellCheck={false} placeholder="teammate@company.com" aria-label="Email address"
          value={email} onChange={(event) => setEmail(event.target.value)} />
        <select value={role} onChange={(event) => setRole(event.target.value as "member" | "admin")} aria-label="Role">
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
        <button type="submit" className="primary-button" disabled={saving || !email.trim()}><Mail size={15} /> {saving ? "Sending…" : "Send invite"}</button>
      </div>
      <p className="setup-hint">No email? <button type="button" className="link-button" disabled={saving} onClick={() => void invite(false)}>Create an invite link</button> and share it yourself. Links work for 7 days.</p>
    </form>
    {error && <p className="form-error" role="alert">{error}</p>}
    {(sent.length > 0 || others.length > 0) && <ul className="setup-list">
      {sent.map(({ invite, email: to, delivered }) => <li key={invite.id}>
        <span className="setup-list-icon"><Mail size={15} /></span>
        <span><strong>{to ?? "Invite link"}</strong><small>{!invite.code ? `Invited · ${invite.role} · waiting for them to join` : to ? (delivered ? `Invite emailed · ${invite.role}` : `Email isn't set up on this server. Copy the link and send it to them · ${invite.role}`) : `Anyone with the link joins as ${invite.role}`}</small></span>
        {invite.code && <button type="button" className="secondary-button compact" onClick={() => copy(invite.code!)}><Copy size={14} /> {copied === invite.code ? "Copied" : "Copy link"}</button>}
      </li>)}
      {others.map((user) => <li key={user.id}>
        <span className="setup-list-icon"><Check size={15} /></span>
        <span><strong>{user.displayName || user.email}</strong><small>Joined · {user.role}</small></span>
      </li>)}
    </ul>}
  </div>;
}

function ReadyStep({ data, serverName, done, onOpen }: {
  data: Bootstrap;
  serverName: string;
  done: Record<SetupStep, boolean>;
  onOpen: (conversationId?: string) => void;
}) {
  const liveChannels = data.conversations.filter((item) => item.channel && !item.channel.archivedAt);
  const general = liveChannels.find((item) => item.channel!.name.toLowerCase() === "general") ?? liveChannels[0];
  const dm = data.conversations.find((item) => item.type === "dm");
  const firstAgent = data.agents[0];
  const connected = data.providers.filter((provider) => provider.status === "connected");
  const rows: Array<[string, boolean, string]> = [
    ["Model provider", done.provider, done.provider ? connected.map(providerConnectionLabel).join(", ") : "Skipped. Connect one from Settings"],
    ["Agents", done.agents, done.agents ? data.agents.map((agent) => agent.name).join(", ") : "None yet"],
    ["Channels", liveChannels.length > 0, liveChannels.map((item) => `#${item.channel!.name}`).join("  ") || "None yet"],
    ["People", done.people, done.people ? "Invites on their way" : "Just you for now"],
  ];
  return <div className="setup-ready">
    <span className="setup-ready-mark"><Check size={26} strokeWidth={3} /></span>
    <h1 id="setup-title">{serverName} is ready</h1>
    <p className="setup-lead">Here's what you set up. Anything you skipped is waiting in Settings.</p>
    <ul className="setup-summary">
      {rows.map(([label, ok, detail]) => <li key={label} className={ok ? "is-done" : ""}>
        <span className="setup-step-mark">{ok ? <Check size={13} strokeWidth={3} /> : "–"}</span>
        <span><strong>{label}</strong><small>{detail}</small></span>
      </li>)}
    </ul>
    <div className="setup-ready-actions">
      {firstAgent && dm && <button type="button" className="primary-button large" onClick={() => onOpen(dm.id)} autoFocus>Message {firstAgent.name} <ArrowRight size={16} /></button>}
      {general && <button type="button" className={firstAgent && dm ? "secondary-button large" : "primary-button large"} onClick={() => onOpen(general.id)}>Open #{general.channel!.name}</button>}
      {!general && !(firstAgent && dm) && <button type="button" className="primary-button large" onClick={() => onOpen()}>Open {serverName}</button>}
    </div>
  </div>;
}
