'use client';

import { useState } from 'react';
import { Building2 } from 'lucide-react';
import { api, Customer } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';

/**
 * The name over the door.
 *
 * It appears in the sidebar, the top bar, the live-monitoring subtitle and
 * every report, and until now could only be set at sign-up. A fleet that
 * rebrands, or a demo account being shown to a prospect under their own
 * name, needed a way to change it that did not involve the database.
 */
export function CompanySettingsPanel({
  customer,
  onChanged,
}: {
  customer: Customer | null;
  onChanged: (customer: Customer) => void;
}) {
  const cacheCustomer = useAuthStore((s) => s.setCustomer);
  const [name, setName] = useState(customer?.company_name ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = name.trim() !== (customer?.company_name ?? '').trim();

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('The company needs a name.');
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await api<Customer>('/auth/branding', {
        method: 'PATCH',
        body: JSON.stringify({ company_name: trimmed }),
      });
      cacheCustomer(updated);
      onChanged(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the name');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-edge bg-panel p-6">
      <div className="flex items-center gap-2">
        <Building2 className="h-4 w-4 text-accent-y" />
        <h2 className="font-semibold text-ink">Company</h2>
      </div>
      <p className="mt-1 text-xs text-ink-dim">
        The name shown across the dashboard, in alerts and on every report.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-[220px]">
          <span className="text-xs text-ink-dim">Company name</span>
          <input
            type="text"
            value={name}
            maxLength={80}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && dirty && !saving) void save();
            }}
            placeholder="Blue Fleet"
            className="mt-1 w-full rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-brand"
          />
        </label>
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-accent-y-ink disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save name'}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-bad">{error}</p>}
      {saved && !error && (
        <p className="mt-2 text-xs text-good">Saved — the new name is showing everywhere now.</p>
      )}
    </div>
  );
}
