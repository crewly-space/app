import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ModelInfo } from '@crewly/protocol';
import { client } from '../../lib/api/client';

const defaultLoadModels = (providerId: string) => client.providers.listModels(providerId);

/** 128000 reads as noise; 128K is the number people compare. */
function contextLabel(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M context`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K context`;
  return `${tokens} context`;
}

type Failure = { message: string; code?: string; retryable: boolean };

/**
 * What went wrong, in the server's words when it gave some. The server names
 * the failure (a rejected key, a rate limit, no catalogue at all) so the
 * person is told which of those it was rather than one catch-all sentence.
 */
function failureOf(reason: unknown): Failure {
  const error = reason as { message?: unknown; code?: unknown; body?: unknown } | null;
  const code = typeof error?.code === 'string' ? error.code : undefined;
  const body = error?.body && typeof error.body === 'object' ? (error.body as { retryable?: unknown }) : undefined;
  const message = typeof error?.message === 'string' && error.message
    ? error.message
    : "This provider's model list could not be loaded.";
  const retryable = typeof body?.retryable === 'boolean'
    ? body.retryable
    : code !== 'provider_models_unsupported' && code !== 'provider_auth_failed';
  return { message, code, retryable };
}

export function ModelPicker({
  providerId,
  value,
  onChange,
  loadModels = defaultLoadModels,
}: {
  providerId: string;
  value: string;
  onChange: (modelId: string) => void;
  /** Injected in tests; in the app this is the provider's own model list. */
  loadModels?: (providerId: string) => Promise<ModelInfo[]>;
}) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState('');
  const [custom, setCustom] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Nothing to ask until a provider is chosen; asking anyway would report a
    // failure the person cannot do anything about.
    if (!providerId) {
      setModels([]);
      setState('idle');
      return;
    }
    let active = true;
    setState('loading');
    setFailure(null);
    loadModels(providerId)
      .then((result) => {
        if (!active) return;
        setModels(result);
        setState('ready');
      })
      .catch((reason) => {
        if (!active) return;
        setModels([]);
        setFailure(failureOf(reason));
        setState('failed');
      });
    return () => { active = false; };
  }, [providerId, loadModels, attempt]);

  // A different provider is a different catalogue; a custom id typed for the
  // previous one is not a choice made about this one.
  useEffect(() => { setCustom(false); setSearch(''); }, [providerId]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return models;
    return models.filter(
      (model) =>
        model.displayName.toLowerCase().includes(needle) || model.id.toLowerCase().includes(needle),
    );
  }, [models, search]);

  // An agent already running a model this provider no longer lists keeps it:
  // editing its name must never quietly move it onto a different model.
  const unknownModel = Boolean(value) && state === 'ready' && !models.some((model) => model.id === value);
  // A provider that lists nothing leaves typing as the only way forward. A
  // failed list does not: retrying comes first, and typing is a choice.
  const typing = custom || unknownModel || (state === 'ready' && models.length === 0);
  const idle = state === 'idle';

  return (
    <div className="model-picker">
      <span className="model-picker-label">Model <em>Required</em></span>

      {state === 'idle' && (
        <p className="field-description">Connect a provider first, then its models are listed here.</p>
      )}
      {state === 'failed' && failure && (
        <div className="model-picker-failure" role="alert">
          <strong>Models could not be loaded</strong>
          <p>{failure.message}</p>
          {value && !custom && (
            <p className="field-description">This agent keeps <strong>{value}</strong> until you choose another.</p>
          )}
          <div className="model-picker-failure-actions">
            {failure.retryable && (
              <button type="button" className="secondary-button" onClick={retry}>Retry</button>
            )}
            {!custom && (
              <button type="button" className="text-button" onClick={() => setCustom(true)}>
                Enter a model ID instead
              </button>
            )}
          </div>
        </div>
      )}
      {state === 'ready' && models.length === 0 && (
        <p className="field-description">This provider listed no models. Enter a model ID instead.</p>
      )}
      {unknownModel && !custom && (
        <p className="field-description">
          <strong>{value}</strong> is not in the provider's list. It is kept as it is.
        </p>
      )}

      {idle || (state === 'failed' && !custom) ? null : typing ? (
        <input
          aria-label="Model ID"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="e.g. gpt-4o-mini or claude-sonnet-5"
        />
      ) : (
        <>
          <input
            ref={searchRef}
            type="search"
            aria-label="Search models"
            autoComplete="off"
            spellCheck={false}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={state === 'loading' ? 'Loading models…' : 'Search models'}
            disabled={state === 'loading'}
          />
          <ul className="model-list" role="listbox" aria-label="Models" aria-busy={state === 'loading'}>
            {matches.map((model) => (
              <li key={model.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={model.id === value}
                  className={`model-option${model.id === value ? ' selected' : ''}`}
                  onClick={() => onChange(model.id)}
                >
                  <strong>{model.displayName}</strong>
                  {model.displayName !== model.id && <small>{model.id}</small>}
                  <small>{contextLabel(model.contextWindow)}</small>
                </button>
              </li>
            ))}
          </ul>
          {state === 'ready' && matches.length === 0 && (
            <p className="field-description">No model matches “{search}”.</p>
          )}
        </>
      )}

      {state === 'ready' && models.length > 0 && (
        <button
          type="button"
          className="text-button"
          onClick={() => {
            setCustom(!typing);
            if (typing) setSearch('');
          }}
        >
          {typing ? 'Choose from the list' : 'Use a custom model ID'}
        </button>
      )}
      {state === 'failed' && custom && (
        <button type="button" className="text-button" onClick={() => { setCustom(false); retry(); }}>
          Try loading the list again
        </button>
      )}
    </div>
  );
}
