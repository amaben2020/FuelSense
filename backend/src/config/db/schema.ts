import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  integer,
  bigserial,
  bigint,
  numeric,
  text,
  unique,
  index,
  uniqueIndex,
  jsonb,
  date,
} from 'drizzle-orm/pg-core';

export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  /**
   * Everyone who should receive this fleet's email — alerts and the daily
   * report alike. Set under Settings → Notifications. When empty, mail falls
   * back to the account email, which on a seeded account is a placeholder
   * nothing can deliver to; the list is how a real inbox gets on the wire.
   */
  notificationEmails: text('notification_emails').array().notNull().default([]),
  /** Set on every successful sign-in; the developer's monitoring page reads it. */
  lastLoginAt: timestamp('last_login_at'),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  /**
   * Null until the account holder clicks the link we emailed at sign-up.
   * Defaults to NOW() so every account that predates verification — the
   * seeded and demo fleets included — counts as verified; only /register
   * writes a null. While null, no fleet mail is sent (see fleetRecipients).
   */
  emailVerifiedAt: timestamp('email_verified_at').defaultNow(),
  /** sha256 of the outstanding link's token; the raw token is only ever in the email. */
  emailVerifyTokenHash: varchar('email_verify_token_hash', { length: 64 }),
  emailVerifySentAt: timestamp('email_verify_sent_at'),
  phone: varchar('phone', { length: 50 }),
  companyName: varchar('company_name', { length: 255 }),
  // White-labelling: the customer's own logo, shown in place of ours. A URL
  // rather than a blob so it can point at whatever the customer already hosts.
  logoUrl: text('logo_url'),
  /** Accent colour, hex. Falls back to the FuelSense green when unset. */
  brandColor: varchar('brand_color', { length: 9 }),
  /**
   * When set, the product calls itself by the company's name everywhere a
   * signed-in person sees it — tab title, loading screen, driver app, the
   * copy that says who worked a figure out. A logo and a colour make the
   * dashboard look like the customer's; this makes it read as theirs.
   */
  whiteLabel: boolean('white_label').default(false),
  subscriptionStatus: varchar('subscription_status', { length: 50 }).default('active'),
  onboardingCompleted: boolean('onboarding_completed').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

/**
 * People who sign in to a fleet account other than the account holder.
 *
 * A customer row is the fleet — its login is the manager who set it up. A
 * fleet user is a person that fleet lets in under their own name, so every
 * command they send is signed by them (the immobilizer audit trail reads
 * it) rather than by a shared login. For a manager or commander the role only
 * chooses where the dashboard opens: a commander lands on the Command Summary,
 * everyone else on the operations dashboard. A viewer is the exception — they
 * can open every page and change nothing, which the auth middleware enforces
 * by refusing any request that is not a read.
 */
export const FLEET_ROLES = ['manager', 'commander', 'viewer'] as const;
export type FleetRole = (typeof FLEET_ROLES)[number];

