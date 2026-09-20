import { sql } from 'drizzle-orm';
import { db } from '../../config/db';

/**
 * Monthly range partitions for `telemetry`.
 *
 * Why partition at all: every plan for bounding this table — a retention
 * window, an archive to S3 — ends in deleting old rows, and on a heap table a
 * DELETE over months of telemetry is the worst thing that can happen to it.
 * It holds a transaction across millions of rows, leaves every one of them as
 * a dead tuple for vacuum to chase, and bloats the indexes it was meant to
 * shrink. With monthly partitions the same expiry is `DROP TABLE` on one child:
 * instant, no bloat, and the archive step becomes "dump one partition".
 *
 * Why monthly: a month of a fifty-vehicle fleet at the 7-second floor is about
 * six million rows, which is a comfortable child to index, dump or drop. Daily
 * would be hundreds of children a year for no gain at this scale.
 *
 * Why this file exists: a range-partitioned table only accepts a row whose
 * `recorded_at` falls inside an existing child. Nothing creates next month's
 * child on its own, and a tracker does not stop reporting at midnight on the
 * first. So a child is always created ahead of time — this month, next month
 * and the one after — and a DEFAULT child sits underneath as a net, so that a
 * row can never be refused for want of a table to land in.
 *
 * The two-column primary key is not a choice. Postgres requires the partition
 * key in every unique constraint on a partitioned table, so `id` alone cannot
 * be the key and `device_frames.telemetry_id` can no longer be a foreign key
 * to it. The join in fleet-intelligence still works; only the constraint went.
 * `drizzle-kit push` would try to reinstate the single-column key and must not
 * be run against a partitioned database.
 */

/** How many months ahead of the current one to keep a child ready. */
const MONTHS_AHEAD = 2;

export function partitionName(year: number, month: number): string {
  return `telemetry_y${year}m${String(month).padStart(2, '0')}`;
}

/** First instant of the month, and of the one after, as ISO date strings. */
export function monthBounds(year: number, month: number): { from: string; to: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    from: `${year}-${pad(month)}-01`,
    to: `${nextYear}-${pad(nextMonth)}-01`,
  };
}

/** Whether `telemetry` has been converted to a partitioned table yet. */
export async function isTelemetryPartitioned(): Promise<boolean> {
  const r = await db.execute(sql`
    SELECT relkind FROM pg_class WHERE relname = 'telemetry' AND relnamespace = 'public'::regnamespace
  `);
  return (r.rows[0] as { relkind?: string } | undefined)?.relkind === 'p';
}

/**
 * Create any missing child from `year/month` forward through MONTHS_AHEAD.
 *
 * Idempotent: `IF NOT EXISTS` on every child, so it is safe on every boot and
 * every hour. Returns the names it created, empty when everything was already
 * in place.
 */
export async function ensureTelemetryPartitions(now = new Date()): Promise<string[]> {
  if (!(await isTelemetryPartitioned())) return [];

  const created: string[] = [];
  for (let i = 0; i <= MONTHS_AHEAD; i += 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    const name = partitionName(year, month);
    const { from, to } = monthBounds(year, month);

    const exists = await db.execute(sql`
      SELECT 1 FROM pg_class WHERE relname = ${name} AND relnamespace = 'public'::regnamespace
    `);
    if (exists.rows.length > 0) continue;

    await db.execute(
      sql.raw(
        `CREATE TABLE IF NOT EXISTS ${name} PARTITION OF telemetry
           FOR VALUES FROM ('${from}') TO ('${to}')`
      )
    );
    created.push(name);
  }
  return created;
}

let timer: NodeJS.Timeout | null = null;

/** Hourly. The only job is to have next month's child exist before it is needed. */
export function startTelemetryPartitionSweep(intervalMs = 60 * 60 * 1000): void {
  if (timer) return;

  const run = async () => {
    try {
      const created = await ensureTelemetryPartitions();
      if (created.length) {
        console.log(`[telemetry_partitions] created ${created.join(', ')}`);
      }
    } catch (error) {
      console.error('[telemetry_partitions] failed:', (error as Error).message);
    }
  };

  timer = setInterval(run, intervalMs);
  timer.unref?.();
  void run();
}
