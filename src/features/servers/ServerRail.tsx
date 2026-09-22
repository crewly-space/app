import { Cloud, HardDrive, Plus } from 'lucide-react';
import type { RegistryServer } from '../../lib/servers/types';

/** A server that is still being built, or gone, cannot be opened. */
function openable(server: RegistryServer): boolean {
  if (server.kind !== 'cloud') return true;
  return server.status === 'ready';
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).slice(0, 2);
  return words.map((word) => word.charAt(0).toUpperCase()).join('') || '?';
}

/**
 * What the rail says about a server, in words.
 *
 * Colour alone would leave a screen reader with a list of identical buttons,
 * and the difference between a cloud server and one somebody runs themselves
 * matters before you click.
 */
function describe(server: RegistryServer, failure?: string, unread?: number): string {
  const kind = server.kind === 'cloud' ? 'Crewly Cloud' : 'self-hosted';
  const parts = [`${server.name}, ${kind}`];
  if (failure) parts.push(failure);
  else if (server.kind === 'cloud' && server.status !== 'ready') parts.push(server.status);
  if (unread) parts.push(`${unread} unread`);
  return parts.join(' — ');
}

export function ServerRail({
  servers,
  selectedId,
  onSelect,
  onAddServer,
  unread = {},
  failures = {},
}: {
  servers: RegistryServer[];
  selectedId: string | null;
  onSelect: (server: RegistryServer) => void;
  onAddServer: () => void;
  /** Messages waiting on servers nobody is looking at. */
  unread?: Record<string, number>;
  /** Why a server could not be reached, when it could not. */
  failures?: Record<string, string>;
}) {
  return (
    <nav className="server-rail" role="tablist" aria-orientation="vertical" aria-label="Servers">
      {servers.map((server) => {
        const selected = server.id === selectedId;
        const failure = failures[server.id];
        // Unread is about what is waiting elsewhere, so the server being read
        // never carries a count.
        const waiting = selected ? 0 : unread[server.id] ?? 0;
        const ready = openable(server);
        return (
          <button
            key={server.id}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-label={describe(server, failure, waiting)}
            title={describe(server, failure, waiting)}
            className={[
              'server-tab',
              server.kind === 'cloud' ? 'cloud' : 'self-hosted',
              selected ? 'selected' : '',
              ready ? '' : 'unavailable',
              failure ? 'failed' : '',
            ].filter(Boolean).join(' ')}
            disabled={!ready}
            onClick={() => ready && onSelect(server)}
          >
            <span className="server-tab-mark" aria-hidden="true">{initials(server.name)}</span>
            <span className="server-tab-kind" aria-hidden="true">
              {server.kind === 'cloud' ? <Cloud size={11} /> : <HardDrive size={11} />}
            </span>
            {waiting > 0 && <span className="server-tab-unread">{waiting > 99 ? '99+' : waiting}</span>}
            {(failure || !ready) && <span className="server-tab-state" aria-hidden="true" />}
          </button>
        );
      })}
      <button type="button" className="server-tab add" aria-label="Add a server" onClick={onAddServer}>
        <span className="server-tab-mark" aria-hidden="true"><Plus size={16} /></span>
      </button>
    </nav>
  );
}
