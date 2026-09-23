import type { CloudAccountProfile, RegistryServer } from '../servers/types';

/**
 * The Crewly account, read from Cloud.
 *
 * The app runs on its own origin, so the Cloud session cookie only travels
 * when a request asks for it. Every call here is `credentials: 'include'` for
 * that reason, and no Cloud session is ever copied into the app's own storage:
 * it stays a cookie owned by the origin that issued it.
 */
export class CloudAccount {
  constructor(
    private readonly baseUrl: string,
    // Looked up per call: the registry's account is built when the module loads.
    private readonly fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args),
  ) {}

  private async get<T>(path: string): Promise<T | null> {
    const response = await this.fetchImpl(`${this.baseUrl.replace(/\/+$/, '')}${path}`, {
      method: 'GET',
      credentials: 'include',
      headers: { accept: 'application/json' },
    });
    // Signed out is an answer, not a failure: the app offers a sign-in.
    if (response.status === 401) return null;
    if (!response.ok) throw new Error(`Cloud returned HTTP ${response.status}`);
    return (await response.json()) as T;
  }

  /** The signed-in account, or null when there is no Cloud session. */
  async me(): Promise<CloudAccountProfile | null> {
    const body = await this.get<{ account: CloudAccountProfile }>('/api/v1/account');
    return body?.account ?? null;
  }

  async servers(): Promise<RegistryServer[]> {
    const body = await this.get<{ servers: RegistryServer[] }>('/api/v1/account/servers');
    return body?.servers ?? [];
  }

  /**
   * A short-lived token for one server, or null when Cloud will not mint one
   * -- an unlinked Cloud, a server that is not ready, a session that expired.
   * The caller falls back to a local login rather than failing.
   */
  async handoffToken(serverId: string): Promise<string | null> {
    const response = await this.fetchImpl(
      `${this.baseUrl.replace(/\/+$/, '')}/api/v1/account/servers/${serverId}/token`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { accept: 'application/json' },
      },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { token?: unknown };
    return typeof body.token === 'string' ? body.token : null;
  }
}
