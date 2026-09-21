// Make / model / year specifications for the vehicles Nigerian fleets actually run.
//
// Why this exists: a new vehicle used to be seeded from its *class* — every SUV
// and pickup alike started at 14.3 L/100 km. A RAV4 and a Land Cruiser are both
// "SUV" and are nowhere near each other, so the first weeks of estimates for a
// new vehicle were wrong by a wide margin in a direction nobody could predict.
// Seeding from the actual model closes most of that gap on day one, before a
// single receipt has been logged.
//
// **These are still seeds, not truth.** Every figure here is a real-world
// city-traffic equivalent for a well-maintained example, and a specific vehicle
// will differ by its age, engine option, load and condition. Fill-to-fill
// calibration replaces them with a measured rate as soon as there is one — see
// `fuel-calibration.ts`. The catalogue's job is to make the first estimate
// defensible, not final.
//
// Figures are deliberately *city-biased* rather than combined-cycle
// manufacturer ratings, which are measured on a test loop no Lagos fleet will
// ever reproduce. A combined-cycle number seeded here would flatter every
// vehicle and make the first calibration look like a regression.

import { VehicleType } from '../fuel/fuel-metrics.service';

/**
 * A tank size that applies to one generation of a model.
 *
 * Tank sizes change between generations far more than consumption does — a
 * Camry went 70 → 64 → 60 L across three — so the litre figure is resolved by
 * year while the burn figures stay per model. Where a vehicle carries a
 * sub-tank that the main tank draws from automatically (Land Cruiser, Prado),
 * `tankLiters` is the TOTAL, because a fill to full at the pump fills both
 * and that total is what fill-to-full calibration measures against.
 */
export interface TankGeneration {
  years: [number, number];
  tankLiters: number;
  note?: string;
}

export interface VehicleModelSpec {
  model: string;
  /** Drives the class preset fallback and the body-class 3D illustration. */
  type: VehicleType;
  /** Litres for the model when no generation matches — a manager can override
   *  per vehicle. Prefer `tankLitersFor()`, which consults `tankByYear`. */
  tankLiters: number;
  /** Per-generation tank sizes, checked before `tankLiters`. Petrol figures;
   *  hybrids of the same model usually carry 10–15% less. */
  tankByYear?: TankGeneration[];
  /** L/100 km in mixed city traffic, not a combined-cycle rating. */
  consumptionL100km: number;
  /** L/h with the engine running and the vehicle stationary, AC on. */
  idleBurnLph: number;
  /** Generation range this spec applies to, inclusive. */
  years: [number, number];
  /** Set when a variant differs enough that one figure would mislead. */
  note?: string;
}

export interface VehicleMakeEntry {
  make: string;
  models: VehicleModelSpec[];
}

/**
 * Weighted to what actually runs in Nigerian fleets: Hiace and Sprinter buses,
 * Hilux and Navara pickups, Corolla and Camry saloons, and the Chinese and
 * Japanese trucks that do the heavy work. Anything absent falls back to
 * free-text entry plus a class preset, which is the old behaviour.
 */
