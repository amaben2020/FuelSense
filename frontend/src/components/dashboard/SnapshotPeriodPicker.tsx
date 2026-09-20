'use client';

import { useState } from 'react';
import { CalendarRange, ChevronDown } from 'lucide-react';
import {
  MAX_PERIOD_DAYS,
  SnapshotPeriod,
  fleetToday,
  periodFromRange,
  rangeDays,
} from '@/lib/period';

const PRESETS = [
  { days: 1, label: 'Today' },
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
] as const;

/**
 * The window selector on the operational snapshot: three presets plus a
 * from–to calendar. Presets only offer windows the summary API can back —
 * it caps every window at 90 days, so an annual option is not on the list
 * and a picked range longer than that is refused before it is sent.
 */
export function SnapshotPeriodPicker({
  period,
  onChange,
}: {
  period: SnapshotPeriod;
  onChange: (period: SnapshotPeriod) => void;
}) {
  const isCustom = Boolean(period.from && period.to);
  const [editing, setEditing] = useState(false);
  const [from, setFrom] = useState(period.from ?? '');
  const [to, setTo] = useState(period.to ?? fleetToday());
  const today = fleetToday();

  const showCalendar = editing || isCustom;
  const days = from && to && to >= from ? rangeDays(from, to) : null;
  const problem =
    !from || !to
      ? null
      : to < from
        ? 'End date is before the start'
        : days != null && days > MAX_PERIOD_DAYS
          ? `Longest window is ${MAX_PERIOD_DAYS} days`
          : null;
  const canApply = Boolean(from && to && !problem);

  const apply = () => {
    if (!canApply) return;
    onChange(periodFromRange(from, to));
    setEditing(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="relative inline-flex items-center">
        <span className="sr-only">Snapshot period</span>
        <select
          value={isCustom || editing ? 'custom' : String(period.days)}
          onChange={(e) => {
            if (e.target.value === 'custom') {
              setEditing(true);
              return;
            }
            setEditing(false);
            onChange({ days: Number(e.target.value) });
          }}
          className="appearance-none rounded-full border border-edge bg-panel py-1.5 pl-3.5 pr-8 text-xs font-medium text-ink focus:border-accent-y focus:outline-none"
        >
          {PRESETS.map((p) => (
            <option key={p.days} value={p.days}>
              {p.label}
            </option>
          ))}
          <option value="custom">Custom range…</option>
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-ink-dim" />
      </label>

      {showCalendar && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <CalendarRange className="h-3.5 w-3.5 text-ink-dim" aria-hidden />
          <label className="sr-only" htmlFor="snapshot-from">
            From
          </label>
          <input
            id="snapshot-from"
            type="date"
            value={from}
            max={to || today}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-full border border-edge bg-panel px-2.5 py-1 text-xs text-ink focus:border-accent-y focus:outline-none"
          />
          <span className="text-ink-dim">to</span>
          <label className="sr-only" htmlFor="snapshot-to">
            To
          </label>
          <input
            id="snapshot-to"
            type="date"
            value={to}
            min={from || undefined}
            max={today}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-full border border-edge bg-panel px-2.5 py-1 text-xs text-ink focus:border-accent-y focus:outline-none"
          />
          <button
            type="button"
            onClick={apply}
            disabled={!canApply}
            className="rounded-full bg-brand px-3 py-1 text-xs font-semibold text-brand-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            Apply
          </button>
          {problem ? (
            <span className="text-warn">{problem}</span>
          ) : days != null ? (
            <span className="text-ink-dim">
              {days} day{days === 1 ? '' : 's'}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
