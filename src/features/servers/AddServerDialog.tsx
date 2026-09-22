import { useState } from 'react';
import { CloudAccount } from '../../lib/cloud/account';
import { cloudUrl } from './useServerRegistry';

/**
 * Adds a server somebody runs themselves to their Crewly account.
 *
 * Cloud checks the address before it stores it, so the reasons this can fail
 * are its reasons -- not reachable from the internet, not answering like a
 * Crewly server, already on the account -- and they are shown as given rather
 * than replaced with a generic failure.
 */
export function AddServerDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !cloudUrl) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`${cloudUrl.replace(/\/+$/, '')}/api/v1/account/servers`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), baseUrl: baseUrl.trim() }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(String((body as { error?: unknown }).error ?? `Cloud returned HTTP ${response.status}`));
      }
      onAdded();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The server could not be added');
      setSaving(false);
    }
  }

  return (
    <div className="modal-layer" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="add-server-title">
        <header>
          <div>
            <h2 id="add-server-title">Add your own server</h2>
            <p>A Crewly server you run yourself, listed beside the ones you bought.</p>
          </div>
        </header>
        <form className="form" onSubmit={submit}>
          <label>
            <span>Name</span>
            <input required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} placeholder="Home lab" />
          </label>
          <label>
            <span>Address</span>
            <input
              required
              type="url"
              autoComplete="off"
              spellCheck={false}
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://crewly.example.com"
            />
            <small className="field-description">
              Must be reachable over HTTPS. You sign in to it with its own account.
            </small>
          </label>
          {error && <p role="alert">{error}</p>}
          <div className="form-actions">
            <button type="button" className="text-button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-button" disabled={saving}>
              {saving ? 'Checking…' : 'Add server'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
