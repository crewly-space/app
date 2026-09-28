import { useEffect, useState } from "react";
import type { AuthUser, Connector, ConnectorGrant, ConnectorProvider, ConnectorProviderDefinition, DeviceInfo, DevicePairingInfo, ModelInfo, ServerBranding, SlackImportChannel } from "@crewly/sdk";
import { Check, ChevronLeft, ChevronRight, Cloud, FileText, GitBranch, HardDrive, Laptop, LockKeyhole, Monitor, Moon, Plug, Plus, RefreshCw, Sun, X } from "lucide-react";
import { gateway } from "../../lib/gateway";
import { client } from "../../lib/api/client";
import { navigateToServerUrl } from "../../lib/safe-navigation";
import { ProviderConnect } from "../providers/ProviderConnect";
import { ProviderCredentials } from "../providers/ProviderCredentials";
import { ProviderLogo } from "../providers/ProviderLogo";
import type { Agent, Provider } from "../../types";
import type { Theme } from "../../app-types";
import type { AvatarMode } from "@crewly/protocol";
import { AvatarModePicker, UserAvatar } from "../appearance/Avatar";
import { providerConnectionLabel } from "../providers/labels";
import { useDialog } from "../../lib/layers";
import { AdminSection, type AdminSectionId } from "../dashboard/AdminSection";
import { serverApi, type DashboardApi } from "../dashboard/api";
import type { PlatformApi } from "../dashboard/platform-api";
import type { ServicesApi } from "../dashboard/services-api";
import { canOpen, findSection, visibleGroups, type SettingsSectionId } from "./sections";

/** Settings sections that are rendered by the server-administration component. */
const ADMIN_SECTIONS: Partial<Record<SettingsSectionId, AdminSectionId>> = {
  people: "people", roles: "roles", agents: "agents",
  tools: "tools", skills: "skills", secrets: "secrets", mail: "mail", cloud: "cloud", federation: "federation",
  usage: "usage", runs: "runs", automations: "automations",
};

/** Old servers do not expose their provider catalog, so these remain a compatible fallback. */
const DEFAULT_CONNECTOR_APPS: ConnectorProviderDefinition[] = [
  { provider: "github", label: "GitHub", description: "Repositories, issues and pull requests.", capabilities: [], scopes: [] },
  { provider: "linear", label: "Linear", description: "Issues, projects and cycles.", capabilities: [], scopes: [] },
  { provider: "slack", label: "Slack", description: "Channels and messages, with a one-time import.", capabilities: [], scopes: [] },
];
const connectorIcon = (provider: ConnectorProvider) => provider === "github" || provider === "gitlab" ? GitBranch
  : provider === "notion" ? FileText : provider === "google-drive" ? HardDrive : provider === "slack" ? Cloud : Plug;

/** 128000 reads as noise; 128K is the number people compare. */
function contextLabel(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M context`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K context`;
  return `${tokens} context`;
}

/** Where Settings opens on a wide screen when nothing asked for a section. */
function defaultSection(role: string): SettingsSectionId {
  return role === "owner" || role === "admin" ? "providers" : "appearance";
}

/**
 * Settings: everything a person or an admin can configure, in one place.
 *
 * Grouped by whose setting it is -- your account, then this server -- and
 * gated by role from the section map in ./sections. On a phone it is a list of
 * sections that opens one at a time, so nothing has to scroll sideways.
 */
