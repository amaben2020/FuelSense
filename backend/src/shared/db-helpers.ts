import { db } from '../config/db';
import {
  customers,
  drivers,
  vehicles,
  devices,
  telemetry,
  deviceFrames,
  deviceEvents,
  alerts,
  odometerAudit,
  fuelPurchases,
  fuelReceipts,
  siphonEvents,
  payments,
  deviceOrders,
  placeCache,
  featureFlags,
  notificationPreferences,
  fuelPrices,
  vehicleCertificates,
} from '../config/db/schema';
import { eq, and, desc, sql, isNull, inArray } from 'drizzle-orm';
import { serializeForApi } from './serialize';
import {
  DEFAULT_VEHICLE_TYPE,
  isVehicleType,
  presetForVehicleType,
} from '../features/fuel/fuel-metrics.service';
import {
  catalogueSpec,
  resolveVehicleSpec,
  tankLitersFor,
  yearInRange,
} from '../features/vehicles/vehicle-catalogue.service';

export const IMEI_PATTERN = /^\d{15}$/;

interface LinkDeviceParams {
  imei: string;
  vehicleId: string;
  customerId: string;
  deviceModel?: string;
}

type AnyTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export const linkDevice = async (tx: AnyTx, { imei, vehicleId, customerId, deviceModel = 'FMC150' }: LinkDeviceParams): Promise<void> => {
  if (!IMEI_PATTERN.test(imei || '')) {
    throw Object.assign(new Error('IMEI must be exactly 15 digits'), { status: 400 });
  }

  const [existingDevice] = await (tx as typeof db)
    .select({ customerId: devices.customerId })
    .from(devices)
    .where(eq(devices.imei, imei))
    .for('update');

  if (existingDevice) {
    if (existingDevice.customerId !== customerId) {
      throw Object.assign(new Error('Device is registered to another account'), { status: 409 });
    }

    await (tx as typeof db)
      .update(devices)
      .set({
        vehicleId,
        customerId,
        isActive: true,
        deviceModel,
        updatedAt: sql`NOW()`,
      })
      .where(eq(devices.imei, imei));
    return;
  }

  await (tx as typeof db).insert(devices).values({
    imei,
    vehicleId,
    customerId,
    deviceModel,
  });
};

interface CreateVehicleParams {
  licensePlate: string;
  make?: string;
  model?: string;
  year?: number;
  tankCapacityLiters?: number;
  /** Dashboard reading at onboarding, in km. The tracker only counts distance
   *  from the day it is fitted, so without this we can never show true mileage.
   *  `odometer_baseline_device_km` is left null and resolves from the vehicle's
   *  first telemetry reading, which correctly handles a previously-used tracker
   *  whose internal counter is already non-zero. */
  odometerBaselineKm?: number;
  /** Vehicle class. Seeds the starting fuel figures; measured fill-to-fill data
   *  replaces them once enough purchases are logged. */
  vehicleType?: string;
}

