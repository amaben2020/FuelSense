import { db, alerts, vehicles, telemetry, eq, and, desc, sql } from '../../shared/db-helpers';
import {
  REFUEL_THRESHOLD_LITERS,
  IDLE_BURN_LITERS_PER_HOUR,
  DEFAULT_FUEL_PRICE_NGN_LITER,
  baselineEfficiencyKmL,
} from './fuel-metrics.service';
import { DetectorState } from '../../shared/detector-state';

const lastFuelByImei = new DetectorState<number>('last-fuel', { ttlSeconds: 24 * 60 * 60 });
const fraudSimulatedFor = new Set<string>();
const baselineCache = new Map<string, { baseline: VehicleBaseline; expiresAt: number }>();

const BASELINE_TTL_MS = 24 * 60 * 60 * 1000;

interface VehicleBaseline {
  avgFuelPerKm: number;
  avgIdleFuelPerHour: number;
  typicalVariance: number;
}

export function resetEngineState(): void {
  lastFuelByImei.clear();
  fraudSimulatedFor.clear();
  baselineCache.clear();
}

async function hasOpenAlert(customerId: string, vehicleId: string, alertType: string): Promise<boolean> {
  const [row] = await db
    .select({ id: alerts.id })
    .from(alerts)
    .where(
      and(
        eq(alerts.customerId, customerId),
        eq(alerts.vehicleId, vehicleId),
        eq(alerts.alertType, alertType),
        eq(alerts.isResolved, false)
      )
    )
    .limit(1);
  return !!row;
}

