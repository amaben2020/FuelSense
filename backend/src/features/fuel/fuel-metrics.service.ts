import { epaHighwayFactor } from '../vehicles/vehicle-epa-economy.service';

/**
 * km/L baselines for Nigerian city conditions — NOT manufacturer combined-cycle
 * figures, which are measured on smooth roads at steady speeds with the AC off
 * and flatter every vehicle here by 30-40%.
 *
 * These assume what the fleet actually drives in: stop-start gridlock, potholed
 * surfaces that force low gears, and the AC running permanently (a 10-15% fuel
 * penalty on its own). Holding vehicles to a brochure number makes every driver
 * look wasteful and makes real theft impossible to see against the noise.
 */
/**
 * Telemetry rows that re-anchor the fuel model rather than measure it.
 *
 * `calibration` is a manager saying "the tank holds this much now";
 * `receipt` is a verified fill being credited; `odometer_gap` is fuel booked
 * for distance the tracker never saw, found when the manager re-reads the
 * dashboard odometer. Both write a level step into the
 * series so the dashboard curve moves at the moment it happens, and neither is
 * fuel the engine burned.
 *
 * Every query deriving consumption from level deltas must skip these rows. The
 * consumption thresholds cannot catch them: a calibration from 29.95 L down to
 * 20 L is a 9.95 L drop, below the 12 L siphon guard and nothing like a 5 L
 * refuel rise, so it falls between the two and is booked as burn.
 *
 * Lives here rather than in `virtual-tank.ts` so the SQL helpers can import it
 * without pulling the tank engine (and its mailer and alert dependencies) into
 * a query builder.
 */
export const FUEL_MARKER_SOURCES = ['calibration', 'receipt', 'odometer_gap'] as const;

export type FuelMarkerSource = (typeof FUEL_MARKER_SOURCES)[number];

export const VEHICLE_EFFICIENCY: Record<string, { min: number; max: number; avg: number }> = {
  Corolla: { min: 8.0, max: 10.0, avg: 9.0 },
  Camry: { min: 7.0, max: 9.0, avg: 8.0 },
  RAV4: { min: 6.0, max: 8.0, avg: 7.0 },
  Hilux: { min: 6.0, max: 8.0, avg: 7.0 },
  Hiace: { min: 5.5, max: 7.0, avg: 6.2 },
};

const DEFAULT_EFFICIENCY = { min: 6.0, max: 8.5, avg: 7.2 };

/** Vehicle classes with their industry-average starting figures. These are only
 *  a seed: once a vehicle has enough logged fill-ups, its own measured rate
 *  replaces the preset entirely (see CALIBRATION_MIN_PURCHASES). */
export type VehicleType =
  | 'sedan'
  | 'suv_pickup'
  | 'van_bus'
  | 'medium_truck'
  | 'heavy_truck'
  | 'motorcycle';

export interface VehicleTypePreset {
  consumptionL100km: number;
  idleBurnLph: number;
  label: string;
}

// Kept consistent with VEHICLE_EFFICIENCY: a vehicle costed by its class must
// not disagree with the same vehicle costed by its model. Figures are city-
// traffic equivalents (sedan 11 L/100km ≈ 9 km/L, SUV 14.3 ≈ 7 km/L), not
// combined-cycle ratings.
export const VEHICLE_TYPE_PRESETS: Record<VehicleType, VehicleTypePreset> = {
  sedan: { consumptionL100km: 11, idleBurnLph: 0.9, label: 'Sedan' },
  suv_pickup: { consumptionL100km: 14.3, idleBurnLph: 1.2, label: 'SUV / Pickup' },
  van_bus: { consumptionL100km: 16, idleBurnLph: 1.4, label: 'Van / Bus' },
  medium_truck: { consumptionL100km: 26, idleBurnLph: 1.9, label: 'Medium truck' },
  heavy_truck: { consumptionL100km: 40, idleBurnLph: 2.8, label: 'Heavy truck' },
  motorcycle: { consumptionL100km: 3, idleBurnLph: 0.2, label: 'Motorcycle' },
};

export const DEFAULT_VEHICLE_TYPE: VehicleType = 'suv_pickup';

export function isVehicleType(value: unknown): value is VehicleType {
  return typeof value === 'string' && value in VEHICLE_TYPE_PRESETS;
}

export function presetForVehicleType(type: string | null | undefined): VehicleTypePreset {
  return VEHICLE_TYPE_PRESETS[isVehicleType(type) ? type : DEFAULT_VEHICLE_TYPE];
}

/** Fill-ups needed before a vehicle's measured rate replaces its class preset. */
export const CALIBRATION_MIN_PURCHASES = Number(process.env.CALIBRATION_MIN_PURCHASES || 2);

/**
 * Average trip speeds the two reference rates stand for. The EPA city cycle
 * averages ~34 km/h with frequent stops and its highway cycle ~78 km/h; Wialon's
 * sensorless "math consumption" model — the one most Teltonika fleets run —
 * pins its urban rate at 36 km/h and its suburban rate at 80 km/h. Below the
 * first a trip burns at the city rate (stop-start is already inside it, and
 * standing still with the engine on is charged separately as idle); above the
 * second at the highway rate; in between the rate slides linearly.
 */