export const VEHICLE_CATALOGUE: VehicleMakeEntry[] = [
  {
    make: 'Toyota',
    models: [
      // Tank sizes per generation are manufacturer (petrol) figures, cross-
      // checked 2026-09-21 against US-spec listings (autopadre, edmunds,
      // fueltankcap) and the model Wikipedia pages. Diesel and hybrid variants
      // of the same body can differ by a few litres; the manager's own figure
      // always wins over these.
      {
        model: 'Hiace', type: 'van_bus', tankLiters: 70, consumptionL100km: 13.5, idleBurnLph: 1.3, years: [2005, 2026],
        tankByYear: [{ years: [2005, 2026], tankLiters: 70, note: 'H200 and H300 both carry 70 L.' }],
      },
      {
        model: 'Hilux', type: 'suv_pickup', tankLiters: 80, consumptionL100km: 12.8, idleBurnLph: 1.2, years: [2005, 2026],
        tankByYear: [{ years: [2005, 2026], tankLiters: 80 }],
      },
      {
        model: 'Corolla', type: 'sedan', tankLiters: 50, consumptionL100km: 9.0, idleBurnLph: 0.8, years: [2003, 2026],
        // 13.2 US gal on every petrol generation since the E120.
        tankByYear: [{ years: [2003, 2026], tankLiters: 50, note: 'Hybrid variants carry 43 L.' }],
      },
      {
        model: 'Camry', type: 'sedan', tankLiters: 60, consumptionL100km: 10.5, idleBurnLph: 0.9, years: [2002, 2026],
        tankByYear: [
          { years: [2002, 2011], tankLiters: 70, note: 'XV30/XV40 — 18.5 US gal.' },
          { years: [2012, 2017], tankLiters: 64, note: 'XV50 — 17 US gal.' },
          { years: [2018, 2024], tankLiters: 60, note: 'XV70 — 15.8 US gal.' },
          { years: [2025, 2026], tankLiters: 49, note: 'XV80 is hybrid-only — 13 US gal.' },
        ],
      },
      {
        model: 'RAV4', type: 'suv_pickup', tankLiters: 60, consumptionL100km: 11.8, idleBurnLph: 1.1, years: [2006, 2026],
        tankByYear: [
          { years: [2006, 2018], tankLiters: 60, note: 'XA30 and XA40 — 15.9 US gal.' },
          { years: [2019, 2026], tankLiters: 55, note: 'XA50 — 14.5 US gal.' },
        ],
      },
      {
        model: 'Land Cruiser', type: 'suv_pickup', tankLiters: 138, consumptionL100km: 18.5, idleBurnLph: 1.6, years: [2003, 2026],
        // Twin tanks: the sub feeds the main automatically, so a fill to full
        // is the total. Enter the main tank alone (93 / 80) only if the sub
        // is disconnected.
        tankByYear: [
          { years: [2003, 2007], tankLiters: 145, note: '100 series — 96 L main + 49 L sub.' },
          { years: [2008, 2021], tankLiters: 138, note: '200 series — 93 L main + 45 L sub.' },
          { years: [2022, 2026], tankLiters: 110, note: '300 series — 80 L main + 30 L sub.' },
        ],
      },
      {
        model: 'Prado', type: 'suv_pickup', tankLiters: 150, consumptionL100km: 16.0, idleBurnLph: 1.4, years: [2003, 2026],
        tankByYear: [
          { years: [2003, 2009], tankLiters: 87, note: '120 series — 87 L main; some markets add a 63 L sub (150 L total).' },
          { years: [2010, 2023], tankLiters: 150, note: '150 series — 87 L main + 63 L sub. 87 L if there is no sub-tank.' },
          { years: [2024, 2026], tankLiters: 110, note: '250 series — single 110 L tank.' },
        ],
      },
      {
        model: 'Highlander', type: 'suv_pickup', tankLiters: 68, consumptionL100km: 13.0, idleBurnLph: 1.2, years: [2004, 2026],
        tankByYear: [
          { years: [2004, 2007], tankLiters: 73, note: 'XU20 — 19.2 US gal.' },
          { years: [2008, 2019], tankLiters: 73, note: 'XU40/XU50 petrol — 19.2 US gal. Hybrid 65 L.' },
          { years: [2020, 2026], tankLiters: 68, note: 'XU70 — 17.9 US gal. Hybrid 65 L.' },
        ],
      },
      {
        model: 'Sienna', type: 'van_bus', tankLiters: 68, consumptionL100km: 13.0, idleBurnLph: 1.2, years: [2004, 2026],
        tankByYear: [
          { years: [2004, 2020], tankLiters: 76, note: 'XL20/XL30 — 20 US gal.' },
          { years: [2021, 2026], tankLiters: 68, note: 'XL40 is hybrid-only — 18 US gal.' },
        ],
      },
      { model: 'Coaster', type: 'van_bus', tankLiters: 95, consumptionL100km: 19.0, idleBurnLph: 1.8, years: [2000, 2026] },
      { model: 'Dyna', type: 'medium_truck', tankLiters: 100, consumptionL100km: 24.0, idleBurnLph: 1.9, years: [2000, 2026] },
    ],
  },
  {
    make: 'Kia',
    models: [
      { model: 'Rio', type: 'sedan', tankLiters: 45, consumptionL100km: 8.5, idleBurnLph: 0.7, years: [2005, 2026] },
      { model: 'Cerato', type: 'sedan', tankLiters: 50, consumptionL100km: 9.5, idleBurnLph: 0.8, years: [2005, 2026] },
      { model: 'Optima', type: 'sedan', tankLiters: 70, consumptionL100km: 10.8, idleBurnLph: 0.9, years: [2006, 2026] },
      { model: 'Sportage', type: 'suv_pickup', tankLiters: 58, consumptionL100km: 11.5, idleBurnLph: 1.1, years: [2005, 2026] },
      { model: 'Sorento', type: 'suv_pickup', tankLiters: 71, consumptionL100km: 13.5, idleBurnLph: 1.2, years: [2004, 2026] },
      { model: 'Picanto', type: 'sedan', tankLiters: 35, consumptionL100km: 7.5, idleBurnLph: 0.6, years: [2005, 2026] },
    ],
  },
  {
    make: 'Hyundai',
    models: [
      { model: 'Elantra', type: 'sedan', tankLiters: 50, consumptionL100km: 9.2, idleBurnLph: 0.8, years: [2004, 2026] },
      { model: 'Accent', type: 'sedan', tankLiters: 43, consumptionL100km: 8.5, idleBurnLph: 0.7, years: [2004, 2026] },
      { model: 'Sonata', type: 'sedan', tankLiters: 70, consumptionL100km: 10.8, idleBurnLph: 0.9, years: [2004, 2026] },
      { model: 'Tucson', type: 'suv_pickup', tankLiters: 58, consumptionL100km: 11.5, idleBurnLph: 1.1, years: [2005, 2026] },
      { model: 'Santa Fe', type: 'suv_pickup', tankLiters: 71, consumptionL100km: 13.2, idleBurnLph: 1.2, years: [2004, 2026] },
      { model: 'H-1 / Starex', type: 'van_bus', tankLiters: 75, consumptionL100km: 14.0, idleBurnLph: 1.3, years: [2005, 2026] },
    ],
  },
  {
    make: 'Mercedes-Benz',
    models: [
      { model: 'Sprinter', type: 'van_bus', tankLiters: 75, consumptionL100km: 14.5, idleBurnLph: 1.4, years: [2000, 2026] },
      { model: 'Vito', type: 'van_bus', tankLiters: 70, consumptionL100km: 12.5, idleBurnLph: 1.2, years: [2003, 2026] },
      { model: 'Actros', type: 'heavy_truck', tankLiters: 400, consumptionL100km: 38.0, idleBurnLph: 2.8, years: [2000, 2026] },
      { model: 'C-Class', type: 'sedan', tankLiters: 66, consumptionL100km: 11.0, idleBurnLph: 0.9, years: [2003, 2026] },
      { model: 'E-Class', type: 'sedan', tankLiters: 66, consumptionL100km: 11.8, idleBurnLph: 1.0, years: [2003, 2026] },
    ],
  },
  {
    make: 'Ford',
    models: [
      { model: 'Transit', type: 'van_bus', tankLiters: 80, consumptionL100km: 14.0, idleBurnLph: 1.3, years: [2003, 2026] },
      { model: 'Ranger', type: 'suv_pickup', tankLiters: 80, consumptionL100km: 12.5, idleBurnLph: 1.2, years: [2006, 2026] },
      { model: 'Explorer', type: 'suv_pickup', tankLiters: 70, consumptionL100km: 14.5, idleBurnLph: 1.3, years: [2004, 2026] },
      { model: 'Edge', type: 'suv_pickup', tankLiters: 68, consumptionL100km: 13.5, idleBurnLph: 1.2, years: [2007, 2026] },
    ],
  },
  {
    make: 'Nissan',
    models: [
      { model: 'Navara', type: 'suv_pickup', tankLiters: 80, consumptionL100km: 12.8, idleBurnLph: 1.2, years: [2005, 2026] },
      { model: 'Urvan', type: 'van_bus', tankLiters: 65, consumptionL100km: 13.8, idleBurnLph: 1.3, years: [2003, 2026] },
      { model: 'Almera', type: 'sedan', tankLiters: 41, consumptionL100km: 8.5, idleBurnLph: 0.7, years: [2004, 2026] },
      { model: 'X-Trail', type: 'suv_pickup', tankLiters: 60, consumptionL100km: 11.8, idleBurnLph: 1.1, years: [2004, 2026] },
      { model: 'Patrol', type: 'suv_pickup', tankLiters: 95, consumptionL100km: 18.0, idleBurnLph: 1.6, years: [2003, 2026] },
    ],
  },
  {
    make: 'Honda',
    models: [
      { model: 'Accord', type: 'sedan', tankLiters: 65, consumptionL100km: 10.5, idleBurnLph: 0.9, years: [2003, 2026] },
      { model: 'Civic', type: 'sedan', tankLiters: 47, consumptionL100km: 8.8, idleBurnLph: 0.8, years: [2003, 2026] },
      { model: 'CR-V', type: 'suv_pickup', tankLiters: 58, consumptionL100km: 11.5, idleBurnLph: 1.1, years: [2004, 2026] },
      { model: 'Pilot', type: 'suv_pickup', tankLiters: 74, consumptionL100km: 14.5, idleBurnLph: 1.3, years: [2005, 2026] },
    ],
  },
  {
    make: 'Mitsubishi',
    models: [
      { model: 'L200', type: 'suv_pickup', tankLiters: 75, consumptionL100km: 12.5, idleBurnLph: 1.2, years: [2005, 2026] },
      { model: 'Pajero', type: 'suv_pickup', tankLiters: 88, consumptionL100km: 16.0, idleBurnLph: 1.4, years: [2003, 2026] },
      { model: 'Canter', type: 'medium_truck', tankLiters: 100, consumptionL100km: 23.0, idleBurnLph: 1.9, years: [2000, 2026] },
    ],
  },
  {
    make: 'Isuzu',
    models: [
      { model: 'D-Max', type: 'suv_pickup', tankLiters: 76, consumptionL100km: 12.0, idleBurnLph: 1.2, years: [2005, 2026] },
      { model: 'NPR', type: 'medium_truck', tankLiters: 100, consumptionL100km: 24.0, idleBurnLph: 1.9, years: [2000, 2026] },
      { model: 'FVR', type: 'heavy_truck', tankLiters: 200, consumptionL100km: 34.0, idleBurnLph: 2.5, years: [2000, 2026] },
    ],
  },
  {
    make: 'Volkswagen',
    models: [
      { model: 'Golf', type: 'sedan', tankLiters: 55, consumptionL100km: 9.0, idleBurnLph: 0.8, years: [2003, 2026] },
      { model: 'Passat', type: 'sedan', tankLiters: 70, consumptionL100km: 10.5, idleBurnLph: 0.9, years: [2003, 2026] },
      { model: 'Crafter', type: 'van_bus', tankLiters: 75, consumptionL100km: 14.5, idleBurnLph: 1.4, years: [2006, 2026] },
      { model: 'Amarok', type: 'suv_pickup', tankLiters: 80, consumptionL100km: 12.8, idleBurnLph: 1.2, years: [2010, 2026] },
    ],
  },
  {
    make: 'JAC',
    models: [
      { model: 'X200 Pickup', type: 'suv_pickup', tankLiters: 70, consumptionL100km: 13.0, idleBurnLph: 1.2, years: [2012, 2026] },
      { model: 'N-Series Truck', type: 'medium_truck', tankLiters: 120, consumptionL100km: 25.0, idleBurnLph: 1.9, years: [2012, 2026] },
      { model: 'Sunray Bus', type: 'van_bus', tankLiters: 90, consumptionL100km: 16.0, idleBurnLph: 1.5, years: [2014, 2026] },
    ],
  },
  {
    make: 'Iveco',
    models: [
      { model: 'Daily', type: 'van_bus', tankLiters: 90, consumptionL100km: 15.5, idleBurnLph: 1.5, years: [2003, 2026] },
      { model: 'Eurocargo', type: 'heavy_truck', tankLiters: 200, consumptionL100km: 32.0, idleBurnLph: 2.4, years: [2003, 2026] },
    ],
  },
  {
    make: 'Mack',
    models: [
      { model: 'Granite', type: 'heavy_truck', tankLiters: 400, consumptionL100km: 42.0, idleBurnLph: 3.0, years: [2000, 2026] },
      { model: 'CH / Vision', type: 'heavy_truck', tankLiters: 380, consumptionL100km: 40.0, idleBurnLph: 2.8, years: [1998, 2020] },
    ],
  },
];

