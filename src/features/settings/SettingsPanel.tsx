import { useEffect, useState, type ReactNode } from "react";
import { Blobatar } from "@blobatar/react";
import { bloopSvg } from "@crewly/bloop";
import type { AuthUser, Connector, DeviceInfo, DevicePairingInfo, DirectoryUser, ServerBranding, SlackImportChannel, UserAccount } from "@crewly/sdk";
import { Building2, Check, Cpu, GitBranch, Laptop, LockKeyhole, Monitor, Moon, Palette, Plug, Plus, RefreshCw, Sun, UserRound, X } from "lucide-react";
import { gateway } from "../../lib/gateway";
import { client } from "../../lib/api/client";
import { ProviderConnect } from "../providers/ProviderConnect";
import { ProviderCredentials } from "../providers/ProviderCredentials";
import { ProviderLogo } from "../providers/ProviderLogo";
import type { Agent, Provider } from "../../types";
import type { Theme } from "../../app-types";
import type { AvatarMode } from "@crewly/protocol";
import { AvatarModePicker, UserAvatar } from "../appearance/Avatar";
import { providerConnectionLabel } from "../providers/labels";
import { InvitesManager } from "../people/InvitesManager";
import { serverInvitesApi } from "../people/api";
import { useDialog } from "../../lib/layers";

