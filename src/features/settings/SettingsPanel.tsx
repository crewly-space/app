import { useEffect, useState } from "react";
import { Blobatar } from "@blobatar/react";
import { bloopSvg } from "@crewly/bloop";
import type { AuthUser, Connector, DeviceInfo, DevicePairingInfo, DirectoryUser, ServerBranding, UserAccount } from "@crewly/sdk";
import { Building2, Check, Cpu, GitBranch, Laptop, LockKeyhole, Monitor, Moon, Palette, Plug, Plus, RefreshCw, Sun, UserRound, X } from "lucide-react";
import { gateway } from "../../lib/gateway";
import { client } from "../../lib/api/client";
import { ProviderConnect } from "../providers/ProviderConnect";
import { ProviderCredentials } from "../providers/ProviderCredentials";
import { ProviderLogo } from "../providers/ProviderLogo";
import { InviteUserDialog } from "./InviteUserDialog";
import type { Agent, Provider } from "../../types";
import type { Theme } from "../../app-types";
import type { AvatarMode } from "@crewly/protocol";
import { AvatarModePicker, UserAvatar } from "../appearance/Avatar";

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
}) {
  const [section, setSection] = useState<
    "providers" | "connectors" | "members" | "devices" | "server" | "appearance"
  >("providers");
  const [addingProvider, setAddingProvider] = useState(false);
  const [managingProvider, setManagingProvider] = useState<Provider | null>(null);
  const [invitingUser, setInvitingUser] = useState(false);
  const [pairingCode, setPairingCode] = useState("");
  const [pairing, setPairing] = useState<DevicePairingInfo | null>(null);
  const [pairingError, setPairingError] = useState("");
  const [pairingBusy, setPairingBusy] = useState(false);
  const [connectorBusy, setConnectorBusy] = useState(false);
  const [brandingName, setBrandingName] = useState(serverBranding.displayName);
  const [brandingTagline, setBrandingTagline] = useState(serverBranding.tagline);
  const [brandingIcon, setBrandingIcon] = useState<string | null>(serverBranding.iconDataUrl);
  const [brandingBusy, setBrandingBusy] = useState(false);
  const [brandingError, setBrandingError] = useState("");
  const canManageServer = currentUser.role === 'owner' || currentUser.role === 'admin';
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const code = query.get("code");
    const state = query.get("state");
    if (query.get("connector") !== "github" || !code || !state || !canManageServer) return;
    setConnectorBusy(true);
    void client.connectors.completeGitHubOAuth({ code, state }).then(async () => {
      window.history.replaceState({}, "", window.location.pathname);
      await onConnectorsChanged();
      onNotify("GitHub connected.");
    }).catch(() => onNotify("GitHub could not be connected.")).finally(() => setConnectorBusy(false));
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
          className={section === "connectors" ? "active" : ""}
          onClick={() => setSection("connectors")}
        >
          <Plug size={16} /> Connectors
        </button>}
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
        {canManageServer && <button
          className={section === "server" ? "active" : ""}
          onClick={() => setSection("server")}
        >
          <Building2 size={16} /> Server
        </button>}
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
        ) : section === "connectors" ? (
          <>
            <div className="section-heading">
              <div>
                <h3>Connectors</h3>
                <p>External services with explicit, auditable capabilities.</p>
              </div>
              <button onClick={() => void connectGitHub()} disabled={connectorBusy}><GitBranch size={15} /> Connect GitHub</button>
            </div>
            {connectors.map((connector) => (
              <div className="connector-card" key={connector.id}>
                <div className="connector-card-heading"><GitBranch size={19} /><div><strong>{connector.accountName || "GitHub"}</strong><span>{connector.status.replaceAll("_", " ")}</span></div><span className={`connector-status ${connector.status}`}>{connector.status === "connected" ? "Connected" : "Action needed"}</span></div>
                <p>{connector.scopes.length ? `Scopes: ${connector.scopes.join(", ")}` : "No permissions granted yet."}</p>
                <small>Capabilities are not available to agents until an explicit policy grant is added.</small>
                <div className="connector-card-actions">
                  <button className="text-button" onClick={() => void client.connectors.refresh(connector.id).then(onConnectorsChanged)} disabled={connectorBusy}><RefreshCw size={13} /> Refresh</button>
                  <button className="text-button danger" onClick={() => void client.connectors.revoke(connector.id).then(onConnectorsChanged)} disabled={connectorBusy}>Disconnect</button>
                </div>
              </div>
            ))}
            {!connectors.length && <div className="empty-state"><Plug size={24} /><strong>No connectors connected</strong><p>Connect GitHub here; MCP tools and AI providers remain separate settings.</p></div>}
            <div className="local-note"><LockKeyhole size={15} /><span>Connectors use encrypted server credentials. Tokens and secrets never return to the browser.</span></div>
          </>
        ) : section === "members" ? (
          <>
            <div className="section-heading">
              <div>
                <h3>People</h3>
                <p>People who can sign in to this server.</p>
              </div>
              <button onClick={() => setInvitingUser(true)}>
                <Plus size={15} /> Invite
              </button>
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
            <div className="security-note">
              <LockKeyhole size={15} />
              <span>Invite links let people choose their own password. Manage pending, accepted and revoked invites from Server admin.</span>
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
      <button className="secondary-button" onClick={() => void gateway.logout()}>Log out</button>
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
      {invitingUser && <InviteUserDialog
        allowAdmin={currentUser.role === 'owner'}
        onClose={() => setInvitingUser(false)}
        onCreated={() => onNotify('Invite created. Copy the link and send it to the new member.')}
      />}
    </aside>
  );
}
