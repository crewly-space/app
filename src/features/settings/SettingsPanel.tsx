import { useEffect, useState } from "react";
import type { AuthUser, Connector, DeviceInfo, DevicePairingInfo, GatewayStatus, ModelInfo, ServerBranding } from "@crewly/sdk";
import { Check, ChevronLeft, ChevronRight, Laptop, LockKeyhole, Monitor, Moon, Plus, Sun, X } from "lucide-react";
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
import { useDialog } from "../../lib/layers";
import { AdminSection, type AdminSectionId } from "../dashboard/AdminSection";
import { serverApi, type DashboardApi } from "../dashboard/api";
import type { PlatformApi } from "../dashboard/platform-api";
import type { ServicesApi } from "../dashboard/services-api";
import { ConnectorsSection } from "./ConnectorsSection";
import { ProfileSection } from "./ProfileSection";
import { canOpen, findSection, visibleGroups, type SettingsSectionId } from "./sections";

/** Settings sections that are rendered by the server-administration component. */
const ADMIN_SECTIONS: Partial<Record<SettingsSectionId, AdminSectionId>> = {
  people: "people", roles: "roles", agents: "agents",
  tools: "tools", skills: "skills", secrets: "secrets", mail: "mail", cloud: "cloud", federation: "federation",
  usage: "usage", runs: "runs", automations: "automations", activity: "activity",
};

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
  onProfileChanged,
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
  /** Reloads who the person is after they change their own profile. */
  onProfileChanged?: () => Promise<void>;
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
  // The last "does this model answer?" check per model, keyed provider/model.
  const [checks, setChecks] = useState<Record<string, { busy: boolean; ok?: boolean; text?: string }>>({});
  // A Gateway already added can stop working when the server's Crewly link does; say so where it is listed.
  const [gatewayProblem, setGatewayProblem] = useState<GatewayStatus | null>(null);
  const hasGateway = providers.some((provider) => provider.name === "crewly-gateway");
  useEffect(() => {
    if (section !== "providers" || !hasGateway || !(role === "owner" || role === "admin")) return;
    let live = true;
    Promise.resolve().then(() => client.providers.gatewayStatus())
      .then((status) => { if (live) setGatewayProblem(status.state === "ready" ? null : status); })
      .catch(() => { if (live) setGatewayProblem(null); });
    return () => { live = false; };
  }, [section, hasGateway, role]);
  const [pairingCode, setPairingCode] = useState("");
  const [pairing, setPairing] = useState<DevicePairingInfo | null>(null);
  const [pairingError, setPairingError] = useState("");
  const [pairingBusy, setPairingBusy] = useState(false);
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
  /** Sends the smallest real request, so an admin knows a model answers before an agent needs it. */
  const testModel = async (providerId: string, model: string) => {
    const key = `${providerId}/${model}`;
    setChecks((current) => ({ ...current, [key]: { busy: true } }));
    try {
      const result = await client.providers.verify(providerId, model);
      setChecks((current) => ({ ...current, [key]: { busy: false, ok: true, text: `Answered in ${(result.latencyMs / 1000).toFixed(1)}s` } }));
    } catch (reason) {
      setChecks((current) => ({ ...current, [key]: { busy: false, ok: false, text: reason instanceof Error ? reason.message : "It did not answer." } }));
    }
  };
  const browseModels = async (providerId: string) => {
    if (models?.providerId === providerId) { setModels(null); return; }
    setModelsError("");
    try { setModels({ providerId, list: await adminApi.listModels(providerId) }); }
    catch (reason) { setModels(null); setModelsError(reason instanceof Error ? reason.message : "Models could not be listed."); }
  };

  const adminSection = ADMIN_SECTIONS[section];
  const body = adminSection ? (
    <>
      <AdminSection
        key={adminSection}
        section={adminSection}
        api={adminApi}
        platform={platform}
        services={services}
        currentUser={currentUser}
        serverName={serverName ?? serverBranding.displayName}
      />
      {section === "tools" && <p className="settings-aside">
        MCP servers are any tool that speaks MCP, with tools you give each agent in its settings. GitHub, Linear and Slack signed in with OAuth are <button type="button" className="text-button inline" onClick={() => open("connectors")}>Connectors</button>; models come from <button type="button" className="text-button inline" onClick={() => open("providers")}>AI providers</button>.
      </p>}
    </>
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
                {models.list.map((model) => {
                  const key = `${provider.id}/${model.id}`;
                  const check = checks[key];
                  return <li key={model.id}>
                    <strong>{model.displayName}</strong><small>{model.id}</small>{model.contextWindow > 0 && <small>{contextLabel(model.contextWindow)}</small>}
                    <button type="button" className="text-button inline" disabled={check?.busy} aria-label={`Test ${model.displayName}`}
                      onClick={() => void testModel(provider.id, model.id)}>{check?.busy ? "Testing…" : "Test"}</button>
                    {check?.text && <small className={check.ok ? "settings-model-ok" : "settings-model-failed"} role="status">{check.text}</small>}
                  </li>;
                })}
              </ul>
            )
          )}
        </div>
      ))}
      {gatewayProblem && <div className="settings-warning" role="status">
        <span><strong>Crewly Gateway needs attention.</strong> {gatewayProblem.message}</span>
        {gatewayProblem.state !== "not_offered" && gatewayProblem.state !== "unavailable" &&
          <button type="button" className="secondary-button compact" onClick={() => open("cloud")}>Open Crewly Cloud</button>}
      </div>}
      {modelsError && <p className="form-error" role="alert">{modelsError}</p>}
      <div className="local-note">
        <LockKeyhole size={15} />
        <span>Provider credentials are stored encrypted on this server and never sent back to the browser.</span>
      </div>
    </>
  ) : section === "profile" ? (
    <ProfileSection key={currentUser.id} currentUser={currentUser} onNotify={onNotify}
      onChanged={onProfileChanged ?? (async () => {})} />
  ) : section === "connectors" ? (
    <ConnectorsSection connectors={connectors} agents={agents} onNotify={onNotify}
      onConnectorsChanged={onConnectorsChanged} onOpenSection={open} />
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
      {addingProvider && <div className="provider-connect-layer"><ProviderConnect onClose={() => setAddingProvider(false)} onOpenCrewly={canManageServer ? () => { setAddingProvider(false); open("cloud"); } : undefined} onConnected={() => {
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