export const createVehicle = async (
  tx: AnyTx,
  customerId: string,
  {
    licensePlate,
    make,
    model,
    year,
    tankCapacityLiters,
    odometerBaselineKm,
    vehicleType,
  }: CreateVehicleParams
): Promise<{
  id: string;
  license_plate: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  tank_capacity_liters: number | null;
}> => {
  if (!licensePlate?.trim()) {
    throw Object.assign(new Error('License plate is required'), { status: 400 });
  }
  const bad = (message: string) => Object.assign(new Error(message), { status: 400 });

  // Every figure that feeds the fuel model is checked here, not trusted from
  // the form: a tank of 0 L makes the gauge divide by zero, a tank of 6000 L
  // (a typo for 60) makes every fill look like a 1% top-up, and a year the
  // model was never sold in picks the wrong generation's tank.
  const yearNum = year != null && year !== ('' as unknown) ? Number(year) : null;
  if (yearNum != null && (!Number.isInteger(yearNum) || yearNum < 1980 || yearNum > new Date().getFullYear() + 1)) {
    throw bad(`Year must be between 1980 and ${new Date().getFullYear() + 1}`);
  }
  const known = make && model ? catalogueSpec(make, model) : null;
  if (known && yearNum != null && !yearInRange(known, yearNum)) {
    throw bad(`${make} ${known.model} was sold from ${known.years[0]}; ${yearNum} is outside that range`);
  }
  const tankNum = tankCapacityLiters != null && tankCapacityLiters !== ('' as unknown) ? Number(tankCapacityLiters) : null;
  if (tankNum != null && (!Number.isFinite(tankNum) || tankNum < 20 || tankNum > 600)) {
    throw bad('Tank capacity must be between 20 and 600 litres');
  }
  if (known && tankNum != null) {
    // A manager may fit a long-range tank or disconnect a sub-tank, so a
    // different figure is allowed — but not one that cannot be the same
    // vehicle. Half or double the catalogue size is a typo, not a variant.
    const expected = tankLitersFor(known, yearNum).tankLiters;
    if (tankNum < expected * 0.5 || tankNum > expected * 2) {
      throw bad(
        `${tankNum} L does not look right for a ${yearNum ?? ''} ${make} ${known.model} — the manufacturer figure is ${expected} L. Leave it blank to use that, or enter a value within half to double of it.`
      );
    }
  }
  const odoNum = odometerBaselineKm != null && odometerBaselineKm !== ('' as unknown) ? Number(odometerBaselineKm) : null;
  if (odoNum != null && (!Number.isFinite(odoNum) || odoNum < 0 || odoNum > 2_000_000)) {
    throw bad('Odometer must be between 0 and 2,000,000 km');
  }

  // Seeded from the actual make and model where we know it, and only from the
  // class average where we do not.
  //
  // The class average alone was a poor start: a RAV4 and a Land Cruiser are
  // both "SUV / pickup" and burn 11.8 and 18.5 L/100 km respectively, so a new
  // vehicle spent its first weeks wrong by up to 50% in a direction nobody
  // could predict. Calibration still overwrites all of this once real fill-ups
  // exist — this only makes day one defensible.
  const fallbackType = isVehicleType(vehicleType) ? vehicleType : DEFAULT_VEHICLE_TYPE;
  const fallback = presetForVehicleType(fallbackType);
  const spec = resolveVehicleSpec(make, model, yearNum, {
    type: fallbackType,
    consumptionL100km: fallback.consumptionL100km,
    idleBurnLph: fallback.idleBurnLph,
  });

  const resolvedType = spec.type;
  const preset = {
    consumptionL100km: spec.consumptionL100km,
    idleBurnLph: spec.idleBurnLph,
  };

  const [vehicle] = await (tx as typeof db)
    .insert(vehicles)
    .values({
      customerId,
      licensePlate: licensePlate.trim().toUpperCase(),
      make: make?.trim() || null,
      model: model?.trim() || null,
      year: yearNum,
      // The manager's own figure wins; the catalogue only fills a blank —
      // with the size for that year's generation, not a model-wide average.
      tankCapacityLiters: tankNum ?? (spec.tankLiters || null),
      odometerBaselineKm: odoNum != null ? Math.round(odoNum) : null,
      odometerBaselineAt: odoNum != null ? sql`NOW()` : null,
      vehicleType: resolvedType,
      consumptionRateL100km: preset.consumptionL100km.toFixed(2),
      idleBurnRateLph: preset.idleBurnLph.toFixed(2),
      rateSource: spec.matched ? 'catalogue' : 'preset',
    })
    .returning({
      id: vehicles.id,
      license_plate: vehicles.licensePlate,
      make: vehicles.make,
      model: vehicles.model,
      year: vehicles.year,
      tank_capacity_liters: vehicles.tankCapacityLiters,
    });

  return vehicle;
};

export const customerPublicSelect = {
  id: customers.id,
  name: customers.name,
  email: customers.email,
  company_name: customers.companyName,
  // White-label: every surface that shows a mark reads these, falling back to
  // FuelSense branding when a customer has not supplied their own.
  logo_url: customers.logoUrl,
  brand_color: customers.brandColor,
  white_label: customers.whiteLabel,
  subscription_status: customers.subscriptionStatus,
  onboarding_completed: customers.onboardingCompleted,
  created_at: customers.createdAt,
};

export {
  serializeForApi,
  db,
  customers,
  drivers,
  vehicles,
  devices,
  telemetry,
  deviceFrames,
  deviceEvents,
  alerts,
  odometerAudit,
  fuelPurchases,
  fuelReceipts,
  siphonEvents,
  payments,
  deviceOrders,
  placeCache,
  featureFlags,
  notificationPreferences,
  fuelPrices,
  vehicleCertificates,
  eq,
  and,
  desc,
  sql,
  inArray,
  isNull,
};
