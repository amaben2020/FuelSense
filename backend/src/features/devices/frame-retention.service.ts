import { sql } from 'drizzle-orm';
import { db } from '../../config/db';

/**
 * Expires raw device frames once nothing reads them any more.
 *
 * `device_frames` is the widest row the platform writes — about 1.6 kB once
 * indexes are counted, four times a telemetry row — because it keeps the whole
 * AVL IO map as JSON. One vehicle produced 21 MB of it in a month; fifty
 * vehicles on the road daily would produce roughly 175 GB a year, and nothing
 * was ever deleting it.
 *
 * It is not a debug table, so it cannot simply stop being written:
 *  - `driving-events-sweep` reads `gps_raw` for speed and heading, which is the
 *    only place harsh acceleration, braking and cornering can be derived from —
 *    `telemetry` has no heading column at all.
 *  - `fleet-intelligence-sql` reads GSM signal (IO 21) and GNSS status (IO 69).
 *  - the vehicle-signal panels read the newest frame per device.
 *
 * Hence a retention window rather than a switch. The default matches the
 * product's own horizon: every `days` parameter in the API is clamped to 90, so
 * at 90 days no existing query can notice the deletion. Fleets that never ask
 * for a 90-day green-driving count can set DEVICE_FRAME_RETENTION_DAYS=30 and
 * cut the steady-state footprint to a third.
 */
const RETENTION_DAYS = Number(process.env.DEVICE_FRAME_RETENTION_DAYS || 90);

/**
 * Rows per statement. A single unbounded DELETE over months of frames holds one
 * transaction open across millions of rows, bloats the table it is trying to
 * shrink, and blocks the ingest path that is still inserting into it. Batching
 * keeps each statement short enough that a live tracker never waits on it.
 */
const BATCH_SIZE = Number(process.env.DEVICE_FRAME_DELETE_BATCH || 5_000);

/** Ceiling per pass, so a first run over a large backlog is spread over hours. */
const MAX_BATCHES_PER_PASS = Number(process.env.DEVICE_FRAME_MAX_BATCHES || 40);

export async function sweepDeviceFrames(): Promise<number> {
  let deleted = 0;

  for (let pass = 0; pass < MAX_BATCHES_PER_PASS; pass += 1) {
    const result = await db.execute(sql`
      DELETE FROM device_frames
      WHERE id IN (
        SELECT id FROM device_frames
        WHERE received_at < NOW() - (${RETENTION_DAYS} || ' days')::INTERVAL
        ORDER BY id
        LIMIT ${BATCH_SIZE}
      )
    `);

    const rows = result.rowCount ?? 0;
    deleted += rows;
    // Short of a full batch means the backlog is drained.
    if (rows < BATCH_SIZE) break;
  }

  return deleted;
}

let timer: NodeJS.Timeout | null = null;

/** Hourly, matching the alert sweep — the window is measured in months. */
export function startDeviceFrameRetentionSweep(intervalMs = 60 * 60 * 1000): void {
  if (timer) return;

  const run = async () => {
    try {
      const deleted = await sweepDeviceFrames();
      if (deleted) {
        console.log(
          `[frame_retention] ${deleted} frame(s) older than ${RETENTION_DAYS}d deleted`
        );
      }
    } catch (error) {
      console.error('[frame_retention] failed:', (error as Error).message);
    }
  };

  timer = setInterval(run, intervalMs);
  timer.unref?.();
  void run();
}