export function SettingsPanel({
  providers,
  connectors,
  devices,
  agents,
  currentUser,
  users,
  people,
  serverBranding,
  onAvatarModeChange,
  theme,
  onThemeChange,
  onNotify,
  onProvidersChanged,
  onConnectorsChanged,
  onUsersChanged,
  onDevicesChanged,
  onServerBrandingChanged,
  onClose,
  serverName,
}: {
  providers: Provider[];
  connectors: Connector[];
  devices: DeviceInfo[];
  agents: Agent[];
  currentUser: AuthUser;
  users: UserAccount[];
  people: DirectoryUser[];
  serverBranding: ServerBranding;
  onAvatarModeChange: (mode: AvatarMode) => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  onNotify: (message: string) => void;
  onProvidersChanged: () => Promise<void>;
  onConnectorsChanged: () => Promise<void>;
  onUsersChanged: () => Promise<void>;
  onDevicesChanged: () => Promise<void>;
  onServerBrandingChanged: (input: { displayName: string; tagline: string; iconDataUrl: string | null }) => Promise<void>;
  onClose: () => void;
  /** The server being administered, so nobody mistakes a server setting for their own. */
  serverName?: string;
}) {
  const [section, setSection] = useState<
    "providers" | "connectors" | "members" | "devices" | "server" | "appearance"
  >("providers");
  const [addingProvider, setAddingProvider] = useState(false);
  const [managingProvider, setManagingProvider] = useState<Provider | null>(null);
  const [pairingCode, setPairingCode] = useState("");
  const [pairing, setPairing] = useState<DevicePairingInfo | null>(null);
  const [pairingError, setPairingError] = useState("");
  const [pairingBusy, setPairingBusy] = useState(false);
  const [connectorBusy, setConnectorBusy] = useState(false);
  const [slackChannels, setSlackChannels] = useState<SlackImportChannel[]>([]);
  const [selectedSlackChannels, setSelectedSlackChannels] = useState<string[]>([]);
  const [slackHistory, setSlackHistory] = useState(0);
  const [slackMembers, setSlackMembers] = useState(true);
  const [brandingName, setBrandingName] = useState(serverBranding.displayName);
  const [brandingTagline, setBrandingTagline] = useState(serverBranding.tagline);
  const [brandingIcon, setBrandingIcon] = useState<string | null>(serverBranding.iconDataUrl);
  const [brandingBusy, setBrandingBusy] = useState(false);
  const [brandingError, setBrandingError] = useState("");
  const canManageServer = currentUser.role === 'owner' || currentUser.role === 'admin';
  const dialogRef = useDialog(onClose);
  const navButton = (id: typeof section, icon: ReactNode, label: string) => (
    <button
      type="button"
      className={section === id ? "active" : ""}
      aria-current={section === id ? "page" : undefined}
      onClick={() => setSection(id)}
    >
      {icon} {label}
    </button>
  );
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const code = query.get("code");
    const state = query.get("state");
    const provider = query.get("connector");
    if (!provider || !["github", "linear", "slack"].includes(provider) || !code || !state || !canManageServer) return;
    setConnectorBusy(true);
    const complete = provider === "linear" ? client.connectors.completeLinearOAuth({ code, state }) : provider === "slack" ? client.connectors.completeSlackOAuth({ code, state }) : client.connectors.completeGitHubOAuth({ code, state });
    void complete.then(async () => {
      window.history.replaceState({}, "", window.location.pathname);
      await onConnectorsChanged();
      onNotify(`${provider === "linear" ? "Linear" : provider === "slack" ? "Slack" : "GitHub"} connected.`);
    }).catch(() => onNotify(`${provider === "linear" ? "Linear" : provider === "slack" ? "Slack" : "GitHub"} could not be connected.`)).finally(() => setConnectorBusy(false));
  }, [canManageServer, onConnectorsChanged, onNotify]);
  const connectGitHub = async () => {
    setConnectorBusy(true);
    try {
      const pending = await client.connectors.startGitHubOAuth({ callbackUrl: `${window.location.origin}/?connector=github` });
      window.location.assign(pending.authorizeUrl);
    } catch {
      setConnectorBusy(false);
      onNotify("GitHub OAuth is not configured on this server.");
    }
  };
  const connectLinear = async () => {
    setConnectorBusy(true);
    try {
      const pending = await client.connectors.startLinearOAuth({ callbackUrl: `${window.location.origin}/?connector=linear` });
      window.location.assign(pending.authorizeUrl);
    } catch {
      setConnectorBusy(false);
      onNotify("Linear OAuth is not configured on this server.");
    }
  };
  const connectSlack = async () => {
    setConnectorBusy(true);
    try {
      const pending = await client.connectors.startSlackOAuth({ callbackUrl: `${window.location.origin}/?connector=slack` });
      window.location.assign(pending.authorizeUrl);
    } catch {
      setConnectorBusy(false);
      onNotify("Slack OAuth is not configured on this server.");
    }
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
  return (
    <div className="modal-layer settings-layer" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
    <div ref={dialogRef} className="settings-panel settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header>
        <strong id="settings-title">Settings</strong>
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
        <div className="settings-nav-group">
          <span className="settings-nav-label">Your account</span>
          <span className="settings-nav-hint">{currentUser.email}</span>
          {navButton("appearance", <Palette size={16} />, "Appearance")}
          {navButton("devices", <Laptop size={16} />, "Devices")}
        </div>
        <div className="settings-nav-group">
          <span className="settings-nav-label">This server</span>
          {serverName && <span className="settings-nav-hint">{serverName}</span>}
          {navButton("providers", <Cpu size={16} />, "Providers")}
          {canManageServer && navButton("connectors", <Plug size={16} />, "Connectors")}
          {canManageServer && navButton("members", <UserRound size={16} />, "People")}
          {canManageServer && navButton("server", <Building2 size={16} />, "Server")}
        </div>
        <button type="button" className="text-button settings-logout" onClick={() => void gateway.logout()}>Log out</button>
      </nav>
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
                  <strong>{providerConnectionLabel(provider)}</strong>
                  <span>{provider.detail}</span>
                </div>
                {!canManageServer ? <span className="connected-label"><Check size={13} /> Ready</span> : provider.status === "available" ? (
                  <button
                    className="use-button"
                    onClick={() =>
                      onNotify(`${providerConnectionLabel(provider)} is ready to use.`)
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
        ) : section === "connectors" ? (
          <>
            <div className="section-heading">
              <div>
                <h3>Connectors</h3>
                <p>External services with explicit, auditable capabilities.</p>
              </div>
              <div className="section-heading-actions"><button onClick={() => void connectGitHub()} disabled={connectorBusy}><GitBranch size={15} /> Connect GitHub</button><button onClick={() => void connectLinear()} disabled={connectorBusy}><Plug size={15} /> Connect Linear</button><button onClick={() => void connectSlack()} disabled={connectorBusy}><Plug size={15} /> Connect Slack</button></div>
            </div>
            {connectors.map((connector) => (
              <div className="connector-card" key={connector.id}>
                <div className="connector-card-heading"><GitBranch size={19} /><div><strong>{connector.accountName || (connector.provider === "linear" ? "Linear" : connector.provider === "slack" ? "Slack" : "GitHub")}</strong><span>{connector.provider} · {connector.status.replaceAll("_", " ")}</span></div><span className={`connector-status ${connector.status}`}>{connector.status === "connected" ? "Connected" : "Action needed"}</span></div>
                <p>{connector.scopes.length ? `Scopes: ${connector.scopes.join(", ")}` : "No permissions granted yet."}</p>
                <small>Capabilities are not available to agents until an explicit policy grant is added.</small>
                <div className="connector-card-actions">
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
            {!connectors.length && <div className="empty-state"><Plug size={24} /><strong>No connectors connected</strong><p>Connect GitHub, Linear, or Slack here; MCP tools and AI providers remain separate settings.</p></div>}
            <div className="local-note"><LockKeyhole size={15} /><span>Connectors use encrypted server credentials. Tokens and secrets never return to the browser.</span></div>
          </>
        ) : section === "members" ? (
          <>
            <div className="section-heading">
              <div>
                <h3>People</h3>
                <p>People who can sign in to this server.</p>
              </div>
            </div>
            {users.map((user) => (
              <div className="setting-row" key={user.id}>
                <UserAvatar id={user.id} name={user.displayName} size="small"
                  mode={user.avatarMode ?? people.find((person) => person.id === user.id)?.avatarMode} />
                <div>
                  <strong>{user.displayName}</strong>
                  <span>{user.email}</span>
                </div>
                <span className="device-status-chip">{user.role}</span>
              </div>
            ))}
            <InvitesManager
              api={serverInvitesApi}
              allowAdmin={currentUser.role === 'owner'}
              onNotify={onNotify}
            />
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
        ) : section === "server" ? (
          <>
            <div className="section-heading">
              <div>
                <h3>Server identity</h3>
                <p>Give this server a name and optional icon. Members can see it; only admins can change it.</p>
              </div>
            </div>
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
            <button type="button" className="primary-button" disabled={brandingBusy || !brandingName.trim()} onClick={() => void saveBranding()}>
              {brandingBusy ? "Saving…" : "Save server identity"}
            </button>
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
        )}
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
