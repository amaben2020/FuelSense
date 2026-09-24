/**
 * How every duration in the app is written.
 *
 * There was one rule and six copies of it, plus a handful of places that
 * interpolated `{minutes}m` straight into the markup and never reached any of
 * them. That is how a two-hour stop came to read **"parked 137m"** on the trip
 * timeline: a bare number beside a lower-case `m`, on a screen otherwise full
 * of distances, reads as 137 metres. A manager doing their first week on the
 * platform has no way to tell which one it is.
 *
 * So: a duration under an hour is written with the word `min`, never a bare
 * `m`, and anything above an hour rolls over so the `h` is there to
 * disambiguate. "137m" cannot be produced by this module at all.
 */

/** A count of minutes, as a duration: "2h 17m", "45 min", "under a minute". */
export function formatMinutes(minutes: number | null | undefined): string {
  const total = Math.round(Number(minutes) || 0);
  if (total <= 0) return 'under a minute';
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** The same, for a figure already in hours. */
export function formatHours(hours: number | null | undefined): string {
  return formatMinutes((Number(hours) || 0) * 60);
}

/**
 * The compact form for a dense table cell or a map pin, where the long form
 * would wrap: "2h 17m", "45m", "0m". Still never a bare number — the `m` sits
 * against a digit with no space, which is the convention a table can carry.
 * Prefer `formatMinutes` anywhere the reader has room, especially in prose.
 */
export function formatMinutesShort(minutes: number | null | undefined): string {
  const total = Math.round(Number(minutes) || 0);
  if (total < 60) return `${Math.max(0, total)}m`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h}h ${String(m).padStart(2, '0')}m` : `${h}h`;
}

/** Compact form for a figure already in hours. */
export function formatHoursShort(hours: number | null | undefined): string {
  return formatMinutesShort((Number(hours) || 0) * 60);
}
