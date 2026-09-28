import { useCallback, useEffect, useState } from 'react';
import type { McpCapability, McpServer, NormalizedTool, TrustLevel } from '@crewly/sdk';
import { navigateToServerUrl } from '../../lib/safe-navigation';
import type { PlatformApi } from './platform-api';
import { RegistryPanel } from './RegistryPanel';
import { healthLabel, healthTone, riskLabel, riskTone, trustDetail, trustLabel, trustTone, TRUST_LEVELS } from './tool-labels';
import { useWork } from './useWork';

/** Where an OAuth sign-in comes back to: this screen, told which server it was for. */
export const mcpOAuthCallbackUrl = () => `${window.location.origin}/?mcp_oauth=1`;

const CAPABILITIES: Array<{ id: McpCapability; label: string }> = [
  { id: 'network', label: 'Network' },
  { id: 'filesystem', label: 'Files on this server' },
  { id: 'shell', label: 'Run commands on this server' },
];

/** Tools that ship inside Crewly, so the list of what agents can do is complete. */
const BUILTIN_TOOLS = [
  { name: 'Utilities', tools: 'calculate, current_time, generate_uuid, hash_text, base64_text, format_json, text_stats, url_component, date_math', detail: 'Deterministic arithmetic, clocks, identifiers, hashes and text/data transforms. Always local; no credential or network access.' },
  { name: 'Browser', tools: 'navigate, inspect, interact, screenshot', detail: 'An isolated browser with private-network blocking and per-agent approval policy.' },
  { name: 'Artifacts', tools: 'create_artifact', detail: 'Publishes an intentional generated file into the conversation and run trace.' },
  { name: 'Agent delegation', tools: 'delegate_to_agent', detail: 'Hands bounded work to another Crewly agent while preserving the root run and depth limit.' },
] as const;

/** One line on whether a server works, so nobody has to test it to find out. */
function serverStatus(server: McpServer, tested: string | undefined): { text: string; failed: boolean } {
  if (tested) return { text: tested, failed: !tested.startsWith('Connected') };
  if (server.lastError) return { text: server.lastError, failed: true };
  if (!server.lastTestedAt) return { text: 'Not tested yet. Test the connection to discover its tools.', failed: false };
  const on = server.tools.length - server.disabledTools.length;
  return { text: `Connected · ${on} of ${server.tools.length} tools on`, failed: false };
}

