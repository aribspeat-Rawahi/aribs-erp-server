import { FormEvent, useEffect, useState } from 'react';
import { Plus, UserX, UserCheck, Trash2, RotateCcw, ShieldCheck } from 'lucide-react';
import api from '../api/client';
import { PageHeader, PrimaryButton, SecondaryButton, IconButton, Card, EmptyState, Modal, Field, inputClass } from '../components/ui';
import { USER_ROLE_OPTIONS, MODULE_OPTIONS, ACCESS_LEVEL_OPTIONS } from '../constants';
import { useAuth } from '../context/AuthContext';

const ROLE_OPTIONS = USER_ROLE_OPTIONS.map((r) => ({ value: r, label: r.toUpperCase() }));
const SUPER_ROLES = ['admin', 'ceo', 'md'];

interface TeamUser {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  deletedAt?: string | null;
  modulePermissions?: Record<string, string> | null;
}

export default function Team() {
  const { user: currentUser, hasAnyRole } = useAuth();
  const canDelete = hasAnyRole(['admin', 'ceo', 'md']);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [permissionsUser, setPermissionsUser] = useState<TeamUser | null>(null);
  // "Delete" only hides someone from this list (soft delete) — their
  // login history/activity stays intact and it's fully reversible from
  // this "Deleted" view via Restore.
  const [showDeleted, setShowDeleted] = useState(false);

  function load(deletedView = showDeleted) {
    setLoading(true);
    api
      .get('/auth/users', { params: deletedView ? { deleted: 'true' } : {} })
      .then((res) => setUsers(res.data))
      .finally(() => setLoading(false));
  }

  useEffect(() => load(showDeleted), [showDeleted]);

  async function changeRole(id: string, role: string) {
    try {
      await api.patch(`/auth/users/${id}`, { role });
      load();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not change this user\'s role.');
    }
  }
  async function toggleActive(id: string, active: boolean) {
    try {
      await api.patch(`/auth/users/${id}`, { active });
      load();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not update this user\'s status.');
    }
  }

  async function deleteUser(id: string, name: string) {
    if (
      !window.confirm(
        `Delete ${name} from the Team list? Their login will be blocked and they'll disappear from this list, but nothing they created (invoices, orders, etc.) is affected — you can bring them back anytime from "Show deleted".`,
      )
    )
      return;
    try {
      await api.delete(`/auth/users/${id}`);
      load();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not delete this team member.');
    }
  }

  async function restoreUser(id: string) {
    try {
      await api.patch(`/auth/users/${id}/restore`);
      load();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not restore this team member.');
    }
  }

  return (
    <div>
      <PageHeader
        title="Team"
        subtitle={showDeleted ? 'Deleted team members — restore anyone from here' : 'Everyone with a login to this ERP'}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {canDelete && (
              <SecondaryButton onClick={() => setShowDeleted((v) => !v)}>
                {showDeleted ? 'Back to active list' : 'Show deleted'}
              </SecondaryButton>
            )}
            {!showDeleted && (
              <PrimaryButton icon={Plus} onClick={() => setShowAdd(true)}>
                New team member
              </PrimaryButton>
            )}
          </div>
        }
      />
      {loading ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : users.length === 0 ? (
        <EmptyState>{showDeleted ? 'No deleted team members.' : 'No team members yet.'}</EmptyState>
      ) : (
        <Card>
          <div className="divide-y divide-black/5">
            {users.map((u) => (
              <div key={u.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-ink">{u.name}</div>
                  <div className="text-xs text-muted">{u.email}</div>
                </div>
                <div className="flex items-center gap-2">
                  {showDeleted ? (
                    <>
                      <span className="text-xs px-2 py-1 rounded-full bg-black/5 text-ink/60 font-medium">
                        {ROLE_OPTIONS.find((r) => r.value === u.role)?.label || u.role}
                      </span>
                      {canDelete && <IconButton icon={RotateCcw} tone="success" title="Restore" onClick={() => restoreUser(u.id)} />}
                    </>
                  ) : (
                    <>
                      {!u.active && <span className="text-xs px-2 py-1 rounded-full bg-black/5 text-ink/60 font-medium">Inactive</span>}
                      <select
                        className={`${inputClass} !py-1.5 !text-xs w-32`}
                        value={u.role}
                        onChange={(e) => changeRole(u.id, e.target.value)}
                      >
                        {ROLE_OPTIONS.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                      <IconButton icon={ShieldCheck} title="Area access permissions" onClick={() => setPermissionsUser(u)} />
                      {u.active ? (
                        <IconButton icon={UserX} tone="danger" title="Deactivate" onClick={() => toggleActive(u.id, false)} />
                      ) : (
                        <IconButton icon={UserCheck} tone="success" title="Reactivate" onClick={() => toggleActive(u.id, true)} />
                      )}
                      {canDelete && u.id !== currentUser?.id && (
                        <IconButton icon={Trash2} tone="danger" title="Delete" onClick={() => deleteUser(u.id, u.name)} />
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
      {showAdd && (
        <AddTeamMemberModal
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            load();
          }}
        />
      )}
      {permissionsUser && (
        <PermissionsModal
          user={permissionsUser}
          onClose={() => setPermissionsUser(null)}
          onSaved={() => {
            setPermissionsUser(null);
            load();
          }}
        />
      )}
    </div>
  );
}

// "Default" means "no override — this module's visibility follows this
// user's role, exactly like it does today." Anything else is an explicit
// override, saved only for the modules the admin actually touched.
const DEFAULT_OVERRIDE = '';

function PermissionsModal({ user, onClose, onSaved }: { user: TeamUser; onClose: () => void; onSaved: () => void }) {
  const isSuperRole = SUPER_ROLES.includes(user.role);
  const [levels, setLevels] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const m of MODULE_OPTIONS) initial[m.key] = user.modulePermissions?.[m.key] || DEFAULT_OVERRIDE;
    return initial;
  });
  const [bulkValue, setBulkValue] = useState(ACCESS_LEVEL_OPTIONS[0].value);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function setLevel(key: string, value: string) {
    setLevels((prev) => ({ ...prev, [key]: value }));
  }

  function applyToAll() {
    const next: Record<string, string> = {};
    for (const m of MODULE_OPTIONS) next[m.key] = bulkValue;
    setLevels(next);
  }

  async function onSave() {
    setBusy(true);
    setError('');
    // Only send explicit overrides — a module left on "Default" is
    // omitted entirely so it keeps following the role-based rule.
    const modulePermissions: Record<string, string> = {};
    for (const key of Object.keys(levels)) {
      if (levels[key] && levels[key] !== DEFAULT_OVERRIDE) modulePermissions[key] = levels[key];
    }
    try {
      await api.patch(`/auth/users/${user.id}`, {
        modulePermissions: Object.keys(modulePermissions).length > 0 ? modulePermissions : null,
      });
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not save these permissions.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Area access — ${user.name}`} onClose={onClose} wide>
      <div className="space-y-3">
        {isSuperRole ? (
          <p className="text-sm text-ink/80 bg-black/[0.03] rounded-lg p-3">
            {user.name}'s role ({user.role.toUpperCase()}) already has full access to every area, regardless of what's
            set here. Any overrides below will be saved but won't have an effect unless their role is changed later.
          </p>
        ) : (
          <p className="text-xs text-muted">
            Leave an area on "Default" to keep it following {user.name}'s role ({user.role.toUpperCase()}) as usual.
            Pick "No Access" to hide an area they'd normally see, or a higher level to give them an area their role
            wouldn't normally show.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 border border-black/10 rounded-lg p-2.5 bg-black/[0.02]">
          <span className="text-xs text-muted">Select all:</span>
          <select className={`${inputClass} !py-1 !text-xs w-40`} value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}>
            {ACCESS_LEVEL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <SecondaryButton onClick={applyToAll}>Apply to all</SecondaryButton>
        </div>

        <div className="border border-black/10 rounded-lg divide-y divide-black/5 max-h-[50vh] overflow-y-auto">
          {MODULE_OPTIONS.map((m) => (
            <div key={m.key} className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="text-sm text-ink">{m.label}</span>
              <select
                className={`${inputClass} !py-1.5 !text-xs w-44`}
                value={levels[m.key]}
                onChange={(e) => setLevel(m.key, e.target.value)}
              >
                <option value={DEFAULT_OVERRIDE}>Default (role-based)</option>
                {ACCESS_LEVEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton onClick={onSave} disabled={busy}>
            {busy ? 'Saving…' : 'Save permissions'}
          </PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

function AddTeamMemberModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      // New accounts always start as Sales — promote the role afterwards
      // from the Team list (that PATCH is admin-only, unlike registration).
      await api.post('/auth/register', { name, email, password });
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not create the account.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New team member" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Email">
          <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Temporary password">
          <input
            className={inputClass}
            type="password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        <p className="text-xs text-muted">
          New accounts are created with the Sales role. Change it from the Team list once the account exists.
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create'}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}
