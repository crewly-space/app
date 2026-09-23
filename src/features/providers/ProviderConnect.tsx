import { useEffect, useState } from 'react';
import type { DeviceInfo } from '@crewly/sdk';
import { client } from '../../lib/api/client';
import { codexRuntimeOn, deviceProviderAvailability, explain, type DeviceProviderKind } from './availability';

// Mirrors the kinds the server accepts. deepseek was missing here even though
// the server and the docs both list it.
const kinds = ['openai', 'anthropic', 'openrouter', 'deepseek', 'openai-compatible', 'claude-subscription', 'ollama'] as const;
type Kind = typeof kinds[number];
// Device-backed kinds have their own section; the key form only lists these.
const apiKinds = kinds.filter((item): item is Exclude<Kind, DeviceProviderKind> => item !== 'claude-subscription' && item !== 'ollama');

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
/** True when the page was loaded by a provider redirecting back with a code this tab is waiting for. */
export function hasPendingProviderOAuth(): boolean {
  return Boolean(new URLSearchParams(window.location.search).get('code') && readPendingState());
}
function writePendingState(state: string | null): void {
  try {
    if (state === null) window.sessionStorage?.removeItem(PENDING_KEY);
    else window.sessionStorage?.setItem(PENDING_KEY, state);
  } catch { /* the flow still works; the user just cannot resume after a reload */ }
}
export function ProviderConnect({ onConnected, onClose }: {
  onConnected: () => void;
  onClose?: () => void;
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
  const [devices, setDevices] = useState<DeviceInfo[] | null>(null);
  const [connectingDevice, setConnectingDevice] = useState<DeviceProviderKind | null>(null);

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

    void client.devices.list()
      .then((list) => { if (active) setDevices(list); })
      .catch(() => { if (active) setDevices([]); /* key-based setup remains available */ });

    return () => { active = false; };
  }, [onConnected]);

  // A device-backed provider carries no secret: the server is told which kind
  // to route through the paired device, and the device does the signing in.
  const connectThroughDevice = async (deviceKind: DeviceProviderKind): Promise<void> => {
    setError(''); setConnectingDevice(deviceKind);
    try {
      await client.providers.create({ id: deviceKind, kind: deviceKind });
      onConnected();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not connect through the device');
    } finally {
      setConnectingDevice(null);
    }
  };

  const deviceOption = (deviceKind: DeviceProviderKind, title: string, subtitle: string) => {
    const availability = devices ? deviceProviderAvailability(devices, deviceKind) : null;
    const ready = availability?.state === 'ready';
    return <div className={`provider-option${ready ? '' : ' unavailable'}`} key={deviceKind}>
      <div>
        <strong>{title}</strong> <span>{subtitle}</span>
        <small>{availability ? explain(deviceKind, availability) : 'Checking your paired devices…'}</small>
      </div>
      {ready && <button type="button" className="secondary-button" disabled={connectingDevice !== null}
        onClick={() => void connectThroughDevice(deviceKind)}>
        {connectingDevice === deviceKind ? 'Connecting…' : `Connect ${title}`}
      </button>}
    </div>;
  };
  const codexDevice = devices ? codexRuntimeOn(devices) : null;

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
      await client.providers.create({ id, kind, apiKey: key, ...(baseUrl ? { baseUrl } : {}) });
      onConnected();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Provider setup failed'); }
    finally { setSaving(false); }
  }}>
    <h1>Connect a model provider</h1><p>Agents need a model to think with. Use a subscription through your own device, or a provider's API key.</p>

    <section className="provider-class" aria-labelledby="provider-class-device">
      <h2 id="provider-class-device">On your device</h2>
      <p>Uses a subscription or local model through a paired device. The sign-in stays on the device; this server never sees it.</p>
      {deviceOption('claude-subscription', 'Claude', 'Pro or Max subscription')}
      {deviceOption('ollama', 'Ollama', 'Local models')}
      <div className="provider-option unavailable">
        <div>
          <strong>ChatGPT</strong> <span>Plus or Pro subscription</span>
          <small>{codexDevice
            ? `Codex is signed in on ${codexDevice} and can run coding work there as a runtime. A ChatGPT subscription can't be used as a chat provider yet.`
            : "A ChatGPT subscription can't be used as a chat provider yet."}</small>
        </div>
      </div>
    </section>

    <section className="provider-class" aria-labelledby="provider-class-gateway">
      <h2 id="provider-class-gateway">Crewly Gateway</h2>
      <div className="provider-option unavailable">
        <div>
          <strong>Models through your Crewly account</strong>
          <small>No keys to manage, billed with your plan. Not available on this server yet.</small>
        </div>
      </div>
    </section>

    <section className="provider-class" aria-labelledby="provider-class-key">
    <h2 id="provider-class-key">With an API key</h2>
    {oauthKinds.includes('openrouter') && <>
      <button type="button" className="secondary-button full" disabled={connecting} onClick={signInToProvider}>
        {connecting ? 'Connecting…' : 'Sign in with OpenRouter'}
      </button>
      <small>OpenRouter issues a key for this server. Nothing to copy or paste.</small>
      <p className="oauth-divider"><span>or paste a key</span></p>
    </>}
    <label>Provider<select value={kind} onChange={(e) => { const next = e.target.value as Kind; setKind(next); setId(next); }}>
      {apiKinds.map((item) => <option key={item} value={item}>{kindLabels[item]}</option>)}</select></label>
    <label>API key<input required type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} /></label>
    {kind === 'openai-compatible' && <label>Base URL<input required type="url" autoComplete="off" spellCheck={false} placeholder="https://api.example.com/v1" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
      <small>The root the provider documents for its OpenAI-compatible endpoints, without /chat/completions.</small></label>}
    {showId
      ? <label>Provider ID<input required autoComplete="off" spellCheck={false} value={id} onChange={(e) => setId(e.target.value)} />
          <small>How agents refer to this connection. Change it to add a second {kindLabels[kind]} account.</small>
        </label>
      : <button type="button" className="link-button" onClick={() => setShowId(true)}>Connecting another {kindLabels[kind]} provider?</button>}
    </section>
    {error && <p role="alert">{error}</p>}
    <button className="primary-button" disabled={saving}>{saving ? 'Checking the key…' : 'Save provider'}</button>
    {onClose && <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>}
  </form></div></div>;
}
