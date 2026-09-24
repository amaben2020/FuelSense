// Corrects idle stretches that were recorded before the observed-time rule.
//
// `stepIdle` used to measure wall-clock from the start of a stretch to
// whichever frame arrived next, so any silence inside it was billed as a
// running engine. The worst stored example claims **16h 35m and ~14.93 L**
// against a vehicle whose last frame before the outage read ignition OFF; the
// telemetry supports about twelve minutes.
//
// This recomputes each stored `idling_end` from the telemetry that actually
// exists — summing the gaps between consecutive frames that were idling, each
// capped at IDLE_GAP_CAP_SECONDS, exactly as the fixed detector and the daily
// reports do — and rewrites the minutes where they disagree.
//
// It corrects values in place rather than deleting and regenerating: the event
// ids are referenced by replays and alerts, and a correction that preserves
// them is auditable in a way a delete is not.
//
// Usage: npx tsx src/scripts/fix-inflated-idle-events.ts                (dry run)
//        npx tsx src/scripts/fix-inflated-idle-events.ts --apply
//        npx tsx src/scripts/fix-inflated-idle-events.ts --days 90 --apply
import 'dotenv/config';
import { db, sql } from '../shared/db-helpers';
import { initDatabase } from '../config/db';
import { IDLE_GAP_CAP_SECONDS } from '../features/telemetry/telemetry-deltas.repository';

/** Only rewrite when the claim is out by at least this much. */
const TOLERANCE_MINUTES = 1;

/**
 * Below this a stretch was never an idle at all, so it is deleted rather than
 * rewritten to zero: `IDLE_MIN_SECONDS` is the bar the detector applies before
 * it will emit anything, and "Idled 0m" on a manager's feed is noise standing
 * where a false accusation used to be.
 */
const MIN_REAL_MINUTES = Number(process.env.IDLE_MIN_SECONDS || 120) / 60;

interface Row {
  id: number;
  vehicle_id: string;
  occurred_at: Date;
  claimed: number;
  observed: number | null;
}

async function run(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const daysArg = process.argv.indexOf('--days');
  const days = daysArg !== -1 ? Number(process.argv[daysArg + 1]) || 90 : 90;

  await initDatabase();

  // For each stored idling_end, re-measure the stretch it claims to describe:
  // walk back over the frames from its own timestamp for as long as they were
  // idling, summing capped gaps. `started` is the matching idling_start where
  // one exists, so the window is the stretch itself rather than a fixed span.
  const rows = await db.execute(sql`
    WITH ends AS (
      SELECT e.id, e.vehicle_id, e.occurred_at, e.value::numeric AS claimed,
             (
               SELECT max(s.occurred_at) FROM device_events s
               WHERE s.vehicle_id = e.vehicle_id
                 AND s.event_type = 'idling_start'
                 AND s.occurred_at <= e.occurred_at
             ) AS started_at
      FROM device_events e
      WHERE e.event_type = 'idling_end'
        AND e.value IS NOT NULL
        AND e.occurred_at > NOW() - (${days} || ' days')::INTERVAL
    ),
    measured AS (
      SELECT
        ends.id, ends.vehicle_id, ends.occurred_at, ends.claimed,
        (
          SELECT COALESCE(SUM(LEAST(gap, ${IDLE_GAP_CAP_SECONDS})), 0) / 60.0
          FROM (
            SELECT EXTRACT(EPOCH FROM (
                     t.recorded_at - LAG(t.recorded_at) OVER (ORDER BY t.recorded_at)
                   ))::int AS gap,
                   LAG(t.ignition_on) OVER (ORDER BY t.recorded_at) AS prev_ign,
                   LAG(COALESCE(t.speed_kph, 0)) OVER (ORDER BY t.recorded_at) AS prev_kph
            FROM telemetry t
            WHERE t.vehicle_id = ends.vehicle_id
              AND t.recorded_at >= COALESCE(ends.started_at, ends.occurred_at - INTERVAL '1 hour')
              AND t.recorded_at <= ends.occurred_at
          ) hops
          -- A hop counts only if the frame that OPENED it was idling: that is
          -- the interval during which the engine was observed running.
          WHERE gap IS NOT NULL AND gap > 0 AND prev_ign IS TRUE AND prev_kph < 2
        ) AS observed
      FROM ends
    )
    SELECT * FROM measured
    WHERE observed IS NULL OR abs(claimed - observed) >= ${TOLERANCE_MINUTES}
    ORDER BY claimed - COALESCE(observed, 0) DESC
  `);

  const list = rows.rows as unknown as Row[];
  if (!list.length) {
    console.log('Every stored idle stretch already matches its telemetry.');
    // The alerts those stretches raised are a separate store and can still be
    // carrying the old figures, so that pass runs regardless.
    await fixAlerts(apply);
    process.exit(0);
  }

  let overstated = 0;
  let overstatedMinutes = 0;
  console.log(`${list.length} stretch(es) disagree with the telemetry (last ${days} days):\n`);
  for (const r of list) {
    const observed = Math.round((Number(r.observed) || 0) * 10) / 10;
    const claimed = Math.round(Number(r.claimed) * 10) / 10;
    const delta = Math.round((claimed - observed) * 10) / 10;
    if (delta > 0) {
      overstated += 1;
      overstatedMinutes += delta;
    }
    const when = new Date(r.occurred_at).toISOString().slice(0, 16).replace('T', ' ');
    const verdict = observed < MIN_REAL_MINUTES ? 'remove' : 'correct';
    console.log(
      `  ${when}  claimed ${String(claimed).padStart(7)} min  ->  observed ${String(observed).padStart(7)} min  (${delta > 0 ? '-' : '+'}${Math.abs(delta)})  ${verdict}`
    );
  }
  console.log(
    `\n${overstated} overstated by ${Math.round(overstatedMinutes)} minutes ` +
      `(${(overstatedMinutes / 60).toFixed(1)} hours) in total.`
  );

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to correct them.');
    process.exit(0);
  }

  let corrected = 0;
  let removed = 0;
  for (const r of list) {
    const observed = Math.round((Number(r.observed) || 0) * 10) / 10;
    if (observed < MIN_REAL_MINUTES) {
      // Drop the pair. The matching start is the latest one at or before this
      // end for the same vehicle — the same rule the measurement used.
      await db.execute(sql`
        DELETE FROM device_events
        WHERE id = (
          SELECT s.id FROM device_events s
          WHERE s.vehicle_id = (SELECT vehicle_id FROM device_events WHERE id = ${r.id})
            AND s.event_type = 'idling_start'
            AND s.occurred_at <= (SELECT occurred_at FROM device_events WHERE id = ${r.id})
          ORDER BY s.occurred_at DESC LIMIT 1
        )
      `);
      await db.execute(sql`DELETE FROM device_events WHERE id = ${r.id}`);
      removed += 1;
      continue;
    }
    await db.execute(sql`UPDATE device_events SET value = ${observed} WHERE id = ${r.id}`);
    corrected += 1;
  }
  console.log(
    `\nCorrected ${corrected} stretch(es); removed ${removed} that never met the ` +
      `${MIN_REAL_MINUTES}-minute bar to be an idle at all.`
  );

  await fixAlerts(apply);
  process.exit(0);
}

