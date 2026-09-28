import { useCallback, useEffect, useState } from "react";
import type { Connector, ConnectorCapability, ConnectorGrant, ConnectorProvider, ConnectorProviderDefinition, SlackImportChannel } from "@crewly/sdk";
import { Box, CalendarDays, Check, Cloud, Copy, ExternalLink, FileText, GitBranch, HardDrive, ListChecks, LockKeyhole, Mail, Plug, RefreshCw, type LucideIcon } from "lucide-react";
import { client } from "../../lib/api/client";
import { navigateToServerUrl } from "../../lib/safe-navigation";
import type { Agent } from "../../types";
import type { SettingsSectionId } from "./sections";

/** What a server without a provider catalog (older than 0.1.7) can connect. */
const FALLBACK_PROVIDERS: ConnectorProviderDefinition[] = [
  { provider: "github", label: "GitHub", description: "Repositories, issues and pull requests.", capabilities: ["read_profile", "read_repository", "read_issues", "create_issue", "comment_on_pull_request"], scopes: [] },
  { provider: "linear", label: "Linear", description: "Issues, projects and cycles.", capabilities: ["read_issues", "read_projects", "create_issue", "comment_on_issue"], scopes: [] },
  { provider: "slack", label: "Slack", description: "Channels and messages, with a one-time import.", capabilities: ["read_profile", "read_channels", "read_messages", "post_messages"], scopes: [] },
];

/** Capabilities in the words an admin grants them in. */
const CAPABILITY_LABELS: Record<ConnectorCapability, string> = {
  read_profile: "See the account",
  read_repository: "Read repositories",
  read_issues: "Read issues",
  create_issue: "Create issues",
  comment_on_pull_request: "Comment on pull requests",
  read_projects: "Read projects",
  comment_on_issue: "Comment on issues",
  read_channels: "See channels",
  read_messages: "Read messages",
  post_messages: "Post messages",
  read_pages: "Read pages",
  search_pages: "Search pages",
  create_page: "Create pages",
  comment_on_page: "Comment on pages",
  read_files: "Read files",
  search_files: "Search files",
  create_file: "Create files",
  read_calendar: "See calendars",
  read_events: "Read events",
  create_event: "Create events",
  update_event: "Change events",
  delete_event: "Delete events",
  read_email: "Read email",
  search_email: "Search email",
  send_email: "Send email",
};

const ICONS: Partial<Record<ConnectorProvider, LucideIcon>> = {
  github: GitBranch, gitlab: GitBranch, asana: ListChecks, notion: FileText, "google-drive": HardDrive,
  "google-calendar": CalendarDays, gmail: Mail, dropbox: Box, slack: Cloud,
};

const STATUS_TEXT: Record<Connector["status"], string> = {
  pending: "Sign-in not finished",
  connected: "Connected",
  action_required: "Needs attention",
  permission_revoked: "Access was revoked",
  rate_limited: "Rate limited",
  provider_unavailable: "Service unavailable",
  revoked: "Disconnected",
};

const callbackUrl = (provider: ConnectorProvider) => `${window.location.origin}/?connector=${provider}`;

/**
 * The connector for each app that matters now: a working one first, then one
 * that needs attention, then the latest disconnected one to reconnect. A
 * sign-in that was started and abandoned never hides a real connection.
 */
function currentConnector(connectors: Connector[], provider: ConnectorProvider): Connector | undefined {
  const mine = connectors.filter((connector) => connector.provider === provider);
  return mine.find((connector) => connector.status === "connected")
    ?? mine.find((connector) => connector.status !== "revoked" && connector.status !== "pending")
    ?? mine.find((connector) => connector.status === "revoked");
}

function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="copy-value">
      <code>{value}</code>
      <button type="button" className="icon-button compact" aria-label={`Copy ${value}`} onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); });
      }}>{copied ? <Check size={13} /> : <Copy size={13} />}</button>
    </span>
  );
}