export const URBAN_CYCLE_KPH = 36;
export const HIGHWAY_CYCLE_KPH = 80;

/**
 * Multiplier on a vehicle's city rate for a trip at this average speed.
 *
 * `highwayFactor` is the vehicle's highway burn over its city burn (EPA city
 * mpg ÷ highway mpg, ~0.77 for a 2013 RAV4). Null when the vehicle has no
 * highway rating — a model the EPA never rated, or a rate the manager read off
 * the trip computer, which already averages this vehicle's own mix — and then
 * no adjustment is invented.
 */
export function speedAdjustment(
  avgSpeedKph: number | null | undefined,
  highwayFactor: number | null | undefined
): number {
  if (highwayFactor == null || !(highwayFactor > 0)) return 1;
  if (avgSpeedKph == null || !Number.isFinite(avgSpeedKph) || avgSpeedKph <= URBAN_CYCLE_KPH) return 1;
  if (avgSpeedKph >= HIGHWAY_CYCLE_KPH) return round2(highwayFactor);
  const share = (avgSpeedKph - URBAN_CYCLE_KPH) / (HIGHWAY_CYCLE_KPH - URBAN_CYCLE_KPH);
  return round2(1 + (highwayFactor - 1) * share);
}

/** Which reference rate a trip's average speed puts it on, for display. */
export function speedAdjustmentLabel(
  avgSpeedKph: number | null | undefined,
  highwayFactor: number | null | undefined
): string | null {
  if (highwayFactor == null || avgSpeedKph == null || avgSpeedKph <= 0) return null;
  if (avgSpeedKph <= URBAN_CYCLE_KPH) return 'City';
  if (avgSpeedKph >= HIGHWAY_CYCLE_KPH) return 'Highway';
  return 'City–highway';
}

/**
 * Whether a vehicle's stored rate already contains its idling and its mix of
 * city and highway driving. A rate measured full-to-full from receipts does,
 * and so does a long-term average read off the vehicle's own trip computer;
 * charging speed and idle on top of either bills the same fuel twice. A
 * catalogue or class figure is a city driving rate and gets both.
 */
export function isAllInRate(rateSource: string | null | undefined): boolean {
  return rateSource === 'calibrated' || rateSource === 'manual';
}

/** The highway adjustment for a vehicle, or null when none applies. */
export function vehicleHighwayFactor(vehicle: {
  make: string | null | undefined;
  model: string | null | undefined;
  year: number | null | undefined;
  rateSource: string | null | undefined;
}): number | null {
  if (isAllInRate(vehicle.rateSource)) return null;
  return epaHighwayFactor(vehicle.make, vehicle.model, vehicle.year);
}

/**
 * Litres for one trip: distance at the vehicle's rate for the speed it was
 * driven at, plus idle burn for engine-on time standing still. An all-in rate
 * is distance times rate and nothing else.
 */
export function tripFuelLiters(params: {
  distanceKm: number;
  idleMinutes: number;
  avgSpeedKph: number | null | undefined;
  consumptionL100km: number;
  idleBurnLph: number;
  highwayFactor: number | null;
  allIn: boolean;
}): number {
  const driving = (params.distanceKm * params.consumptionL100km) / 100;
  if (params.allIn) return round1(driving);
  return round1(
    driving * speedAdjustment(params.avgSpeedKph, params.highwayFactor) +
      (params.idleMinutes / 60) * params.idleBurnLph
  );
}

export const CO2_KG_PER_LITER = 2.31;
export const REFUEL_THRESHOLD_LITERS = 5;
export const THEFT_DROP_THRESHOLD_LITERS = 12;
export const IDLE_BURN_LITERS_PER_HOUR = 0.9;
export const DEFAULT_FUEL_PRICE_NGN_LITER = 1300;

/**
 * Rough extra fuel one harsh acceleration, braking, cornering or overspeeding
 * event costs — a rule-of-thumb figure from telematics fuel-economy studies,
 * not a rate measured on this fleet. There is no honest way to derive a
 * per-event litre cost from GPS alone (no accelerometer-to-fuel-flow
 * telemetry exists for this hardware), so this is deliberately an estimate
 * and every figure it produces must say so.
 */
export const HARSH_EVENT_ESTIMATED_LITERS = Number(
  process.env.HARSH_EVENT_ESTIMATED_LITERS || 0.12
);

export function efficiencyProfileForModel(model: string): { min: number; max: number; avg: number } {
  return VEHICLE_EFFICIENCY[model] || DEFAULT_EFFICIENCY;
}

export function sampleEfficiencyKmL(model: string, seed = Math.random()): number {
  const profile = efficiencyProfileForModel(model);
  return profile.min + seed * (profile.max - profile.min);
}

export function fuelUsedForDistanceKm(distanceKm: number, efficiencyKmL: number): number {
  if (distanceKm <= 0 || efficiencyKmL <= 0) return 0;
  return distanceKm / efficiencyKmL;
}

