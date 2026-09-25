import { useEffect, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import type { PermissionId, RolesCatalog, RoleInput, ServerRole, UserAccount } from '@crewly/sdk';

export function RolesPanel({
  catalog,
  members,
  busy,
  onCreate,
  onUpdate,
  onDelete,
  onAssign,
  onUnassign,
}: {
  catalog: RolesCatalog;
  members: UserAccount[];
  busy: boolean;
  onCreate: (input: RoleInput) => Promise<ServerRole>;
  onUpdate: (id: string, input: RoleInput) => Promise<ServerRole>;
  onDelete: (id: string) => Promise<void>;
  onAssign: (roleId: string, userId: string) => Promise<void>;
  onUnassign: (roleId: string, userId: string) => Promise<void>;
}) {
  const custom = catalog.roles.filter((role) => !role.builtIn);
  const [selectedId, setSelectedId] = useState(custom[0]?.id ?? catalog.roles[0]?.id ?? '');
  const [creating, setCreating] = useState(custom.length === 0);
  const selected = catalog.roles.find((role) => role.id === selectedId) ?? null;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [permissions, setPermissions] = useState<PermissionId[]>([]);

  useEffect(() => {
    if (creating) {
      setName(''); setDescription(''); setPermissions([]);
      return;
    }
    if (!selected) return;
    setName(selected.name); setDescription(selected.description); setPermissions(selected.permissions);
  }, [creating, selected]);

  const grouped = catalog.permissions.reduce<Record<string, typeof catalog.permissions>>((all, permission) => {
    (all[permission.group] ??= []).push(permission);
    return all;
  }, {});
  const input: RoleInput = { name, description, permissions };

  return (
    <div className="roles-layout">
      <div className="roles-list dashboard-card">
        <div className="section-heading"><div><h3>Roles</h3><p>Built-in defaults and custom access presets.</p></div><button type="button" onClick={() => { setCreating(true); setSelectedId(''); }}><Plus size={14} /> New role</button></div>
        {catalog.roles.map((role) => (
          <button type="button" className={`role-list-item ${!creating && role.id === selectedId ? 'selected' : ''}`} key={role.id} onClick={() => { setCreating(false); setSelectedId(role.id); }}>
            <strong>{role.name}</strong><small>{role.builtIn ? 'Built-in role' : `${role.permissions.length} permissions`}</small>
          </button>
        ))}
      </div>
      <div className="roles-editor">
        <div className="section-heading"><div><h3>{creating ? 'Create a custom role' : selected?.name ?? 'Role'}</h3><p>{creating ? 'Start with only the access this person needs.' : selected?.builtIn ? 'Built-in roles have safe, fixed defaults.' : 'Edit the role, then preview its effective permissions before saving.'}</p></div></div>
        <div className="dashboard-form">
          <label>Name<input value={name} disabled={!creating && Boolean(selected?.builtIn)} onChange={(event) => setName(event.target.value)} maxLength={80} /></label>
          <label>Description<input value={description} disabled={!creating && Boolean(selected?.builtIn)} onChange={(event) => setDescription(event.target.value)} maxLength={240} /></label>
          {Object.entries(grouped).map(([group, items]) => (
            <fieldset key={group} disabled={!creating && Boolean(selected?.builtIn)}>
              <legend>{group}</legend>
              {items.map((permission) => (
                <label className="permission-choice" key={permission.id}>
                  <input type="checkbox" checked={permissions.includes(permission.id)} onChange={(event) => setPermissions((current) => event.target.checked ? [...current, permission.id] : current.filter((id) => id !== permission.id))} />
                  <span><strong>{permission.label}</strong><small>{permission.description}</small></span>
                </label>
              ))}
            </fieldset>
          ))}
          <div className="role-preview"><strong>Effective permissions preview</strong><span>{permissions.length ? permissions.map((id) => catalog.permissions.find((permission) => permission.id === id)?.label ?? id).join(' · ') : 'No server-level permissions'}</span></div>
          {(!selected?.builtIn || creating) && <div className="dashboard-actions"><button type="button" className="primary-button" disabled={busy || !name.trim()} onClick={() => void (creating ? onCreate(input) : onUpdate(selected!.id, input))}><Save size={14} /> Save role</button>{!creating && selected && <button type="button" className="text-button danger" disabled={busy} onClick={() => void onDelete(selected.id)}><Trash2 size={14} /> Delete</button>}</div>}
        </div>
        {!creating && selected && !selected.builtIn && (
          <div className="dashboard-card role-members"><h3>Assigned members</h3><p className="field-description">Assignment changes take effect immediately. Built-in Owner/Admin protection still applies.</p>{members.filter((member) => member.role !== 'owner').map((member) => {
            const isAssigned = catalog.members.find((row) => row.userId === member.id)?.roles.includes(selected.id) ?? false;
            return <label className="permission-choice" key={member.id}><input type="checkbox" checked={isAssigned} disabled={busy} onChange={(event) => void (event.target.checked ? onAssign(selected.id, member.id) : onUnassign(selected.id, member.id))} /><span><strong>{member.displayName}</strong><small>{member.email} · {member.role}</small></span></label>;
          })}</div>
        )}
      </div>
    </div>
  );
}
