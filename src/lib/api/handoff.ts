import { client, storeToken } from './client';

/**
 * Picks up a Crewly Cloud handoff token left in the URL fragment.
 *
 * The fragment is used rather than a query string because it never leaves the
 * browser: it is not sent to the server, so it cannot end up in an access log
 * or a referrer. It is cleared as soon as it has been read, so a reload or a
 * shared URL carries nothing.
 *
 * Returns true when it produced a session.
 */
export async function consumeHandoffFromUrl(
  location: { hash: string } = window.location,
  clear: () => void = () => history.replaceState(null, '', `${window.location.pathname}${window.location.search}`),
): Promise<boolean> {
  const match = /(?:^|[#&])handoff=([^&]+)/.exec(location.hash);
  if (!match) return false;
  const token = decodeURIComponent(match[1]);
  clear();
  try {
    const result = await client.auth.cloudHandoff({ token });
    storeToken(result.token);
    return true;
  } catch {
    // A token that is stale, replayed, or meant for another server. The sign-in
    // form is the honest next step, not an error the person cannot act on.
    return false;
  }
}
