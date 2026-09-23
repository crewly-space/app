import { useEffect, useState } from 'react';
import type { McpCapability, McpServer } from '@crewly/sdk';
import type { PlatformApi } from './platform-api';
import { useWork } from './useWork';

const CAPABILITIES: McpCapability[] = ['shell', 'filesystem', 'network'];

/**
 * MCP servers: tools agents can call. Connecting one is here; giving its
 * tools to an agent is in that agent's settings.
 */
export function ToolsPanel({ api }: { api: PlatformApi }) {
  const { busy, error, run } = useWork();
  const [servers, setServers] = useState<McpServer[]>([]);
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState({
    name: '', transport: 'http' as 'http' | 'stdio', url: '', command: '', args: '', authorization: '', capabilities: [] as McpCapability[],
  });

  useEffect(() => {
    void run(async () => setServers(await api.mcpServers()));
  }, [api, run]);

  const replace = (updated: McpServer) => setServers((current) => current.map((row) => (row.id === updated.id ? updated : row)));

  return (
    <div className="dashboard-tools">
      {error && <p role="alert" className="dashboard-error">{error}</p>}
      {servers.length === 0 && <p className="field-description">No MCP servers yet.</p>}
      {servers.map((server) => (
        <section key={server.id} className="dashboard-card">
          <header className="dashboard-row-actions">
            <div style={{ marginRight: 'auto' }}>
              <strong>{server.name}</strong>
              <small> {server.transport === 'http' ? server.url : `${server.command} ${server.args.join(' ')}`}</small>
              {server.capabilities.length > 0 && <small> · can use {server.capabilities.join(', ')}</small>}
            </div>
            <button type="button" className="text-button" disabled={busy} onClick={() => void run(async () => {
              const result = await api.testMcpServer(server.id);
              replace(result.server);
              setTestResult((current) => ({
                ...current,
                [server.id]: result.ok ? `Connected: ${result.tools.length} tools` : result.error.message,
              }));
            })}>Test connection</button>
            <button type="button" className="text-button danger" disabled={busy} aria-label={`Remove ${server.name}`} onClick={() => void run(async () => {
              await api.deleteMcpServer(server.id);
              setServers((current) => current.filter((row) => row.id !== server.id));
            })}>Remove</button>
          </header>
          {testResult[server.id] && <p role="status" className="field-description">{testResult[server.id]}</p>}
          {!testResult[server.id] && server.lastError && <p className="dashboard-error">{server.lastError}</p>}
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
                      <strong>{tool.name}</strong> <small>{tool.description}</small>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}

      <h2>Connect an MCP server</h2>
      <form className="dashboard-form" onSubmit={(event) => {
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
        <input aria-label="Server name" placeholder="GitHub" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
        <select aria-label="Transport" value={draft.transport} onChange={(event) => setDraft((current) => ({ ...current, transport: event.target.value as 'http' | 'stdio' }))}>
          <option value="http">Remote (HTTP)</option>
          <option value="stdio">Local command (stdio)</option>
        </select>
        {draft.transport === 'http' ? (
          <>
            <input aria-label="URL" placeholder="https://mcp.example.com/mcp" value={draft.url} onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value }))} />
            <input aria-label="Authorization header" placeholder="Bearer {{secret:GITHUB_TOKEN}}" value={draft.authorization}
              onChange={(event) => setDraft((current) => ({ ...current, authorization: event.target.value }))} />
          </>
        ) : (
          <>
            <input aria-label="Command" placeholder="npx" value={draft.command} onChange={(event) => setDraft((current) => ({ ...current, command: event.target.value }))} />
            <input aria-label="Arguments" placeholder="-y @modelcontextprotocol/server-filesystem /srv" value={draft.args}
              onChange={(event) => setDraft((current) => ({ ...current, args: event.target.value }))} />
            <small className="field-description">Local servers run on this server as its user, and are off unless the operator sets CREWLY_MCP_STDIO=1.</small>
          </>
        )}
        <fieldset>
          <legend>It can use</legend>
          {CAPABILITIES.map((capability) => (
            <label key={capability}>
              <input type="checkbox" checked={draft.capabilities.includes(capability)} onChange={(event) => setDraft((current) => ({
                ...current,
                capabilities: event.target.checked ? [...current.capabilities, capability] : current.capabilities.filter((entry) => entry !== capability),
              }))} /> {capability}
            </label>
          ))}
        </fieldset>
        <button type="submit" className="primary-button" disabled={busy || !draft.name || (draft.transport === 'http' ? !draft.url : !draft.command)}>
          Connect
        </button>
      </form>
    </div>
  );
}