/** The three things an operator does once so admins can press Connect. */
function SetupSteps({ info }: { info: ConnectorProviderDefinition }) {
  const setup = info.setup;
  if (!setup) return null;
  return (
    <ol className="connector-setup">
      <li>
        <span>Create an OAuth app in {info.label}. <a href={setup.setupUrl} target="_blank" rel="noreferrer">Open {info.label} <ExternalLink size={12} /></a></span>
      </li>
      <li>
        <span>Use this as its callback (redirect) URL:</span>
        <CopyValue value={callbackUrl(info.provider)} />
      </li>
      {info.scopes.length > 0 && <li>
        <span>{info.provider === "slack" ? "Add these bot token scopes:" : "It asks for these scopes:"}</span>
        <code className="connector-scopes">{info.scopes.join(" ")}</code>
      </li>}
      <li>
        <span>Put its client ID and secret in the server's environment, then restart the server:</span>
        <CopyValue value={`${setup.clientIdEnv}=`} />
        <CopyValue value={`${setup.clientSecretEnv}=`} />
      </li>
    </ol>
  );
}

/** Which agents may use which of this connector's capabilities. Nothing is granted by connecting. */
function AgentAccess({ connector, info, agents, onNotify }: {
  connector: Connector; info: ConnectorProviderDefinition; agents: Agent[]; onNotify: (message: string) => void;
}) {
  const [grants, setGrants] = useState<ConnectorGrant[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    client.connectors.grants(connector.id)
      .then((result) => { if (live) setGrants(result.grants); })
      .catch((reason: unknown) => { if (live) setError(reason instanceof Error ? reason.message : "Agent access could not be loaded."); });
    return () => { live = false; };
  }, [connector.id]);

  if (error) return <p className="form-error" role="alert">{error}</p>;
  if (!grants) return <p className="field-description">Loading agent access…</p>;
  if (!agents.length) return <p className="field-description">Create an agent first, then choose what it may do with {info.label}.</p>;

  const has = (agentId: string, capability: ConnectorCapability) =>
    grants.some((grant) => grant.granteeType === "agent" && grant.granteeId === agentId && grant.capability === capability);
  const toggle = async (agentId: string, capability: ConnectorCapability) => {
    const next = has(agentId, capability)
      ? grants.filter((grant) => !(grant.granteeType === "agent" && grant.granteeId === agentId && grant.capability === capability))
      : [...grants, { connectorId: connector.id, granteeType: "agent" as const, granteeId: agentId, capability, createdAt: "" }];
    setBusy(true);
    try {
      const saved = await client.connectors.setGrants(connector.id, next.map(({ granteeType, granteeId, capability: granted }) => ({ granteeType, granteeId, capability: granted })));
      setGrants(saved.grants);
    } catch (reason) {
      onNotify(reason instanceof Error ? reason.message : "Agent access could not be saved.");
    } finally { setBusy(false); }
  };

  return (
    <div className="connector-access">
      <strong>Agent access</strong>
      <p>Connecting gives agents nothing. Tick what each agent may do; writes still follow the agent's approval policy.</p>
      {agents.map((agent) => (
        <fieldset key={agent.id} disabled={busy}>
          <legend>{agent.name}</legend>
          {info.capabilities.map((capability) => (
            <label key={capability}>
              <input type="checkbox" checked={has(agent.id, capability)} onChange={() => void toggle(agent.id, capability)} />
              {CAPABILITY_LABELS[capability] ?? capability.replaceAll("_", " ")}
            </label>
          ))}
        </fieldset>
      ))}
    </div>
  );
}

