import { useEffect, useMemo, useRef, useState } from 'react';
import type { ModelInfo } from '@crewly/protocol';
import { client } from '../../lib/api/client';

const defaultLoadModels = (providerId: string) => client.providers.listModels(providerId);

/** 128000 reads as noise; 128K is the number people compare. */
function contextLabel(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M context`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K context`;
  return `${tokens} context`;
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
  const [search, setSearch] = useState('');
  const [custom, setCustom] = useState(false);
  const [retry, setRetry] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
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
    setErrorMessage('');
    loadModels(providerId)
      .then((result) => {
        if (!active) return;
        setModels(result);
        setState('ready');
        if (result.length === 0) setCustom(true);
      })
      .catch((reason) => {
        if (!active) return;
        setModels([]);
        setState('failed');
        // Discovery is optional for providers that do not expose /models.
        // Fall back to an editable ID so onboarding can still finish with a
        // known model instead of trapping the user in the picker.
        setCustom(true);
        setErrorMessage(reason instanceof Error ? reason.message : 'The provider could not list its models.');
      });
    return () => { active = false; };
  }, [providerId, loadModels, retry]);

  useEffect(() => {
    setSearch('');
    setCustom(false);
    setRetry(0);
  }, [providerId]);

  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return models;
    return models.filter(
      (model) =>
        model.displayName.toLowerCase().includes(needle) || model.id.toLowerCase().includes(needle),
    );
  }, [models, search]);

  // A provider that answered with nothing, or did not answer at all, leaves
  // typing an id as the only way forward. So does an agent already running a
  // model this provider no longer lists: editing its name must never quietly
  // move it onto a different model.
  const unknownModel = Boolean(value) && state === 'ready' && !models.some((model) => model.id === value);
  const typing = custom || unknownModel;
  // With no provider chosen there is nothing to search and nothing to type an
  // id against, so neither control is shown.
  const idle = state === 'idle';

  return (
    <div className="model-picker">
      <span className="model-picker-label">Model <em>Required</em></span>

      {state === 'idle' && (
        <p className="field-description">Connect a provider first, then its models are listed here.</p>
      )}
      {state === 'loading' && (
        <p className="field-description">Loading models…</p>
      )}
      {state === 'failed' && (
        <p role="alert" className="field-description">
          This provider's model list could not be loaded{errorMessage ? `: ${errorMessage}` : '.'} Retry first, or use a custom model ID under Advanced.
        </p>
      )}
      {state === 'ready' && models.length === 0 && (
        <p className="field-description">This provider listed no models. Retry, or use a custom model ID under Advanced.</p>
      )}
      {unknownModel && !custom && (
        <p className="field-description">
          <strong>{value}</strong> is not in the provider's list. It is kept as it is.
        </p>
      )}

      {idle ? null : typing ? (
        <input
          aria-label="Model ID"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="e.g. gpt-4o-mini or claude-sonnet-5"
        />
      ) : state === 'ready' && models.length > 0 ? (
        <>
          <input
            ref={searchRef}
            type="search"
            aria-label="Search models"
            autoComplete="off"
            spellCheck={false}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search models"
          />
          <ul className="model-list" role="listbox" aria-label="Models">
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
                  <small>{model.id}</small>
                  <small>{contextLabel(model.contextWindow)}</small>
                </button>
              </li>
            ))}
          </ul>
          {state === 'ready' && matches.length === 0 && (
            <p className="field-description">No model matches “{search}”.</p>
          )}
        </>
      ) : null}

      {!idle && (state === 'failed' || (state === 'ready' && models.length === 0)) && (
        <div className="model-picker-actions">
          <button type="button" className="secondary-button compact" onClick={() => { setCustom(false); setRetry((count) => count + 1); }}>
            Retry model discovery
          </button>
          {!typing && <button type="button" className="text-button" onClick={() => setCustom(true)}>
            Use a custom model ID
          </button>}
        </div>
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
    </div>
  );
}
