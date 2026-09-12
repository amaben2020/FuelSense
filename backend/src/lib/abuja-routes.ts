import type { GeoPoint } from './route-corridor';

/**
 * Where the Blue Fleet demo cars work: four Abuja districts, and the roads
 * between them.
 *
 * Each loop is a round trip that starts and ends at its home district and
 * calls at two or three real places on the way — a depot run, a delivery
 * round, a school route. The stops here are only the *intent*; the geometry
 * a car actually follows lives in abuja-routes.json, fetched once from the
 * Directions API by build-abuja-routes.ts so it follows the carriageway bend
 * for bend. A car that drove straight between these stops would cross the
 * Jabi lake and half of Wuse.
 */
export const ABUJA_LOOP_DEFINITIONS: Record<string, { home: string; stops: GeoPoint[] }> = {
  // Idu Industrial → Kubwa Expressway → Jabi → Utako → back. A factory's
  // delivery round into town.
  idu: {
    home: 'Idu Industrial',
    stops: [
      { lat: 9.0356, lng: 7.4021 },
      { lat: 9.0619, lng: 7.4302 },
      { lat: 9.0718, lng: 7.4453 },
      { lat: 9.0500, lng: 7.4136 },
    ],
  },
  // Mabushi → Wuse 2 → Wuse Market → Jahi → back. A contractor's runs between
  // sites and suppliers.
  mabushi: {
    home: 'Mabushi',
    stops: [
      { lat: 9.0795, lng: 7.4560 },
      { lat: 9.0729, lng: 7.4803 },
      { lat: 9.0610, lng: 7.4624 },
      { lat: 9.0913, lng: 7.4560 },
    ],
  },
  // Durumi → Area 1 → Garki → Central Business District → back. An office
  // fleet's afternoon of meetings.
  durumi: {
    home: 'Durumi',
    stops: [
      { lat: 9.0263, lng: 7.4738 },
      { lat: 9.0180, lng: 7.4939 },
      { lat: 9.0343, lng: 7.4917 },
      { lat: 9.0475, lng: 7.4890 },
    ],
  },
  // Asokoro → Aso Drive past the Villa → Maitama → Three Arms Zone → back.
  // The executive cars.
  aso: {
    home: 'Aso Hills',
    stops: [
      { lat: 9.0437, lng: 7.5302 },
      { lat: 9.0700, lng: 7.5152 },
      { lat: 9.0866, lng: 7.4934 },
      { lat: 9.0530, lng: 7.5112 },
    ],
  },
  // The long one: Idu → Mabushi → Durumi → Asokoro → back to Idu. A courier
  // crossing the whole city, so at least one car is always in transit
  // between the districts the others stay inside.
  ring: {
    home: 'Idu Industrial',
    stops: [
      { lat: 9.0356, lng: 7.4021 },
      { lat: 9.0795, lng: 7.4560 },
      { lat: 9.0263, lng: 7.4738 },
      { lat: 9.0437, lng: 7.5302 },
    ],
  },
};

/**
 * Where the fleet sleeps. Every car leaves here in the morning, works its
 * district, and is back by its return hour. TRT's office is on the fourth
 * floor of the Kojo Motors building on Shehu Yar'adua Way, so the pin is
 * Kojo Motors — the one Google knows.
 */
export const TRT_OFFICE: GeoPoint & { name: string } = {
  name: 'TRT office (Kojo Motors), Mabushi',
  lat: 9.077736,
  lng: 7.44469,
};

export interface AbujaRoutes {
  loops: Record<string, GeoPoint[]>;
  /** Office → district hub, and hub → office, per loop. */
  commutes: Record<string, { out: GeoPoint[]; back: GeoPoint[] }>;
}

/** Road-following geometry; empty until build-abuja-routes.ts has run. */
export function loadAbujaRoutes(): AbujaRoutes {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const raw = require('./abuja-routes.json') as Partial<AbujaRoutes> & Record<string, unknown>;
    if (raw.loops) return { loops: raw.loops, commutes: raw.commutes ?? {} };
    return { loops: {}, commutes: {} };
  } catch {
    return { loops: {}, commutes: {} };
  }
}

export function loadAbujaLoops(): Record<string, GeoPoint[]> {
  return loadAbujaRoutes().loops;
}
