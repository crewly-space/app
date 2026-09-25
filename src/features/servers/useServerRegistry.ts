import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CloudAccount } from '../../lib/cloud/account';
import { activateServer } from '../../lib/api/client';
import { connectToServer } from '../../lib/servers/connect';
import type { CloudAccountProfile, RegistryServer } from '../../lib/servers/types';
import { watchBackgroundServers } from './unread';

const LAST_SERVER_KEY = 'crewly:last-server';
const REGISTRY_CACHE_KEY = 'crewly:server-registry';

/**
 * Where Cloud lives, decided at build time.
 *
 * Without it the app is what it has always been: one client for the server
 * that served it. That is how a self-hosted install keeps working with no
 * account, no registry and nothing to configure.
 */
export const cloudUrl: string | undefined = import.meta.env.VITE_CREWLY_CLOUD_URL;

/**
 * Where the selected server stands, as far as this app can tell.
 *
 * Kept apart from the account on purpose: a server that is offline, still
 * being built or wanting its own login is a state of that server, and the
 * rest of the app -- the rail, the account, the other servers -- carries on.
 */
export type ServerConnection =
  | { state: 'loading' }
  | { state: 'cloud_unreachable' }
  | { state: 'no_servers' }
  | { state: 'connecting' }
  | { state: 'connected' }
  | { state: 'not_ready'; status: RegistryServer['status'] }
  | { state: 'needs_login' }
  | { state: 'unreachable' };

