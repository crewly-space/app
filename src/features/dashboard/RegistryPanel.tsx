import { useEffect, useState } from 'react';
import type { RegistryInstallation, RegistryItem, RegistrySettings } from '@crewly/sdk';
import type { PlatformApi } from './platform-api';
import { useWork } from './useWork';

export function RegistryPanel({ api }: { api: PlatformApi }) {
  const { busy, error, run } = useWork();
  const [settings, setSettings] = useState<RegistrySettings | null>(null);
  const [items, setItems] = useState<RegistryItem[]>([]);
  const [installed, setInstalled] = useState<RegistryInstallation[]>([]);
  const [query, setQuery] = useState('');

  const supported = typeof api.registrySettings === 'function';
  const refresh = () => run(async () => {
    const next = await api.registrySettings();
    setSettings(next);
    setInstalled(await api.registryInstallations());
    setItems(next.enabled && next.registryUrl ? await api.registryItems({ q: query }) : []);
  });
  useEffect(() => { if (supported) void refresh(); }, []); // The panel owns the explicit refresh/search actions after first load.

  if (!supported) return null;
  if (!settings) return <p className="field-description">Loading the registry…</p>;
  return (
    <div className="dashboard-registry">
      {error && <p role="alert" className="dashboard-error">{error}</p>}
      <section className="dashboard-card">
        <h2>Skills & tools registry</h2>
        <p className="field-description">Disabled by default. Use a registry you trust; unverified publishers stay blocked unless you explicitly allow them.</p>
        <label><input type="checkbox" checked={settings.enabled} disabled={busy} onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })} /> Enable registry</label>
        <label className="dashboard-form"><span>Registry URL</span><input type="url" value={settings.registryUrl ?? ''} placeholder="https://registry.example/catalog.json" onChange={(event) => setSettings({ ...settings, registryUrl: event.target.value || null })} /></label>
        <label><input type="checkbox" checked={settings.allowUnverified} disabled={busy} onChange={(event) => setSettings({ ...settings, allowUnverified: event.target.checked })} /> Allow unverified publishers</label>
        <div className="dashboard-actions"><button className="primary-button" type="button" disabled={busy || (settings.enabled && !settings.registryUrl)} onClick={() => void run(async () => { setSettings(await api.updateRegistrySettings(settings)); })}>Save registry</button></div>
      </section>
      {settings.enabled && settings.registryUrl && <section className="dashboard-card">
        <h2>Browse</h2>
        <form className="dashboard-form form" onSubmit={(event) => { event.preventDefault(); void run(async () => setItems(await api.registryItems({ q: query }))); }}>
          <input value={query} placeholder="Search skills and MCP presets" onChange={(event) => setQuery(event.target.value)} />
          <button type="submit" className="secondary-button" disabled={busy}>Search</button>
        </form>
        <ul className="dashboard-logs">{items.map((item) => {
          const current = installed.find((entry) => entry.registryId === item.id && entry.itemType === item.type);
          const latest = item.versions.at(-1)?.version;
          return <li key={`${item.type}:${item.id}`}><strong>{item.name}{item.verified ? ' · verified' : ''}</strong><span>{item.description}</span><small>{item.publisher} · {item.type === 'skill' ? 'Skill' : 'MCP preset'} · {latest}</small>
            <button type="button" className="text-button" disabled={busy || Boolean(current?.pinnedVersion && current.pinnedVersion !== latest)} onClick={() => void run(async () => { await api.installRegistryItem({ itemId: item.id, type: item.type, version: latest }); setInstalled(await api.registryInstallations()); })}>{current ? 'Update' : 'Install'}</button></li>;
        })}</ul>
      </section>}
      {installed.length > 0 && <section><h2>Installed</h2><table className="dashboard-table"><thead><tr><th>Name</th><th>Version</th><th>Publisher</th><th>Pin</th></tr></thead><tbody>{installed.map((entry) => <tr key={entry.id}><td>{entry.name}</td><td>{entry.version}</td><td>{entry.publisher}</td><td><button type="button" className="text-button" disabled={busy} onClick={() => void run(async () => { await api.pinRegistryInstallation(entry.id, entry.pinnedVersion ? null : entry.version); setInstalled(await api.registryInstallations()); })}>{entry.pinnedVersion ? `Unpin ${entry.pinnedVersion}` : 'Pin version'}</button></td></tr>)}</tbody></table></section>}
    </div>
  );
}
