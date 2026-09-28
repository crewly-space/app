import { useEffect, useState } from 'react';
import type { RegistryInstallation, RegistryItem, RegistrySettings } from '@crewly/sdk';
import type { PlatformApi } from './platform-api';
import { useWork } from './useWork';

const GROUPS: Record<RegistryItem['type'], { title: string; description: string; search: string }> = {
  mcp_preset: { title: 'Add from the catalog', search: 'Search GitHub, Linear, docs…',
    description: 'Ready-made MCP servers. Adding one lists it above; then test it and give its tools to agents in each agent’s settings.' },
  skill: { title: 'Add from the catalog', search: 'Search reviews, release notes…',
    description: 'Ready-made instructions. Adding one puts it in the skill library above; turn it on per agent.' },
};

const MCP_CATEGORIES = ['Deploy', 'Finance', 'Cloud', 'Observability', 'Database', 'Documentation'] as const;

/**
 * The catalog for one kind of item: MCP servers under MCP tools, skills under
 * Skills. Only the Skills one shows the registry source settings, since the
 * source is shared and one place to change it is enough.
 */
export function RegistryPanel({ api, type, showSource = false, onInstalled }: {
  api: PlatformApi;
  type: RegistryItem['type'];
  showSource?: boolean;
  onInstalled?: (item: RegistryItem) => void;
}) {
  const group = GROUPS[type];
  const { busy, error, run } = useWork();
  const [settings, setSettings] = useState<RegistrySettings | null>(null);
  const [items, setItems] = useState<RegistryItem[]>([]);
  const [installed, setInstalled] = useState<RegistryInstallation[]>([]);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');

  const supported = typeof api.registrySettings === 'function';
  // The built-in catalog is always browsable; a server that predates it only
  // answers with items once a registry is enabled, so a refusal then means "none yet".
  const load = async (current: RegistrySettings, q: string) => {
    try { setItems(await api.registryItems({ q, type })); }
    catch (reason) { if (current.enabled && current.registryUrl) throw reason; setItems([]); }
  };
  const refresh = () => run(async () => {
    const next = await api.registrySettings();
    setSettings(next);
    setInstalled(await api.registryInstallations());
    await load(next, query);
  });
  useEffect(() => { if (supported) void refresh(); }, []); // The panel owns the explicit refresh/search actions after first load.

  if (!supported) return null;
  if (!settings) return <p className="field-description">Loading the catalog…</p>;

  const install = (item: RegistryItem, version: string | undefined) => void run(async () => {
    await api.installRegistryItem({ itemId: item.id, type: item.type, version });
    setInstalled(await api.registryInstallations());
    onInstalled?.(item);
    setNotice(item.type === 'mcp_preset'
      ? `${item.name} added above.${item.requiredSecrets.length ? ` Add the secret ${item.requiredSecrets.join(', ')} in Secrets and grant it to ${item.name}, then` : ''} Test the connection and choose which agents get its tools.`
      : `${item.name} added to the skill library. Turn it on in an agent’s settings.`);
  });

  return (
    <div className="dashboard-registry">
      {error && <p role="alert" className="dashboard-error">{error}</p>}
      {notice && <p role="status" className="field-description">{notice}</p>}
      <section className="dashboard-card">
        <h2>{group.title}</h2>
        <p className="field-description">{group.description}</p>
        <form className="catalog-search" role="search" onSubmit={(event) => { event.preventDefault(); void run(() => load(settings, query)); }}>
          <input type="search" value={query} aria-label="Search the catalog" placeholder={group.search} onChange={(event) => setQuery(event.target.value)} />
          <button type="submit" className="secondary-button compact" disabled={busy}>Search</button>
        </form>
        {type === 'mcp_preset' && <div className="catalog-categories" aria-label="Tool categories">{MCP_CATEGORIES.map((category) =>
          <button key={category} type="button" className="text-button" disabled={busy} onClick={() => { setQuery(category); void run(() => load(settings, category)); }}>{category}</button>)}</div>}
        {items.length === 0 && <p className="field-description">Nothing to add{query ? ' matches that search' : ' yet'}.</p>}
        {items.length > 0 && <ul className="catalog-list">{items.filter((item) => item.type === type).map((item) => {
          const current = installed.find((entry) => entry.registryId === item.id && entry.itemType === item.type);
          const latest = item.versions.at(-1)?.version;
          const upToDate = current?.version === latest;
          return <li key={`${item.type}:${item.id}`} className="catalog-item">
            <div>
              <strong>{item.name}{item.verified && <span className="catalog-verified"> · verified</span>}</strong>
              <span>{item.description}</span>
              <small>{item.publisher} · version {latest}{item.requiredSecrets.length ? ` · needs secret ${item.requiredSecrets.join(', ')}` : ' · no key needed'}</small>
            </div>
            <button type="button" className="secondary-button compact" disabled={busy || upToDate || Boolean(current?.pinnedVersion && current.pinnedVersion !== latest)} onClick={() => install(item, latest)}>{!current ? 'Add' : upToDate ? 'Added' : 'Update'}</button>
          </li>;
        })}</ul>}
      </section>
      {showSource && installed.length > 0 && <section><h2>Installed from catalogs</h2><table className="dashboard-table"><thead><tr><th>Name</th><th>Version</th><th>Publisher</th><th>Pin</th></tr></thead><tbody>{installed.map((entry) => <tr key={entry.id}><td>{entry.name}</td><td>{entry.version}</td><td>{entry.publisher}</td><td><button type="button" className="text-button" disabled={busy} onClick={() => void run(async () => { await api.pinRegistryInstallation(entry.id, entry.pinnedVersion ? null : entry.version); setInstalled(await api.registryInstallations()); })}>{entry.pinnedVersion ? `Unpin ${entry.pinnedVersion}` : 'Pin version'}</button></td></tr>)}</tbody></table></section>}
      {showSource && <section className="dashboard-card">
        <h2>Another registry</h2>
        <p className="field-description">Crewly presets are built in, and remote HTTP servers from the official MCP Registry appear in search as community items. To add a different registry, use one you trust; unverified publishers stay blocked unless you explicitly allow them.</p>
        <label><input type="checkbox" checked={settings.enabled} disabled={busy} onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })} /> Use another registry</label>
        <label className="dashboard-form"><span>Registry URL</span><input type="url" value={settings.registryUrl ?? ''} placeholder="https://registry.example/catalog.json" onChange={(event) => setSettings({ ...settings, registryUrl: event.target.value || null })} /></label>
        <label><input type="checkbox" checked={settings.allowUnverified} disabled={busy} onChange={(event) => setSettings({ ...settings, allowUnverified: event.target.checked })} /> Allow unverified publishers</label>
        <div className="dashboard-actions"><button className="primary-button" type="button" disabled={busy || (settings.enabled && !settings.registryUrl)} onClick={() => void run(async () => { const saved = await api.updateRegistrySettings(settings); setSettings(saved); await load(saved, query); })}>Save registry</button></div>
      </section>}
    </div>
  );
}
