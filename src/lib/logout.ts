import { CloudAccount } from './cloud/account';
import { clearToken } from './api/client';
import { clearWorkspaces } from './boot-cache';
import { gateway } from './gateway';
import { resetConnections } from './servers/session';

const cloudUrl: string | undefined = import.meta.env.VITE_CREWLY_CLOUD_URL;

/** Sign out of the account on hosted builds, or the server on standalone builds. */
export async function logout(): Promise<void> {
  if (!cloudUrl) return gateway.logout();
  await new CloudAccount(cloudUrl).logout();
  // Forget every server session so another account cannot reuse this account's access.
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('crewly:session:') || key === 'crewly:server-registry' || key === 'crewly:last-server') {
        localStorage.removeItem(key);
      }
    }
  } catch { /* storage can be refused */ }
  clearToken();
  resetConnections();
  clearWorkspaces();
  window.dispatchEvent(new Event('crewly:account-logout'));
}
