// What a vehicle needs doing, and how often.
//
// Intervals are the conservative end of what manufacturers publish, chosen
// for Nigerian conditions — dust, heat, stop-start traffic and mineral oil
// rather than long-life synthetic. A manager can change any of them per
// vehicle; these are the numbers a schedule starts from so nobody has to
// look them up. Distance is stored in km; the dashboard shows miles.
export interface ServiceDefinition {
  kind: string;
  label: string;
  group: 'engine' | 'tyres_brakes' | 'fluids' | 'electrical' | 'general';
  /** Null = time-based only. */
  intervalKm: number | null;
  /** Null = distance-based only. */
  intervalDays: number | null;
  /** What actually gets done, in plain words. */
  what: string;
  /** Part of the one-click standard plan. */
  core: boolean;
}

export const SERVICE_CATALOGUE: ServiceDefinition[] = [
  { kind: 'oil_change', label: 'Engine oil & filter', group: 'engine', intervalKm: 5000, intervalDays: 180, what: 'Drain and replace engine oil; new oil filter.', core: true },
  { kind: 'air_filter', label: 'Air filter', group: 'engine', intervalKm: 15000, intervalDays: 365, what: 'Replace the engine air filter — sooner on dusty routes.', core: true },
  { kind: 'fuel_filter', label: 'Fuel filter', group: 'engine', intervalKm: 20000, intervalDays: 365, what: 'Replace the fuel filter; protects injectors from bad fuel.', core: false },
  { kind: 'spark_plugs', label: 'Spark plugs', group: 'engine', intervalKm: 30000, intervalDays: null, what: 'Replace spark plugs (petrol engines).', core: false },
  { kind: 'timing_belt', label: 'Timing belt', group: 'engine', intervalKm: 90000, intervalDays: 1825, what: 'Replace the timing belt and tensioner before it fails.', core: false },
  { kind: 'tyre_rotation', label: 'Tyre rotation', group: 'tyres_brakes', intervalKm: 10000, intervalDays: null, what: 'Swap tyres front to back so they wear evenly.', core: true },
  { kind: 'tyres', label: 'Tyre replacement', group: 'tyres_brakes', intervalKm: 40000, intervalDays: 1460, what: 'New tyres; also whenever tread is under 1.6 mm or a tyre is over 4 years old.', core: true },
  { kind: 'wheel_alignment', label: 'Wheel alignment', group: 'tyres_brakes', intervalKm: 10000, intervalDays: 365, what: 'Align and balance — bad roads knock it out fast.', core: false },
  { kind: 'brake_pads', label: 'Brake pads', group: 'tyres_brakes', intervalKm: 20000, intervalDays: null, what: 'Inspect and replace pads; check discs.', core: true },
  { kind: 'brake_fluid', label: 'Brake fluid', group: 'fluids', intervalKm: 40000, intervalDays: 730, what: 'Flush and replace brake fluid.', core: true },
  { kind: 'coolant', label: 'Coolant', group: 'fluids', intervalKm: 40000, intervalDays: 730, what: 'Flush the cooling system and refill with the right coolant.', core: true },
  { kind: 'transmission_fluid', label: 'Transmission fluid', group: 'fluids', intervalKm: 60000, intervalDays: 1095, what: 'Replace gearbox oil (automatic or manual).', core: false },
  { kind: 'battery', label: 'Battery', group: 'electrical', intervalKm: null, intervalDays: 1095, what: 'Replace the battery; test it every service.', core: true },
  { kind: 'wiper_blades', label: 'Wiper blades', group: 'general', intervalKm: null, intervalDays: 365, what: 'New blades before the rains.', core: true },
  { kind: 'ac_service', label: 'Air conditioning', group: 'general', intervalKm: null, intervalDays: 365, what: 'Regas and check the compressor and cabin filter.', core: false },
  { kind: 'shock_absorbers', label: 'Shock absorbers', group: 'tyres_brakes', intervalKm: 40000, intervalDays: null, what: 'Replace shocks; check sooner if the ride has gone bouncy or the car nose-dives on braking.', core: false },
  { kind: 'suspension_check', label: 'Suspension & steering check', group: 'tyres_brakes', intervalKm: 10000, intervalDays: 180, what: 'Ball joints, bushings, tie rods and control arms — the parts potholes eat first.', core: true },
  { kind: 'drive_belts', label: 'Drive belts', group: 'engine', intervalKm: 60000, intervalDays: 730, what: 'Replace the serpentine/fan belt and check tensioners.', core: false },
  { kind: 'power_steering_fluid', label: 'Power steering fluid', group: 'fluids', intervalKm: 50000, intervalDays: 730, what: 'Flush and refill; a whining pump means it is overdue.', core: false },
  { kind: 'injector_cleaning', label: 'Fuel injector cleaning', group: 'engine', intervalKm: 30000, intervalDays: null, what: 'Clean injectors and throttle body — bad fuel clogs them.', core: false },
  { kind: 'lights_check', label: 'Lights & bulbs', group: 'electrical', intervalKm: null, intervalDays: 180, what: 'Headlights, brake lights, indicators — a checkpoint stop waiting to happen.', core: false },
  { kind: 'engine_mounts', label: 'Engine mounts', group: 'engine', intervalKm: 80000, intervalDays: null, what: 'Replace worn mounts; a shudder at idle is the usual sign.', core: false },
  { kind: 'service', label: 'Full service', group: 'general', intervalKm: 10000, intervalDays: 365, what: 'General inspection: belts, hoses, suspension, lights, fluids.', core: true },
];

export const serviceDefinition = (kind: string): ServiceDefinition | undefined =>
  SERVICE_CATALOGUE.find((s) => s.kind === kind);

export const serviceLabel = (kind: string): string =>
  serviceDefinition(kind)?.label ?? kind.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
