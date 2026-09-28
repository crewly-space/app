import { Fragment, useEffect, useState } from 'react';
import { FileCode2, PenLine, Plus } from 'lucide-react';
import type { Agent, Skill } from '@crewly/sdk';
import type { PlatformApi } from './platform-api';
import { SkillPlanCard } from './SkillPlanCard';
import { useWork } from './useWork';

/** What a skill needs, in a line: capabilities, and whether it ever asks. */
function needs(skill: Skill): string {
  const requirements = skill.requirements;
  if (!requirements) return '';
  const parts = requirements.requires.map((entry) => entry.capability.replaceAll('_', ' '));
  if (requirements.approvals.length) parts.push(`asks before ${requirements.approvals.length} action${requirements.approvals.length === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/**
 * Skills: how an agent works, written once and given to many agents. Not a
 * tool it calls, and not where it runs -- those are Tools and each agent's
 * runtime.
 */
export function SkillsPanel({ api, agents = [] }: { api: PlatformApi; agents?: Agent[] }) {
  const { busy, error, run } = useWork();
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [skills, setSkills] = useState<Skill[]>([]);
  const [mode, setMode] = useState<'write' | 'install'>('write');
  const [draft, setDraft] = useState({ name: '', description: '', instructions: '', manifest: '' });

  useEffect(() => {
    void run(async () => { setSkills(await api.skills()); setLoaded(true); });
  }, [api, run]);

  const [loaded, setLoaded] = useState(false);
  const add = (skill: Skill) => setSkills((current) => [...current, skill].sort((a, b) => a.name.localeCompare(b.name)));

  return (
    <div className="dashboard-skills">
      {error && <p role="alert" className="dashboard-error">{error}</p>}
      {notice && <p role="status" className="callout">{notice}</p>}
      {loaded && skills.length === 0 && (
        <div className="dashboard-empty">
          <strong>No skills yet</strong>
          <p>Write one below, install a manifest, or add a ready-made one from the catalog.</p>
        </div>
      )}
      {skills.length > 0 && <table className="dashboard-table">
        <thead><tr><th>Skill</th><th>Settings</th><th>Source</th><th aria-label="Actions" /></tr></thead>
        <tbody>
          {skills.map((skill) => (
            <Fragment key={skill.id}>
            <tr>
              <td><strong>{skill.name}</strong><small>{skill.description}</small>{needs(skill) && <small>Needs {needs(skill)}</small>}</td>
              <td>{skill.configFields.map((field) => `${field.label}${field.secret ? ' (secret)' : ''}`).join(', ') || 'None'}</td>
              <td>{skill.source === 'installed' ? `Installed v${skill.version}` : 'Written here'}</td>
              <td className="dashboard-row-actions">
                {api.skillPlan && (
                  <button type="button" className="text-button" aria-expanded={reviewing === skill.id} onClick={() => setReviewing((current) => (current === skill.id ? null : skill.id))}>
                    {reviewing === skill.id ? 'Close' : 'Give to an agent'}
                  </button>
                )}
                <button type="button" className="text-button danger" disabled={busy} aria-label={`Remove ${skill.name}`} onClick={() => void run(async () => {
                  await api.deleteSkill(skill.id);
                  setSkills((current) => current.filter((row) => row.id !== skill.id));
                })}>Remove</button>
              </td>
            </tr>
            {reviewing === skill.id && (
              <tr><td colSpan={4}>
                <SkillPlanCard api={api} skill={skill} agents={agents} onAuthorized={(name) => { setReviewing(null); setNotice(`${skill.name} is installed on ${name}, with the access listed.`); }} />
              </td></tr>
            )}
            </Fragment>
          ))}
        </tbody>
      </table>}

      <div className="dashboard-tabs" role="tablist" aria-label="Add a skill">
        <button type="button" role="tab" aria-selected={mode === 'write'} className={mode === 'write' ? 'selected' : ''} onClick={() => setMode('write')}><PenLine size={14} /> Write one</button>
        <button type="button" role="tab" aria-selected={mode === 'install'} className={mode === 'install' ? 'selected' : ''} onClick={() => setMode('install')}><FileCode2 size={14} /> Install a manifest</button>
      </div>
      <form className="dashboard-form form" onSubmit={(event) => {
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
          <Plus size={14} /> {mode === 'write' ? 'Add skill' : 'Install'}
        </button>
      </form>
    </div>
  );
}
