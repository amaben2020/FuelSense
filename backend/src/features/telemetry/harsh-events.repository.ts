import { SQL, sql } from 'drizzle-orm';
import { DEFAULT_HARSH_THRESHOLDS } from './harsh-driving.service';

const G_MS2 = 9.80665;

/**
 * Whether a harsh-manoeuvre row counts against a driver.
 *
 * Two sources write these rows: the FMC150's own accelerometer (AVL 253,
 * stored in g) and the GPS detector (stored in m/s²). They disagreed on what
 * "harsh" means. The device runs Teltonika's defaults, which flag 0.25 g, an
 * ordinary brisk pull-away; the detector's floors sit at 0.33-0.39 g. Counting
 * both at their own bar, and counting a manoeuvre both of them saw twice, put
 * a real driver at 20 events per 100 km and zero points for smooth driving.
 *
 * So there is one bar, the detector's, applied to both. Where the device saw
 * the same manoeuvre, its accelerometer outranks a speed series differentiated
 * from GPS, so the GPS row stands down even when the device reading fell below
 * the bar. Overspeeding and every other event type pass through untouched.
 */
export function countedHarshEvent(alias: string): SQL {
  const e = sql.raw(alias);
  const { accelerationMs2, brakingMs2, corneringMs2 } = DEFAULT_HARSH_THRESHOLDS;
  return sql`(
    ${e}.event_type NOT IN ('harsh_acceleration', 'harsh_braking', 'harsh_cornering')
    OR (
      ${e}.unit = 'g'
      AND ${e}.value * ${G_MS2} >= CASE ${e}.event_type
        WHEN 'harsh_acceleration' THEN ${accelerationMs2}::numeric
        WHEN 'harsh_braking' THEN ${brakingMs2}::numeric
        ELSE ${corneringMs2}::numeric
      END
    )
    OR (
      ${e}.unit IS DISTINCT FROM 'g'
      AND NOT EXISTS (
        SELECT 1 FROM device_events dev
        WHERE dev.vehicle_id = ${e}.vehicle_id
          AND dev.unit = 'g'
          AND dev.event_type = ${e}.event_type
          AND dev.occurred_at BETWEEN ${e}.occurred_at - INTERVAL '10 seconds'
            AND ${e}.occurred_at + INTERVAL '10 seconds'
      )
    )
  )`;
}
