import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CloudAccount } from '../../lib/cloud/account';
import { activateServer } from '../../lib/api/client';
import { connectToServer } from '../../lib/servers/connect';
import type { CloudAccountProfile, RegistryServer } from '../../lib/servers/types';
import { watchBackgroundServers } from './unread';

const LAST_SERVER_KEY = 'crewly:last-server';

/**
 * Where Cloud lives, decided at build time.
 *
 * Without it the app is what it has always been: one client for the server
 * that served it. That is how a self-hosted install keeps working with no
 * account, no registry and nothing to configure.
 */
export const cloudUrl: string | undefined = import.meta.env.VITE_CREWLY_CLOUD_URL;

export interface ServerRegistry {
  /** False on a self-hosted install with no Cloud behind it. */
  multiServer: boolean;
  account: CloudAccountProfile | null;
  servers: RegistryServer[];
  selected: RegistryServer | null;
  unread: Record<string, number>;
  failures: Record<string, string>;
  /** Bumped when the app should reload everything for the selected server. */
  epoch: number;
  select: (server: RegistryServer) => void;
  refresh: () => Promise<void>;
}

function remember(serverId: string): void {
  try {
    localStorage.setItem(LAST_SERVER_KEY, serverId);
  } catch { /* storage can be refused; the first server is then the default */ }
}

function remembered(): string | null {
  try {
    return localStorage.getItem(LAST_SERVER_KEY);
  } catch {
    return null;
  }
}

export function useServerRegistry(account = cloudUrl ? new CloudAccount(cloudUrl) : null): ServerRegistry {
  const [profile, setProfile] = useState<CloudAccountProfile | null>(null);
  const [servers, setServers] = useState<RegistryServer[]>([]);
  const [selected, setSelected] = useState<RegistryServer | null>(null);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [epoch, setEpoch] = useState(0);
  const connecting = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!account) return;
    const [me, list] = await Promise.all([account.me(), account.servers()]);
    setProfile(me);
    setServers(list);
    setSelected((current) => {
      if (current) return list.find((server) => server.id === current.id) ?? current;
      const preferred = list.find((server) => server.id === remembered());
      return preferred ?? list.find((server) => server.status === 'ready') ?? list[0] ?? null;
    });
  }, [account]);

  useEffect(() => { void refresh().catch(() => {}); }, [refresh]);

  // Connecting is what turns a chosen server into a usable one: the app points
  // at it, and a session is found or fetched. A failure is reported on the
  // rail rather than thrown away, so a server that cannot be reached looks
  // different from one with nothing in it.
  useEffect(() => {
    if (!account || !selected) return;
    if (connecting.current === selected.id) return;
    connecting.current = selected.id;
    let cancelled = false;

    activateServer(selected);
    void connectToServer(selected, account)
      .then((result) => {
        if (cancelled) return;
        setFailures((current) => {
          const next = { ...current };
          if (result.state === 'connected') delete next[selected.id];
          else if (result.state === 'not_ready') next[selected.id] = `This server is ${result.status}`;
          else next[selected.id] = 'Sign in to this server';
          return next;
        });
        // Whatever the outcome, the app reloads for this server: a connected
        // one has data to show, and a refused one must not keep showing the
        // previous server's.
        setUnread((current) => ({ ...current, [selected.id]: 0 }));
        setEpoch((value) => value + 1);
      })
      .catch(() => {
        if (cancelled) return;
        setFailures((current) => ({ ...current, [selected.id]: 'Could not reach this server' }));
      })
      .finally(() => { connecting.current = null; });

    return () => { cancelled = true; };
  }, [account, selected]);

  useEffect(() => {
    if (!account || servers.length === 0) return;
    return watchBackgroundServers(servers, selected?.id ?? null, (serverId, count) => {
      setUnread((current) => ({ ...current, [serverId]: count }));
    });
  }, [account, servers, selected]);

  const select = useCallback((server: RegistryServer) => {
    remember(server.id);
    setSelected(server);
  }, []);

  return useMemo(
    () => ({
      multiServer: Boolean(account),
      account: profile,
      servers,
      selected,
      unread,
      failures,
      epoch,
      select,
      refresh,
    }),
    [account, profile, servers, selected, unread, failures, epoch, select, refresh],
  );
}
