import { CrewlyClient } from '@crewly/sdk';
import { clientFor, readServerToken, storeServerToken } from '../servers/session';
import type { RegistryServer } from '../servers/types';
import { APP_VERSION } from '../../version';

/**
 * Where a single-server app keeps its session.
 *
 * Standalone mode -- the app served by the server it talks to -- still uses
 * this key, so an existing install keeps its session across the change to
 * per-server storage.
 */
const TOKEN_KEY = 'crewly:session';

/** The server the app is currently showing; null in standalone mode. */
let active: RegistryServer | null = null;
let standalone = new CrewlyClient({ baseUrl: window.location.origin, clientVersion: APP_VERSION });

function current(): CrewlyClient {
  return active ? clientFor(active).client : standalone;
}

/**
 * The client every module imports.
 *
 * It forwards to whichever server is being shown, so switching servers does
 * not mean re-importing anything: the binding modules hold stays the same
 * while what it points at changes. Callers that want one specific server ask
 * `clientFor` instead.
 */
export const client = new Proxy({} as CrewlyClient, {
  get(_target, property, receiver) {
    const instance = current();
    return Reflect.get(instance, property, receiver === undefined ? instance : instance);
  },
  set(_target, property, value) {
    return Reflect.set(current(), property, value);
  },
  has(_target, property) {
    return Reflect.has(current(), property);
  },
}) as CrewlyClient;

export function activeServerId(): string | null {
  return active?.id ?? null;
}

/**
 * Points the app at one server. Sessions are per server, so this never signs
 * anyone out of the others -- it changes which one is being read.
 */
export function activateServer(server: RegistryServer | null): void {
  active = server;
  if (!server) return;
  const token = readServerToken(server.id);
  clientFor(server).client.setToken(token ?? undefined);
}

export function currentToken(): string | null {
  if (active) return readServerToken(active.id);
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function storeToken(token: string): void {
  if (active) {
    storeServerToken(active.id, token);
    return;
  }
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* a private window can refuse storage; the session still works until reload */
  }
  standalone.setToken(token);
}

export function clearToken(): void {
  if (active) {
    // Signing out of one server leaves the account and the others alone.
    try {
      localStorage.removeItem(`crewly:session:${active.id}`);
    } catch { /* see storeToken */ }
    clientFor(active).client.setToken(undefined);
  } else {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch { /* see storeToken */ }
    standalone.setToken(undefined);
  }
  window.dispatchEvent(new Event('crewly:logout'));
}

const token = (() => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
})();
if (token) standalone.setToken(token);
