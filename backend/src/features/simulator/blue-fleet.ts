/**
 * Blue Fleet — the sales-demo fleet.
 *
 * Ten virtual vehicles that live in a separate database (Neon) and a separate
 * cache (their own Upstash), so nothing here can touch the production RDS or
 * the real tracker's data. The same profiles drive two things:
 *
 *  - `seed-blue-fleet.ts` writes the account and a week of history from them,
 *    so trip history, daily activity and the fuel estimate have something to
 *    show the moment the dashboard opens;
 *  - the fleet simulator (FLEET_SIM_PROFILES=blue-fleet) plays them live on
 *    the map during a demo, generating real alerts and driving events through
 *    the same ingest path a real FMC150 would.
 *
 * The fleet works Abuja from one depot, the TRT office in Mabushi. Each
 * morning at 08:00 WAT a car leaves the office for its district — Idu
 * Industrial, Mabushi, Durumi or Aso Hills, with two couriers on a ring
 * through all four — works there with stops and rests, and from its return
 * hour (3, 4 or 5 pm, staggered so the office fills up over the afternoon)
 * heads back and parks until the next shift. The roads it drives are real
 * geometry from the Directions API (abuja-routes).
 *
 * Tanks are capped at 60 L for the demo — a Coaster's real 95 L or an NPR's
 * 100 L reads as a typo on a gauge next to sedans — and the fuel-left figures
 * sit at the two-thirds mark a fleet actually runs at.
 *
 * IMEIs are in a reserved-looking range that cannot collide with a real
 * Teltonika unit (which start 35/86). Plates follow Abuja and Lagos formats.
 */

/** 08:00–19:00 West Africa Time. */
export const BLUE_FLEET_WORK_HOURS_UTC: [number, number] = [7, 18];

export const BLUE_FLEET_EMAIL = 'manager@bluefleet.demo';
export const BLUE_FLEET_PASSWORD = 'BlueFleet2026!';
/**
 * The demo is pitched as the Nigerian Air Force's own ground-fleet tool, so
 * the account wears their name, crest and blue. All of it is account data —
 * `company_name`, `logo_url`, `brand_color`, `white_label` on this one
 * customer row — so nothing here can reach a real fleet on the production
 * database, which never sees this seed.
 */
export const BLUE_FLEET_COMPANY = 'NAF Fleet Command and Management System';
export const BLUE_FLEET_LOGO_URL = '/brands/naf-crest.png';
export const BLUE_FLEET_BRAND_COLOR = '#364d70';

/**
 * The people who sign in beside the manager. Both have the whole dashboard;
 * the difference is where it opens. The commander lands on the Command
 * Summary — reports, totals and trends are what he is there for — and the
 * logistics officer lands on the operations dashboard the way a fleet
 * manager does. Names are invented for the demo.
 */
export const BLUE_FLEET_USERS = [
  {
    email: 'commander@naf.com',
    password: 'Commander2026!',
    name: 'AVM T. A. Okonkwo',
    title: 'Air Officer Commanding, Logistics Command',
    role: 'commander' as const,
  },
  {
    email: 'logistics@naf.com',
    password: 'Logistics2026!',
    name: 'Wg Cdr F. Danjuma',
    title: 'Fleet Logistics Officer',
    role: 'manager' as const,
  },
];
/** Each driver's PIN is 1 + the three digits of their code: BF-104 → 1104. */
export function driverPin(code: string): string {
  return '1' + code.replace(/\D/g, '');
}

export interface BlueFleetProfile {
  imei: string;
  label: string;
  make: string;
  model: string;
  year: number;
  vehicleType: string;
  routeLoop: 'idu' | 'mabushi' | 'durumi' | 'aso' | 'ring';
  workHoursUtc: [number, number];
  /** Cruising range while driving. Abuja traffic, not an expressway. */
  cruiseKph: [number, number];
  /** How much longer a rest phase runs than a driving one. */
  restCycleFactor: number;
  /** When the car heads back to the office, UTC. 14/15/16 is 3/4/5 pm WAT. */
  returnHourUtc: number;
  initialFuel: number;
  tankCapacity: number;
  initialOdometer: number;
  /** Minutes of driving between stops; rests run restCycleFactor × this. */
  driveMinutes: number;
  idleRatio?: number;
  idleTarget?: boolean;
  theftTarget?: boolean;
  theftAfterTicks?: number;
  theftDropLiters?: number;
  refuelEvery?: number;
  driver: { name: string; phone: string; licence: string; code: string };
}