export const fleetUsers = pgTable('fleet_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id, { onDelete: 'cascade' }),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  role: varchar('role', { length: 20 }).notNull(),
  /** Rank, title or unit — shown under the name, never used for access. */
  title: varchar('title', { length: 120 }),
  isActive: boolean('is_active').default(true),
  lastLoginAt: timestamp('last_login_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const drivers = pgTable('drivers', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id, { onDelete: 'cascade' }),
  fullName: varchar('full_name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }),
  phone: varchar('phone', { length: 50 }),
  licenseNumber: varchar('license_number', { length: 80 }),
  driverCode: varchar('driver_code', { length: 50 }),
  pinHash: varchar('pin_hash', { length: 255 }),
  /**
   * The driver's photo, as a compressed data URL.
   *
   * Same storage as receipt and odometer photos: there is no object store
   * configured for this deployment, and a face at avatar size is a few tens of
   * kilobytes. The upload path compresses before it ever reaches here.
   */
  photoUrl: text('photo_url'),
  status: varchar('status', { length: 30 }).default('active'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const vehicles = pgTable(
  'vehicles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    licensePlate: varchar('license_plate', { length: 50 }).notNull(),
    make: varchar('make', { length: 100 }),
    model: varchar('model', { length: 100 }),
    year: integer('year'),
    tankCapacityLiters: integer('tank_capacity_liters'),
    // Vehicle class drives the starting fuel figures. Once enough fill-ups are
    // logged, the measured rate below takes over and the class is only a label.
    vehicleType: varchar('vehicle_type', { length: 20 }),
    // Rate actually in use. Seeded from the class preset, then overwritten by
    // fill-to-fill calibration; `rate_source` says which is in play.
    consumptionRateL100km: numeric('consumption_rate_l_per_100km', { precision: 6, scale: 2 }),
    idleBurnRateLph: numeric('idle_burn_rate_l_per_hour', { precision: 5, scale: 2 }),
    rateSource: varchar('rate_source', { length: 12 }).default('preset'),
    // Speed above which this vehicle is overspeeding, km/h. Set to match the
    // limit configured on the tracker. NULL means the fleet has declared none,
    // and overspeeding is then not reported rather than guessed at.
    speedLimitKph: integer('speed_limit_kph'),
    // True dashboard odometer, anchored once by the fleet manager. The tracker
    // only reports AVL 16 (distance accumulated since it was fitted), so the
    // real total is this baseline plus whatever the device has counted since
    // the moment the baseline was taken.
    odometerBaselineKm: integer('odometer_baseline_km'),
    odometerBaselineDeviceKm: integer('odometer_baseline_device_km'),
    odometerBaselineAt: timestamp('odometer_baseline_at'),
    driverId: uuid('driver_id').references(() => drivers.id, { onDelete: 'set null' }),
    driverName: varchar('driver_name', { length: 255 }),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [unique().on(table.customerId, table.licensePlate)]
);

export const fuelReceipts = pgTable('fuel_receipts', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id, { onDelete: 'cascade' }),
  driverId: uuid('driver_id')
    .notNull()
    .references(() => drivers.id, { onDelete: 'cascade' }),
  vehicleId: uuid('vehicle_id')
    .notNull()
    .references(() => vehicles.id, { onDelete: 'cascade' }),
  receiptPhotoUrl: text('receipt_photo_url'),
  merchantName: varchar('merchant_name', { length: 255 }),
  merchantAddress: text('merchant_address'),
  transactionDate: timestamp('transaction_date').notNull(),
  declaredLiters: numeric('declared_liters', { precision: 10, scale: 2 }).notNull(),
  pricePerLiter: numeric('price_per_liter', { precision: 10, scale: 2 }),
  totalAmount: numeric('total_amount', { precision: 12, scale: 2 }),
  odometerKm: integer('odometer_km'),
  obdLitersActual: numeric('obd_liters_actual', { precision: 10, scale: 2 }),
  differenceLiters: numeric('difference_liters', { precision: 10, scale: 2 }),
  obdRefuelDetectedAt: timestamp('obd_refuel_detected_at'),
  ignitionOnAt: timestamp('ignition_on_at'),
  reconciliationStatus: varchar('reconciliation_status', { length: 30 }).default('pending'),
  // Why the receipt holds the status it does: the individual checks, their
  // outcomes, and the numbers behind them. Stored so a manager reviewing a
  // flag months later sees the evidence as it stood, not as it recomputes.
  verification: jsonb('verification'),
  receiptLatitude: numeric('receipt_latitude', { precision: 10, scale: 8 }),
  receiptLongitude: numeric('receipt_longitude', { precision: 11, scale: 8 }),
  clientReceiptId: varchar('client_receipt_id', { length: 64 }),
  uploadedAt: timestamp('uploaded_at').defaultNow(),
  reconciledAt: timestamp('reconciled_at'),
});

export const siphonEvents = pgTable('siphon_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id, { onDelete: 'cascade' }),
  vehicleId: uuid('vehicle_id')
    .notNull()
    .references(() => vehicles.id, { onDelete: 'cascade' }),
  driverId: uuid('driver_id').references(() => drivers.id, { onDelete: 'set null' }),
  alertId: integer('alert_id'),
  occurredAt: timestamp('occurred_at').notNull(),
  litersStolen: numeric('liters_stolen', { precision: 10, scale: 2 }).notNull(),
  estimatedLossNgn: integer('estimated_loss_ngn'),
  fuelLevelBefore: numeric('fuel_level_before', { precision: 10, scale: 2 }),
  fuelLevelAfter: numeric('fuel_level_after', { precision: 10, scale: 2 }),
  engineStateBefore: boolean('engine_state_before'),
  engineStateAfter: boolean('engine_state_after'),
  parkedDurationMinutes: integer('parked_duration_minutes'),
  latitude: numeric('latitude', { precision: 10, scale: 8 }),
  longitude: numeric('longitude', { precision: 11, scale: 8 }),
  locationName: varchar('location_name', { length: 255 }),
  status: varchar('status', { length: 30 }).default('active'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow(),
  resolvedAt: timestamp('resolved_at'),
});

export const fuelPurchases = pgTable('fuel_purchases', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id, { onDelete: 'cascade' }),
  vehicleId: uuid('vehicle_id')
    .notNull()
    .references(() => vehicles.id, { onDelete: 'cascade' }),
  purchasedAt: timestamp('purchased_at').notNull().defaultNow(),
  merchant: varchar('merchant', { length: 255 }),
  receiptReference: varchar('receipt_reference', { length: 120 }),
  litersDeclared: numeric('liters_declared', { precision: 10, scale: 2 }).notNull(),
  litersActual: numeric('liters_actual', { precision: 10, scale: 2 }),
  obdRefuelDetectedAt: timestamp('obd_refuel_detected_at'),
  ignitionOnAt: timestamp('ignition_on_at'),
  costPerLiterNgn: integer('cost_per_liter_ngn'),
  // What the driver actually paid. Litres × price is a reconstruction and
  // drifts by a naira or two against the slip; this is the figure on it.
  totalAmountNgn: integer('total_amount_ngn'),
  // Dashboard reading at the pump, in km. Everything downstream compares in km;
  // miles only ever appear as a secondary display.
  odometerKm: integer('odometer_km'),
  odometerPhotoUrl: text('odometer_photo_url'),
  status: varchar('status', { length: 30 }).default('verified'),
  source: varchar('source', { length: 30 }).default('receipt'),
  // --- fill-to-fill reconciliation, written when a purchase is logged ---
  // Distance covered since the previous fill, by odometer and by GPS.
  odometerDeltaKm: integer('odometer_delta_km'),
  gpsDistanceKm: numeric('gps_distance_km', { precision: 10, scale: 1 }),
  // This vehicle's measured burn over that interval — the number that
  // eventually replaces the class preset.
  realConsumptionL100km: numeric('real_consumption_l_per_100km', { precision: 6, scale: 2 }),
  // Odometer and GPS disagree by more than tolerance: tracker gap, or a
  // reading that doesn't match how far the vehicle actually went.
  distanceMismatch: boolean('distance_mismatch').default(false),
  // Reading is impossible (backwards, unchanged, or an implausible jump), so
  // no rate is derived from it rather than publishing a nonsense figure.
  implausibleOdometer: boolean('implausible_odometer').default(false),
  // Litres bought exceed what the distance can account for.
  unusualPurchase: boolean('unusual_purchase').default(false),
  flagReason: text('flag_reason'),
  // What the driver said about the tank at the pump. A fill to full pins the
  // level at capacity — the one fact that resets the model to truth — and
  // two consecutive fills to full give the vehicle's real consumption. A
  // gauge reading (0–8, eighths of a tank as read off the dash) is the
  // fallback when the fill was a top-up.
  filledToFull: boolean('filled_to_full').default(false),
  gaugeEighths: integer('gauge_eighths'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const devices = pgTable('devices', {
  imei: varchar('imei', { length: 20 }).primaryKey(),
  vehicleId: uuid('vehicle_id').references(() => vehicles.id, { onDelete: 'set null' }),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id, { onDelete: 'cascade' }),
  deviceModel: varchar('device_model', { length: 50 }).default('FMC150'),
  firmwareVersion: varchar('firmware_version', { length: 50 }),
  isActive: boolean('is_active').default(true),
  installedAt: timestamp('installed_at').defaultNow(),
  lastSeenAt: timestamp('last_seen_at'),
  // Whether the engine-start circuit is currently cut via the wired DOUT
  // relay. Read by every safety check before another command is allowed —
  // never inferred from the device's own reply, since a command can be sent
  // to a device that never had the relay wired at all.
  immobilized: boolean('immobilized').default(false),
  immobilizedAt: timestamp('immobilized_at'),
  // The setdigout in flight, if any: 'engage' or 'release'. Queued when the
  // tracker had no open socket, sent once it does, cleared by its Codec 12
  // reply. The text is the exact command line, kept so the UI can show it.
  immobilizerCommand: varchar('immobilizer_command', { length: 16 }),
  immobilizerCommandText: text('immobilizer_command_text'),
  immobilizerQueuedAt: timestamp('immobilizer_queued_at'),
  immobilizerSentAt: timestamp('immobilizer_sent_at'),
  // The device's last reply to a setdigout, verbatim ("DOUTS are set to:10
  // TMOs are: 0 0"), and when it arrived.
  immobilizerAck: text('immobilizer_ack'),
  immobilizerAckAt: timestamp('immobilizer_ack_at'),
  // DOUT1 as the device itself last reported it in AVL 179 — the relay-side
  // truth, independent of what was commanded. Null on a tracker that does
  // not have the element enabled.
  dout1State: integer('dout1_state'),
  dout1ReportedAt: timestamp('dout1_reported_at'),
  // The last central-locking pulse on DOUT2: when it was sent and what the
  // device replied. A lock pulse is only ever sent to a connected tracker,
  // so there is no queue for it.
  doorLockSentAt: timestamp('door_lock_sent_at'),
  doorLockAck: text('door_lock_ack'),
  doorLockAckAt: timestamp('door_lock_ack_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Partitioned by month on recorded_at in production (lib/telemetry-partitions).
// The real primary key there is (id, recorded_at) — Postgres requires the
// partition column in it — so `drizzle-kit push` must NOT be run against that
// database: it would try to reinstate the single-column key and fail, or worse.
// Schema changes go through initDatabase's ensureColumn, as they already do.
export const telemetry = pgTable('telemetry', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  imei: varchar('imei', { length: 20 }).references(() => devices.imei),
  customerId: uuid('customer_id').references(() => customers.id),
  vehicleId: uuid('vehicle_id').references(() => vehicles.id),
  recordedAt: timestamp('recorded_at').notNull().defaultNow(),
  fuelLevelLiters: numeric('fuel_level_liters', { precision: 10, scale: 2 }),
  // Provenance of fuel_level_liters: CAN | OBD% | virtual | none
  fuelSource: varchar('fuel_source', { length: 12 }),
  // AVL ID 12 — firmware fuel-used accumulator in ml (GPS-derived, survives trips,
  // resets to 0 on device power cycle)
  fuelUsedGpsMl: bigint('fuel_used_gps_ml', { mode: 'number' }),
  // AVL ID 13 — instantaneous burn rate; device sends l/h ×100, stored as l/h
  fuelRateLph: numeric('fuel_rate_lph', { precision: 8, scale: 2 }),
  // Modelled fuel burned over the hop ending at this reading, in millilitres.
  // Consumption is SUMmed from this rather than differenced out of
  // fuel_level_liters — see FuelGpsResult.burnMl for why that mattered.
  burnMl: bigint('burn_ml', { mode: 'number' }),
  odometerKm: integer('odometer_km'),
  // AVL 16 reports metres. Rounding to whole kilometres made any movement
  // under 500 m invisible, which is most of a delivery round, so the raw
  // value is kept alongside the rounded one every consumer already reads.
  odometerM: bigint('odometer_m', { mode: 'number' }),
  latitude: numeric('latitude', { precision: 10, scale: 8 }),
  longitude: numeric('longitude', { precision: 11, scale: 8 }),
  speedKph: integer('speed_kph'),
  ignitionOn: boolean('ignition_on'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Software-modelled fuel tank for vehicles without CAN/OBD fuel data.
// Level is decremented by Fuel Used GPS (AVL 12) deltas and credited by
// verified fuel receipts; the manager anchors it via calibration.
export const virtualTanks = pgTable('virtual_tanks', {
  vehicleId: uuid('vehicle_id')
    .primaryKey()
    .references(() => vehicles.id, { onDelete: 'cascade' }),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id, { onDelete: 'cascade' }),
  capacityLiters: numeric('capacity_liters', { precision: 10, scale: 2 }).notNull(),
  levelMl: bigint('level_ml', { mode: 'number' }).notNull(),
  // Last seen value of the device's Fuel Used GPS accumulator — the baseline
  // for delta computation. A reading below this means the accumulator reset.
  lastFuelUsedMl: bigint('last_fuel_used_ml', { mode: 'number' }),
  lastReadingAt: timestamp('last_reading_at'),
  calibratedAt: timestamp('calibrated_at'),
  calibrationSource: varchar('calibration_source', { length: 30 }),
  consumedSinceCalibrationMl: bigint('consumed_since_calibration_ml', { mode: 'number' })
    .notNull()
    .default(0),
  // EMA of Fuel Rate GPS while stationary — the vehicle's real idle burn (l/h)
  learnedIdleLph: numeric('learned_idle_lph', { precision: 6, scale: 3 }),
  // EMA of the burn rate implied by the accumulator itself over the same
  // stationary samples. The two should agree; when they don't, the accumulator
  // is miscalibrated and the ratio between them is the correction.
  accumulatorIdleLph: numeric('accumulator_idle_lph', { precision: 6, scale: 3 }),
  // Multiplier applied to accumulator deltas. 1 = trust the device as-is.
  burnFactor: numeric('burn_factor', { precision: 5, scale: 3 }).notNull().default('1'),
  burnFactorSource: varchar('burn_factor_source', { length: 30 }),
  burnFactorSamples: integer('burn_factor_samples').notNull().default(0),
  // Anchored model. Level is computed from the anchor and the accumulator's
  // absolute travel since it, rather than by subtracting each ping's delta:
  // that way fuel burned while the tracker was offline is still counted, and
  // a single bad write cannot drift the tank permanently.
  anchorLevelMl: bigint('anchor_level_ml', { mode: 'number' }),
  anchorAccumulatorMl: bigint('anchor_accumulator_ml', { mode: 'number' }),
  // Modelled burn — the counter the level is actually computed from.
  //
  // AVL 12 was measured counting 13 ml over 3.55 km of driving on this fleet,
  // and AVL 13 reports a constant ~2.47 l/h whether moving, idling or parked:
  // the device's fuel elements do not describe the vehicle. Burn is therefore
  // modelled from distance travelled and time spent idling, both of which the
  // tracker does measure well (the odometer validates to 0.03%).
  //
  // Monotonic and absolute like the accumulator it replaces, so the anchored
  // model above works unchanged — and so does surviving a power cycle, which
  // this counter does by construction rather than by offsetting resets.
  modelledBurnMl: bigint('modelled_burn_ml', { mode: 'number' }).notNull().default(0),
  anchorModelledMl: bigint('anchor_modelled_ml', { mode: 'number' }),
  /**
   * When and why the level was last pinned — a receipt credit or a
   * calibration. `calibrated_at` only moves on calibrations, so before this
   * column existed the working page had no honest date for a receipt anchor.
   */
  anchoredAt: timestamp('anchored_at'),
  anchorSource: varchar('anchor_source', { length: 30 }),
  // Previous odometer reading, for the distance half of the model.
  lastOdometerM: bigint('last_odometer_m', { mode: 'number' }),
  // AVL 12 restarts at zero on every power cycle, so the running total is the
  // raw reading plus everything counted before the resets.
  accumulatorOffsetMl: bigint('accumulator_offset_ml', { mode: 'number' }).notNull().default(0),
  /**
   * What the fuel currently in this tank cost per litre, weighted by volume.
   *
   * Fuel physically mixes, so a tank is not a queue: 10 L bought at 1,275
   * plus 40 L bought at 1,440 is 50 L that genuinely costs 1,407 a litre, and
   * there is no way to burn "the old litres first". Weighted average is the
   * honest model, and it has the useful property that consumption never moves
   * it — only a fill does.
   *
   * Null until a priced fill lands. A tank holding fuel of unknown price says
   * so rather than borrowing today's pump rate, which would restate what last
   * month's fuel cost every time the price moved.
   */
  avgCostNgnPerLiter: numeric('avg_cost_ngn_per_liter', { precision: 10, scale: 2 }),
  confidence: integer('confidence').notNull().default(30),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const alerts = pgTable('alerts', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  imei: varchar('imei', { length: 20 }).references(() => devices.imei),
  customerId: uuid('customer_id').references(() => customers.id),
  vehicleId: uuid('vehicle_id').references(() => vehicles.id),
  alertType: varchar('alert_type', { length: 50 }).notNull(),
  message: text('message').notNull(),
  fuelLevelLiters: numeric('fuel_level_liters', { precision: 10, scale: 2 }),
  fuelDropLiters: numeric('fuel_drop_liters', { precision: 10, scale: 2 }),
  estimatedLossNgn: integer('estimated_loss_ngn'),
  latitude: numeric('latitude', { precision: 10, scale: 8 }),
  longitude: numeric('longitude', { precision: 11, scale: 8 }),
  isResolved: boolean('is_resolved').default(false),
  resolvedAt: timestamp('resolved_at'),
  /**
   * The driver's account of what happened, written from the driver app.
   *
   * An alert is a question about a vehicle, and the person who can answer it
   * is the one who was driving. Letting them answer turns "left the depot zone
   * at 19:40" from something a manager has to chase into something already
   * explained by the time it is read. Only the alert types in
   * DRIVER_EXPLAINABLE_ALERTS ask for one.
   */
  driverNote: text('driver_note'),
  driverNoteAt: timestamp('driver_note_at'),
  /** Swiped away in the driver app. Hides it from the driver only; the
   *  manager's record is untouched. */
  driverDismissedAt: timestamp('driver_dismissed_at'),
  driverId: uuid('driver_id').references(() => drivers.id, { onDelete: 'set null' }),
  /**
   * What the manager made of the driver's account. `accepted` closes the
   * alert with the note on record; `escalated` keeps it open and flagged.
   * Null while the explanation is still waiting in the manager's queue.
   */
  managerAction: varchar('manager_action', { length: 20 }),
  managerActionAt: timestamp('manager_action_at'),
  managerActionBy: text('manager_action_by'),
  managerComment: text('manager_comment'),
  /**
   * Who asked for this, when the alert records a person's command rather
   * than something the fleet did — the manager behind an immobilize, a
   * mobilize or a door lock. Null on every alert the detectors raise. Kept
   * as its own column, not just inside the message, so the audit trail can
   * answer "who did this" without parsing prose.
   */
  actor: text('actor'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id, { onDelete: 'cascade' }),
  planName: varchar('plan_name', { length: 50 }).notNull().default('basic'),
  pricePerVehicleNgn: integer('price_per_vehicle_ngn').notNull().default(120000),
  status: varchar('status', { length: 50 }).default('active'),
  currentPeriodStart: timestamp('current_period_start').defaultNow(),
  currentPeriodEnd: timestamp('current_period_end'),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false),
  createdAt: timestamp('created_at').defaultNow(),
});

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id, { onDelete: 'cascade' }),
  subscriptionId: uuid('subscription_id').references(() => subscriptions.id, {
    onDelete: 'set null',
  }),
  amountNgn: integer('amount_ngn').notNull(),
  reference: varchar('reference', { length: 255 }).notNull().unique(),
  status: varchar('status', { length: 50 }).default('pending'),
  paymentMethod: varchar('payment_method', { length: 50 }),
  paidAt: timestamp('paid_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const deviceOrders = pgTable('device_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id, { onDelete: 'cascade' }),
  orderDate: timestamp('order_date').defaultNow(),
  status: varchar('status', { length: 50 }).default('pending'),
  deviceImeis: text('device_imeis').array().default(sql`ARRAY[]::text[]`),
  quantity: integer('quantity').notNull().default(1),
  totalAmountNgn: integer('total_amount_ngn').notNull(),
  shippingAddress: text('shipping_address'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Scenario events decoded from FMC150 GNSS/accelerometer AVL elements —
// green driving (harsh accel/brake/cornering), overspeeding, towing, crash,
// jamming, unplug, idling, trip start/stop, geofence transitions.
export const deviceEvents = pgTable('device_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  imei: varchar('imei', { length: 20 }).references(() => devices.imei),
  customerId: uuid('customer_id').references(() => customers.id),
  vehicleId: uuid('vehicle_id').references(() => vehicles.id),
  eventType: varchar('event_type', { length: 40 }).notNull(),
  severity: varchar('severity', { length: 10 }).notNull().default('info'),
  // Scenario magnitude — g-force for green driving, km/h for overspeeding
  value: numeric('value', { precision: 12, scale: 3 }),
  unit: varchar('unit', { length: 12 }),
  speedKph: integer('speed_kph'),
  latitude: numeric('latitude', { precision: 10, scale: 8 }),
  longitude: numeric('longitude', { precision: 11, scale: 8 }),
  occurredAt: timestamp('occurred_at').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

/**
 * Every change to a vehicle's odometer baseline, kept forever.
 *
 * The baseline silently redefines what every mileage figure for the vehicle
 * means — including the intervals its service schedules are measured against —
 * and the vehicles row holds only the current value. Without this, a correction
 * is indistinguishable from the original reading being wrong, and a fleet with
 * more than one manager has no way to ask who changed it.
 *
 * `previousBaselineKm` is null for the first anchor, which is how a first
 * anchoring is told apart from an override.
 */
export const odometerAudit = pgTable('odometer_audit', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id, { onDelete: 'cascade' }),
  vehicleId: uuid('vehicle_id')
    .notNull()
    .references(() => vehicles.id, { onDelete: 'cascade' }),
  previousBaselineKm: integer('previous_baseline_km'),
  newBaselineKm: integer('new_baseline_km').notNull(),
  // The tracker's own counter at the moment of the change. Without it the pair
  // of baselines cannot be turned back into the totals they produced.
  deviceKmAtChange: integer('device_km_at_change'),
  // Distance the new reading showed the tracker had missed, and the fuel booked
  // out of the tank for it at the vehicle's rate. Null when nothing was booked.
  gapKm: integer('gap_km'),
  gapFuelLiters: numeric('gap_fuel_liters', { precision: 8, scale: 2 }),
  gapRateL100km: numeric('gap_rate_l_per_100km', { precision: 6, scale: 2 }),
  /** The account that made the change. One login per company today, so this
   *  identifies the account rather than an individual — recorded as the email
   *  and name at the time, not a foreign key, so it survives the account being
   *  renamed or deleted. */
  changedByEmail: varchar('changed_by_email', { length: 255 }),
  changedByName: varchar('changed_by_name', { length: 255 }),
  changedAt: timestamp('changed_at').defaultNow(),
});

// Which alert types a customer wants emailed. A missing row means "not opted
// in" — notifications are never forced on.
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    alertType: varchar('alert_type', { length: 40 }).notNull(),
    emailEnabled: boolean('email_enabled').notNull().default(false),
    // Optional override; falls back to the account email.
    emailAddress: varchar('email_address', { length: 255 }),
    /**
     * How patient this alert should be, for the types that wait before firing.
     * Only `device_offline` reads it today: how long a tracker may stay quiet
     * before it counts as an outage. NULL keeps the platform default, so a
     * manager who never touches it is unaffected.
     */
    thresholdMinutes: integer('threshold_minutes'),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [unique().on(table.customerId, table.alertType)]
);

// Pump price per litre as the fleet manager declares it, kept as a history
// rather than a single editable value.
//
// Nigerian pump prices move often, and a fleet's cost figures are only fair if
// each period is valued at the price that applied *then*. Storing one mutable
// number would silently restate last month's spend every time the price
// changed. Each row opens a new period; the row with the latest
// effective_from at or before a moment in time is the price for that moment.
export const fuelPrices = pgTable(
  'fuel_prices',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    ngnPerLiter: numeric('ngn_per_liter', { precision: 10, scale: 2 }).notNull(),
    effectiveFrom: timestamp('effective_from').notNull().defaultNow(),
    // Where the figure came from — a manager typing it in, or a logged receipt.
    source: varchar('source', { length: 20 }).notNull().default('manager'),
    note: text('note'),
    createdAt: timestamp('created_at').defaultNow(),
  },
  // Costing runs this lookup once per telemetry delta, so it has to be indexed.
  (table) => [index('fuel_prices_customer_effective_idx').on(table.customerId, table.effectiveFrom)]
);

// Per-customer visibility switches, so a half-finished area can be hidden
// without a redeploy. Absence of a row means the flag's coded default applies.
export const featureFlags = pgTable(
  'feature_flags',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    // Null customer = platform-wide default; a row with a customer overrides it.
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'cascade' }),
    flagKey: varchar('flag_key', { length: 60 }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    note: text('note'),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [unique().on(table.customerId, table.flagKey)]
);

// Reverse-geocoded stop locations. Keyed by rounded coordinates so repeat
// visits to the same place reuse one lookup — Google billing is per call and
// a fleet revisits the same depots and markets constantly.
export const placeCache = pgTable('place_cache', {
  geoKey: varchar('geo_key', { length: 32 }).primaryKey(),
  latitude: numeric('latitude', { precision: 10, scale: 6 }).notNull(),
  longitude: numeric('longitude', { precision: 11, scale: 6 }).notNull(),
  formattedAddress: text('formatted_address'),
  placeName: varchar('place_name', { length: 255 }),
  placeId: varchar('place_id', { length: 255 }),
  photoReference: text('photo_reference'),
  // Street View shows the actual kerbside the driver stopped at, which is more
  // use than a stock photo of a nearby business. Null pano = no coverage there.
  streetViewPanoId: varchar('street_view_pano_id', { length: 255 }),
  streetViewDate: varchar('street_view_date', { length: 16 }),
  lookedUpAt: timestamp('looked_up_at').defaultNow(),
});

// Raw frames table — stores the full undecoded SDK record for every packet
// received from a device. Lets us cross-check AVL IDs, GPS fields, and Buffer
// values against what we actually parsed and stored in `telemetry`.
export const deviceFrames = pgTable('device_frames', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  imei: varchar('imei', { length: 20 }).references(() => devices.imei),
  // null when the record was dropped (e.g. GPS fix rejected, unknown device)
  telemetryId: bigint('telemetry_id', { mode: 'number' }).references(() => telemetry.id),
  receivedAt: timestamp('received_at').notNull().defaultNow(),
  // When the device took the reading. Arrival trails it by a variable 1-3 s,
  // so only this can time a manoeuvre. Null on frames stored before it was.
  recordedAt: timestamp('recorded_at'),
  // AVL event ID that triggered this record (e.g. 239 = ignition, 11 = overspeeding)
  eventId: integer('event_id'),
  // Satellite count at capture time — key signal for GPS fix quality
  gpsSatellites: integer('gps_satellites'),
  // Whether our code accepted this GPS fix (satellites >= MIN and coords non-zero)
  gpsValid: boolean('gps_valid'),
  // Full GPS object from the SDK: {latitude, longitude, speed, satellites, ...}
  gpsRaw: jsonb('gps_raw'),
  // All AVL IO keys from this record. Buffer values are serialised as {hex, dec}.
  ioRaw: jsonb('io_raw'),
});

/**
 * Service intervals per vehicle, measured against the tracker's own odometer
 * (AVL 16) rather than a number somebody typed in. That is the whole point:
 * a schedule anchored to hand-entered mileage drifts the moment a driver
 * forgets, and every "overdue" figure after that is fiction.
 */
export const maintenanceSchedules = pgTable(
  'maintenance_schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    /** 'oil_change' | 'tyres' | 'brakes' | 'service' | free text */
    kind: varchar('kind', { length: 40 }).notNull(),
    /** Distance between services. Null = time-based only. */
    intervalKm: integer('interval_km'),
    /** Days between services. Null = distance-based only. */
    intervalDays: integer('interval_days'),
    /** When the reminder last fired for the current interval; cleared on completion. */
    dueSoonAlertedAt: timestamp('due_soon_alerted_at'),
    overdueAlertedAt: timestamp('overdue_alerted_at'),
    /** Odometer reading at the last service, in km. */
    lastServiceKm: integer('last_service_km'),
    lastServiceAt: timestamp('last_service_at'),
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    unique().on(table.vehicleId, table.kind),
    index('maintenance_customer_idx').on(table.customerId),
  ]
);

