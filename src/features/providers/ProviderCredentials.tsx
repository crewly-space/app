import { useState } from 'react';
import { client } from '../../lib/api/client';
import type { Provider } from '../../types';
import { providerConnectionLabel } from './labels';

export function ProviderCredentials({
  provider,
  usedByAgents,
  onChanged,
  onClose,
}: {
  provider: Provider;
  usedByAgents: number;
  onChanged: (message: string) => Promise<void>;
  onClose: () => void;
}) {
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');
  const local = provider.name === 'claude-subscription' || provider.name === 'ollama' || provider.name === 'crewly-gateway';

  return <div className="onboarding"><div className="onboarding-body"><form className="onboarding-card form" onSubmit={async (event) => {
    event.preventDefault();
    if (local) return;
    setSaving(true); setError('');
    try {
      await client.providers.update(provider.id, {
        apiKey,
        ...(baseUrl ? { baseUrl: baseUrl.replace(/\/+$/, '') } : {}),
      });
      await onChanged('Provider credentials updated.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update provider');
    } finally { setSaving(false); }
  }}>
    <h1>Manage {provider.name}</h1>
    <p>{local
      ? provider.name === 'crewly-gateway'
        ? 'This provider runs through your Crewly account. The upstream credential stays in Crewly Cloud.'
        : 'This provider runs on a paired device. No credential is stored on the server.'
      : <>Rotate the credential for <strong>{provider.id}</strong>. Existing keys are never shown.</>}</p>
    {!local && <label>New API key<input required type="password" autoComplete="off" spellCheck={false} value={apiKey} onChange={(event) => setApiKey(event.target.value)} /></label>}
    {!local && provider.name === 'openai-compatible' && <label>New base URL <small>(optional)</small><input type="url" autoComplete="off" spellCheck={false} value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="Leave blank to keep the current URL" /></label>}
    {error && <p role="alert">{error}</p>}
    {!local && <button className="primary-button" disabled={saving}>{saving ? 'Updating…' : 'Rotate credential'}</button>}
    <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
    {!confirmDelete ? (
      <button type="button" className="danger-button" onClick={() => setConfirmDelete(true)}>Remove provider</button>
    ) : (
      <div className="danger-confirm" role="alert">
        <strong>Remove {providerConnectionLabel(provider)}?</strong>
        <p>{usedByAgents > 0
          ? `${usedByAgents} agent${usedByAgents === 1 ? '' : 's'} use this provider and will stop replying until reconfigured.`
          : 'Agents will no longer be able to use this provider.'}</p>
        <button type="button" className="danger-button" disabled={saving} onClick={async () => {
          setSaving(true); setError('');
          try {
            await client.providers.delete(provider.id);
            await onChanged('Provider removed.');
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Could not remove provider');
            setSaving(false);
          }
        }}>Yes, remove provider</button>
        <button type="button" className="link-button" disabled={saving} onClick={() => setConfirmDelete(false)}>Keep provider</button>
      </div>
    )}
  </form></div></div>;
}
