import { useState } from "react";
import { Blobatar } from "@blobatar/react";
import { bloopSvg } from "@crewly/ui/bloop";
import type { AuthUser, DeviceInfo, DevicePairingInfo, DirectoryUser, UserAccount } from "@crewly/sdk";
import { Check, Cpu, Laptop, LockKeyhole, Monitor, Moon, Palette, Plus, Settings, Sun, UserRound, X } from "lucide-react";
import { gateway } from "../../lib/gateway";
import { ProviderConnect } from "../providers/ProviderConnect";
import { ProviderCredentials } from "../providers/ProviderCredentials";
import { ProviderLogo } from "../providers/ProviderLogo";
import { AddUserDialog } from "./AddUserDialog";
import type { Agent, Provider } from "../../types";
import type { Theme } from "../../app-types";
import type { AvatarMode } from "@crewly/protocol";
import { AvatarModePicker, UserAvatar } from "../appearance/Avatar";

export function SettingsPanel({
  providers,
  devices,
  agents,
  currentUser,
  users,
  people,
  onAvatarModeChange,
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
  people: DirectoryUser[];
  onAvatarModeChange: (mode: AvatarMode) => void;
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