export interface ServerRegistry {
  /** False on a self-hosted install with no Cloud behind it. */
  multiServer: boolean;
  account: CloudAccountProfile | null;
  accountClient: CloudAccount | null;
  servers: RegistryServer[];
  selected: RegistryServer | null;
  /** The selected server's state; always connected on a self-hosted install. */
  connection: ServerConnection;
  unread: Record<string, number>;
  failures: Record<string, string>;
  /** Bumped when the app should reload everything for the selected server. */
  epoch: number;
  select: (server: RegistryServer) => void;
  refresh: () => Promise<void>;
  /** Tries the selected server again: after its own login, or once it is back. */
  reconnect: () => void;
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

interface RegistryCache {
  profile: CloudAccountProfile;
  servers: RegistryServer[];
  selectedId: string | null;
}

function readCache(): RegistryCache | null {
  try {
    const raw = localStorage.getItem(REGISTRY_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RegistryCache>;
    if (!parsed.profile || !Array.isArray(parsed.servers)) return null;
    return {
      profile: parsed.profile,
      servers: parsed.servers,
      selectedId: typeof parsed.selectedId === 'string' ? parsed.selectedId : null,
    };
  } catch {
    return null;
  }
}

function writeCache(profile: CloudAccountProfile, servers: RegistryServer[], selectedId: string | null): void {
  try {
    localStorage.setItem(REGISTRY_CACHE_KEY, JSON.stringify({ profile, servers, selectedId } satisfies RegistryCache));
  } catch { /* storage can be refused; the network remains authoritative */ }
}

/*
 * One client for the life of the page.
 *
 * It used to be built as a default argument, so every render made a new one.
 * That changed `refresh`, whose effect fetched again, whose result rendered
 * again: the app asked Cloud for the account about twenty times a second for
 * as long as it was open, and reconnected to the server on every lap.
 */
const defaultAccount = cloudUrl ? new CloudAccount(cloudUrl) : null;

export function useServerRegistry(account = defaultAccount): ServerRegistry {
  const [cached] = useState(readCache);
  const [profile, setProfile] = useState<CloudAccountProfile | null>(cached?.profile ?? null);
  const [servers, setServers] = useState<RegistryServer[]>(cached?.servers ?? []);
  const [selected, setSelected] = useState<RegistryServer | null>(() => {
    if (!cached) return null;
    return cached.servers.find((server) => server.id === (cached.selectedId ?? remembered()))
      ?? cached.servers.find((server) => server.status === 'ready')
      ?? cached.servers[0]
      ?? null;
  });
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [epoch, setEpoch] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [cloudDown, setCloudDown] = useState(false);
  const [states, setStates] = useState<Record<string, ServerConnection>>({});
  const [attempt, setAttempt] = useState(0);
  const connecting = useRef<string | null>(null);
  // A refresh hands back a new object for the same server. Connecting again
  // for that would reload the whole app, so only a different server, or the
  // same one changing state (becoming ready), is a reason to reconnect.
  const selectedKey = selected ? `${selected.id}:${selected.status}` : null;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const refresh = useCallback(async () => {
    if (!account) return;
    const [me, list] = await Promise.all([account.me(), account.servers()]);
    setProfile(me);
    setServers(list);
    setLoaded(true);
    setCloudDown(false);
    setSelected((current) => {
      const preferred = list.find((server) => server.id === (current?.id ?? remembered()))
        ?? list.find((server) => server.status === 'ready')
        ?? list[0]
        ?? null;
      if (me) writeCache(me, list, preferred?.id ?? null);
      return preferred;
    });
  }, [account]);

  useEffect(() => { void refresh().catch(() => setCloudDown(true)); }, [refresh]);

  // Connecting is what turns a chosen server into a usable one: the app points
  // at it, and a session is found or fetched. A failure is reported on the
  // rail rather than thrown away, so a server that cannot be reached looks
  // different from one with nothing in it.
  useEffect(() => {
    const selected = selectedRef.current;
    if (!account || !selected) return;
    if (connecting.current === selected.id) return;
    connecting.current = selected.id;
    let cancelled = false;
    const settle = (state: ServerConnection) => setStates((current) => ({ ...current, [selected.id]: state }));

    settle({ state: 'connecting' });
    activateServer(selected);
    void connectToServer(selected, account)
      .then((result) => {
        if (cancelled) return;
        settle(result.state === 'needs_local_login' ? { state: 'needs_login' } : result);
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
        settle({ state: 'unreachable' });
        setFailures((current) => ({ ...current, [selected.id]: 'Could not reach this server' }));
      })
      .finally(() => { connecting.current = null; });

    return () => { cancelled = true; };
  }, [account, selectedKey, attempt]);

  // Signing out of one server leaves the account and the rail; that server
  // simply wants its login again.
  useEffect(() => {
    if (!account) return;
    const signedOut = () => {
      const current = selectedRef.current;
      if (current) setStates((known) => ({ ...known, [current.id]: { state: 'needs_login' } }));
    };
    window.addEventListener('crewly:logout', signedOut);
    return () => window.removeEventListener('crewly:logout', signedOut);
  }, [account]);

  useEffect(() => {
    if (!account || servers.length === 0) return;
    return watchBackgroundServers(servers, selected?.id ?? null, (serverId, count) => {
      setUnread((current) => ({ ...current, [serverId]: count }));
    });
  }, [account, servers, selected]);

  const select = useCallback((server: RegistryServer) => {
    remember(server.id);
    try {
      const raw = localStorage.getItem(REGISTRY_CACHE_KEY);
      if (raw) {
        const current = JSON.parse(raw) as Partial<RegistryCache>;
        localStorage.setItem(REGISTRY_CACHE_KEY, JSON.stringify({ ...current, selectedId: server.id }));
      }
    } catch { /* storage can be refused; selection still works for this session */ }
    setSelected(server);
  }, []);

  const reconnect = useCallback(() => setAttempt((value) => value + 1), []);

  let connection: ServerConnection;
  if (!account) connection = { state: 'connected' };
  else if (!loaded) connection = cloudDown ? { state: 'cloud_unreachable' } : { state: 'loading' };
  else if (!selected) connection = { state: 'no_servers' };
  else connection = states[selected.id] ?? { state: 'connecting' };

  return useMemo(
    () => ({
      multiServer: Boolean(account),
      account: profile,
      accountClient: account,
      servers,
      selected,
      connection,
      unread,
      failures,
      epoch,
      select,
      refresh,
      reconnect,
    }),
    // The connection is derived from loaded, states and selected.
    [account, profile, servers, selected, loaded, cloudDown, states, unread, failures, epoch, select, refresh, reconnect],
  );
}
