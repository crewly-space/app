import { useEffect, useState } from 'react';
import type { Agent, McpServer, Secret, SecretGrant } from '@crewly/sdk';
import { CrewlyApiError } from '@crewly/sdk';
import type { PlatformApi } from './platform-api';
import { useWork } from './useWork';

/**
 * The vault. A value is typed once and never shown again -- not here, not
 * anywhere -- so rotating is the only way to change what a secret holds.
 */
export function SecretsPanel({ api, agents }: { api: PlatformApi; agents: Agent[] }) {
  const { busy, error, run, setError } = useWork();
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [servers, setServers] = useState<McpServer[]>([]);
  const [draft, setDraft] = useState({ name: '', value: '', description: '' });
  const [rotating, setRotating] = useState<{ id: string; value: string } | null>(null);
  const [blocked, setBlocked] = useState<{ id: string; dependents: Array<{ type: string; name: string; via: string }> } | null>(null);

  useEffect(() => {
    void run(async () => {
      const [list, mcp] = await Promise.all([api.secrets(), api.mcpServers().catch(() => [])]);
      setSecrets(list);
      setServers(mcp);
    });
  }, [api, run]);

  const replace = (updated: Secret) => setSecrets((current) => current.map((row) => (row.id === updated.id ? updated : row)));
  const granteeName = (grant: SecretGrant) =>
    grant.type === 'agent' ? agents.find((agent) => agent.id === grant.id)?.name ?? grant.id
      : grant.type === 'mcp_server' ? servers.find((server) => server.id === grant.id)?.name ?? grant.id
        : grant.id;

  const remove = (secret: Secret, force = false) => run(async () => {
    try {
      await api.deleteSecret(secret.id, force);
      setSecrets((current) => current.filter((row) => row.id !== secret.id));
      setBlocked(null);
    } catch (reason) {
      const details = reason instanceof CrewlyApiError ? (reason.body as { dependents?: Array<{ type: string; name: string; via: string }> } | undefined) : undefined;
      if (details?.dependents) {
        setBlocked({ id: secret.id, dependents: details.dependents });
        setError('');
        return;
      }
      throw reason;
    }
  });

  return (
    <div className="dashboard-secrets">
      {error && <p role="alert" className="dashboard-error">{error}</p>}
      <p className="field-description">
        Refer to a secret from an MCP server or a skill as <code>{'{{secret:NAME}}'}</code>, then grant it to that server
        or agent. Nothing else can read it, and every read is recorded.
      </p>
      <table className="dashboard-table">
        <thead><tr><th>Secret</th><th>Given to</th><th>Version</th><th aria-label="Actions" /></tr></thead>
        <tbody>
          {secrets.map((secret) => (
            <tr key={secret.id}>
              <td>
                <strong>{secret.name}</strong>
                <small>{secret.revoked ? 'Revoked — rotate to restore' : secret.description || ' '}</small>
              </td>
              <td>
                {secret.grants.map(granteeName).join(', ') || 'Nothing yet'}
                <select
                  aria-label={`Give ${secret.name} to`}
                  value=""
                  disabled={busy}
                  onChange={(event) => {
                    const [type, id] = event.target.value.split(':') as [SecretGrant['type'], string];
                    if (!id) return;
                    void run(async () => replace(await api.setSecretGrants(secret.id, [...secret.grants, { type, id }])));
                  }}
                >
                  <option value="">Give to…</option>
                  {agents.map((agent) => <option key={agent.id} value={`agent:${agent.id}`}>Agent: {agent.name}</option>)}
                  {servers.map((server) => <option key={server.id} value={`mcp_server:${server.id}`}>MCP: {server.name}</option>)}
                </select>
              </td>
              <td>v{secret.version}</td>
              <td className="dashboard-row-actions">
                {rotating?.id === secret.id ? (
                  <form onSubmit={(event) => {
                    event.preventDefault();
                    void run(async () => {
                      replace(await api.rotateSecret(secret.id, rotating.value));
                      setRotating(null);
                    });
                  }}>
                    <input aria-label={`New value for ${secret.name}`} type="password" autoComplete="off" autoFocus
                      value={rotating.value} onChange={(event) => setRotating({ id: secret.id, value: event.target.value })} />
                    <button type="submit" className="text-button" disabled={busy || !rotating.value}>Save</button>
                  </form>
                ) : (
                  <button type="button" className="text-button" disabled={busy} aria-label={`Rotate ${secret.name}`}
                    onClick={() => setRotating({ id: secret.id, value: '' })}>Rotate</button>
                )}
                {!secret.revoked && (
                  <button type="button" className="text-button" disabled={busy} aria-label={`Revoke ${secret.name}`}
                    onClick={() => void run(async () => replace(await api.revokeSecret(secret.id)))}>Revoke</button>
                )}
                <button type="button" className="text-button danger" disabled={busy} aria-label={`Delete ${secret.name}`}
                  onClick={() => void remove(secret)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {blocked && (
        <div role="alert" className="dashboard-blocked">
          <p>This secret is still used by:</p>
          <ul>{blocked.dependents.map((dependent) => <li key={`${dependent.type}-${dependent.name}`}>{dependent.name} ({dependent.type.replace('_', ' ')}, {dependent.via})</li>)}</ul>
          <div className="dashboard-actions">
            <button type="button" className="secondary-button" onClick={() => setBlocked(null)}>Keep it</button>
            <button type="button" className="text-button danger" onClick={() => {
              const secret = secrets.find((row) => row.id === blocked.id);
              if (secret) void remove(secret, true);
            }}>Delete anyway</button>
          </div>
        </div>
      )}

      <form className="dashboard-actions" onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          const created = await api.createSecret({ name: draft.name, value: draft.value, description: draft.description || undefined });
          setSecrets((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
          setDraft({ name: '', value: '', description: '' });
        });
      }}>
        <input aria-label="Secret name" placeholder="GITHUB_TOKEN" value={draft.name}
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') }))} />
        <input aria-label="Secret value" type="password" autoComplete="off" placeholder="Value" value={draft.value}
          onChange={(event) => setDraft((current) => ({ ...current, value: event.target.value }))} />
        <input aria-label="What it is for" placeholder="What it is for" value={draft.description}
          onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} />
        <button type="submit" className="primary-button" disabled={busy || !draft.name || !draft.value}>Add secret</button>
      </form>
    </div>
  );
}
