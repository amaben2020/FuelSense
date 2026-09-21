// The tracker's odometer at a moment in time.
//
// AVL 16 is the vehicle's own total odometer, validated against the dash to
// within 0.03%, so nobody is asked to read it off the dashboard at the pump.
// Anchored to the purchase time rather than "now", because a receipt queued
// offline — or backfilled by a manager — can arrive hours and many
// kilometres later, and a fill-to-fill rate is only as good as the two
// odometer readings it divides by.
import { db, sql } from '../../shared/db-helpers';

export async function odometerAtPurchase(
  vehicleId: string,
  customerId: string,
  when: Date
): Promise<number | null> {
  // Metres first: the km column is rounded on write, and two roundings on
  // either end of a 300 km interval are already 0.6% — the same order as the
  // consumption differences calibration exists to find.
  const odometer = sql`COALESCE(odometer_m::double precision / 1000.0, odometer_km::double precision)`;
  const before = await db.execute(sql`
    SELECT ${odometer} AS odometer_km
    FROM telemetry
    WHERE vehicle_id = ${vehicleId}
      AND customer_id = ${customerId}
      AND (odometer_m IS NOT NULL OR odometer_km IS NOT NULL)
      AND recorded_at <= ${when}
    ORDER BY recorded_at DESC
    LIMIT 1
  `);

  // A receipt timed before this vehicle's first reading (clock skew on the
  // phone, or a device fitted after the fill) still deserves the nearest fix.
  const row =
    before.rows[0] ??
    (
      await db.execute(sql`
        SELECT ${odometer} AS odometer_km
        FROM telemetry
        WHERE vehicle_id = ${vehicleId}
          AND customer_id = ${customerId}
          AND (odometer_m IS NOT NULL OR odometer_km IS NOT NULL)
        ORDER BY recorded_at ASC
        LIMIT 1
      `)
    ).rows[0];

  const value = (row as Record<string, unknown> | undefined)?.odometer_km;
  return value != null && Number.isFinite(Number(value)) ? Math.round(Number(value)) : null;
}