export function SettingsPanel({
  providers,
  connectors,
  devices,
  agents,
  currentUser,
  serverBranding,
  onAvatarModeChange,
  theme,
  onThemeChange,
  onNotify,
  onProvidersChanged,
  onConnectorsChanged,
  onDevicesChanged,
  onServerBrandingChanged,
  onClose,
  serverName,
  initialSection,
  adminApi = serverApi,
  platform,
  services,
}: {
  providers: Provider[];
  connectors: Connector[];
  devices: DeviceInfo[];
  agents: Agent[];
  currentUser: AuthUser;
  serverBranding: ServerBranding;
  onAvatarModeChange: (mode: AvatarMode) => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  onNotify: (message: string) => void;
  onProvidersChanged: () => Promise<void>;
  onConnectorsChanged: () => Promise<void>;
  onDevicesChanged: () => Promise<void>;
  onServerBrandingChanged: (input: { displayName: string; tagline: string; iconDataUrl: string | null }) => Promise<void>;
  onClose: () => void;
  /** The server being administered, so nobody mistakes a server setting for their own. */
  serverName?: string;
  /** Open on this section, e.g. from /admin or a "Connect a provider" nudge. */
  initialSection?: SettingsSectionId;
  adminApi?: DashboardApi;
  platform?: PlatformApi;
  services?: ServicesApi;
}) {
  const role = currentUser.role;
  const requested = findSection(initialSection);
  const [section, setSection] = useState<SettingsSectionId>(
    requested && canOpen(requested, role) ? requested.id : defaultSection(role),
  );
  // Phones show either the list of sections or one section, never both.
  const [pane, setPane] = useState<"nav" | "content">(requested ? "content" : "nav");
  const [addingProvider, setAddingProvider] = useState(false);
  const [managingProvider, setManagingProvider] = useState<Provider | null>(null);
  const [models, setModels] = useState<{ providerId: string; list: ModelInfo[] } | null>(null);
  const [modelsError, setModelsError] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [pairing, setPairing] = useState<DevicePairingInfo | null>(null);
  const [pairingError, setPairingError] = useState("");
  const [pairingBusy, setPairingBusy] = useState(false);
  const [connectorBusy, setConnectorBusy] = useState(false);
  const [connectorApps, setConnectorApps] = useState<ConnectorProviderDefinition[]>(DEFAULT_CONNECTOR_APPS);
  const [connectorAccess, setConnectorAccess] = useState<string | null>(null);
  const [connectorGrants, setConnectorGrants] = useState<Record<string, ConnectorGrant[]>>({});
  const [connectorGrantAgent, setConnectorGrantAgent] = useState<Record<string, string>>({});
  const [slackChannels, setSlackChannels] = useState<SlackImportChannel[]>([]);
  const [selectedSlackChannels, setSelectedSlackChannels] = useState<string[]>([]);
  const [slackHistory, setSlackHistory] = useState(0);
  const [slackMembers, setSlackMembers] = useState(true);
  const [brandingName, setBrandingName] = useState(serverBranding.displayName);
  const [brandingTagline, setBrandingTagline] = useState(serverBranding.tagline);
  const [brandingIcon, setBrandingIcon] = useState<string | null>(serverBranding.iconDataUrl);
  const [brandingBusy, setBrandingBusy] = useState(false);
  const [brandingError, setBrandingError] = useState("");
  const canManageServer = role === "owner" || role === "admin";
  const dialogRef = useDialog(onClose);
  const groups = visibleGroups(role);
  const current = findSection(section)!;

  const open = (id: SettingsSectionId) => { setSection(id); setPane("content"); };

  useEffect(() => {
    if (!canManageServer) return;
    void client.connectors.providers().then((result) => setConnectorApps(result.providers)).catch(() => undefined);
  }, [canManageServer]);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const code = query.get("code");
    const state = query.get("state");
    const provider = query.get("connector");
    const app = connectorApps.find((entry) => entry.provider === provider);
    if (!app || !code || !state || !canManageServer) return;
    setSection("connectors"); setPane("content");
    setConnectorBusy(true);
    const complete = client.connectors.completeOAuth(app.provider, { code, state });
    const name = app.label;
    void complete.then(async () => {
      window.history.replaceState({}, "", window.location.pathname);
      await onConnectorsChanged();
      onNotify(`${name} connected.`);
    }).catch(() => onNotify(`${name} could not be connected.`)).finally(() => setConnectorBusy(false));
  }, [canManageServer, connectorApps, onConnectorsChanged, onNotify]);

  const connect = async (app: ConnectorProvider) => {
    setConnectorBusy(true);
    const callbackUrl = `${window.location.origin}/?connector=${app}`;
    try {
      const pending = await client.connectors.startOAuth(app, { callbackUrl });
      navigateToServerUrl(pending.authorizeUrl);
    } catch {
      setConnectorBusy(false);
      onNotify(`${connectorApps.find((entry) => entry.provider === app)?.label ?? app} OAuth is not configured on this server.`);
    }
  };
  const manageConnectorAccess = async (connector: Connector) => {
    if (connectorAccess === connector.id) { setConnectorAccess(null); return; }
    setConnectorBusy(true);
    try {
      const result = await client.connectors.grants(connector.id);
      setConnectorGrants((current) => ({ ...current, [connector.id]: result.grants }));
      setConnectorGrantAgent((current) => ({ ...current, [connector.id]: current[connector.id] ?? agents[0]?.id ?? "" }));
      setConnectorAccess(connector.id);
    } catch { onNotify("Connector access rules could not be loaded."); }
    finally { setConnectorBusy(false); }
  };
  const toggleConnectorGrant = async (connector: Connector, agentId: string, capability: Connector["capabilities"][number], enabled: boolean) => {
    const existing = connectorGrants[connector.id] ?? [];
    const next = existing.filter((grant) => !(grant.granteeType === "agent" && grant.granteeId === agentId && grant.capability === capability));
    if (enabled) next.push({ connectorId: connector.id, granteeType: "agent", granteeId: agentId, capability, createdAt: new Date().toISOString() });
    setConnectorBusy(true);
    try {
      const saved = await client.connectors.setGrants(connector.id, next.map(({ granteeType, granteeId, capability: granted }) => ({ granteeType, granteeId, capability: granted })));
      setConnectorGrants((current) => ({ ...current, [connector.id]: saved.grants }));
    } catch { onNotify("Connector access rule could not be saved."); }
    finally { setConnectorBusy(false); }
  };
  const saveBranding = async () => {
    setBrandingBusy(true); setBrandingError("");
    try {
      await onServerBrandingChanged({ displayName: brandingName.trim(), tagline: brandingTagline.trim(), iconDataUrl: brandingIcon });
      onNotify("Server identity saved.");
    } catch (reason) {
      setBrandingError(reason instanceof Error ? reason.message : "Server identity could not be saved.");
    } finally { setBrandingBusy(false); }
  };
  const chooseBrandingIcon = (file: File | undefined) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/svg+xml'].includes(file.type)) {
      setBrandingError("Use a PNG, JPEG or SVG icon.");
      return;
    }
    if (file.size > 256 * 1024) {
      setBrandingError("Icons must be 256 KB or smaller.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => { setBrandingIcon(typeof reader.result === 'string' ? reader.result : null); setBrandingError(""); };
    reader.onerror = () => setBrandingError("That icon could not be read.");
    reader.readAsDataURL(file);
  };
  const browseModels = async (providerId: string) => {
    if (models?.providerId === providerId) { setModels(null); return; }
    setModelsError("");
    try { setModels({ providerId, list: await adminApi.listModels(providerId) }); }
    catch (reason) { setModels(null); setModelsError(reason instanceof Error ? reason.message : "Models could not be listed."); }
  };

  const adminSection = ADMIN_SECTIONS[section];
  const body = adminSection ? (
    <AdminSection
      key={adminSection}
      section={adminSection}
      api={adminApi}
      platform={platform}
      services={services}
      currentUser={currentUser}
      serverName={serverName ?? serverBranding.displayName}
    />
  ) : section === "providers" ? (
    <>
      {canManageServer && <div className="settings-toolbar">
        <button type="button" className="primary-button compact" onClick={() => setAddingProvider(true)}>
          <Plus size={15} /> Add provider
        </button>
      </div>}
      {!providers.length && <div className="empty-state">
        <strong>No AI provider yet</strong>
        <p>{canManageServer
          ? "Agents can't reply until one is connected. Use Crewly Gateway for models through your Crewly account, a provider's API key, or a subscription on your own computer."
          : "Agents can't reply until an admin connects one."}</p>
      </div>}
      {providers.map((provider) => (
        <div className="settings-item" key={provider.id}>
          <div className="setting-row">
            <ProviderLogo provider={provider.name} small />
            <div>
              <strong>{providerConnectionLabel(provider)}</strong>
              <span>{provider.detail}</span>
            </div>
            {!canManageServer ? <span className="connected-label"><Check size={13} /> Ready</span> : (
              <div className="setting-row-actions">
                {provider.status !== "available" && <button type="button" className="text-button"
                  aria-expanded={models?.providerId === provider.id}
                  aria-label={`Models from ${providerConnectionLabel(provider)}`}
                  onClick={() => void browseModels(provider.id)}>Models</button>}
                {provider.status === "available"
                  ? <button type="button" className="use-button" onClick={() => onNotify(`${providerConnectionLabel(provider)} is ready to use.`)}>Use</button>
                  : <button type="button" className="use-button" onClick={() => setManagingProvider(provider)}>Manage</button>}
              </div>
            )}
          </div>
          {models?.providerId === provider.id && (
            models.list.length === 0 ? <p className="field-description">This provider listed no models.</p> : (
              <ul className="settings-models">
                {models.list.map((model) => <li key={model.id}><strong>{model.displayName}</strong><small>{model.id}</small>{model.contextWindow > 0 && <small>{contextLabel(model.contextWindow)}</small>}</li>)}
              </ul>
            )
          )}
        </div>
      ))}
      {modelsError && <p className="form-error" role="alert">{modelsError}</p>}
      <div className="local-note">
        <LockKeyhole size={15} />
        <span>Provider credentials are stored encrypted on this server and never sent back to the browser.</span>
      </div>
    </>
  ) : section === "connectors" ? (
    <>
      <div className="connector-apps">
        {connectorApps.map((app) => {
          const connected = connectors.filter((connector) => connector.provider === app.provider);
          const Icon = connectorIcon(app.provider);
          return (
            <div className="connector-app" key={app.provider}>
              <span className="connector-app-icon"><Icon size={18} /></span>
              <div>
                <strong>{app.label}</strong>
                <span>{app.description}</span>
              </div>
              {connected.some((connector) => connector.status === "connected")
                ? <span className="connector-status connected">Connected</span>
                : <button type="button" className="secondary-button compact" disabled={connectorBusy} onClick={() => void connect(app.provider)}>Connect</button>}
            </div>
          );
        })}
      </div>
      {connectors.map((connector) => (
        <div className="connector-card" key={connector.id}>
          <div className="connector-card-heading"><GitBranch size={19} /><div><strong>{connector.accountName || connectorApps.find((app) => app.provider === connector.provider)?.label || connector.provider}</strong><span>{connector.provider} · {connector.status.replaceAll("_", " ")}</span></div><span className={`connector-status ${connector.status}`}>{connector.status === "connected" ? "Connected" : "Action needed"}</span></div>
          <p>{connector.scopes.length ? `Scopes: ${connector.scopes.join(", ")}` : "No permissions granted yet."}</p>
          <small>Capabilities are not available to agents until an explicit policy grant is added.</small>
          <div className="connector-card-actions">
            {connector.status === "connected" && <button className="text-button" onClick={() => void manageConnectorAccess(connector)} disabled={connectorBusy}>Agent access</button>}
            <button className="text-button" onClick={() => void client.connectors.refresh(connector.id).then(onConnectorsChanged)} disabled={connectorBusy}><RefreshCw size={13} /> Refresh</button>
            <button className="text-button danger" onClick={() => void client.connectors.revoke(connector.id).then(onConnectorsChanged)} disabled={connectorBusy}>Disconnect</button>
            {connector.provider === 'slack' && connector.status === 'connected' && <button className="text-button" onClick={() => {
              setConnectorBusy(true);
              void client.connectors.slackChannels(connector.id).then((result) => {
                setSlackChannels(result.channels);
                setSelectedSlackChannels(result.channels.map((channel) => channel.id));
              }).catch(() => onNotify('Slack channels could not be loaded.')).finally(() => setConnectorBusy(false));
            }}>Import channels</button>}
          </div>
          {connectorAccess === connector.id && <div className="connector-access">
            <strong>Agent access</strong>
            {!agents.length ? <p>Create an agent before granting connector tools.</p> : <>
              <label>Agent <select value={connectorGrantAgent[connector.id] ?? agents[0]!.id} onChange={(event) => setConnectorGrantAgent((current) => ({ ...current, [connector.id]: event.target.value }))}>
                {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
              </select></label>
              <div className="dashboard-toggles">
                {connector.capabilities.map((capability) => {
                  const agentId = connectorGrantAgent[connector.id] ?? agents[0]!.id;
                  const checked = (connectorGrants[connector.id] ?? []).some((grant) => grant.granteeType === "agent" && grant.granteeId === agentId && grant.capability === capability);
                  return <label key={capability}><input type="checkbox" checked={checked} disabled={connectorBusy}
                    onChange={(event) => void toggleConnectorGrant(connector, agentId, capability, event.target.checked)} /> {capability.replaceAll("_", " ")}</label>;
                })}
              </div>
              <small>Reads still follow network policy. Writes also require external side-effect permission or an approval.</small>
            </>}
          </div>}
          {connector.provider === 'slack' && slackChannels.length > 0 && <div className="slack-import">
            <strong>QuickStart from Slack</strong>
            <p>Select exactly what Crewly should copy. Retrying is safe and does not duplicate imported items.</p>
            {slackChannels.map((channel) => <label key={channel.id}><input type="checkbox" checked={selectedSlackChannels.includes(channel.id)} onChange={(event) => setSelectedSlackChannels((current) => event.target.checked ? [...current, channel.id] : current.filter((id) => id !== channel.id))} /> #{channel.name} {channel.topic && <small>— {channel.topic}</small>}</label>)}
            <label>Recent messages per channel <input type="number" min={0} max={100} value={slackHistory} onChange={(event) => setSlackHistory(Number(event.target.value))} /></label>
            <label><input type="checkbox" checked={slackMembers} onChange={(event) => setSlackMembers(event.target.checked)} /> Create Crewly invitations for Slack members with email access</label>
            <button className="primary-button" disabled={connectorBusy || !selectedSlackChannels.length} onClick={() => {
              setConnectorBusy(true);
              void client.connectors.importSlack(connector.id, { channelIds: selectedSlackChannels, historyLimit: slackHistory, importMembers: slackMembers }).then((summary) => {
                onNotify(`Slack import complete: ${summary.createdChannels} channels, ${summary.importedMessages} messages, ${summary.invitedMembers} invitations.`);
                setSlackChannels([]);
                return onConnectorsChanged();
              }).catch(() => onNotify('Slack import did not finish.')).finally(() => setConnectorBusy(false));
            }}>Import selected</button>
          </div>}
        </div>
      ))}
      <p className="settings-aside">
        Connectors are apps signed in with OAuth. For a tool that speaks MCP, use <button type="button" className="text-button inline" onClick={() => open("tools")}>MCP tools</button>; models come from <button type="button" className="text-button inline" onClick={() => open("providers")}>AI providers</button>.
      </p>
      <div className="local-note"><LockKeyhole size={15} /><span>Connectors use encrypted server credentials. Tokens and secrets never return to the browser.</span></div>
    </>
  ) : section === "devices" ? (
    <>
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
  ) : section === "general" ? (
    <>
      <form className="form settings-form" onSubmit={(event) => { event.preventDefault(); void saveBranding(); }}>
        <h4 className="settings-subheading">Server identity</h4>
        <p className="field-description">Members see this name and icon; only admins can change them.</p>
        <label>
          <span>Display name</span>
          <input maxLength={60} required value={brandingName} onChange={(event) => setBrandingName(event.target.value)} />
        </label>
        <label>
          <span>Tagline <em>Optional</em></span>
          <input maxLength={160} value={brandingTagline} onChange={(event) => setBrandingTagline(event.target.value)} placeholder="The team's shared workspace" />
        </label>
        <div className="branding-icon-editor">
          <div className="branding-icon-preview">
            {brandingIcon ? <img src={brandingIcon} alt="Current server icon" /> : <span>{(brandingName.trim().slice(0, 2) || "C").toUpperCase()}</span>}
          </div>
          <div>
            <strong>Server icon</strong>
            <small>PNG, JPEG or SVG, up to 256 KB.</small>
            <div className="form-actions">
              <label className="text-button">
                Choose icon
                <input type="file" accept="image/png,image/jpeg,image/svg+xml" hidden onChange={(event) => chooseBrandingIcon(event.target.files?.[0])} />
              </label>
              {brandingIcon && <button type="button" className="text-button danger" onClick={() => setBrandingIcon(null)}>Remove</button>}
            </div>
          </div>
        </div>
        {brandingError && <p className="form-error" role="alert">{brandingError}</p>}
        <div className="settings-form-actions">
          <button type="submit" className="primary-button" disabled={brandingBusy || !brandingName.trim()}>
            {brandingBusy ? "Saving…" : "Save server identity"}
          </button>
        </div>
      </form>
      <AdminSection section="status" api={adminApi} platform={platform} services={services}
        currentUser={currentUser} serverName={serverName ?? serverBranding.displayName} />
    </>
  ) : (
    <>
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
        <strong>Your avatar</strong>
        <span>How you appear to everyone on this server. Each agent's avatar is chosen in its settings.</span>
      </div>
      <AvatarModePicker
        name="my-avatar"
        legend="Your avatar"
        value={currentUser.avatarMode ?? "bloop"}
        onChange={onAvatarModeChange}
        preview={(mode) => <UserAvatar id={currentUser.id} name={currentUser.displayName ?? currentUser.email} mode={mode} />}
      />
      <p className="avatar-privacy-note">
        Avatars are generated on each device from a name or id. Only
        the style you choose is stored.
      </p>
    </>
  );

  return (
    <div className="modal-layer settings-layer" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
    <div ref={dialogRef} className="settings-panel settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" data-pane={pane}>
      <header>
        {pane === "content" && (
          <button type="button" className="icon-button compact settings-back" onClick={() => setPane("nav")} aria-label="Back to settings">
            <ChevronLeft size={18} />
          </button>
        )}
        <strong id="settings-title">Settings</strong>
        <span className="settings-header-section" aria-hidden="true">{current.label}</span>
        <button
          className="icon-button compact"
          onClick={onClose}
          aria-label="Close settings"
        >
          <X size={18} />
        </button>
      </header>
      <div className="settings-body">
      <nav className="settings-nav" aria-label="Settings sections">
        {groups.map((group) => (
          <div className="settings-nav-group" key={group.id}>
            <span className="settings-nav-label">{group.label}</span>
            {group.id === "account" && <span className="settings-nav-hint">{currentUser.email}</span>}
            {group.id === "server" && serverName && <span className="settings-nav-hint">{serverName}</span>}
            {group.sections.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className={section === id ? "active" : ""}
                aria-current={section === id ? "page" : undefined}
                onClick={() => open(id)}
              >
                <Icon size={16} /> <span>{label}</span> <ChevronRight size={15} className="settings-nav-chevron" aria-hidden="true" />
              </button>
            ))}
          </div>
        ))}
        <button type="button" className="text-button settings-logout" onClick={() => void gateway.logout()}>Log out</button>
      </nav>
      <div className="settings-content">
        <div className="section-heading">
          <div>
            <h3>{current.label}</h3>
            <p>{current.summary}</p>
          </div>
        </div>
        {body}
      </div>
      </div>
      {/* The same full screen first run uses; from a panel it has to cover the
          app, or it renders inside a 330px column and runs off its edge. */}
      {addingProvider && <div className="provider-connect-layer"><ProviderConnect onClose={() => setAddingProvider(false)} onConnected={() => {
        setAddingProvider(false); onProvidersChanged(); onNotify('Provider saved.');
      }} /></div>}
      {managingProvider && <ProviderCredentials
        provider={managingProvider}
        usedByAgents={agents.filter((agent) => agent.providerId === managingProvider.id).length}
        onClose={() => setManagingProvider(null)}
        onChanged={async (message) => {
          await onProvidersChanged(); setManagingProvider(null); onNotify(message);
        }}
      />}
    </div>
    </div>
  );
}
