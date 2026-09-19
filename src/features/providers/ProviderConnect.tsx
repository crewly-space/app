import { useEffect, useState } from 'react';
import { client } from '../../lib/api/client';

// Mirrors the kinds the server accepts. deepseek was missing here even though
// the server and the docs both list it.
const kinds = ['openai', 'anthropic', 'openrouter', 'deepseek', 'openai-compatible', 'claude-subscription', 'ollama'] as const;
type Kind = typeof kinds[number];

// The wire values are lowercase ids; showing them raw in a menu reads as an
// unfinished screen rather than a product.
const kindLabels: Record<Kind, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
  deepseek: 'DeepSeek',
  'openai-compatible': 'OpenAI-compatible endpoint',
  'claude-subscription': 'Claude Subscription on a paired device',
  ollama: 'Ollama on a paired device',
};

const PENDING_KEY = 'crewly:provider-oauth';
const callbackUrl = `${window.location.origin}/`;

// Session storage is not always reachable: a private window, blocked site data,
// or a non-browser render can each make the accessor itself throw.
function readPendingState(): string | null {
  try { return window.sessionStorage?.getItem(PENDING_KEY) ?? null; } catch { return null; }
}
function writePendingState(state: string | null): void {
  try {
    if (state === null) window.sessionStorage?.removeItem(PENDING_KEY);
    else window.sessionStorage?.setItem(PENDING_KEY, state);
  } catch { /* the flow still works; the user just cannot resume after a reload */ }
}
export function ProviderConnect({ onConnected, onClose, onSkip }: {
  onConnected: () => void;
  onClose?: () => void;
  /** Offered during first run only: enter the app without a provider yet. */
  onSkip?: () => void;
}) {
  const [kind, setKind] = useState<Kind>('openai');
  const [id, setId] = useState('openai');
  const [key, setKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [oauthKinds, setOauthKinds] = useState<string[]>([]);
  const [connecting, setConnecting] = useState(false);
  // The id only matters when connecting a second account of the same kind, so
  // it stays out of the way until someone asks for it.
  const [showId, setShowId] = useState(false);
  const [localKinds, setLocalKinds] = useState<string[]>([]);

  useEffect(() => {
    let active = true;

    // Returning from the provider: the code is in the URL and the state was
    // parked before leaving. Redeem it, then clean the URL so a refresh does
    // not retry a code the provider has already burned.
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const pending = readPendingState();
    if (code && pending) {
      writePendingState(null);
      window.history.replaceState(null, '', window.location.pathname);
      setConnecting(true);
      void client.providers
        .completeOAuth({ state: pending, code })
        .then(() => { if (active) onConnected(); })
        .catch((reason) => {
          if (active) setError(reason instanceof Error ? reason.message : 'Could not finish connecting');
        })
        .finally(() => { if (active) setConnecting(false); });
    }

    void client.providers
      .oauthKinds()
      .then((result) => { if (active) setOauthKinds(result.kinds); })
      .catch(() => { /* older server: key entry still works */ });

    void client.devices.list().then((devices) => {
      if (!active) return;
      const available = new Set<string>();
      for (const device of devices) {
        if (!device.connected) continue;
        const providers = Array.isArray(device.capabilities.providers) ? device.capabilities.providers : [];
        for (const provider of providers) {
          if (provider && typeof provider === 'object' && typeof (provider as { kind?: unknown }).kind === 'string') {
            available.add((provider as { kind: string }).kind);
          }
        }
      }
      setLocalKinds([...available]);
    }).catch(() => { /* remote provider setup remains available */ });

    return () => { active = false; };
  }, [onConnected]);

  const signInToProvider = async (): Promise<void> => {
    setError(''); setConnecting(true);
    try {
      const started = await client.providers.startOAuth({ kind: 'openrouter', callbackUrl });
      writePendingState(started.state);
      window.location.assign(started.authorizeUrl);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not start the connection');
      setConnecting(false);
    }
  };

  return <div className="onboarding"><div className="onboarding-body"><form className="onboarding-card form" onSubmit={async (event) => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const local = kind === 'claude-subscription' || kind === 'ollama';
      await client.providers.create({ id, kind, ...(local ? {} : { apiKey: key }), ...(baseUrl ? { baseUrl } : {}) });
      onConnected();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Provider setup failed'); }
    finally { setSaving(false); }
  }}>
    <h1>Connect a model provider</h1><p>Use a remote API or an available provider on one of your paired devices.</p>
    {oauthKinds.includes('openrouter') && <>
      <button type="button" className="secondary-button full" disabled={connecting} onClick={signInToProvider}>
        {connecting ? 'Connecting…' : 'Sign in with OpenRouter'}
      </button>
      <small>OpenRouter issues a key for this server. Nothing to copy or paste.</small>
      <p className="oauth-divider"><span>or paste a key</span></p>
    </>}
    <label>Provider<select value={kind} onChange={(e) => { const next = e.target.value as Kind; setKind(next); setId(next); }}>
      {kinds.filter((item) => item !== 'claude-subscription' && item !== 'ollama' || localKinds.includes(item))
        .map((item) => <option key={item} value={item}>{kindLabels[item]}</option>)}</select></label>
    {kind !== 'claude-subscription' && kind !== 'ollama' && <label>API key<input required type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} /></label>}
    {kind === 'openai-compatible' && <label>Base URL<input required type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} /></label>}
    {showId
      ? <label>Provider ID<input required value={id} onChange={(e) => setId(e.target.value)} />
          <small>How agents refer to this connection. Change it to add a second {kindLabels[kind]} account.</small>
        </label>
      : <button type="button" className="link-button" onClick={() => setShowId(true)}>Connecting another {kindLabels[kind]} provider?</button>}
    {error && <p role="alert">{error}</p>}
    <button className="primary-button" disabled={saving}>{saving ? 'Checking the key…' : 'Save provider'}</button>
    {onClose && <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>}
    {onSkip && <button type="button" className="link-button" disabled={saving} onClick={onSkip}>Skip for now — look around first</button>}
  </form></div></div>;
}
