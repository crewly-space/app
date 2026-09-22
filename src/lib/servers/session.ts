import { CrewlyClient } from '@crewly/sdk';
import type { RegistryServer } from './types';

/**
 * One session per server, rather than one for the app.
 *
 * Keying storage by server id is what keeps them apart: signing out of one
 * server, or having its session expire, leaves every other one alone.
 */
const tokenKey = (serverId: string) => `crewly:session:${serverId}`;

export function readServerToken(serverId: string): string | null {
  try {
    return localStorage.getItem(tokenKey(serverId));
  } catch {
    // A browser with storage blocked can still use the app for this session.
    return null;
  }
}

export function storeServerToken(serverId: string, token: string): void {
  try {
    localStorage.setItem(tokenKey(serverId), token);
  } catch {
    /* ignored: see readServerToken */
  }
  connections.get(serverId)?.client.setToken(token);
}

export function clearServerToken(serverId: string): void {
  try {
    localStorage.removeItem(tokenKey(serverId));
  } catch {
    /* ignored: see readServerToken */
  }
  connections.get(serverId)?.client.setToken(undefined);
}

export interface ServerConnection {
  id: string;
  endpoint: string;
  client: CrewlyClient;
}

const connections = new Map<string, ServerConnection>();

/**
 * The connection for one server, built once and kept.
 *
 * Switching away and back must not tear down and rebuild a client, or every
 * switch would pay for a fresh websocket and a fresh bootstrap.
 */
export function clientFor(server: RegistryServer): ServerConnection {
  const existing = connections.get(server.id);
  if (existing) return existing;

  const endpoint = server.endpoint ?? window.location.origin;
  const client = new CrewlyClient({ baseUrl: endpoint });
  const token = readServerToken(server.id);
  if (token) client.setToken(token);
  const connection: ServerConnection = { id: server.id, endpoint, client };
  connections.set(server.id, connection);
  return connection;
}

/** Drops every cached connection. Used when the Crewly account signs out. */
export function resetConnections(): void {
  connections.clear();
}
