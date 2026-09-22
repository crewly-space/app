import type { CloudAccount } from '../cloud/account';
import { clientFor, readServerToken, storeServerToken } from './session';
import type { RegistryServer } from './types';

export type ConnectionResult =
  | { state: 'connected' }
  | { state: 'needs_local_login' }
  | { state: 'not_ready'; status: RegistryServer['status'] };

export interface ConnectOptions {
  /** Whether a stored session still works. Injected so tests need no server. */
  verifyToken?: (server: RegistryServer, token: string) => Promise<boolean>;
  /** Trades a Cloud handoff token for a session on the server itself. */
  exchangeHandoff?: (server: RegistryServer, token: string) => Promise<string>;
}

async function defaultVerify(server: RegistryServer, token: string): Promise<boolean> {
  const { client } = clientFor(server);
  client.setToken(token);
  try {
    await client.auth.me();
    return true;
  } catch {
    return false;
  }
}

async function defaultExchange(server: RegistryServer, token: string): Promise<string> {
  const { client } = clientFor(server);
  const result = await client.auth.cloudHandoff({ token });
  return result.token;
}

/**
 * Gets a usable session for one server, without disturbing the others.
 *
 * The order matters: a session we already hold costs nothing, so it is tried
 * first. Only a cloud server can be entered with a handoff, and a refused
 * handoff -- an unlinked Cloud, an expired Cloud session, a server that has
 * not been told about Cloud -- falls back to the server's own login rather
 * than leaving the person stuck.
 */
export async function connectToServer(
  server: RegistryServer,
  account: CloudAccount,
  options: ConnectOptions = {},
): Promise<ConnectionResult> {
  const verify = options.verifyToken ?? defaultVerify;
  const exchange = options.exchangeHandoff ?? defaultExchange;

  const stored = readServerToken(server.id);
  if (stored && (await verify(server, stored))) return { state: 'connected' };

  // A server still being built has no door to knock on yet, and saying so is
  // more use than a connection error.
  if (!server.endpoint || (server.kind === 'cloud' && server.status !== 'ready')) {
    return { state: 'not_ready', status: server.status };
  }
  if (server.kind !== 'cloud') return { state: 'needs_local_login' };

  const handoff = await account.handoffToken(server.id);
  if (!handoff) return { state: 'needs_local_login' };
  try {
    storeServerToken(server.id, await exchange(server, handoff));
    return { state: 'connected' };
  } catch {
    return { state: 'needs_local_login' };
  }
}
