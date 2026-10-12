import { useState, type FormEvent } from 'react';
import type { DeviceWorkspace, DeviceWorkspaceChange } from '@crewly/sdk';
import { useWork } from './useWork';
import './device-workspaces.css';

export interface WorkspaceActions {
  add(path: string, name?: string): Promise<DeviceWorkspaceChange>;
  rename(workspaceId: string, name: string): Promise<DeviceWorkspaceChange>;
  remove(workspaceId: string): Promise<DeviceWorkspaceChange>;
}

const folderName = (path: string) => path.trim().replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';

/**
 * Where a coding agent works on one device: a scratch folder of its own, or
 * one of the device's workspaces -- which can be added, renamed and removed
 * right here instead of in a terminal on that device.
 */
export function DeviceWorkspaces({
  device,
  selectedId,
  onSelect,
  actions,
  onChanged,
}: {
  device: { id: string; name: string; connected: boolean; workspaces: DeviceWorkspace[] };
  selectedId: string;
  onSelect: (workspaceId: string) => void;
  actions: WorkspaceActions;
  onChanged: (workspaces: DeviceWorkspace[]) => void;
}) {
  const { busy, error, run, setError } = useWork();
  const [adding, setAdding] = useState(false);
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const offline = !device.connected;
  const locked = busy || offline;

  const add = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const result = await actions.add(path.trim(), name.trim() || undefined);
      onChanged(result.workspaces);
      if (result.workspace) onSelect(result.workspace.id);
      setAdding(false);
      setPath('');
      setName('');
    });
  };

  const rename = (event: FormEvent) => {
    event.preventDefault();
    if (!renaming) return;
    void run(async () => {
      onChanged((await actions.rename(renaming.id, renaming.name.trim())).workspaces);
      setRenaming(null);
    });
  };

  const remove = (workspaceId: string) => void run(async () => {
    onChanged((await actions.remove(workspaceId)).workspaces);
    if (selectedId === workspaceId) onSelect('');
    setRemoving(null);
  });

  return (
    <fieldset className="device-workspaces" aria-label="Workspace">
      <legend>Workspace on {device.name}</legend>
      <p className="field-description">The folder it works in. It cannot reach anything outside it.</p>

      <div className="device-workspace">
        <label>
          <input type="radio" name={`workspace-${device.id}`} checked={selectedId === ''} onChange={() => onSelect('')} />
          <span>
            <strong>Scratch folder</strong>
            <small>A fresh, empty folder of its own. None of your files are shared.</small>
          </span>
        </label>
      </div>

      {device.workspaces.map((workspace) => (
        <div className="device-workspace" key={workspace.id}>
          {renaming?.id === workspace.id ? (
            <form className="device-workspace-rename" onSubmit={rename}>
              <input aria-label={`New name for ${workspace.name}`} value={renaming.name} autoFocus maxLength={100}
                onChange={(event) => setRenaming({ id: workspace.id, name: event.target.value })}
                onKeyDown={(event) => { if (event.key === 'Escape') setRenaming(null); }} />
              <button type="submit" className="primary-button compact" disabled={busy || !renaming.name.trim()}>Save</button>
              <button type="button" className="text-button" onClick={() => setRenaming(null)}>Cancel</button>
            </form>
          ) : (
            <>
              <label>
                <input type="radio" name={`workspace-${device.id}`} checked={selectedId === workspace.id} onChange={() => onSelect(workspace.id)} />
                <span><strong>{workspace.name}</strong></span>
              </label>
              <span className="device-workspace-actions">
                {removing === workspace.id ? (
                  <>
                    <small>Stop sharing it? The folder stays on {device.name}.</small>
                    <button type="button" className="danger-button compact" disabled={locked} onClick={() => remove(workspace.id)}>Remove</button>
                    <button type="button" className="text-button" onClick={() => setRemoving(null)}>Keep</button>
                  </>
                ) : (
                  <>
                    <button type="button" className="text-button" disabled={locked} aria-label={`Rename ${workspace.name}`}
                      onClick={() => { setError(''); setRemoving(null); setRenaming({ id: workspace.id, name: workspace.name }); }}>Rename</button>
                    <button type="button" className="text-button" disabled={locked} aria-label={`Remove ${workspace.name}`}
                      onClick={() => { setError(''); setRenaming(null); setRemoving(workspace.id); }}>Remove</button>
                  </>
                )}
              </span>
            </>
          )}
        </div>
      ))}

      {adding ? (
        <form className="device-workspace-add" onSubmit={add}>
          <label>
            Folder on {device.name}
            <input value={path} autoFocus placeholder="~/code/my-project" spellCheck={false} autoCapitalize="off"
              onChange={(event) => setPath(event.target.value)} />
          </label>
          <label>
            Name <small>optional</small>
            <input value={name} maxLength={100} placeholder={folderName(path) || 'my-project'} onChange={(event) => setName(event.target.value)} />
          </label>
          <div className="device-workspace-add-actions">
            <button type="submit" className="primary-button compact" disabled={locked || !path.trim()}>Add folder</button>
            <button type="button" className="text-button" onClick={() => { setAdding(false); setError(''); }}>Cancel</button>
          </div>
        </form>
      ) : (
        <button type="button" className="secondary-button compact device-workspace-new" disabled={locked}
          onClick={() => { setError(''); setRenaming(null); setRemoving(null); setAdding(true); }}>+ Add a folder</button>
      )}

      {offline && (
        <p className="field-description">{device.name} is offline. Run <code>crewly start</code> there to add or change folders.</p>
      )}
      {error && <p role="alert" className="dashboard-error">{error}</p>}
    </fieldset>
  );
}