/**
 * Zones a fleet cares about. Stored as either a circle (centre + radius) or a
 * polygon ring, because depots are circles and territories are not, and
 * forcing one shape onto the other produces alerts nobody trusts.
 */
export const geofences = pgTable(
  'geofences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    /** 'circle' | 'polygon' */
    shape: varchar('shape', { length: 12 }).notNull().default('circle'),
    centerLat: numeric('center_lat', { precision: 10, scale: 6 }),
    centerLng: numeric('center_lng', { precision: 11, scale: 6 }),
    radiusM: integer('radius_m'),
    /** [[lat, lng], ...] ring for polygon zones. */
    polygon: jsonb('polygon'),
    /** 'depot' | 'customer' | 'restricted' | 'fuel_station' — drives how a breach is phrased. */
    purpose: varchar('purpose', { length: 24 }).notNull().default('depot'),
    /** Google place a fuel-station zone was picked from, and what it showed. */
    placeId: varchar('place_id', { length: 255 }),
    address: text('address'),
    photoRef: text('photo_ref'),
    /** Alert when a vehicle enters, leaves, or both. */
    notifyOn: varchar('notify_on', { length: 12 }).notNull().default('both'),
    /**
     * Scope. NULL means the zone applies to the whole fleet — a depot is not
     * per-vehicle, but a customer site assigned to one driver is. Set both and
     * the zone only fires for that vehicle while that driver is assigned.
     */
    vehicleId: uuid('vehicle_id').references(() => vehicles.id, { onDelete: 'cascade' }),
    driverId: uuid('driver_id').references(() => drivers.id, { onDelete: 'cascade' }),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [index('geofence_customer_idx').on(table.customerId)]
);