/** Oldest year any catalogue entry covers — the floor for the year dropdown. */
export const CATALOGUE_MIN_YEAR = 1998;

export interface ResolvedVehicleSpec {
  make: string;
  model: string;
  year: number | null;
  type: VehicleType;
  tankLiters: number;
  consumptionL100km: number;
  idleBurnLph: number;
  /** True when this came from the catalogue rather than a class fallback. */
  matched: boolean;
  note?: string;
}

const norm = (value: string): string => value.trim().toLowerCase();

/** Every make in the catalogue, for the first dropdown. */
export function catalogueMakes(): string[] {
  return VEHICLE_CATALOGUE.map((m) => m.make);
}

/**
 * The tank size for a model in a given year. Generations are checked first;
 * the model-level figure is the answer when no year is given or none matches.
 */
export function tankLitersFor(spec: VehicleModelSpec, year?: number | null): TankGeneration {
  if (year != null && spec.tankByYear) {
    const gen = spec.tankByYear.find((g) => year >= g.years[0] && year <= g.years[1]);
    if (gen) return gen;
  }
  return { years: spec.years, tankLiters: spec.tankLiters };
}

/** Whether a year falls inside the model's production range. */
export function yearInRange(spec: VehicleModelSpec, year: number): boolean {
  return year >= spec.years[0] && year <= Math.min(spec.years[1], new Date().getFullYear() + 1);
}