function SlackImport({ connector, busy, setBusy, onNotify, onConnectorsChanged }: {
  connector: Connector; busy: boolean; setBusy: (busy: boolean) => void;
  onNotify: (message: string) => void; onConnectorsChanged: () => Promise<void>;
}) {
  const [channels, setChannels] = useState<SlackImportChannel[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [history, setHistory] = useState(0);
  const [members, setMembers] = useState(true);

  if (!channels.length) return (
    <button type="button" className="text-button" disabled={busy} onClick={() => {
      setBusy(true);
      void client.connectors.slackChannels(connector.id).then((result) => {
        setChannels(result.channels);
        setSelected(result.channels.map((channel) => channel.id));
      }).catch(() => onNotify("Slack channels could not be loaded.")).finally(() => setBusy(false));
    }}>Import channels</button>
  );
  return (
    <div className="slack-import">
      <strong>QuickStart from Slack</strong>
      <p>Select exactly what Crewly should copy. Retrying is safe and does not duplicate imported items.</p>
      {channels.map((channel) => <label key={channel.id}><input type="checkbox" checked={selected.includes(channel.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, channel.id] : current.filter((id) => id !== channel.id))} /> #{channel.name} {channel.topic && <small>— {channel.topic}</small>}</label>)}
      <label>Recent messages per channel <input type="number" min={0} max={100} value={history} onChange={(event) => setHistory(Number(event.target.value))} /></label>
      <label><input type="checkbox" checked={members} onChange={(event) => setMembers(event.target.checked)} /> Create Crewly invitations for Slack members with email access</label>
      <div className="form-actions">
        <button type="button" className="primary-button" disabled={busy || !selected.length} onClick={() => {
          setBusy(true);
          void client.connectors.importSlack(connector.id, { channelIds: selected, historyLimit: history, importMembers: members }).then((summary) => {
            onNotify(`Slack import complete: ${summary.createdChannels} channels, ${summary.importedMessages} messages, ${summary.invitedMembers} invitations.`);
            setChannels([]);
            return onConnectorsChanged();
          }).catch(() => onNotify("Slack import did not finish.")).finally(() => setBusy(false));
        }}>Import selected</button>
        <button type="button" className="text-button" disabled={busy} onClick={() => setChannels([])}>Cancel</button>
      </div>
    </div>
  );
}

/**
 * Connectors: apps Crewly signs in to with OAuth on the server's behalf.
 *
 * One card per app, whatever its state, so the admin always sees the whole
 * catalog and what each app needs next: server setup, a sign-in, attention,
 * or nothing but choosing which agents may use it.
 */
export function ConnectorsSection({ connectors, agents, onNotify, onConnectorsChanged, onOpenSection }: {
  connectors: Connector[];
  agents: Agent[];
  onNotify: (message: string) => void;
  onConnectorsChanged: () => Promise<void>;
  onOpenSection: (id: SettingsSectionId) => void;
}) {
  const [catalog, setCatalog] = useState<ConnectorProviderDefinition[]>(FALLBACK_PROVIDERS);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<ConnectorProvider | null>(null);
  const [connectError, setConnectError] = useState<{ provider: ConnectorProvider; message: string } | null>(null);

  const loadCatalog = useCallback(() => client.connectors.providers()
    .then((result) => { if (result.providers.length) setCatalog(result.providers); })
    .catch(() => undefined), []);
  useEffect(() => { void loadCatalog(); }, [loadCatalog]);

  // Finish a sign-in the provider redirected back from.
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const provider = query.get("connector") as ConnectorProvider | null;
    const code = query.get("code");
    const state = query.get("state");
    // Any provider the server knows; it rejects one it does not.
    if (!provider || !/^[a-z][a-z-]{1,40}$/.test(provider)) return;
    const name = FALLBACK_PROVIDERS.find((entry) => entry.provider === provider)?.label ?? provider;
    window.history.replaceState({}, "", window.location.pathname);
    if (!code || !state) {
      setConnectError({ provider, message: query.get("error_description") ?? `${name} sign-in was cancelled, so nothing was connected.` });
      return;
    }
    setBusy(true);
    void client.connectors.completeOAuth(provider, { code, state }).then(async () => {
      await onConnectorsChanged();
      setOpen(provider);
      onNotify(`${name} connected. Choose which agents may use it.`);
    }).catch((reason: unknown) => {
      setConnectError({ provider, message: reason instanceof Error ? reason.message : `${name} could not be connected.` });
    }).finally(() => setBusy(false));
  }, [onConnectorsChanged, onNotify]);

  const connect = async (info: ConnectorProviderDefinition, reconnect?: Connector) => {
    setBusy(true); setConnectError(null);
    try {
      const pending = await client.connectors.startOAuth(info.provider, { callbackUrl: callbackUrl(info.provider), ...(reconnect ? { connectorId: reconnect.id } : {}) });
      navigateToServerUrl(pending.authorizeUrl);
    } catch (reason) {
      setBusy(false);
      setConnectError({ provider: info.provider, message: reason instanceof Error ? reason.message : `${info.label} could not be connected.` });
      // The server may have been configured since the page loaded, or not at all.
      void loadCatalog();
    }
  };
  const act = (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    void work().then(onConnectorsChanged).then(() => onNotify(done))
      .catch((reason: unknown) => onNotify(reason instanceof Error ? reason.message : "That did not work."))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <div className="connector-apps">
        {catalog.map((info) => {
          const connector = currentConnector(connectors, info.provider);
          const connected = connector?.status === "connected";
          const troubled = connector && !connected && connector.status !== "revoked";
          const needsSetup = info.configured === false && !connected;
          const expanded = open === info.provider;
          const Icon = ICONS[info.provider] ?? Plug;
          const badge = needsSetup ? { text: "Needs server setup", tone: "warning" }
            : connected ? { text: connector.accountName ? `Connected as ${connector.accountName}` : "Connected", tone: "connected" }
            : troubled ? { text: STATUS_TEXT[connector.status], tone: "danger" }
            : connector ? { text: "Disconnected", tone: "muted" } : null;
          const error = connectError?.provider === info.provider ? connectError.message : "";
          return (
            <div className={`connector-app${expanded ? " expanded" : ""}`} key={info.provider}>
              <span className="connector-app-icon"><Icon size={18} /></span>
              <div>
                <strong>{info.label}</strong>
                <span>{info.description}</span>
                {badge && <span className={`connector-status ${badge.tone}`}>{badge.text}</span>}
              </div>
              <div className="connector-app-actions">
                {needsSetup ? (
                  <button type="button" className="secondary-button compact" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : info.provider)}>
                    {expanded ? "Hide setup" : "How to set up"}
                  </button>
                ) : connected ? (
                  <button type="button" className="secondary-button compact" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : info.provider)}>
                    {expanded ? "Done" : "Manage"}
                  </button>
                ) : (
                  <button type="button" className="primary-button compact" disabled={busy} onClick={() => void connect(info, connector)}>
                    {connector ? "Reconnect" : "Connect"}
                  </button>
                )}
              </div>
              {error && <p className="form-error connector-app-detail" role="alert">{error}</p>}
              {troubled && !needsSetup && connector.lastError && !error && <p className="connector-app-detail connector-app-note">{connector.lastError}</p>}
              {expanded && needsSetup && <div className="connector-app-detail">
                <p className="field-description">An admin with access to the server's configuration does this once; after that anyone who manages this server can press Connect.</p>
                <SetupSteps info={info} />
                <div className="form-actions">
                  <button type="button" className="text-button" disabled={busy} onClick={() => void loadCatalog()}><RefreshCw size={13} /> Check again</button>
                </div>
              </div>}
              {expanded && connected && <div className="connector-app-detail">
                <dl className="connector-facts">
                  <dt>Account</dt>
                  <dd>{connector.accountUrl ? <a href={connector.accountUrl} target="_blank" rel="noreferrer">{connector.accountName || connector.accountUrl}</a> : connector.accountName || "—"}</dd>
                  <dt>Granted scopes</dt>
                  <dd>{connector.scopes.length ? <code className="connector-scopes">{connector.scopes.join(" ")}</code> : "None"}</dd>
                  {connector.lastCheckedAt && <><dt>Last checked</dt><dd>{new Date(connector.lastCheckedAt).toLocaleString()}</dd></>}
                </dl>
                <AgentAccess connector={connector} info={info} agents={agents} onNotify={onNotify} />
                <div className="connector-card-actions">
                  <button type="button" className="text-button" disabled={busy} onClick={() => act(() => client.connectors.refresh(connector.id), `${info.label} checked.`)}><RefreshCw size={13} /> Check connection</button>
                  {info.provider === "slack" && <SlackImport connector={connector} busy={busy} setBusy={setBusy} onNotify={onNotify} onConnectorsChanged={onConnectorsChanged} />}
                  <button type="button" className="text-button danger" disabled={busy} onClick={() => {
                    act(() => client.connectors.revoke(connector.id), `${info.label} disconnected. Agent access is kept for when you reconnect.`);
                    setOpen(null);
                  }}>Disconnect</button>
                </div>
              </div>}
            </div>
          );
        })}
      </div>
      <p className="settings-aside">
        Connectors are apps Crewly signs in to with OAuth, with access you grant per agent. Any other tool that speaks MCP goes in <button type="button" className="text-button inline" onClick={() => onOpenSection("tools")}>MCP tools</button>; models come from <button type="button" className="text-button inline" onClick={() => onOpenSection("providers")}>AI providers</button>.
      </p>
      <div className="local-note"><LockKeyhole size={15} /><span>Connector tokens are stored encrypted on this server and never sent back to the browser.</span></div>
    </>
  );
}
