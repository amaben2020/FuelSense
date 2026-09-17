// Refuel planning: the three questions a manager funding a fleet actually
// asks about each driver. When did they last buy fuel (the receipt, not the
// model)? How far have they driven since? When will they be back asking for
// money, and roughly how much?
//
// Only the first is measured. Distance since the receipt is odometer/GPS
// (good to a few percent). "Tank now" is the modelled level — distance times
// the vehicle's rate, anchored by receipts — and the date is that level over
// the last two weeks' daily average. Where a vehicle has enough receipts, the
// gap between them is a second opinion that needs no model at all, and the
// response carries both so the table can say which it is leaning on.
import { db, sql } from './db-helpers';
import { round1, DEFAULT_FUEL_PRICE_NGN_LITER } from './fuel-metrics';
import { localDate, distanceDeltasCte } from './telemetry-deltas-sql';
import { latestReceiptPrice } from './fuel-price';
import { RESERVE_LITERS_DEFAULT } from './virtual-tank';

const DAILY_WINDOW_DAYS = 14;
const RECEIPT_LOOKBACK_DAYS = 90;

export async function buildRefuelPlanning(customerId: string) {
  const price = await latestReceiptPrice(customerId).catch(() => null);
  const pricePerLiter = price?.ngnPerLiter ?? DEFAULT_FUEL_PRICE_NGN_LITER;

  const rows = await db.execute(sql`
    WITH ${distanceDeltasCte({ customerId, days: RECEIPT_LOOKBACK_DAYS })},
    last_receipt AS (
      SELECT DISTINCT ON (vehicle_id)
        vehicle_id, id AS receipt_id, transaction_date, uploaded_at, declared_liters, total_amount,
        price_per_liter, merchant_name, reconciliation_status, driver_id AS receipt_driver_id
      FROM fuel_receipts
      WHERE customer_id = ${customerId}
      ORDER BY vehicle_id, transaction_date DESC
    ),
    recent AS (
      SELECT
        vehicle_id, declared_liters, total_amount,
        EXTRACT(EPOCH FROM (transaction_date - LAG(transaction_date) OVER (
          PARTITION BY vehicle_id ORDER BY transaction_date
        ))) / 86400.0 AS gap_days,
        ROW_NUMBER() OVER (PARTITION BY vehicle_id ORDER BY transaction_date DESC) AS rn
      FROM fuel_receipts
      WHERE customer_id = ${customerId}
        AND transaction_date >= NOW() - (${RECEIPT_LOOKBACK_DAYS} || ' days')::INTERVAL
    ),
    cadence AS (
      SELECT
        vehicle_id,
        COUNT(*)::int AS receipts,
        AVG(gap_days) AS avg_gap_days,
        AVG(declared_liters) AS avg_liters,
        AVG(total_amount) AS avg_amount,
        SUM(CASE WHEN rn <= 100 THEN total_amount END) AS spend_window
      FROM recent
      WHERE rn <= 6
      GROUP BY vehicle_id
    ),
    month AS (
      SELECT vehicle_id, COUNT(*)::int AS receipts_30d,
             SUM(declared_liters) AS liters_30d, SUM(total_amount) AS spend_30d
      FROM fuel_receipts
      WHERE customer_id = ${customerId} AND transaction_date >= NOW() - INTERVAL '30 days'
      GROUP BY vehicle_id
    ),
    since AS (
      SELECT d.vehicle_id, SUM(d.dist_delta) AS km_since, SUM(d.idle_delta_s) AS idle_s_since
      FROM deltas d
      JOIN last_receipt r ON r.vehicle_id = d.vehicle_id
      WHERE d.recorded_at > r.transaction_date
      GROUP BY d.vehicle_id
    ),
    daily AS (
      SELECT vehicle_id, SUM(dist_delta) AS km_window,
             COUNT(DISTINCT CASE WHEN dist_delta > 0 THEN ${localDate} END)::int AS active_days
      FROM deltas
      WHERE recorded_at >= NOW() - (${DAILY_WINDOW_DAYS} || ' days')::INTERVAL
      GROUP BY vehicle_id
    )
    SELECT
      v.id AS vehicle_id, v.license_plate, v.make, v.model,
      v.tank_capacity_liters, v.consumption_rate_l_per_100km, v.rate_source,
      COALESCE(dr.full_name, v.driver_name) AS driver_name, dr.id AS driver_id, dr.phone AS driver_phone,
      r.receipt_id, r.transaction_date, r.declared_liters, r.total_amount, r.price_per_liter,
      r.merchant_name, r.reconciliation_status,
      s.km_since, s.idle_s_since,
      dl.km_window, dl.active_days,
      c.receipts AS cadence_receipts, c.avg_gap_days, c.avg_liters, c.avg_amount,
      m.receipts_30d, m.liters_30d, m.spend_30d,
      vt.level_ml, vt.capacity_liters AS tank_capacity, vt.calibrated_at, vt.calibration_source,
      vt.last_reading_at, vt.anchor_level_ml,
      -- Rows anchored before anchored_at existed: whichever came later, the
      -- calibration or the last receipt credit (receipts credit on upload).
      COALESCE(vt.anchored_at, GREATEST(vt.calibrated_at, r.uploaded_at)) AS anchored_at,
      COALESCE(vt.anchor_source,
        CASE WHEN r.uploaded_at IS NOT NULL AND (vt.calibrated_at IS NULL OR r.uploaded_at > vt.calibrated_at)
             THEN 'receipt' ELSE vt.calibration_source END) AS anchor_source,
      odo_now.odometer_km AS odometer_now_km, odo_now.recorded_at AS odometer_now_at,
      odo_then.odometer_km AS odometer_at_receipt_km
    FROM vehicles v
    LEFT JOIN drivers dr ON dr.id = v.driver_id AND dr.customer_id = v.customer_id
    LEFT JOIN last_receipt r ON r.vehicle_id = v.id
    LEFT JOIN since s ON s.vehicle_id = v.id
    LEFT JOIN daily dl ON dl.vehicle_id = v.id
    LEFT JOIN cadence c ON c.vehicle_id = v.id
    LEFT JOIN month m ON m.vehicle_id = v.id
    LEFT JOIN virtual_tanks vt ON vt.vehicle_id = v.id
    LEFT JOIN LATERAL (
      SELECT COALESCE(t.odometer_m::double precision / 1000.0, t.odometer_km::double precision) AS odometer_km,
             t.recorded_at
      FROM telemetry t
      WHERE t.vehicle_id = v.id AND (t.odometer_m IS NOT NULL OR t.odometer_km IS NOT NULL)
      ORDER BY t.recorded_at DESC LIMIT 1
    ) odo_now ON TRUE
    LEFT JOIN LATERAL (
      SELECT COALESCE(t.odometer_m::double precision / 1000.0, t.odometer_km::double precision) AS odometer_km
      FROM telemetry t
      WHERE t.vehicle_id = v.id AND r.transaction_date IS NOT NULL
        AND t.recorded_at <= r.transaction_date
        AND (t.odometer_m IS NOT NULL OR t.odometer_km IS NOT NULL)
      ORDER BY t.recorded_at DESC LIMIT 1
    ) odo_then ON TRUE
    WHERE v.customer_id = ${customerId}
  `);

  const num = (v: unknown): number | null => (v == null ? null : Number(v));
  const now = Date.now();

  const vehicles = rows.rows.map((raw) => {
    const row = raw as Record<string, unknown>;
    const rate = num(row.consumption_rate_l_per_100km) || 14.3;
    const capacity = num(row.tank_capacity_liters) ?? num(row.tank_capacity);
    const levelL = row.level_ml != null ? Number(row.level_ml) / 1000 : null;
    const kmSince = num(row.km_since) ?? 0;
    const kmPerDay = row.km_window != null ? Number(row.km_window) / DAILY_WINDOW_DAYS : null;
    const lastAt = row.transaction_date ? new Date(String(row.transaction_date)) : null;
    const daysSince = lastAt ? (now - lastAt.getTime()) / 86_400_000 : null;

    // Litres left above the reserve, and how far that goes at this
    // vehicle's rate. Null when there is no tank row to read.
    const usableL = levelL != null ? Math.max(0, levelL - RESERVE_LITERS_DEFAULT) : null;
    const rangeKm = usableL != null ? (usableL / rate) * 100 : null;
    const daysByModel =
      rangeKm != null && kmPerDay != null && kmPerDay > 0.5 ? rangeKm / kmPerDay : null;

    // Receipt cadence: no model, just history. Only trusted with three or
    // more gaps, since two receipts a day apart say nothing about the next.
    const avgGap = num(row.avg_gap_days);
    const cadenceReceipts = num(row.cadence_receipts) ?? 0;
    const daysByCadence =
      avgGap != null && cadenceReceipts >= 3 && daysSince != null ? avgGap - daysSince : null;

    const basis: 'model' | 'cadence' | null =
      daysByModel != null ? 'model' : daysByCadence != null ? 'cadence' : null;
    const daysUntil = basis === 'model' ? daysByModel : basis === 'cadence' ? daysByCadence : null;
    const nextAt = daysUntil != null ? new Date(now + Math.max(0, daysUntil) * 86_400_000) : null;

    // What to have ready: what this driver usually buys, once there is a
    // pattern to read; a full tank otherwise. Nobody funds 40 litres for a
    // driver who has bought 12 at a time six times running.
    const litersToFill = capacity != null && levelL != null ? Math.max(0, capacity - levelL) : null;
    const typicalLiters = num(row.avg_liters);
    const typicalAmount = num(row.avg_amount);
    const fillCost = litersToFill != null ? Math.round(litersToFill * pricePerLiter) : null;
    const hasPattern = cadenceReceipts >= 3 && typicalAmount != null;
    const cashLiters = hasPattern ? typicalLiters : litersToFill;
    const cash = hasPattern ? Math.round(typicalAmount) : fillCost;

    const status: 'no_receipts' | 'overdue' | 'soon' | 'ok' | 'unknown' = !lastAt
      ? 'no_receipts'
      : daysUntil == null
        ? 'unknown'
        : daysUntil <= 0
          ? 'overdue'
          : daysUntil <= 3
            ? 'soon'
            : 'ok';

    // The working, laid out so a manager can check each step against the
    // dashboard's own odometer and the receipt in their hand.
    const odoNow = num(row.odometer_now_km);
    const odoThen = num(row.odometer_at_receipt_km);
    const anchorL = row.anchor_level_ml != null ? Number(row.anchor_level_ml) / 1000 : null;
    const calculation = {
      odometer_now_km: odoNow != null ? round1(odoNow) : null,
      odometer_now_at: row.odometer_now_at,
      odometer_at_refuel_km: odoThen != null ? round1(odoThen) : null,
      km_since_refuel: round1(kmSince),
      km_since_source: 'odometer/GPS hops, each capped at speed × time' as const,
      rate_l_per_100km: round1(rate),
      rate_mpg: round1(235.215 / rate),
      rate_source: (row.rate_source ?? 'preset') as string,
      liters_used_since_refuel: round1((kmSince * rate) / 100),
      anchor: {
        at: row.anchored_at,
        source: row.anchor_source,
        level_l: anchorL != null ? round1(anchorL) : null,
      },
      burned_since_anchor_l:
        anchorL != null && levelL != null ? round1(Math.max(0, anchorL - levelL)) : null,
      level_now_l: levelL != null ? round1(levelL) : null,
      reserve_l: RESERVE_LITERS_DEFAULT,
      usable_l: usableL != null ? round1(usableL) : null,
      range_km: rangeKm != null ? Math.round(rangeKm) : null,
      km_per_day: kmPerDay != null ? round1(kmPerDay) : null,
      days_by_model: daysByModel != null ? round1(daysByModel) : null,
      days_by_cadence: daysByCadence != null ? round1(daysByCadence) : null,
      price_per_liter_ngn: pricePerLiter,
    };

    return {
      vehicle_id: row.vehicle_id,
      license_plate: row.license_plate,
      make: row.make,
      model: row.model,
      driver_id: row.driver_id,
      driver_name: row.driver_name ?? 'Unassigned',
      driver_phone: row.driver_phone,
      last_refuel: lastAt
        ? {
            receipt_id: row.receipt_id,
            at: lastAt.toISOString(),
            days_ago: round1(daysSince ?? 0),
            liters: round1(num(row.declared_liters) ?? 0),
            amount_ngn: num(row.total_amount),
            price_per_liter: num(row.price_per_liter),
            merchant: row.merchant_name,
            status: row.reconciliation_status,
          }
        : null,
      since_refuel: lastAt
        ? {
            km: round1(kmSince),
            idle_hours: round1((num(row.idle_s_since) ?? 0) / 3600),
            fuel_used_l: round1((kmSince * rate) / 100),
          }
        : null,
      tank: {
        level_l: levelL != null ? round1(levelL) : null,
        capacity_l: capacity,
        percent:
          levelL != null && capacity ? Math.round((levelL / capacity) * 100) : null,
        range_km: rangeKm != null ? Math.round(rangeKm) : null,
        rate_l_per_100km: round1(rate),
        rate_source: row.rate_source ?? 'preset',
        calibrated_at: row.calibrated_at,
        last_reading_at: row.last_reading_at,
      },
      usage: {
        km_per_day: kmPerDay != null ? round1(kmPerDay) : null,
        active_days: num(row.active_days) ?? 0,
        window_days: DAILY_WINDOW_DAYS,
      },
      next_refuel: {
        status,
        basis,
        in_days: daysUntil != null ? round1(daysUntil) : null,
        at: nextAt ? nextAt.toISOString() : null,
        /** Money to have ready: the driver's usual purchase, or a fill-up when there is no pattern yet. */
        cash_liters: cashLiters != null ? round1(cashLiters) : null,
        cash_ngn: cash,
        cash_basis: hasPattern ? ('typical' as const) : ('fill' as const),
        fill_liters: litersToFill != null ? round1(litersToFill) : null,
        fill_cost_ngn: fillCost,
        avg_gap_days: avgGap != null && cadenceReceipts >= 3 ? round1(avgGap) : null,
      },
      calculation,
      last_30_days: {
        receipts: num(row.receipts_30d) ?? 0,
        liters: round1(num(row.liters_30d) ?? 0),
        spend_ngn: Math.round(num(row.spend_30d) ?? 0),
      },
    };
  });

  const order = { overdue: 0, soon: 1, unknown: 2, ok: 3, no_receipts: 4 };
  vehicles.sort((a, b) => {
    const d = order[a.next_refuel.status] - order[b.next_refuel.status];
    if (d) return d;
    return (a.next_refuel.in_days ?? 1e9) - (b.next_refuel.in_days ?? 1e9);
  });

  const dueWithin = (days: number) =>
    vehicles.filter((v) => v.next_refuel.in_days != null && v.next_refuel.in_days <= days);
  return {
    generated_at: new Date().toISOString(),
    price_per_liter_ngn: pricePerLiter,
    price_source: price ? 'latest_receipt' : 'default',
    reserve_liters: RESERVE_LITERS_DEFAULT,
    summary: {
      vehicles: vehicles.length,
      due_now: vehicles.filter((v) => v.next_refuel.status === 'overdue').length,
      due_this_week: dueWithin(7).length,
      cash_needed_this_week_ngn: dueWithin(7).reduce((s, v) => s + (v.next_refuel.cash_ngn ?? 0), 0),
      spend_30d_ngn: vehicles.reduce((s, v) => s + v.last_30_days.spend_ngn, 0),
      liters_30d: round1(vehicles.reduce((s, v) => s + v.last_30_days.liters, 0)),
      no_receipts: vehicles.filter((v) => v.next_refuel.status === 'no_receipts').length,
    },
    vehicles,
  };
}