/** The catalogue entry for a make/model, or null. */
export function catalogueSpec(make: string, model: string): VehicleModelSpec | null {
  return findSpec(make, model);
}

/** Models offered for a make, narrowed to those sold in the chosen year. */
export function catalogueModels(make: string, year?: number | null): VehicleModelSpec[] {
  const entry = VEHICLE_CATALOGUE.find((m) => norm(m.make) === norm(make));
  if (!entry) return [];
  if (year == null) return entry.models;
  return entry.models.filter((spec) => year >= spec.years[0] && year <= spec.years[1]);
}

/** Years a given model was available, for the year dropdown. */
export function catalogueYears(make: string, model: string): number[] {
  const spec = findSpec(make, model);
  if (!spec) return [];
  const [from, to] = spec.years;
  const cap = Math.min(to, new Date().getFullYear() + 1);
  const years: number[] = [];
  for (let y = cap; y >= from; y -= 1) years.push(y);
  return years;
}

function findSpec(make: string, model: string): VehicleModelSpec | null {
  const entry = VEHICLE_CATALOGUE.find((m) => norm(m.make) === norm(make));
  if (!entry) return null;
  return entry.models.find((s) => norm(s.model) === norm(model)) ?? null;
}

/**
 * The starting figures for a vehicle.
 *
 * Returns `matched: false` when the make/model is not in the catalogue, so the
 * caller can say "we are using a class average for this one" rather than
 * implying the numbers are specific to the vehicle. A fleet running something
 * unusual is not blocked — it just starts less accurate and calibrates its way
 * out like everything else.
 */
export function resolveVehicleSpec(
  make: string | null | undefined,
  model: string | null | undefined,
  year: number | null | undefined,
  fallback: { type: VehicleType; consumptionL100km: number; idleBurnLph: number }
): ResolvedVehicleSpec {
  const spec = make && model ? findSpec(make, model) : null;

  if (!spec) {
    return {
      make: make ?? '',
      model: model ?? '',
      year: year ?? null,
      type: fallback.type,
      // No catalogue tank size to offer; the caller keeps whatever the manager
      // typed rather than having a number invented for it.
      tankLiters: 0,
      consumptionL100km: fallback.consumptionL100km,
      idleBurnLph: fallback.idleBurnLph,
      matched: false,
    };
  }

  const tank = tankLitersFor(spec, year);
  return {
    make: make!,
    model: spec.model,
    year: year ?? null,
    type: spec.type,
    tankLiters: tank.tankLiters,
    consumptionL100km: spec.consumptionL100km,
    idleBurnLph: spec.idleBurnLph,
    matched: true,
    note: tank.note ?? spec.note,
  };
}