export const BLUE_FLEET_PROFILES: BlueFleetProfile[] = [
  {
    imei: '990000000000101',
    label: 'ABJ-412-BF',
    make: 'Toyota',
    model: 'Hiace',
    year: 2021,
    vehicleType: 'van',
    routeLoop: 'idu',
    workHoursUtc: BLUE_FLEET_WORK_HOURS_UTC,
    cruiseKph: [22, 50],
    restCycleFactor: 0.9,
    returnHourUtc: 14,
    initialFuel: 41,
    tankCapacity: 60,
    initialOdometer: 58210,
    driveMinutes: 36,
    refuelEvery: 90,
    driver: {
      name: 'Adebayo Okonkwo',
      phone: '+234 803 210 0101',
      licence: 'LAG/2022/40101',
      code: 'BF-101',
    },
  },
  {
    imei: '990000000000102',
    label: 'KUJ-778-BF',
    make: 'Toyota',
    model: 'Hilux',
    year: 2022,
    vehicleType: 'pickup',
    routeLoop: 'mabushi',
    workHoursUtc: BLUE_FLEET_WORK_HOURS_UTC,
    cruiseKph: [22, 50],
    restCycleFactor: 0.9,
    returnHourUtc: 15,
    initialFuel: 47,
    tankCapacity: 60,
    initialOdometer: 31440,
    driveMinutes: 40,
    idleTarget: true,
    idleRatio: 0.4,
    driver: {
      name: 'Ezekiel Danwa',
      phone: '+234 805 210 0102',
      licence: 'LAG/2023/40102',
      code: 'BF-102',
    },
  },
  {
    imei: '990000000000103',
    label: 'ABC-903-BF',
    make: 'Mercedes-Benz',
    model: 'Sprinter',
    year: 2020,
    vehicleType: 'van',
    routeLoop: 'durumi',
    workHoursUtc: BLUE_FLEET_WORK_HOURS_UTC,
    cruiseKph: [22, 50],
    restCycleFactor: 0.9,
    returnHourUtc: 16,
    initialFuel: 38,
    tankCapacity: 56,
    initialOdometer: 112870,
    driveMinutes: 45,
    refuelEvery: 110,
    driver: {
      name: 'Ibrahim Musa',
      phone: '+234 806 210 0103',
      licence: 'ABJ/2021/40103',
      code: 'BF-103',
    },
  },
  {
    imei: '990000000000104',
    label: 'GWA-215-BF',
    make: 'Toyota',
    model: 'Camry',
    year: 2023,
    vehicleType: 'sedan',
    routeLoop: 'aso',
    workHoursUtc: BLUE_FLEET_WORK_HOURS_UTC,
    cruiseKph: [22, 50],
    restCycleFactor: 0.9,
    returnHourUtc: 14,
    initialFuel: 29,
    tankCapacity: 43,
    initialOdometer: 9120,
    driveMinutes: 32,
    driver: {
      name: 'Adeboye Adeyemi',
      phone: '+234 807 210 0104',
      licence: 'LAG/2024/40104',
      code: 'BF-104',
    },
  },
  {
    imei: '990000000000105',
    label: 'BWR-661-BF',
    make: 'Toyota',
    model: 'RAV4',
    year: 2022,
    vehicleType: 'suv',
    routeLoop: 'ring',
    workHoursUtc: BLUE_FLEET_WORK_HOURS_UTC,
    cruiseKph: [22, 50],
    restCycleFactor: 0.9,
    returnHourUtc: 16,
    initialFuel: 31,
    tankCapacity: 43,
    initialOdometer: 27650,
    driveMinutes: 35,
    theftTarget: true,
    theftAfterTicks: 40,
    theftDropLiters: 19,
    driver: {
      name: 'Emeka Nwachukwu',
      phone: '+234 808 210 0105',
      licence: 'LAG/2022/40105',
      code: 'BF-105',
    },
  },
  {
    imei: '990000000000106',
    label: 'KWL-338-BF',
    make: 'Toyota',
    model: 'Hiace',
    year: 2019,
    vehicleType: 'van',
    routeLoop: 'idu',
    workHoursUtc: BLUE_FLEET_WORK_HOURS_UTC,
    cruiseKph: [22, 50],
    restCycleFactor: 0.9,
    returnHourUtc: 15,
    initialFuel: 24,
    tankCapacity: 60,
    initialOdometer: 143900,
    driveMinutes: 40,
    refuelEvery: 85,
    driver: {
      name: 'Segun Bello',
      phone: '+234 809 210 0106',
      licence: 'LAG/2020/40106',
      code: 'BF-106',
    },
  },
  {
    imei: '990000000000107',
    label: 'ABJ-047-BF',
    make: 'Isuzu',
    model: 'NPR',
    year: 2021,
    vehicleType: 'truck',
    routeLoop: 'mabushi',
    workHoursUtc: BLUE_FLEET_WORK_HOURS_UTC,
    cruiseKph: [22, 50],
    restCycleFactor: 0.9,
    returnHourUtc: 14,
    initialFuel: 52,
    tankCapacity: 60,
    initialOdometer: 76340,
    driveMinutes: 48,
    idleRatio: 0.35,
    driver: {
      name: 'Tunde Olawale',
      phone: '+234 810 210 0107',
      licence: 'LAG/2021/40107',
      code: 'BF-107',
    },
  },
  {
    imei: '990000000000108',
    label: 'KUJ-529-BF',
    make: 'Toyota',
    model: 'Hilux',
    year: 2023,
    vehicleType: 'pickup',
    routeLoop: 'durumi',
    workHoursUtc: BLUE_FLEET_WORK_HOURS_UTC,
    cruiseKph: [22, 50],
    restCycleFactor: 0.9,
    returnHourUtc: 16,
    initialFuel: 44,
    tankCapacity: 60,
    initialOdometer: 14780,
    driveMinutes: 35,
    driver: {
      name: 'Amina Yusuf',
      phone: '+234 811 210 0108',
      licence: 'ABJ/2023/40108',
      code: 'BF-108',
    },
  },
  {
    imei: '990000000000109',
    label: 'GWA-184-BF',
    make: 'Honda',
    model: 'Accord',
    year: 2020,
    vehicleType: 'sedan',
    routeLoop: 'aso',
    workHoursUtc: BLUE_FLEET_WORK_HOURS_UTC,
    cruiseKph: [22, 50],
    restCycleFactor: 0.9,
    returnHourUtc: 15,
    initialFuel: 23,
    tankCapacity: 38,
    initialOdometer: 64210,
    driveMinutes: 32,
    theftTarget: true,
    theftAfterTicks: 70,
    theftDropLiters: 15,
    driver: {
      name: 'Oluwaseun Ajayi',
      phone: '+234 812 210 0109',
      licence: 'LAG/2021/40109',
      code: 'BF-109',
    },
  },
  {
    imei: '990000000000110',
    label: 'ABC-756-BF',
    make: 'Toyota',
    model: 'Coaster',
    year: 2018,
    vehicleType: 'bus',
    routeLoop: 'ring',
    workHoursUtc: BLUE_FLEET_WORK_HOURS_UTC,
    cruiseKph: [22, 50],
    restCycleFactor: 0.9,
    returnHourUtc: 14,
    initialFuel: 49,
    tankCapacity: 60,
    initialOdometer: 201560,
    driveMinutes: 50,
    idleRatio: 0.3,
    refuelEvery: 100,
    driver: {
      name: 'Kelechi Obi',
      phone: '+234 813 210 0110',
      licence: 'LAG/2019/40110',
      code: 'BF-110',
    },
  },
];

import {
  ABUJA_LOOP_DEFINITIONS,
  loadAbujaRoutes,
  TRT_OFFICE,
} from '../route-corridor/abuja-routes';

/**
 * The profile with its depot commutes attached, ready for VehicleSimulator.
 * Geometry comes from abuja-routes.json; a loop with no commute built yet
 * (the file is stale) gets no depot and simply loops, rather than failing.
 */
export function simulatorProfile(p: BlueFleetProfile) {
  const { commutes } = loadAbujaRoutes();
  const commute = commutes[p.routeLoop];
  if (!commute) return { ...p };
  // Every hub's road home, so a courier on the ring can turn for the office
  // from whichever district it reaches next rather than finishing the lap.
  const homeFrom = Object.entries(commutes).map(([loop, c]) => ({
    hub: ABUJA_LOOP_DEFINITIONS[loop].stops[0],
    back: c.back,
  }));
  return {
    ...p,
    depot: {
      office: TRT_OFFICE,
      out: commute.out,
      back: commute.back,
      homeFrom,
      returnHourUtc: p.returnHourUtc,
    },
  };
}
