import { useEffect, useState } from 'react';
import type { FederationConnection, FederationSettings } from '@crewly/sdk';
import type { PlatformApi } from './platform-api';
import { useWork } from './useWork';

export function FederationPanel({ api }: { api: PlatformApi }) {
  const { busy, error, run } = useWork();
  const [settings, setSettings] = useState<FederationSettings | null>(null);
  const [connections, setConnections] = useState<FederationConnection[]>([]);
  const [remoteUrl, setRemoteUrl] = useState('');
  const [scopes, setScopes] = useState('events:receive');
  const supported = typeof api.federation === 'function';
  const load = () => run(async () => { const result = await api.federation(); setSettings(result.settings); setConnections(result.connections); });
  useEffect(() => { if (supported) void load(); }, []);
  if (!supported) return null;
  if (!settings) return <p className="field-description">Loading federation…</p>;
  return <div className="dashboard-federation">
    {error && <p role="alert" className="dashboard-error">{error}</p>}
    <section className="dashboard-card"><h2>Server federation</h2><p className="field-description">Each connection is mutual, scoped and independently revocable. This server continues operating locally if a peer is unavailable.</p>
      <label><input type="checkbox" checked={settings.enabled} disabled={busy} onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })} /> Enable opt-in federation</label>
      <label className="dashboard-form"><span>Server name</span><input value={settings.displayName} onChange={(event) => setSettings({ ...settings, displayName: event.target.value })} /></label>
      <button type="button" className="primary-button" disabled={busy || !settings.displayName.trim()} onClick={() => void run(async () => setSettings(await api.updateFederationSettings(settings)))}>Save federation</button>
    </section>
    {settings.enabled && <section className="dashboard-card"><h2>Connect another server</h2><label className="dashboard-form"><span>Remote URL</span><input type="url" value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} /></label><label className="dashboard-form"><span>Scopes, comma separated</span><input value={scopes} onChange={(event) => setScopes(event.target.value)} /></label><button type="button" className="secondary-button" disabled={busy || !remoteUrl} onClick={() => void run(async () => { await api.createFederationConnection({ remoteUrl, scopes: scopes.split(',').map((value) => value.trim()).filter(Boolean) }); setRemoteUrl(''); const next = await api.federation(); setConnections(next.connections); })}>Send invitation</button></section>}
    <table className="dashboard-table"><thead><tr><th>Server</th><th>Status</th><th>Scopes</th><th aria-label="Actions" /></tr></thead><tbody>{connections.map((connection) => <tr key={connection.id}><td><strong>{connection.remoteName ?? connection.remoteUrl}</strong><small>{connection.remoteUrl}</small></td><td>{connection.status}</td><td>{connection.scopes.join(', ')}</td><td className="dashboard-row-actions">{connection.status === 'pending' && connection.remoteServerId && <button type="button" className="text-button" disabled={busy} onClick={() => void run(async () => { await api.acceptFederationConnection(connection.id); const next = await api.federation(); setConnections(next.connections); })}>Accept</button>} {connection.status !== 'revoked' && <button type="button" className="text-button danger" disabled={busy} onClick={() => void run(async () => { await api.revokeFederationConnection(connection.id); const next = await api.federation(); setConnections(next.connections); })}>Revoke</button>}</td></tr>)}</tbody></table>
  </div>;
}