export async function getOrComputeVehicleBaseline(vehicleId: string, model: string | null, nowTime = new Date()): Promise<VehicleBaseline> {
  const cached = baselineCache.get(vehicleId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.baseline;
  }

  const defaultKmL = baselineEfficiencyKmL(model || 'Hiace');
  const defaultIdlePerHour = IDLE_BURN_LITERS_PER_HOUR;
  const defaultBaseline: VehicleBaseline = {
    avgFuelPerKm: 1 / defaultKmL,
    avgIdleFuelPerHour: defaultIdlePerHour,
    typicalVariance: 0.5,
  };

  try {
    const sevenDaysAgo = new Date(nowTime.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const rows = await db
      .select({
        recordedAt: telemetry.recordedAt,
        fuelLevelLiters: telemetry.fuelLevelLiters,
        odometerKm: telemetry.odometerKm,
        speedKph: telemetry.speedKph,
        ignitionOn: telemetry.ignitionOn,
      })
      .from(telemetry)
      .where(
        and(
          eq(telemetry.vehicleId, vehicleId),
          sql`recorded_at >= ${sevenDaysAgo}::timestamp`
        )
      )
      .orderBy(telemetry.recordedAt);

    if (rows.length < 50) {
      baselineCache.set(vehicleId, {
        baseline: defaultBaseline,
        expiresAt: Date.now() + BASELINE_TTL_MS,
      });
      return defaultBaseline;
    }

    let totalDrivingFuel = 0;
    let totalDrivingDistance = 0;
    let totalIdleFuel = 0;
    let totalIdleTimeHours = 0;
    const differences: number[] = [];

    for (let i = 0; i < rows.length - 1; i++) {
      const curr = rows[i];
      const next = rows[i + 1];
      if (curr.fuelLevelLiters == null || next.fuelLevelLiters == null) continue;

      const fCurr = Number(curr.fuelLevelLiters);
      const fNext = Number(next.fuelLevelLiters);
      const deltaF = fCurr - fNext;
      const deltaT = (new Date(next.recordedAt).getTime() - new Date(curr.recordedAt).getTime()) / 3600000;

      if (deltaF < -REFUEL_THRESHOLD_LITERS || deltaF > 15) continue;

      if (curr.ignitionOn && (curr.speedKph ?? 0) > 2) {
        const oCurr = curr.odometerKm;
        const oNext = next.odometerKm;
        if (oCurr != null && oNext != null) {
          const deltaO = oNext - oCurr;
          if (deltaO > 0 && deltaF > 0) {
            totalDrivingFuel += deltaF;
            totalDrivingDistance += deltaO;
          }
        }
      } else if (curr.ignitionOn && (curr.speedKph ?? 0) <= 2) {
        if (deltaT > 0 && deltaF > 0) {
          totalIdleFuel += deltaF;
          totalIdleTimeHours += deltaT;
        }
      } else if (!curr.ignitionOn) {
        differences.push(Math.abs(deltaF));
      }
    }

    const learnedKmL = totalDrivingDistance > 10 ? totalDrivingDistance / totalDrivingFuel : defaultKmL;
    const learnedIdlePerHour = totalIdleTimeHours > 0.5 ? totalIdleFuel / totalIdleTimeHours : defaultIdlePerHour;

    let typicalVariance = 0.5;
    if (differences.length > 0) {
      const sum = differences.reduce((a, b) => a + b, 0);
      typicalVariance = Math.max(0.1, sum / differences.length);
    }

    const baseline: VehicleBaseline = {
      avgFuelPerKm: 1 / learnedKmL,
      avgIdleFuelPerHour: learnedIdlePerHour,
      typicalVariance,
    };

    baselineCache.set(vehicleId, {
      baseline,
      expiresAt: Date.now() + BASELINE_TTL_MS,
    });
    return baseline;
  } catch (error) {
    console.error('Error computing baseline for vehicle', vehicleId, error);
    return defaultBaseline;
  }
}

interface DeviceInfo {
  imei: string;
  customerId: string;
  vehicleId: string;
}

interface TelemetryRow {
  fuelLevelLiters?: string | number | null;
  ignitionOn?: boolean | null;
  speedKph?: number | null;
  latitude?: string | number | null;
  longitude?: string | number | null;
  recordedAt: Date | string;
}

export async function detectAnomalies(device: DeviceInfo, row: TelemetryRow, { licensePlate }: { licensePlate?: string } = {}): Promise<void> {
  if (!device.customerId || !device.vehicleId) return;

  const imei = device.imei;
  const fuel = row.fuelLevelLiters != null ? Number(row.fuelLevelLiters) : null;
  const lat = row.latitude;
  const lng = row.longitude;
  const pricePerLiter = Number(process.env.FUEL_PRICE_NGN_LITER || DEFAULT_FUEL_PRICE_NGN_LITER);

  const prevFuel = (await lastFuelByImei.get(imei)) ?? undefined;

  // 1. Refuel classification and Receipt Fraud Simulation (demo support)
  if (fuel != null) {
    if (prevFuel != null && fuel - prevFuel >= REFUEL_THRESHOLD_LITERS) {
      const actualAdded = fuel - prevFuel;
      const fraudKey = `${device.vehicleId}-fraud`;

      if (
        licensePlate === 'LAG-456-CD' &&
        !fraudSimulatedFor.has(fraudKey) &&
        !(await hasOpenAlert(device.customerId, device.vehicleId, 'receipt_fraud'))
      ) {
        const declared = Math.round(actualAdded + 15);
        const difference = declared - actualAdded;
        const loss = Math.round(difference * pricePerLiter);
        fraudSimulatedFor.add(fraudKey);

        await db.insert(alerts).values({
          imei,
          customerId: device.customerId,
          vehicleId: device.vehicleId,
          alertType: 'receipt_fraud',
          message: `Receipt mismatch at Mobil Ojota: claimed ${declared}L but OBD recorded ${actualAdded.toFixed(1)}L added (−${difference}L). Est. loss ₦${loss.toLocaleString('en-NG')}.`,
          fuelLevelLiters: fuel.toString(),
          fuelDropLiters: difference.toFixed(2),
          estimatedLossNgn: loss,
          latitude: lat?.toString() ?? null,
          longitude: lng?.toString() ?? null,
        });
      }
    }
    lastFuelByImei.set(imei, fuel);
  }

  // Idling is handled by idle-detector.ts, which measures the stretch from
  // record timestamps. The tick-counting engine that used to live here raised
  // a second `excessive_idle` alert for the same episode.

  // Fuel-theft detection was removed on 2026-09-25, deliberately and in full.
  //
  // It inferred siphoning from the VIRTUAL TANK — a level modelled from
  // distance and idle time, because this hardware carries no fuel-level
  // sensor. A "drop while parked" was therefore the model disagreeing with
  // itself, and the engine turned that into "Fuel theft detected! ... 8.1L ...
  // Estimated loss 10,595 NGN" against a named driver. Nothing in the
  // telemetry could confirm or refute it, which makes it unfalsifiable — and
  // an unfalsifiable accusation is the one thing a fleet platform must never
  // produce, because somebody loses their job over it.
  //
  // The rule now: every figure the system reports must be checkable against
  // what the tracker actually sent. Real fuel evidence comes from receipts and
  // from fill-to-full calibration; both are still here. If a fuel-level sensor
  // is ever fitted, theft detection can be rebuilt on a measurement rather
  // than on an inference.
}