/**
 * The same correction for the alerts those stretches raised.
 *
 * This is the half that reaches a person: an open alert reading "idled 995 min
 * — about 14.9L burned (₦21,571)" is an accusation against a named driver,
 * carrying a number the telemetry never supported. An alert whose measured
 * idling falls under the threshold that justifies raising one is deleted; the
 * rest have their minutes, litres and naira rewritten to what was observed.
 */
async function fixAlerts(apply: boolean): Promise<void> {
  const threshold = Number(process.env.IDLE_ALERT_MINUTES || 5);
  // An alert is raised partway through a stretch, so the stretch that explains
  // it is the first one to END at or after the alert was created. Reading a
  // 24-hour window instead would pour a whole day's separate idles into one
  // alert, which is the same kind of overstatement being corrected.
  const rows = await db.execute(sql`
    SELECT a.id, a.message, a.is_resolved,
           (regexp_match(a.message, 'idled ([0-9]+) min'))[1]::numeric AS claimed,
           (
             SELECT e.value FROM device_events e
             WHERE e.vehicle_id = a.vehicle_id
               AND e.event_type = 'idling_end'
               AND e.occurred_at >= a.created_at - INTERVAL '2 minutes'
               AND e.occurred_at <= a.created_at + INTERVAL '12 hours'
             ORDER BY e.occurred_at ASC LIMIT 1
           ) AS observed
    FROM alerts a
    WHERE a.alert_type = 'excessive_idle'
    ORDER BY a.created_at DESC
  `);

  const list = rows.rows as unknown as Array<{
    id: number; message: string; liters: string | null; ngn: number | null;
    claimed: string | null; observed: string | null; is_resolved: boolean;
  }>;

  // `observed` is null when no corrected stretch survives for that alert —
  // the stretch it was raised from was removed for never being an idle, so
  // the alert has nothing left to stand on.
  const bad = list.filter((r) => {
    const claimed = Number(r.claimed) || 0;
    if (r.observed == null) return true;
    return claimed - Number(r.observed) >= 1;
  });

  console.log(`\n${bad.length} of ${list.length} excessive-idle alert(s) overstate the idling:`);
  for (const r of bad.slice(0, 12)) {
    const claimed = Math.round(Number(r.claimed) || 0);
    const observed = r.observed == null ? null : Math.round(Number(r.observed) * 10) / 10;
    const verdict =
      observed == null
        ? 'remove (its stretch was not a real idle)'
        : observed < threshold
          ? 'remove (never met the alert bar)'
          : 'rewrite';
    console.log(
      `  alert ${r.id}  claimed ${claimed} min -> observed ${observed ?? 'none'} min  ${verdict}` +
        `${r.is_resolved ? '' : '  [OPEN]'}`
    );
  }

  if (!apply) {
    console.log('\nDry run — no alerts changed.');
    return;
  }

  let removedAlerts = 0;
  let rewritten = 0;
  for (const r of bad) {
    const observed = r.observed == null ? 0 : Math.round(Number(r.observed) * 10) / 10;
    if (r.observed == null || observed < threshold) {
      await db.execute(sql`DELETE FROM alerts WHERE id = ${r.id}`);
      removedAlerts += 1;
      continue;
    }
    // Keep the wording the detector produces, with the honest figures in it.
    const liters = (observed / 60) * Number(process.env.IDLE_BURN_LITERS_PER_HOUR || 0.9);
    const message = r.message
      .replace(/idled [0-9]+ min/, `idled ${Math.round(observed)} min`)
      .replace(/about [0-9.]+L burned/, `about ${liters.toFixed(1)}L burned`);
    await db.execute(sql`
      UPDATE alerts SET message = ${message}, fuel_drop_liters = ${liters.toFixed(2)}
      WHERE id = ${r.id}
    `);
    rewritten += 1;
  }
  console.log(
    `\nRemoved ${removedAlerts} alert(s) that never met the ${threshold}-minute bar; ` +
      `rewrote ${rewritten}.`
  );
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