/**
 * Last known inside/outside verdict per vehicle per zone.
 *
 * A crossing is a *change* of containment, which cannot be read from a single
 * fix — the previous verdict has to be durable. Kept in a table rather than in
 * memory (as the idle detector does) because a missed crossing is a missed
 * alert about a vehicle leaving a site, and a process restart must not silently
 * swallow one.
 */
export const geofenceStates = pgTable(
  'geofence_states',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    geofenceId: uuid('geofence_id')
      .notNull()
      .references(() => geofences.id, { onDelete: 'cascade' }),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    inside: boolean('inside').notNull(),
    changedAt: timestamp('changed_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    uniqueIndex('geofence_state_zone_vehicle_idx').on(table.geofenceId, table.vehicleId),
  ]
);

/**
 * One row per time a vehicle went inside a watched fuel station's zone.
 *
 * `stoppedAt` is what separates a visit from a drive-by: forecourts sit on
 * the road, so a zone around one catches every vehicle that passes it. Only
 * a vehicle that stood still inside for a minute is announced to the manager;
 * the rest stay in the log as passes.
 */
export const fuelStationVisits = pgTable(
  'fuel_station_visits',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    geofenceId: uuid('geofence_id')
      .notNull()
      .references(() => geofences.id, { onDelete: 'cascade' }),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    driverName: varchar('driver_name', { length: 255 }),
    enteredAt: timestamp('entered_at').notNull(),
    stoppedAt: timestamp('stopped_at'),
    exitedAt: timestamp('exited_at'),
  },
  (table) => [
    index('fuel_station_visits_customer_entered_idx').on(table.customerId, table.enteredAt),
    uniqueIndex('fuel_station_visits_open_idx')
      .on(table.geofenceId, table.vehicleId)
      .where(sql`exited_at IS NULL`),
  ]
);