/** What discovery learned about a server, and how far it is trusted. */
function ServerFacts({ server, busy, onTrust }: { server: McpServer; busy: boolean; onTrust?: (trust: TrustLevel) => void }) {
  const info = server.serverInfo ?? {};
  const facts = [
    info.name && `${info.title ?? info.name}${info.version ? ` ${info.version}` : ''}`,
    info.protocolVersion && `MCP ${info.protocolVersion}`,
    server.resources?.length ? `${server.resources.length} resource${server.resources.length === 1 ? '' : 's'}` : '',
    server.prompts?.length ? `${server.prompts.length} prompt${server.prompts.length === 1 ? '' : 's'}` : '',
    server.oauth?.signedIn ? `signed in${server.oauth.expiresAt ? `, renews before ${new Date(server.oauth.expiresAt).toLocaleString()}` : ''}` : '',
    server.lastSuccessAt && `last worked ${new Date(server.lastSuccessAt).toLocaleString()}`,
  ].filter(Boolean);
  if (!facts.length && !onTrust) return null;
  return (
    <div className="tool-row">
      <small className="tool-row-main">{facts.join(' · ')}</small>
      {onTrust && server.trust && (
        <label><small>Trust </small>
          <select aria-label={`Trust for ${server.name}`} value={server.trust} disabled={busy} onChange={(event) => onTrust(event.target.value as TrustLevel)}>
            {TRUST_LEVELS.map((level) => <option key={level} value={level}>{trustLabel(level)}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}

/**
 * MCP servers: tools agents can call. Adding one is here, from the catalog or
 * by address; giving its tools to an agent is in that agent's settings.
 */
export function ToolsPanel({ api }: { api: PlatformApi }) {
  const { busy, error, run } = useWork();
  const [servers, setServers] = useState<McpServer[]>([]);
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState({
    name: '', transport: 'http' as 'http' | 'stdio', url: '', command: '', args: '', authorization: '', capabilities: [] as McpCapability[],
  });

  const [catalog, setCatalog] = useState<NormalizedTool[]>([]);
  const [notice, setNotice] = useState('');

  const reload = useCallback(() => run(async () => {
    setServers(await api.mcpServers());
    if (api.toolCatalog) setCatalog(await api.toolCatalog().catch(() => []));
  }), [api, run]);
  useEffect(() => { void reload(); }, [reload]);

  // Finish an OAuth sign-in the authorization server redirected back from.
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (!query.has('mcp_oauth') || !api.completeMcpOAuth) return;
    const code = query.get('code');
    const state = query.get('state');
    window.history.replaceState({}, '', window.location.pathname);
    if (!code || !state) {
      setNotice(query.get('error_description') ?? 'Sign-in was cancelled, so nothing changed.');
      return;
    }
    void run(async () => {
      const result = await api.completeMcpOAuth!(state, code);
      setNotice(result.ok ? `${result.server.name} is signed in · ${result.tools.length} tools found` : result.error.message);
      await reload();
    });
  }, [api, run, reload]);

  const replace = (updated: McpServer) => setServers((current) => current.map((row) => (row.id === updated.id ? updated : row)));
  const riskOf = (server: McpServer, tool: string) => catalog.find((entry) => entry.source.connectionId === server.id && entry.source.toolName === tool);

  return (
    <div className="dashboard-tools">
      {error && <p role="alert" className="dashboard-error">{error}</p>}
      {notice && <p role="status" className="callout">{notice}</p>}
      {servers.length === 0 && (
        <div className="dashboard-empty">
          <strong>No MCP servers yet</strong>
          <p>MCP servers give agents tools beyond conversation: search docs, read a repository, query a database.
            Add one from the catalog or by its address below, then choose which of its tools each agent may use.</p>
        </div>
      )}
      {servers.map((server) => {
        const status = serverStatus(server, testResult[server.id]);
        return (
          <section key={server.id} className="dashboard-card">
            <header className="tool-row">
              <div className="tool-row-main">
                <strong>{server.name}</strong>
                <small> {server.transport === 'http' ? server.url : `${server.command} ${server.args.join(' ')}`}</small>
                {server.capabilities.length > 0 && <small> · may use {server.capabilities.join(', ')}</small>}
              </div>
              {server.status && <span className={`badge ${healthTone(server.status)}`}>{healthLabel(server.status)}</span>}
              {server.trust && <span className={`badge ${trustTone(server.trust)}`} title={trustDetail(server.trust)}>{trustLabel(server.trust)}</span>}
              {server.transport === 'http' && api.startMcpOAuth && (server.oauth?.signedIn
                ? api.signOutMcp && <button type="button" className="text-button" disabled={busy} onClick={() => void run(async () => replace(await api.signOutMcp!(server.id)))}>Sign out</button>
                : <button type="button" className="text-button" disabled={busy} onClick={() => void run(async () => {
                  const pending = await api.startMcpOAuth!(server.id, mcpOAuthCallbackUrl());
                  navigateToServerUrl(pending.authorizationUrl);
                })}>Sign in</button>)}
              <button type="button" className="text-button" disabled={busy} onClick={() => void run(async () => {
                const result = await api.testMcpServer(server.id);
                replace(result.server);
                setTestResult((current) => ({
                  ...current,
                  [server.id]: result.ok ? `Connected · ${result.tools.length} tools found` : result.error.message,
                }));
                if (api.toolCatalog) setCatalog(await api.toolCatalog().catch(() => []));
              })}>Test connection</button>
              <button type="button" className="text-button danger" disabled={busy} aria-label={`Remove ${server.name}`} onClick={() => void run(async () => {
                await api.deleteMcpServer(server.id);
                setServers((current) => current.filter((row) => row.id !== server.id));
              })}>Remove</button>
            </header>
            <p role="status" className={status.failed ? 'dashboard-error' : 'field-description'}>{status.text}</p>
            <ServerFacts server={server} busy={busy} onTrust={api.updateMcpServer ? (trust) => void run(async () => {
              replace(await api.updateMcpServer!(server.id, { trust }));
              if (api.toolCatalog) setCatalog(await api.toolCatalog().catch(() => []));
            }) : undefined} />
            {server.tools.length > 0 && (
              <ul className="dashboard-toggles">
                {server.tools.map((tool) => {
                  const enabled = !server.disabledTools.includes(tool.name);
                  return (
                    <li key={tool.name}>
                      <label>
                        <input type="checkbox" checked={enabled} disabled={busy} onChange={() => void run(async () => {
                          const disabled = enabled ? [...server.disabledTools, tool.name] : server.disabledTools.filter((name) => name !== tool.name);
                          replace(await api.setDisabledTools(server.id, disabled));
                        })} />
                        <strong>{tool.name}</strong>
                        {riskOf(server, tool.name) && <span className={`badge ${riskTone(riskOf(server, tool.name)!.risk)}`} title={riskOf(server, tool.name)!.permission}>{riskLabel(riskOf(server, tool.name)!.risk)}</span>}
                        {' '}<small>{tool.description}</small>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}

      <RegistryPanel api={api} type="mcp_preset" onInstalled={() => void reload()} />

      <details className="dashboard-card builtin-tools">
        <summary><strong>Built-in tools</strong> <small>Always available; each agent's capability policy decides what it may use.</small></summary>
        <ul className="catalog-list">
          {BUILTIN_TOOLS.map((tool) => <li key={tool.name} className="catalog-item"><div><strong>{tool.name}</strong><span>{tool.detail}</span><small>{tool.tools}</small></div></li>)}
        </ul>
      </details>

      <section className="dashboard-card">
        <h2>Add a custom MCP server</h2>
        <p className="field-description">Any server that speaks MCP. For GitHub, Linear or Slack signed in with OAuth, use Connectors instead.</p>
        <form className="dashboard-form form" onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            const created = await api.createMcpServer({
              name: draft.name,
              transport: draft.transport,
              ...(draft.transport === 'http'
                ? { url: draft.url, headers: draft.authorization ? { authorization: draft.authorization } : {} }
                : { command: draft.command, args: draft.args.split(' ').filter(Boolean) }),
              capabilities: draft.capabilities,
            });
            setServers((current) => [...current, created]);
            setDraft((current) => ({ ...current, name: '', url: '', command: '', args: '', authorization: '' }));
          });
        }}>
          <label><span>Name</span>
            <input placeholder="Docs search" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
          </label>
          <label><span>Runs</span>
            <select value={draft.transport} onChange={(event) => setDraft((current) => ({ ...current, transport: event.target.value as 'http' | 'stdio' }))}>
              <option value="http">Remotely, at a URL (HTTP)</option>
              <option value="stdio">As a command on this server (stdio)</option>
            </select>
          </label>
          {draft.transport === 'http' ? (
            <>
              <label><span>URL</span>
                <input type="url" placeholder="https://mcp.example.com/mcp" value={draft.url} onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value }))} />
              </label>
              <label><span>Authorization header <em>Optional</em></span>
                <input placeholder="Bearer {{secret:MY_TOKEN}}" value={draft.authorization}
                  onChange={(event) => setDraft((current) => ({ ...current, authorization: event.target.value }))} />
              </label>
              <small className="field-description">Keep keys in Secrets and refer to one as {'{{secret:NAME}}'}, then grant that secret to this server.</small>
            </>
          ) : (
            <>
              <label><span>Command</span>
                <input placeholder="npx" value={draft.command} onChange={(event) => setDraft((current) => ({ ...current, command: event.target.value }))} />
              </label>
              <label><span>Arguments</span>
                <input placeholder="-y @modelcontextprotocol/server-filesystem /srv" value={draft.args}
                  onChange={(event) => setDraft((current) => ({ ...current, args: event.target.value }))} />
              </label>
              <small className="field-description">Local servers run on this server as its user, and are off unless the operator sets CREWLY_MCP_STDIO=1.</small>
            </>
          )}
          <fieldset>
            <legend>It may use</legend>
            {CAPABILITIES.map((capability) => (
              <label key={capability.id}>
                <input type="checkbox" checked={draft.capabilities.includes(capability.id)} onChange={(event) => setDraft((current) => ({
                  ...current,
                  capabilities: event.target.checked ? [...current.capabilities, capability.id] : current.capabilities.filter((entry) => entry !== capability.id),
                }))} /> {capability.label}
              </label>
            ))}
          </fieldset>
          <div className="form-actions">
            <button type="submit" className="primary-button" disabled={busy || !draft.name || (draft.transport === 'http' ? !draft.url : !draft.command)}>
              Add server
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
