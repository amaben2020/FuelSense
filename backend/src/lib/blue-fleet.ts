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
 * The fleet works Abuja: two cars each based in Idu Industrial, Mabushi,
 * Durumi and Aso Hills, and two couriers on a ring through all four. Every
 * car works 08:00–19:00 WAT (07–18 UTC) and sits parked otherwise, and the
 * roads it drives are real geometry from the Directions API (abuja-routes).
 *
 * IMEIs are in a reserved-looking range that cannot collide with a real
 * Teltonika unit (which start 35/86). Plates follow Abuja and Lagos formats.
 */

/** 08:00–19:00 West Africa Time. */
export const BLUE_FLEET_WORK_HOURS_UTC: [number, number] = [7, 18];

export const BLUE_FLEET_EMAIL = 'manager@bluefleet.demo';
export const BLUE_FLEET_PASSWORD = 'BlueFleet2026!';
export const BLUE_FLEET_COMPANY = 'Blue Fleet';
export const BLUE_FLEET_DRIVER_PIN = '2468';

export interface BlueFleetProfile {
  imei: string;
  label: string;
  make: string;
  model: string;
  year: number;
  vehicleType: string;
  routeLoop: 'idu' | 'mabushi' | 'durumi' | 'aso' | 'ring';
  workHoursUtc: [number, number];
  initialFuel: number;
  tankCapacity: number;
  initialOdometer: number;
  driveCycleTicks: number;
  idleRatio?: number;
  idleTarget?: boolean;
  theftTarget?: boolean;
  theftAfterTicks?: number;
  theftDropLiters?: number;
  refuelEvery?: number;
  securityDemo?: boolean;
  driver: { name: string; phone: string; licence: string; code: string };
}

export const BLUE_FLEET_PROFILES: BlueFleetProfile[] = [
  {
    imei: '990000000000101', label: 'ABJ-412-BF', make: 'Toyota', model: 'Hiace', year: 2021,
    vehicleType: 'van', routeLoop: 'idu', workHoursUtc: BLUE_FLEET_WORK_HOURS_UTC, initialFuel: 44, tankCapacity: 70, initialOdometer: 58210,
    driveCycleTicks: 16, refuelEvery: 90,
    driver: { name: 'Adebayo Okonkwo', phone: '+234 803 210 0101', licence: 'LAG/2022/40101', code: 'BF-101' },
  },
  {
    imei: '990000000000102', label: 'KUJ-778-BF', make: 'Toyota', model: 'Hilux', year: 2022,
    vehicleType: 'pickup', routeLoop: 'mabushi', workHoursUtc: BLUE_FLEET_WORK_HOURS_UTC, initialFuel: 52, tankCapacity: 80, initialOdometer: 31440,
    driveCycleTicks: 18, idleTarget: true, idleRatio: 0.4,
    driver: { name: 'Chidinma Eze', phone: '+234 805 210 0102', licence: 'LAG/2023/40102', code: 'BF-102' },
  },
  {
    imei: '990000000000103', label: 'ABC-903-BF', make: 'Mercedes-Benz', model: 'Sprinter', year: 2020,
    vehicleType: 'van', routeLoop: 'durumi', workHoursUtc: BLUE_FLEET_WORK_HOURS_UTC, initialFuel: 60, tankCapacity: 75, initialOdometer: 112870,
    driveCycleTicks: 20, refuelEvery: 110,
    driver: { name: 'Ibrahim Musa', phone: '+234 806 210 0103', licence: 'ABJ/2021/40103', code: 'BF-103' },
  },
  {
    imei: '990000000000104', label: 'GWA-215-BF', make: 'Toyota', model: 'Camry', year: 2023,
    vehicleType: 'sedan', routeLoop: 'aso', workHoursUtc: BLUE_FLEET_WORK_HOURS_UTC, initialFuel: 38, tankCapacity: 60, initialOdometer: 9120,
    driveCycleTicks: 14,
    driver: { name: 'Ngozi Adeyemi', phone: '+234 807 210 0104', licence: 'LAG/2024/40104', code: 'BF-104' },
  },
  {
    imei: '990000000000105', label: 'BWR-661-BF', make: 'Toyota', model: 'RAV4', year: 2022,
    vehicleType: 'suv', routeLoop: 'ring', workHoursUtc: BLUE_FLEET_WORK_HOURS_UTC, initialFuel: 41, tankCapacity: 55, initialOdometer: 27650,
    driveCycleTicks: 16, theftTarget: true, theftAfterTicks: 40, theftDropLiters: 19, securityDemo: true,
    driver: { name: 'Emeka Nwachukwu', phone: '+234 808 210 0105', licence: 'LAG/2022/40105', code: 'BF-105' },
  },
  {
    imei: '990000000000106', label: 'KWL-338-BF', make: 'Toyota', model: 'Hiace', year: 2019,
    vehicleType: 'van', routeLoop: 'idu', workHoursUtc: BLUE_FLEET_WORK_HOURS_UTC, initialFuel: 30, tankCapacity: 70, initialOdometer: 143900,
    driveCycleTicks: 18, refuelEvery: 85,
    driver: { name: 'Funmilayo Bello', phone: '+234 809 210 0106', licence: 'LAG/2020/40106', code: 'BF-106' },
  },
  {
    imei: '990000000000107', label: 'ABJ-047-BF', make: 'Isuzu', model: 'NPR', year: 2021,
    vehicleType: 'truck', routeLoop: 'mabushi', workHoursUtc: BLUE_FLEET_WORK_HOURS_UTC, initialFuel: 88, tankCapacity: 120, initialOdometer: 76340,
    driveCycleTicks: 22, idleRatio: 0.35,
    driver: { name: 'Tunde Olawale', phone: '+234 810 210 0107', licence: 'LAG/2021/40107', code: 'BF-107' },
  },
  {
    imei: '990000000000108', label: 'KUJ-529-BF', make: 'Toyota', model: 'Hilux', year: 2023,
    vehicleType: 'pickup', routeLoop: 'durumi', workHoursUtc: BLUE_FLEET_WORK_HOURS_UTC, initialFuel: 47, tankCapacity: 80, initialOdometer: 14780,
    driveCycleTicks: 16,
    driver: { name: 'Amina Yusuf', phone: '+234 811 210 0108', licence: 'ABJ/2023/40108', code: 'BF-108' },
  },
  {
    imei: '990000000000109', label: 'GWA-184-BF', make: 'Honda', model: 'Accord', year: 2020,
    vehicleType: 'sedan', routeLoop: 'aso', workHoursUtc: BLUE_FLEET_WORK_HOURS_UTC, initialFuel: 33, tankCapacity: 56, initialOdometer: 64210,
    driveCycleTicks: 14, theftTarget: true, theftAfterTicks: 70, theftDropLiters: 15,
    driver: { name: 'Oluwaseun Ajayi', phone: '+234 812 210 0109', licence: 'LAG/2021/40109', code: 'BF-109' },
  },
  {
    imei: '990000000000110', label: 'ABC-756-BF', make: 'Toyota', model: 'Coaster', year: 2018,
    vehicleType: 'bus', routeLoop: 'ring', workHoursUtc: BLUE_FLEET_WORK_HOURS_UTC, initialFuel: 70, tankCapacity: 95, initialOdometer: 201560,
    driveCycleTicks: 24, idleRatio: 0.3, refuelEvery: 100,
    driver: { name: 'Kelechi Obi', phone: '+234 813 210 0110', licence: 'LAG/2019/40110', code: 'BF-110' },
  },
];