/**
 * Roadworthiness and licence papers, one row per certificate.
 *
 * The "VIO" a Nigerian fleet means is the vehicle licence a state's Vehicle
 * Inspection Office issues — the paper a checkpoint asks for, and the one a
 * fleet gets fined over when it lapses. The fields mirror the printed stub:
 * owner, reg and chassis numbers, make and model, the issuing state, and the
 * two dates. A manager photographs the paper; OCR fills these in and the
 * manager corrects whatever the photo garbled before saving.
 *
 * `expires_on` is the whole point. The expiry sweep raises an alert a week
 * before it and again the day it passes, and the two `*_alert_sent_at`
 * columns are what stop a nightly sweep raising the same alert nightly.
 */
export const CERTIFICATE_KINDS = ['vio'] as const;
export type CertificateKind = (typeof CERTIFICATE_KINDS)[number];

export const vehicleCertificates = pgTable(
  'vehicle_certificates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    vehicleId: uuid('vehicle_id').references(() => vehicles.id, { onDelete: 'cascade' }),
    driverId: uuid('driver_id').references(() => drivers.id, { onDelete: 'set null' }),
    kind: varchar('kind', { length: 20 }).notNull().default('vio'),
    ownerName: varchar('owner_name', { length: 255 }),
    ownerAddress: text('owner_address'),
    fileNumber: varchar('file_number', { length: 80 }),
    registrationNumber: varchar('registration_number', { length: 40 }),
    engineNumber: varchar('engine_number', { length: 80 }),
    chassisNumber: varchar('chassis_number', { length: 80 }),
    vehicleMake: varchar('vehicle_make', { length: 80 }),
    vehicleModel: varchar('vehicle_model', { length: 80 }),
    vehicleType: varchar('vehicle_type', { length: 80 }),
    /** The state whose Vehicle Inspection Office issued it — the "location". */
    issuingState: varchar('issuing_state', { length: 80 }),
    issuedOn: date('issued_on'),
    expiresOn: date('expires_on').notNull(),
    /** Compressed data URL, the same storage as receipt and licence photos. */
    imageUrl: text('image_url'),
    ocrText: text('ocr_text'),
    expiryAlertSentAt: timestamp('expiry_alert_sent_at'),
    expiredAlertSentAt: timestamp('expired_alert_sent_at'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => [
    index('vehicle_certificates_customer_expires_idx').on(t.customerId, t.expiresOn),
  ]
);

/**
 * Every service actually done, one row each. A schedule only remembers its
 * most recent completion; this is the record behind it — what was done, at
 * what mileage, what it cost and where — so a vehicle's history survives the
 * schedule being edited or removed.
 */
export const maintenanceLogs = pgTable(
  'maintenance_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    scheduleId: uuid('schedule_id').references(() => maintenanceSchedules.id, { onDelete: 'set null' }),
    kind: varchar('kind', { length: 40 }).notNull(),
    doneAt: timestamp('done_at').notNull(),
    odometerKm: integer('odometer_km'),
    costNgn: integer('cost_ngn'),
    garage: varchar('garage', { length: 160 }),
    notes: text('notes'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (t) => [index('maintenance_logs_vehicle_done_idx').on(t.vehicleId, t.doneAt)]
);

/**
 * FuelBrain conversations. Owned by whoever asked — the account holder (no
 * fleet_users row) or a fleet user — so two managers on one fleet never see
 * each other's chats. Only the text of each turn is kept; tool traffic is
 * re-fetched on the next question rather than replayed stale.
 */
export const fuelbrainSessions = pgTable(
  'fuelbrain_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => fleetUsers.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 120 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [index('fuelbrain_sessions_owner_idx').on(t.customerId, t.updatedAt)]
);

export const fuelbrainMessages = pgTable(
  'fuelbrain_messages',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => fuelbrainSessions.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 10 }).notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('fuelbrain_messages_session_idx').on(t.sessionId, t.id)]
);

