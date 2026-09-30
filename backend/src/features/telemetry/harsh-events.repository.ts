import { SQL, sql } from 'drizzle-orm';

/**
 * Whether a harsh-manoeuvre row counts against a driver.
 *
 * Only the tracker's own accelerometer (AVL 253, stored in g) is trusted.
 * Rows the retired GPS detector wrote (m/s², differentiated speed) stay in the
 * table for history but are neither shown nor scored. How sensitive the
 * tracker is gets set in the Teltonika Configurator's Eco/Green Driving
 * thresholds, not re-judged here. Overspeeding and every other event type pass
 * through untouched.
 */
export function countedHarshEvent(alias: string): SQL {
  const e = sql.raw(alias);
  return sql`(
    ${e}.event_type NOT IN ('harsh_acceleration', 'harsh_braking', 'harsh_cornering')
    OR ${e}.unit = 'g'
  )`;
}
