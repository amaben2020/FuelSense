import { sql } from 'drizzle-orm';
import { db } from '../../config/db';
import { isTelemetryPartitioned } from './telemetry-partitions.service';

/**
 * Expires telemetry older than TELEMETRY_RETENTION_DAYS. Off unless set.
 *
 * Built for the demo database, which runs the simulated fleet on a free tier
 * with half a gigabyte to its name: ten cars reporting all day would fill it
 * inside a fortnight, and nobody needs to replay a demo car's third week.
 * Production leaves this unset — its telemetry is partitioned by month, and
 * when the day comes to expire it the right tool is dropping a partition after
 * exporting it, not a DELETE. Until then the fleet's history is kept whole.
 *
 * On a partitioned table this drops whole children that have aged out and
 * never deletes row-by-row; on a heap it deletes in batches, so a live ingest
 * never waits behind one long statement.
 */
const RETENTION_DAYS = Number(process.env.TELEMETRY_RETENTION_DAYS || 0);
const BATCH_SIZE = 5_000;
const MAX_BATCHES_PER_PASS = 40;

export async function sweepTelemetryRetention(): Promise<{ rows: number; partitions: string[] }> {
  if (!(RETENTION_DAYS > 0)) return { rows: 0, partitions: [] };

  if (await isTelemetryPartitioned()) {
    // A child whose whole range is older than the cutoff can go as one unit.
    // The upper bound of its range is in its constraint text; a child entirely
    // before the cutoff has an upper bound before it too.
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000);
    const children = await db.execute(sql`
      SELECT c.relname AS child, pg_get_expr(c.relpartbound, c.oid) AS bound
      FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
      WHERE i.inhparent = 'telemetry'::regclass AND c.relname <> 'telemetry_default'
    `);
    const dropped: string[] = [];
    for (const row of children.rows as Array<{ child: string; bound: string }>) {
      const to = /TO \('([^']+)'\)/.exec(row.bound)?.[1];
      if (!to || new Date(to) > cutoff) continue;
      await db.execute(sql.raw(`DROP TABLE ${row.child}`));
      dropped.push(row.child);
    }
    return { rows: 0, partitions: dropped };
  }

  let deleted = 0;
  for (let pass = 0; pass < MAX_BATCHES_PER_PASS; pass += 1) {
    const result = await db.execute(sql`
      DELETE FROM telemetry
      WHERE id IN (
        SELECT id FROM telemetry
        WHERE recorded_at < NOW() - (${RETENTION_DAYS} || ' days')::INTERVAL
        ORDER BY id
        LIMIT ${BATCH_SIZE}
      )
    `);
    const rows = result.rowCount ?? 0;
    deleted += rows;
    if (rows < BATCH_SIZE) break;
  }
  return { rows: deleted, partitions: [] };
}

let timer: NodeJS.Timeout | null = null;

export function startTelemetryRetentionSweep(intervalMs = 60 * 60 * 1000): void {
  if (!(RETENTION_DAYS > 0) || timer) return;

  const run = async () => {
    try {
      const { rows, partitions } = await sweepTelemetryRetention();
      if (rows || partitions.length) {
        console.log(
          `[telemetry_retention] expired beyond ${RETENTION_DAYS}d: ` +
            (partitions.length ? `dropped ${partitions.join(', ')}` : `${rows} row(s)`)
        );
      }
    } catch (error) {
      console.error('[telemetry_retention] failed:', (error as Error).message);
    }
  };

  timer = setInterval(run, intervalMs);
  timer.unref?.();
  void run();
}
