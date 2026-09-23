import { useEffect, useState } from 'react';
import type { Skill } from '@crewly/sdk';
import type { PlatformApi } from './platform-api';
import { useWork } from './useWork';

/**
 * Skills: how an agent works, written once and given to many agents. Not a
 * tool it calls, and not where it runs -- those are Tools and each agent's
 * runtime.
 */
export function SkillsPanel({ api }: { api: PlatformApi }) {
  const { busy, error, run } = useWork();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [mode, setMode] = useState<'write' | 'install'>('write');
  const [draft, setDraft] = useState({ name: '', description: '', instructions: '', manifest: '' });

  useEffect(() => {
    void run(async () => setSkills(await api.skills()));
  }, [api, run]);

  const add = (skill: Skill) => setSkills((current) => [...current, skill].sort((a, b) => a.name.localeCompare(b.name)));

  return (
    <div className="dashboard-skills">
      {error && <p role="alert" className="dashboard-error">{error}</p>}
      <table className="dashboard-table">
        <thead><tr><th>Skill</th><th>Settings</th><th>Source</th><th aria-label="Actions" /></tr></thead>
        <tbody>
          {skills.map((skill) => (
            <tr key={skill.id}>
              <td><strong>{skill.name}</strong><small>{skill.description}</small></td>
              <td>{skill.configFields.map((field) => `${field.label}${field.secret ? ' (secret)' : ''}`).join(', ') || 'None'}</td>
              <td>{skill.source === 'installed' ? `Installed v${skill.version}` : 'Written here'}</td>
              <td className="dashboard-row-actions">
                <button type="button" className="text-button danger" disabled={busy} aria-label={`Remove ${skill.name}`} onClick={() => void run(async () => {
                  await api.deleteSkill(skill.id);
                  setSkills((current) => current.filter((row) => row.id !== skill.id));
                })}>Remove</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="dashboard-tabs" role="tablist" aria-label="Add a skill">
        <button type="button" role="tab" aria-selected={mode === 'write'} className={mode === 'write' ? 'selected' : ''} onClick={() => setMode('write')}>Write one</button>
        <button type="button" role="tab" aria-selected={mode === 'install'} className={mode === 'install' ? 'selected' : ''} onClick={() => setMode('install')}>Install a manifest</button>
      </div>
      <form className="dashboard-form" onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          add(mode === 'write'
            ? await api.createSkill({ name: draft.name, description: draft.description, instructions: draft.instructions })
            : await api.installSkill(draft.manifest));
          setDraft({ name: '', description: '', instructions: '', manifest: '' });
        });
      }}>
        {mode === 'write' ? (
          <>
            <input aria-label="Skill name" placeholder="Code review" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
            <input aria-label="Skill description" placeholder="What it is for" value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} />
            <textarea aria-label="Instructions" rows={6} placeholder="How the agent should work when it has this skill" value={draft.instructions}
              onChange={(event) => setDraft((current) => ({ ...current, instructions: event.target.value }))} />
          </>
        ) : (
          <textarea aria-label="Skill manifest" rows={10} placeholder={'---\nname: Release notes\ndescription: …\n---\nInstructions…'} value={draft.manifest}
            onChange={(event) => setDraft((current) => ({ ...current, manifest: event.target.value }))} />
        )}
        <button type="submit" className="primary-button" disabled={busy || (mode === 'write' ? !draft.name || !draft.instructions : !draft.manifest)}>
          {mode === 'write' ? 'Add skill' : 'Install'}
        </button>
      </form>
    </div>
  );
}
