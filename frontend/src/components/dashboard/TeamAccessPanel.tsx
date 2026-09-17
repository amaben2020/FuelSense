'use client';

import { useCallback, useEffect, useState } from 'react';
import { Eye, Loader2, Plus, UserRound, Users } from 'lucide-react';
import {
  Customer,
  FleetRole,
  TeamMember,
  addTeamMember,
  fetchTeam,
  updateTeamMember,
} from '@/lib/api';
import { Panel, StatusChip } from '@/components/ui/chrome';

const INPUT =
  'mt-1 w-full rounded-lg border border-edge bg-panel px-2 py-2 text-sm text-ink placeholder-ink-dim';

const ROLE_LABEL: Record<FleetRole, string> = {
  manager: 'Manager',
  commander: 'Commander',
  viewer: 'View only',
};

const ROLE_HELP: Record<FleetRole, string> = {
  manager: 'Full access, including adding people here.',
  commander: 'Full access; opens on the Command Summary.',
  viewer: 'Sees every page. Cannot add, change or delete anything.',
};

/**
 * Who else signs in to this fleet.
 *
 * Only a manager sees the form — the backend refuses anyone else — but the
 * list is shown to everyone so a viewer at least knows who to ask.
 */
export function TeamAccessPanel({ customer }: { customer: Customer | null }) {
  const canManage = (customer?.role ?? 'manager') === 'manager';
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', title: '', role: 'viewer' as FleetRole });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setMembers((await fetchTeam()).members);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the team');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { member } = await addTeamMember({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        role: form.role,
        title: form.title.trim() || undefined,
      });
      setMembers((prev) => [member, ...prev]);
      setForm({ name: '', email: '', password: '', title: '', role: 'viewer' });
      setAdding(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add them');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (m: TeamMember) => {
    try {
      const { member } = await updateTeamMember(m.id, { is_active: !m.is_active });
      setMembers((prev) => prev.map((x) => (x.id === member.id ? member : x)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change that');
    }
  };

  return (
    <Panel
      icon={Users}
      title="Team access"
      subtitle="Who signs in to this fleet, and what they can do"
      actions={
        canManage ? (
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-1.5 text-xs font-semibold text-canvas transition-opacity hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" /> Add person
          </button>
        ) : undefined
      }
    >
      {error && <p className="mb-3 rounded-lg bg-bad-deep/20 p-3 text-xs text-bad">{error}</p>}

      {adding && canManage && (
        <form onSubmit={submit} className="mb-4 rounded-xl border border-edge bg-panel-deep p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-ink-mid">
              Name
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={INPUT} />
            </label>
            <label className="text-xs text-ink-mid">
              Email
              <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={INPUT} />
            </label>
            <label className="text-xs text-ink-mid">
              Password
              <input required type="password" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={INPUT} placeholder="At least 8 characters" />
            </label>
            <label className="text-xs text-ink-mid">
              Rank or title <span className="text-ink-dim">(optional)</span>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={INPUT} />
            </label>
          </div>
          <fieldset className="mt-3">
            <legend className="text-xs text-ink-mid">Access</legend>
            <div className="mt-1 grid gap-2 sm:grid-cols-3">
              {(['viewer', 'commander', 'manager'] as FleetRole[]).map((r) => (
                <label
                  key={r}
                  className={`cursor-pointer rounded-lg border px-3 py-2 text-xs ${
                    form.role === r ? 'border-brand bg-brand/10 text-ink' : 'border-edge text-ink-mid'
                  }`}
                >
                  <input type="radio" name="role" className="sr-only" checked={form.role === r} onChange={() => setForm({ ...form, role: r })} />
                  <span className="font-semibold">{ROLE_LABEL[r]}</span>
                  <span className="mt-0.5 block text-[11px] text-ink-dim">{ROLE_HELP[r]}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => setAdding(false)} className="rounded-lg border border-edge px-3 py-2 text-xs text-ink-mid hover:bg-panel-hover">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-good px-4 py-2 text-xs font-semibold text-accent-y-ink disabled:opacity-50">
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Add
            </button>
          </div>
        </form>
      )}

      {loading && !members.length ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-brand" />
        </div>
      ) : members.length === 0 ? (
        <p className="py-4 text-sm text-ink-dim">
          Only the account holder signs in so far. Add a viewer for anyone who should see the fleet
          without being able to change it.
        </p>
      ) : (
        <ul className="divide-y divide-edge">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-panel-deep text-ink-mid">
                {m.role === 'viewer' ? <Eye className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`truncate text-sm font-medium ${m.is_active ? 'text-ink' : 'text-ink-dim line-through'}`}>
                  {m.name}
                  {m.title && <span className="ml-1.5 font-normal text-ink-dim">· {m.title}</span>}
                </p>
                <p className="truncate text-xs text-ink-dim">{m.email}</p>
              </div>
              <StatusChip tone={m.role === 'viewer' ? 'neutral' : 'accent'}>{ROLE_LABEL[m.role]}</StatusChip>
              {canManage && (
                <button
                  type="button"
                  onClick={() => void toggleActive(m)}
                  className="rounded-full border border-edge px-3 py-1 text-[11px] text-ink-mid hover:bg-panel-hover"
                >
                  {m.is_active ? 'Deactivate' : 'Reactivate'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