/** Tokens each FuelBrain question cost, for the per-fleet monthly allowance. */
export const fuelbrainUsage = pgTable(
  'fuelbrain_usage',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => fleetUsers.id, { onDelete: 'set null' }),
    /** Lagos calendar month, 'YYYY-MM'. */
    month: varchar('month', { length: 7 }).notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('fuelbrain_usage_customer_month_idx').on(t.customerId, t.month)]
);

/**
 * Things FuelBrain proposed doing outside the chat — today, an email to a
 * driver. The model only ever drafts one; nothing leaves until the manager
 * presses Send on the card, which is what moves `status` off 'pending'.
 */
export const fuelbrainActions = pgTable(
  'fuelbrain_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => fleetUsers.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').references(() => fuelbrainSessions.id, { onDelete: 'cascade' }),
    /** The assistant reply the card sits under. */
    messageId: bigint('message_id', { mode: 'number' }).references(() => fuelbrainMessages.id, {
      onDelete: 'cascade',
    }),
    kind: varchar('kind', { length: 30 }).notNull(),
    driverId: uuid('driver_id').references(() => drivers.id, { onDelete: 'set null' }),
    toEmail: varchar('to_email', { length: 255 }).notNull(),
    subject: varchar('subject', { length: 200 }).notNull(),
    body: text('body').notNull(),
    status: varchar('status', { length: 12 }).notNull().default('pending'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    decidedAt: timestamp('decided_at'),
  },
  (t) => [index('fuelbrain_actions_customer_idx').on(t.customerId, t.createdAt)]
);
