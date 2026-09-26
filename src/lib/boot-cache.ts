/**
 * The last thing each server's workspace showed, kept for this page's life.
 *
 * Switching back to a server shows its sidebar, conversations and the room
 * that was open straight away, then refreshes underneath, instead of tearing
 * the shell down and cold-booting. Held in memory only: nothing about a
 * server's conversations is written to disk by this.
 */
export interface CachedWorkspace<T> {
  data: T;
  selected: string;
  at: number;
}

const cache = new Map<string, CachedWorkspace<unknown>>();

export function readWorkspace<T>(serverKey: string): CachedWorkspace<T> | undefined {
  return cache.get(serverKey) as CachedWorkspace<T> | undefined;
}

export function writeWorkspace<T>(serverKey: string, data: T, selected: string): void {
  cache.set(serverKey, { data, selected, at: Date.now() });
}

export function hasWorkspace(serverKey: string): boolean {
  return cache.has(serverKey);
}

/** Forgets every server: on signing out of the account, nothing should linger. */
export function clearWorkspaces(): void {
  cache.clear();
}

// Signing out anywhere drops every remembered workspace with it.
if (typeof window !== 'undefined') window.addEventListener('crewly:logout', clearWorkspaces);
