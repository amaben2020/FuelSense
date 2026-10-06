// The fleet every FuelBrain eval case runs against. Rebuilt from scratch on
// each run so a case's right answer never drifts: one parked RAV4 rated at
// 10.23 L/100 km, two drivers (only Benneth has an email), harsh braking this
// week, three receipts totalling ₦84,000 and an unlinked VIO certificate.
//
// It deletes and rewrites rows, so it only runs against EVAL_DATABASE_URL
// (never DATABASE_URL), refuses anything but a local host, and refuses the
// production SSH tunnel's port even though that is local too.
import bcrypt from 'bcryptjs';
import { Client } from 'pg';

export const FIXTURE = {
  email: 'fuelbrain-eval@fuelsense-eval.ng',
  password: 'eval-password-123',
  plate: 'LAG-001-FS',
  imei: '869000000000001',
};

/** The SSH tunnel to production RDS (see the live-DB notes in the docs). */
const PRODUCTION_TUNNEL_PORT = '15432';

export function assertLocalDatabase(url: string | undefined): void {
  if (!url) {
    throw new Error('EVAL_DATABASE_URL is not set. Point it at a throwaway local database (see docs: FuelBrain → Evals).');
  }
  const u = new URL(url);
  if (!['localhost', '127.0.0.1', '::1'].includes(u.hostname)) {
    throw new Error(`Refusing to build the eval fixture on ${u.hostname}: EVAL_DATABASE_URL must be a local database.`);
  }
  if (u.port === PRODUCTION_TUNNEL_PORT) {
    throw new Error(`Refusing port ${PRODUCTION_TUNNEL_PORT}: that is the SSH tunnel to the production database.`);
  }
}

export async function buildFixture(databaseUrl: string): Promise<void> {
  assertLocalDatabase(databaseUrl);
  const db = new Client({ connectionString: databaseUrl, ssl: false });
  await db.connect();
  try {
    await db.query('BEGIN');
    // Everything hangs off the customer row with ON DELETE CASCADE, except
    // the tracker's raw tables keyed by IMEI.
    await db.query('DELETE FROM device_frames WHERE imei = $1', [FIXTURE.imei]);
    await db.query('DELETE FROM telemetry WHERE imei = $1', [FIXTURE.imei]);
    await db.query('DELETE FROM device_events WHERE imei = $1', [FIXTURE.imei]);
    await db.query('DELETE FROM devices WHERE imei = $1', [FIXTURE.imei]);
    await db.query('DELETE FROM customers WHERE email = $1', [FIXTURE.email]);

    const hash = await bcrypt.hash(FIXTURE.password, 10);
    const {
      rows: [c],
    } = await db.query(
      `INSERT INTO customers (name, email, password_hash, company_name, onboarding_completed)
       VALUES ('Ama Benjamin', $1, $2, 'Eval Fleet', true) RETURNING id`,
      [FIXTURE.email, hash]
    );
    const {
      rows: [benneth],
    } = await db.query(
      `INSERT INTO drivers (customer_id, full_name, driver_code, status, email)
       VALUES ($1, 'Benneth Uzochukwu', 'EVAL-001', 'active', 'benneth.driver@fuelsense-eval.ng') RETURNING id`,
      [c.id]
    );
    await db.query(
      `INSERT INTO drivers (customer_id, full_name, driver_code, status)
       VALUES ($1, 'Bola Adeyemi', 'EVAL-002', 'active')`,
      [c.id]
    );
    const {
      rows: [v],
    } = await db.query(
      `INSERT INTO vehicles (customer_id, license_plate, make, model, year, driver_id,
         consumption_rate_l_per_100km, rate_source, idle_burn_rate_l_per_hour, tank_capacity_liters)
       VALUES ($1, $2, 'Toyota', 'RAV4', 2013, $3, 10.23, 'catalogue', 0.85, 60) RETURNING id`,
      [c.id, FIXTURE.plate, benneth.id]
    );
    await db.query(
      `INSERT INTO devices (imei, customer_id, vehicle_id, last_seen_at)
       VALUES ($1, $2, $3, NOW() - INTERVAL '20 minutes')`,
      [FIXTURE.imei, c.id, v.id]
    );

    // Driven on days 4-9 ago, one ~40-minute trip a day; parked since.
    await db.query(
      `INSERT INTO telemetry (imei, customer_id, vehicle_id, recorded_at, latitude, longitude, speed_kph, ignition_on, odometer_km)
       SELECT $1, $2, $3,
              date_trunc('day', NOW()) - (d || ' days')::interval + INTERVAL '8 hours' + (m || ' minutes')::interval,
              9.05 + m * 0.0004, 7.40 + m * 0.0005, 38, true,
              82000 + (10 - d) * 30 + m * (0.5 + d * 0.05)
       FROM generate_series(4, 9) d, generate_series(0, 39) m`,
      [FIXTURE.imei, c.id, v.id]
    );
    // Parked heartbeats: ignition off, GPS asleep (AVL 69 = 3).
    await db.query(
      `INSERT INTO device_frames (imei, received_at, recorded_at, gps_valid, io_raw)
       SELECT $1, NOW() - (h || ' hours')::interval - INTERVAL '20 minutes',
              NOW() - (h || ' hours')::interval - INTERVAL '20 minutes', false,
              '{"239":{"dec":0,"hex":"00"},"69":{"dec":3,"hex":"03"}}'::jsonb
       FROM generate_series(0, 70) h`,
      [FIXTURE.imei]
    );
    // Harsh braking from the tracker's own accelerometer this week.
    await db.query(
      `INSERT INTO device_events (imei, customer_id, vehicle_id, event_type, severity, value, unit, speed_kph, occurred_at)
       SELECT $1, $2, $3, 'harsh_braking', 'warning', 0.48, 'g', 42,
              date_trunc('day', NOW()) - (d || ' days')::interval + INTERVAL '8 hours 20 minutes'
       FROM generate_series(4, 6) d`,
      [FIXTURE.imei, c.id, v.id]
    );
    // Three receipts in the last 30 days: ₦25,000 + ₦30,000 + ₦29,000 = ₦84,000.
    await db.query(
      `INSERT INTO fuel_purchases (customer_id, vehicle_id, purchased_at, merchant, liters_declared,
         cost_per_liter_ngn, total_amount_ngn, source, status)
       VALUES ($1, $2, NOW() - INTERVAL '5 days', 'Hariz Petroleum Ltd', 17.86, 1400, 25000, 'driver_upload', 'verified'),
              ($1, $2, NOW() - INTERVAL '12 days', 'Hariz Petroleum Ltd', 21.43, 1400, 30000, 'driver_upload', 'verified'),
              ($1, $2, NOW() - INTERVAL '20 days', 'ENYO Filling Station', 20.14, 1440, 29000, 'driver_upload', 'verified')`,
      [c.id, v.id]
    );
    // Filed under the registration on the paper, not linked to the vehicle row.
    await db.query(
      `INSERT INTO vehicle_certificates (customer_id, driver_id, kind, registration_number, issuing_state,
         vehicle_make, vehicle_model, issued_on, expires_on)
       VALUES ($1, $2, 'vio', 'ABC782PA', 'Nasarawa', 'Toyota', 'RAV4', '2026-03-16', '2027-03-15')`,
      [c.id, benneth.id]
    );
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  } finally {
    await db.end();
  }
}
