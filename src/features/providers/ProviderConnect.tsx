import { useEffect, useState } from 'react';
import { CrewlyApiError, type DeviceInfo } from '@crewly/sdk';
import { client } from '../../lib/api/client';
import { useLayer } from '../../lib/layers';
import { ProviderLogo } from './ProviderLogo';
import { codexRuntimeOn, connectable, deviceProviderAvailability, explain, explainRefusal, type DeviceProviderKind } from './availability';

// Mirrors the kinds the server accepts. deepseek was missing here even though
// the server and the docs both list it.
const kinds = ['openai', 'anthropic', 'openrouter', 'deepseek', 'openai-compatible', 'claude-subscription', 'ollama'] as const;
type Kind = typeof kinds[number];
// Device-backed kinds have their own section; the key form only lists these.
const apiKinds = kinds.filter((item): item is Exclude<Kind, DeviceProviderKind> => item !== 'claude-subscription' && item !== 'ollama');


/** What each key-based provider is, and what connecting it takes, before anything is asked for. */
const apiKindInfo: Record<Exclude<Kind, DeviceProviderKind>, { title: string; about: string; needs: string }> = {
  openai: { title: 'OpenAI', about: 'GPT models, billed per token by OpenAI.', needs: 'An API key from platform.openai.com.' },
  anthropic: { title: 'Anthropic', about: 'Claude models, billed per token by Anthropic.', needs: 'An API key from console.anthropic.com.' },
  openrouter: { title: 'OpenRouter', about: 'Models from many labs through one account.', needs: 'An OpenRouter key, or sign in.' },
  deepseek: { title: 'DeepSeek', about: 'DeepSeek chat and reasoning models.', needs: 'An API key from platform.deepseek.com.' },
  'openai-compatible': { title: 'Custom endpoint', about: 'Any server that speaks the OpenAI API: vLLM, LM Studio, LiteLLM.', needs: 'Its base URL and a key.' },
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
export function ProviderConnect({ onConnected, onClose, closeLabel = 'Cancel' }: {
  onConnected: () => void;
  onClose?: () => void;
  /** First run offers to skip rather than cancel. */
  closeLabel?: string;
}) {
  // Nothing is asked for until a provider is chosen: credentials belong to
  // one card, not to a form that sits open for all of them.
  const [kind, setKind] = useState<Exclude<Kind, DeviceProviderKind> | null>(null);
  const [id, setId] = useState('');
  const [connectedKinds, setConnectedKinds] = useState<string[]>([]);
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
  // Escape and focus containment, as for any dialog, when it can be closed.
  const dialogRef = useLayer<HTMLFormElement>(() => onClose?.(), Boolean(onClose));
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

    // Which kinds already have a connection, so a card can say so. Members
    // cannot list providers; the cards then simply carry no badge.
    void Promise.resolve().then(() => client.providers.list())
      .then((list) => { if (active) setConnectedKinds(list.map((provider) => provider.kind)); })
      .catch(() => {});

    void client.devices.list()
      .then((list) => { if (active) setDevices(list); })
      .catch(() => { if (active) setDevices([]); /* key-based setup remains available */ });

    return () => { active = false; };
  }, [onConnected]);

  // A device-backed provider carries no secret: the server is told which kind
  // to route through the paired device, and asks your devices to switch it on
  // -- each checks for itself that it is signed in. Connecting again, for a
  // provider that already exists, just asks the devices again.
  const connectThroughDevice = async (deviceKind: DeviceProviderKind): Promise<void> => {
    setError(''); setConnectingDevice(deviceKind);
    try {
      const wasReady = devices ? deviceProviderAvailability(devices, deviceKind).state === 'ready' : false;
      let outcomes;
      try {
        outcomes = (await client.providers.create({ id: deviceKind, kind: deviceKind })).devices ?? [];
      } catch (reason) {
        if (!(reason instanceof CrewlyApiError && reason.code === 'provider_exists')) throw reason;
        outcomes = (await client.providers.enableOnDevices(deviceKind)).devices;
      }
      if (wasReady || outcomes.some((outcome) => outcome.enabled)) {
        onConnected();
        return;
      }
      const refused = outcomes[0];
      setError(refused
        ? explainRefusal(deviceKind, refused.deviceName, refused.error)
        : 'None of your paired devices is online. Start crewly on one, then connect again.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not connect through the device');
    } finally {
      setConnectingDevice(null);
    }
  };

  const deviceOption = (deviceKind: DeviceProviderKind, title: string, subtitle: string) => {
    const availability = devices ? deviceProviderAvailability(devices, deviceKind) : null;
    const ready = availability ? connectable(availability) : false;
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
  // Lead with what works now: a ready device first, otherwise the key-based
  // providers, and options that cannot be used yet after them.
  const deviceFirst = devices
    ? (['claude-subscription', 'ollama'] as const).some((item) => connectable(deviceProviderAvailability(devices, item)))
    : false;

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

  const deviceSection = (
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
  );

  return <div className="onboarding"><div className="onboarding-body"><form ref={dialogRef} className="onboarding-card form provider-connect-card"
    role={onClose ? 'dialog' : undefined} aria-modal={onClose ? true : undefined} aria-labelledby="provider-connect-title"
    onSubmit={async (event) => {
    event.preventDefault();
    if (!kind) return;
    setSaving(true); setError('');
    try {
      await client.providers.create({ id: id.trim() || kind, kind, apiKey: key, ...(baseUrl ? { baseUrl: baseUrl.replace(/\/+$/, '') } : {}) });
      onConnected();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Provider setup failed'); }
    finally { setSaving(false); }
  }}>
    <h1 id="provider-connect-title">Connect a model provider</h1><p>Agents need a model to think with. Use a subscription through your own device, or a provider's API key.</p>

    {deviceFirst && deviceSection}
    <section className="provider-class" aria-labelledby="provider-class-key">
    <h2 id="provider-class-key">With an API key</h2>
    <p>Pay the provider directly. The key is stored encrypted on this server and never shown again.</p>
    {oauthKinds.includes('openrouter') && !kind && <>
      <button type="button" className="secondary-button full" disabled={connecting} onClick={signInToProvider}>
        {connecting ? 'Connecting…' : 'Sign in with OpenRouter'}
      </button>
      <small>OpenRouter issues a key for this server. Nothing to copy or paste.</small>
    </>}
    {!kind ? (
      <div className="provider-cards" role="list" aria-label="API providers">
        {apiKinds.map((item) => {
          const info = apiKindInfo[item];
          const already = connectedKinds.includes(item);
          return <button type="button" role="listitem" key={item} className="provider-card"
            aria-label={`${info.title}${already ? ' (connected)' : ''}`}
            onClick={() => { setKind(item); setId(already ? `${item}-2` : item); setShowId(already); setKey(''); setBaseUrl(''); setError(''); }}>
            <ProviderLogo provider={item} small />
            <span className="provider-card-text">
              <strong>{info.title}</strong>
              <span>{info.about}</span>
              <small>{info.needs}</small>
            </span>
            {already && <span className="provider-card-badge">Connected</span>}
          </button>;
        })}
      </div>
    ) : (
      <div className="provider-key-form">
        <div className="provider-key-form-head">
          <ProviderLogo provider={kind} small />
          <strong>{apiKindInfo[kind].title}</strong>
          <button type="button" className="text-button" onClick={() => { setKind(null); setError(''); }}>Choose another</button>
        </div>
        <label>API key<input required autoFocus type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} />
          <small>{apiKindInfo[kind].needs}</small></label>
        {kind === 'openai-compatible' && <label>Base URL<input required type="url" autoComplete="off" spellCheck={false} placeholder="https://api.example.com/v1" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          <small>The root the provider documents for its OpenAI-compatible endpoints, without /chat/completions.</small></label>}
        {showId
          ? <label>Connection name<input required autoComplete="off" spellCheck={false} value={id} onChange={(e) => setId(e.target.value)} />
              <small>How agents refer to this connection. Use a new one to add a second {apiKindInfo[kind].title} account.</small>
            </label>
          : <button type="button" className="link-button" onClick={() => setShowId(true)}>Connecting another {apiKindInfo[kind].title} account?</button>}
        <button className="primary-button" disabled={saving}>{saving ? 'Checking the key…' : `Connect ${apiKindInfo[kind].title}`}</button>
      </div>
    )}
    </section>
    {!deviceFirst && deviceSection}
    <section className="provider-class" aria-labelledby="provider-class-gateway">
      <h2 id="provider-class-gateway">Crewly Gateway</h2>
      <div className="provider-option unavailable">
        <div>
          <strong>Models through your Crewly account</strong>
          <small>No keys to manage, billed with your plan. Not available on this server yet.</small>
        </div>
      </div>
    </section>

    {error && <p role="alert">{error}</p>}
    {onClose && <button type="button" className="secondary-button" onClick={onClose}>{closeLabel}</button>}
  </form></div></div>;
}
