/** URLs returned by a configured server must never become script execution. */
export function safeNavigationUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw, window.location.origin);
    if (url.protocol === 'https:') return url.toString();
    if (url.protocol !== 'http:') return null;
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host)) return url.toString();
    return null;
  } catch {
    return null;
  }
}

export function navigateToServerUrl(raw: string): void {
  const url = safeNavigationUrl(raw);
  if (!url) throw new Error('The server returned an unsafe navigation URL');
  window.location.assign(url);
}