export function idleFuelBurnLiters(intervalHours: number): number {
  return IDLE_BURN_LITERS_PER_HOUR * intervalHours;
}

export function isRefuelEvent(prevFuel: number | null, nextFuel: number | null): boolean {
  return nextFuel != null && prevFuel != null && nextFuel - prevFuel >= REFUEL_THRESHOLD_LITERS;
}

export function isTheftDrop(
  prevFuel: number | null,
  nextFuel: number | null,
  speedKph: number | null,
  ignitionOn: boolean | null
): boolean {
  if (prevFuel == null || nextFuel == null) return false;
  const drop = prevFuel - nextFuel;
  if (drop < THEFT_DROP_THRESHOLD_LITERS) return false;
  return !ignitionOn || (speedKph != null && speedKph < 2);
}

export function consumptionFromFuelDelta(
  prevFuel: number | null,
  nextFuel: number | null,
  speedKph: number | null,
  ignitionOn: boolean | null
): number {
  if (prevFuel == null || nextFuel == null) return 0;
  if (isRefuelEvent(prevFuel, nextFuel)) return 0;
  if (isTheftDrop(prevFuel, nextFuel, speedKph, ignitionOn)) return 0;
  if (nextFuel < prevFuel) return prevFuel - nextFuel;
  return 0;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function baselineEfficiencyKmL(model: string): number {
  return efficiencyProfileForModel(model).avg;
}

/** Liters per 100 km — standard Nigerian fleet metric (lower is better). */
export function computeL100km(fuelLiters: number, distanceKm: number): number | null {
  if (distanceKm <= 0 || fuelLiters < 0.5) return null;
  return round1((fuelLiters / distanceKm) * 100);
}

export function kmLToL100km(kmL: number | null): number | null {
  if (!kmL || kmL <= 0) return null;
  return round1(100 / kmL);
}

export function baselineEfficiencyL100km(model: string): number {
  return kmLToL100km(baselineEfficiencyKmL(model)) as number;
}

/** 1 km/L = 2.35215 miles per US gallon. */
export const KM_PER_LITER_TO_MPG = 2.35215;

/** 1 km/L = 2.82481 miles per imperial gallon (a UK gallon is ~20% larger). */
export const KM_PER_LITER_TO_MPG_IMPERIAL = 2.82481;

export function kmLToMpg(kmL: number | null): number | null {
  if (!kmL || kmL <= 0) return null;
  return round1(kmL * KM_PER_LITER_TO_MPG);
}

/**
 * Units a fleet manager might read off a dashboard.
 *
 * The unit is asked for rather than assumed, because "15 mpg" is ambiguous by
 * 20%: a US gallon is 3.785 L and an imperial gallon 4.546 L, so 15 mpg is
 * either 6.38 or 5.31 km/L depending on which market the vehicle was built
 * for. Guessing would put a fifth of an error into the one number the whole
 * fuel model is anchored on.
 */
export const ECONOMY_UNITS = ['mpg_us', 'mpg_imp', 'km_l', 'l_100km'] as const;

export type EconomyUnit = (typeof ECONOMY_UNITS)[number];

export const ECONOMY_UNIT_LABELS: Record<EconomyUnit, string> = {
  mpg_us: 'mpg (US)',
  mpg_imp: 'mpg (imperial)',
  km_l: 'km/L',
  l_100km: 'L/100 km',
};

export function isEconomyUnit(value: unknown): value is EconomyUnit {
  return typeof value === 'string' && (ECONOMY_UNITS as readonly string[]).includes(value);
}

/**
 * A dashboard economy reading, in whatever unit it was displayed in, converted
 * to the L/100 km the vehicle row stores. Returns null for values that cannot
 * describe a real vehicle, so a typo cannot silently re-anchor the fuel model.
 */
export function economyToL100km(value: number, unit: EconomyUnit): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;

  const kmPerLiter =
    unit === 'mpg_us'
      ? value / KM_PER_LITER_TO_MPG
      : unit === 'mpg_imp'
        ? value / KM_PER_LITER_TO_MPG_IMPERIAL
        : unit === 'km_l'
          ? value
          : 100 / value;

  // A vehicle doing under 1 km/L or over 50 km/L is a mistyped figure or the
  // wrong unit, not a fleet vehicle.
  if (!Number.isFinite(kmPerLiter) || kmPerLiter < 1 || kmPerLiter > 50) return null;

  return round2(100 / kmPerLiter);
}

export function l100kmToKmL(l100km: number | null): number | null {
  if (!l100km || l100km <= 0) return null;
  return round2(100 / l100km);
}

/** Positive % = worse (more fuel per 100 km than baseline). */
export function efficiencyDeviationPercentL100km(
  actualL100km: number | null,
  baselineL100km: number | null
): number | null {
  if (actualL100km == null || baselineL100km == null || baselineL100km <= 0) return null;
  return Math.round(((actualL100km - baselineL100km) / baselineL100km) * 1000) / 10;
}
