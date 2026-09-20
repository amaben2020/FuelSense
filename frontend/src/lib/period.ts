/**
 * The window a dashboard card aggregates over: the last `days` calendar days
 * including today, or an explicit `from`–`to` range picked on the calendar.
 * Dates are local (Africa/Lagos) YYYY-MM-DD, inclusive at both ends, and the
 * API caps any window at 90 days.
 */
export interface SnapshotPeriod {
  days: number;
  from?: string;
  to?: string;
}

export const MAX_PERIOD_DAYS = 90;

/** Today's date in the fleet's timezone, as the calendar input wants it. */
export function fleetToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
}

/** Days in an inclusive range; 1 when `from` and `to` are the same day. */
export function rangeDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

export function periodFromRange(from: string, to: string): SnapshotPeriod {
  return { days: rangeDays(from, to), from, to };
}

/** The query-string fragment every period-aware endpoint reads. */
export function periodQuery(period: SnapshotPeriod): string {
  return period.from && period.to
    ? `from=${period.from}&to=${period.to}`
    : `days=${period.days}`;
}

const shortDate = (iso: string, withMonth: boolean) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-NG', {
    day: 'numeric',
    ...(withMonth ? { month: 'short' } : {}),
    timeZone: 'Africa/Lagos',
  });

/** "last 7 days", "today", or "12–16 Sep" — for the caption beside a figure. */
export function periodLabel(period: SnapshotPeriod): string {
  if (period.from && period.to) {
    if (period.from === period.to) return shortDate(period.from, true);
    const sameMonth = period.from.slice(0, 7) === period.to.slice(0, 7);
    return `${shortDate(period.from, !sameMonth)}–${shortDate(period.to, true)}`;
  }
  return period.days === 1 ? 'today' : `last ${period.days} days`;
}

/** The instant the window opened, for filtering client-side lists. */
export function periodStartMs(period: SnapshotPeriod): number {
  if (period.from) return Date.parse(`${period.from}T00:00:00+01:00`);
  return Date.now() - period.days * 86_400_000;
}
