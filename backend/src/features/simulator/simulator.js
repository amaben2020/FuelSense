const {
  sampleEfficiencyKmL,
  fuelUsedForDistanceKm,
  idleFuelBurnLiters,
} = require('../fuel/fuel-metrics.service');
const { loopForProfile } = require('./lagos-routes');
const {
  DOUT1_AVL_ID,
  DOUT2_AVL_ID,
  parseSetDigoutCommand,
  formatSetDigoutReply,
} = require('../tracker/teltonika-dout.service');

/**
 * Stateful virtual FMC150 — Uber-style routes, physics-based fuel + odometer.
 */
class VehicleSimulator {
  constructor(profile) {
    this.profile = profile;
    this.tick = 0;
    this.fuelLevel = profile.initialFuel;
    this.tankCapacity = profile.tankCapacity ?? 60;
    this.odometerKm = profile.initialOdometer;
    this.waypoints = loopForProfile(profile);
    this.waypointIndex = 0;
    const start = this.waypoints[0];
    this.lat = profile.startLat ?? start.lat;
    this.lng = profile.startLng ?? start.lng;
    // A resolved origin — where the device last actually reported — takes
    // over from the loop's first corner, and the car rejoins the loop at the
    // point nearest to it. Without the snap a car resumed mid-loop drove a
    // straight line back to waypoint zero, through whatever lay between.
    if (profile.origin) {
      this.lat = profile.origin.lat;
      this.lng = profile.origin.lng;
      let best = 0;
      let bestD = Infinity;
      this.waypoints.forEach((w, i) => {
        const d = Math.hypot(w.lat - this.lat, w.lng - this.lng);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      this.waypointIndex = best;
    }
    this.heading = profile.heading ?? 0;
    this.ignitionOn = profile.startIgnition ?? true;
    this.speedKph = 0;
    this.phase = 'driving';
    this.phaseTicks = 0;
    this.theftDone = false;
    this.stopped = false;
    this.fuelAtPark = null;
    this.tickIntervalMs = profile.tickIntervalMs ?? 4000;
    this.efficiencyKmL =
      profile.efficiencyKmL ?? sampleEfficiencyKmL(profile.model ?? 'Hiace');
    this.imei = profile.imei;
    this.prevIgnition = this.ignitionOn;
    this.prevIdle = false;
    this.pendingEvents = [];
    this.securityEventsFired = new Set();
    this.targetSpeed = null;
    this.crawlTicks = 0;
    this.cycleTarget = null;
    // [startHourUtc, endHourUtc): outside it the car sits parked. Null means
    // it never stops, which is what the development fleet has always done.
    this.workHoursUtc = profile.workHoursUtc ?? null;
    this.offShiftParked = false;
    // A day with a depot: out from the office in the morning, the district
    // loop through the day, back to the office from `returnHourUtc`, parked
    // there until the next shift. Profiles without a depot just loop.
    this.depot = profile.depot ?? null;
    // The two open-collector outputs, as the firmware holds them. DOUT1 is
    // taken to drive a relay in the starter circuit: while it is high the
    // engine cannot be started, and the car stays where it is.
    this.dout = [0, 0];
    this.doutTimeouts = [0, 0];
    // When a timed output drops again, per output (ms epoch; 0 = never).
    this.doutRevertAt = [0, 0];
    // A setdigout received above its speed ceiling waits here until the car
    // has slowed, the way the firmware queues it.
    this.pendingDigout = null;
    this.loopWaypoints = this.waypoints;
    this.mode = 'loop';
    this.lapDone = false;
    if (this.depot) {
      const hour = this.workHoursUtc ? this.workHoursUtc[0] : 0;
      void hour;
      // Where the car is decides how the day resumes: at the office before
      // the shift it waits for the commute; at the office *during* the shift
      // it sets off now — a restart mid-morning used to file every car under
      // "day finished" and the whole fleet sat at the depot until tomorrow;
      // anywhere else it is mid-loop.
      const atOffice = this._distanceKm(this.depot.office) < 0.4;
      if (atOffice) {
        const d = new Date();
        const hourUtc = d.getUTCHours() + d.getUTCMinutes() / 60;
        const shiftStillOn = this.onShift(Date.now()) && hourUtc < this.depot.returnHourUtc;
        this._enterMode(shiftStillOn ? 'commute_out' : 'at_base');
      }
    }
  }

  _distanceKm(point) {
    const kmPerDegLng = 111 * Math.cos((this.lat * Math.PI) / 180);
    return Math.hypot((point.lat - this.lat) * 111, (point.lng - this.lng) * kmPerDegLng);
  }

  _nearestIndex(waypoints) {
    let best = 0;
    let bestD = Infinity;
    waypoints.forEach((w, i) => {
      const d = Math.hypot(w.lat - this.lat, w.lng - this.lng);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  _enterMode(mode) {
    this.mode = mode;
    this.lapDone = false;
    if (mode === 'commute_out') {
      this.waypoints = this.depot.out;
      this.waypointIndex = this._nearestIndex(this.waypoints);
      this.phase = 'driving';
      this.ignitionOn = true;
      this.phaseTicks = 0;
    } else if (mode === 'returning') {
      this.waypoints = this.depot.back;
      this.waypointIndex = this._nearestIndex(this.waypoints);
      this.phase = 'driving';
      this.ignitionOn = true;
      this.phaseTicks = 0;
    } else if (mode === 'loop') {
      this.waypoints = this.loopWaypoints;
      this.waypointIndex = this._nearestIndex(this.waypoints);
    } else if (mode === 'at_base') {
      this.phase = 'parked';
      this.ignitionOn = false;
      this.speedKph = 0;
      this.phaseTicks = 0;
    }
  }

  /**
   * A GPRS command, answered the way the real unit answers it. `setdigout`
   * follows Teltonika's syntax: a level per output (`?` leaves one alone), an
   * optional timeout, and an optional speed ceiling above which the command
   * is held until the car slows.
   */
  handleCommand(text) {
    const digout = parseSetDigoutCommand(text);
    if (digout) {
      this._applyDigout(digout, false);
      return formatSetDigoutReply(this.dout, this.doutTimeouts);
    }
    const word = text.trim().split(/\s+/)[0]?.toLowerCase();
    if (word === 'getio') {
      return `DI1:${this.ignitionOn ? 1 : 0} DI2:0 DO1:${this.dout[0]} DO2:${this.dout[1]} AIN1:0 AIN2:0`;
    }
    return 'unknown command or invalid format';
  }

  _applyDigout(digout, fromQueue) {
    const held = { levels: [null, null], timeouts: [null, null], maxSpeeds: [null, null] };
    let anyHeld = false;
    digout.levels.forEach((level, i) => {
      if (level == null) return;
      const ceiling = digout.maxSpeeds[i];
      if (!fromQueue && ceiling != null && this.speedKph > ceiling) {
        held.levels[i] = level;
        held.timeouts[i] = digout.timeouts[i];
        held.maxSpeeds[i] = ceiling;
        anyHeld = true;
        return;
      }
      this.dout[i] = level;
      this.doutTimeouts[i] = digout.timeouts[i] ?? 0;
      this.doutRevertAt[i] =
        level === 1 && this.doutTimeouts[i] > 0 ? Date.now() + this.doutTimeouts[i] * 1000 : 0;
    });
    this.pendingDigout = anyHeld ? held : null;
  }

  /** A timed output drops on its own once its timeout has run, as on the real unit. */
  _expireDigouts() {
    this.doutRevertAt.forEach((at, i) => {
      if (at && Date.now() >= at) {
        this.dout[i] = 0;
        this.doutTimeouts[i] = 0;
        this.doutRevertAt[i] = 0;
      }
    });
  }

  /** Whether `nowMs` falls inside the profile's working day. */
  onShift(nowMs) {
    if (!this.workHoursUtc) return true;
    const d = new Date(nowMs);
    const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
    return hour >= this.workHoursUtc[0] && hour < this.workHoursUtc[1];
  }

  // FMC150 scenario events ride on eventful records: the AVL event field names
  // the triggering IO element. One event per record, so extras queue up.
  _queueEvent(eventId, ioElements) {
    this.pendingEvents.push({ eventId, ioElements });
  }

  _generateScenarioEvents() {
    // Trip start/stop on ignition transitions (AVL 250)
    if (this.ignitionOn !== this.prevIgnition) {
      this._queueEvent(250, [{ id: 250, size: 1, value: this.ignitionOn ? 1 : 0 }]);
    }

    // Excessive idling start/end (AVL 251)
    const isIdle = this.ignitionOn && this.phase === 'idle';
    if (isIdle !== this.prevIdle) {
      this._queueEvent(251, [{ id: 251, size: 1, value: isIdle ? 1 : 0 }]);
    }

    if (this.phase === 'driving' && this.ignitionOn) {
      // Occasional green-driving violations (AVL 253 type + 254 g×100)
      if (Math.random() < 0.04) {
        const type = 1 + Math.floor(Math.random() * 3);
        const gTimes100 = 25 + Math.floor(Math.random() * 40);
        this._queueEvent(253, [
          { id: 253, size: 1, value: type },
          { id: 254, size: 1, value: gTimes100 },
        ]);
      }

      // Occasional overspeed burst (AVL 255 carries the speed)
      if (Math.random() < 0.03) {
        this.speedKph = 92 + Math.floor(Math.random() * 18);
        this._queueEvent(255, [{ id: 255, size: 2, value: this.speedKph }]);
      }
    }

    // Scripted security incidents for demo profiles
    if (this.profile.securityDemo) {
      const fireOnce = (key, tick, eventId, ioElements) => {
        if (this.tick >= tick && !this.securityEventsFired.has(key)) {
          this.securityEventsFired.add(key);
          this._queueEvent(eventId, ioElements);
        }
      };
      fireOnce('towing', 30, 246, [{ id: 246, size: 1, value: 1 }]);
      fireOnce('jam_on', 60, 249, [{ id: 249, size: 1, value: 1 }]);
      fireOnce('jam_off', 63, 249, [{ id: 249, size: 1, value: 0 }]);
      fireOnce('unplug', 90, 252, [{ id: 252, size: 1, value: 1 }]);
      fireOnce('replug', 94, 252, [{ id: 252, size: 1, value: 0 }]);
    }

    this.prevIgnition = this.ignitionOn;
    this.prevIdle = isIdle;
  }

  // Walks the route, spending the tick's distance across as many points as it
  // covers. The earlier version stepped one waypoint per tick whenever the
  // next was within 150 m — fine for a six-corner Lagos loop, but on road
  // geometry with points every 30 m a car hopped a point a tick whatever its
  // speed, and the odometer counted distance it had not drawn.
  _moveTowardWaypoint(distanceKm) {
    const kmPerDegLat = 111;
    const kmPerDegLng = 111 * Math.cos((this.lat * Math.PI) / 180);
    let remaining = distanceKm;
    let moved = 0;
    // Bounded so a zero-length loop cannot spin forever.
    for (let guard = 0; remaining > 1e-6 && guard < this.waypoints.length + 2; guard += 1) {
      const target = this.waypoints[this.waypointIndex];
      const dLat = target.lat - this.lat;
      const dLng = target.lng - this.lng;
      const distKm = Math.hypot(dLat * kmPerDegLat, dLng * kmPerDegLng);
      if (distKm <= remaining) {
        this.lat = target.lat;
        this.lng = target.lng;
        if (distKm > 0) this.heading = Math.atan2(dLng * kmPerDegLng, dLat * kmPerDegLat);
        remaining -= distKm;
        moved += distKm;
        if (this.waypointIndex === this.waypoints.length - 1) {
          // End of the path. A loop starts over; a commute is finished and
          // the car holds at its end until the mode changes.
          this.lapDone = true;
          if (this.mode === 'commute_out' || this.mode === 'returning') break;
          this.waypointIndex = 0;
        } else {
          this.waypointIndex += 1;
        }
        continue;
      }
      const ratio = remaining / distKm;
      this.lat += dLat * ratio;
      this.lng += dLng * ratio;
      this.heading = Math.atan2(dLng * kmPerDegLng, dLat * kmPerDegLat);
      moved += remaining;
      remaining = 0;
    }
    return moved;
  }

  nextRecord(nowMs = Date.now()) {
    if (this.stopped) return null;

    this.tick += 1;
    this.phaseTicks += 1;

    const offShift = !this.onShift(nowMs);
    if (offShift) {
      // Parked for the night.
      this.phase = 'parked';
      this.phaseTicks = 0;
      this.ignitionOn = false;
      this.speedKph = 0;
      this.offShiftParked = true;
    } else {
      // Only the overnight park is cut short by the start of the shift. An
      // earlier check keyed on "parked with the clock at zero" and matched
      // every rest between runs too, so no car ever stayed stopped for more
      // than one tick — 75 hours of ignition in an 88-hour week.
      if (this.offShiftParked) {
        this.offShiftParked = false;
        if (this.depot) this._enterMode('commute_out');
        else {
          this.phase = 'driving';
          this.ignitionOn = true;
          this.phaseTicks = 0;
        }
      }
      if (this.depot) this._advanceDay(nowMs);
      // Commutes drive straight through; rests belong to the district loop.
      if (this.mode === 'loop') this._advancePhase();
    }

    this._expireDigouts();
    // A held setdigout goes through once the car is under its ceiling.
    if (this.pendingDigout) {
      const ceiling = Math.min(
        ...this.pendingDigout.maxSpeeds.filter((v) => v != null)
      );
      if (this.speedKph <= ceiling) this._applyDigout(this.pendingDigout, true);
    }

    // The relay: with DOUT1 high the starter circuit is open, so whatever
    // the day's plan says, the car does not start. It parks where it is and
    // stays there until the output drops.
    if (this.dout[0] === 1) {
      this.phase = 'parked';
      this.ignitionOn = false;
      this.speedKph = 0;
    }

    let theftSimulated = false;
    const intervalHours = this.tickIntervalMs / 3600000;

    if (this.phase === 'driving' && this.ignitionOn) {
      // A real car does not pick a fresh 35–75 every tick. It eases toward a
      // cruising speed, and every so often meets traffic and crawls for a
      // few minutes — which is also what the trail's "slow traffic" marker
      // and the idle model need to have something to show.
      if (this.crawlTicks > 0) {
        this.crawlTicks -= 1;
        this.targetSpeed = 6 + Math.random() * 8;
      } else if (Math.random() < 0.03) {
        this.crawlTicks = 8 + Math.floor(Math.random() * 15);
      } else if (this.tick % 6 === 0 || this.targetSpeed == null) {
        const [lo, hi] = this.profile.cruiseKph ?? [30, 70];
        this.targetSpeed = lo + Math.random() * (hi - lo);
      }
      this.speedKph = Math.round(
        this.speedKph + (this.targetSpeed - this.speedKph) * 0.45 + (Math.random() - 0.5) * 6
      );
      this.speedKph = Math.max(3, Math.min(this.speedKph, 95));
      let distanceKm = this.speedKph * intervalHours;
      distanceKm = this._moveTowardWaypoint(distanceKm);
      this.odometerKm += distanceKm;
      const burn = fuelUsedForDistanceKm(distanceKm, this.efficiencyKmL);
      this.fuelLevel = Math.max(8, this.fuelLevel - burn);
    } else if (this.phase === 'idle' && this.ignitionOn) {
      this.speedKph = 0;
      this.fuelLevel = Math.max(8, this.fuelLevel - idleFuelBurnLiters(intervalHours));
    } else {
      this.speedKph = 0;
      this.ignitionOn = false;
    }

    if (this.profile.refuelEvery && this.tick % this.profile.refuelEvery === 0) {
      this.fuelLevel = Math.min(this.tankCapacity, this.fuelLevel + 28);
    }

    if (this.fuelLevel < 14 && this.phase === 'driving') {
      this.fuelLevel = Math.min(this.tankCapacity, this.fuelLevel + 30);
    }

    if (this.phase === 'theft' && !this.theftDone) {
      const drop = this.profile.theftDropLiters ?? 18;
      this.fuelLevel = Math.max(8, (this.fuelAtPark ?? this.fuelLevel) - drop);
      this.theftDone = true;
      this.phase = 'parked';
      this.phaseTicks = 0;
      theftSimulated = true;
    }

    if (this.profile.offlineAfterTicks && this.tick >= this.profile.offlineAfterTicks) {
      this.stopped = true;
      return null;
    }

    this._generateScenarioEvents();
    const scenarioEvent = this.pendingEvents.shift() ?? null;

    return buildCodecRecord({
      fuelLevel: this.fuelLevel,
      odometerKm: Math.round(this.odometerKm),
      lat: this.lat,
      lng: this.lng,
      speedKph: this.speedKph,
      ignitionOn: this.ignitionOn,
      headingDeg: (this.heading * 180) / Math.PI,
      eventId: scenarioEvent?.eventId ?? 0,
      extraIo: [
        { id: DOUT1_AVL_ID, size: 1, value: this.dout[0] },
        { id: DOUT2_AVL_ID, size: 1, value: this.dout[1] },
        ...(scenarioEvent?.ioElements ?? []),
      ],
      meta: {
        theftSimulated,
        scenarioEventId: scenarioEvent?.eventId,
        offShift,
        immobilized: this.dout[0] === 1,
      },
    });
  }

  _advanceDay(nowMs) {
    const d = new Date(nowMs);
    const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
    if (this.mode === 'at_base') {
      // Waiting at the office for the shift to start is handled by the
      // off-shift wake; a car at base during the shift has finished its day.
      return;
    }
    if (this.mode === 'commute_out' && this.lapDone) {
      this._enterMode('loop');
      return;
    }
    if (this.mode === 'loop' && hour >= this.depot.returnHourUtc) {
      // Past the return hour the car turns for the office at the next hub it
      // reaches — its own, or on the ring whichever comes first — rather
      // than finishing a lap that can run past the end of the shift. Already
      // at the office (the Mabushi loop passes the door) it simply parks.
      if (this._distanceKm(this.depot.office) < 0.3) {
        this._enterMode('at_base');
        return;
      }
      const hub = (this.depot.homeFrom ?? []).find((h) => this._distanceKm(h.hub) < 0.3);
      if (hub) {
        this.waypoints = hub.back;
        this.mode = 'returning';
        this.lapDone = false;
        this.waypointIndex = this._nearestIndex(this.waypoints);
        this.phase = 'driving';
        this.ignitionOn = true;
        this.phaseTicks = 0;
        return;
      }
    }
    if (this.mode === 'loop' && this.lapDone) this.lapDone = false;
    if (this.mode === 'returning' && this.lapDone) {
      this._enterMode('at_base');
    }
  }

  _advancePhase() {
    const p = this.profile;

    if (p.theftTarget && !this.theftDone) {
      // 'theft' resolves in nextRecord; 'pre_theft_park' must fall through
      // to the transition below, or the car parks for the theft and never
      // leaves — two demo cars sat out a whole week that way.
      if (this.phase === 'theft') return;
      if (this.phase !== 'pre_theft_park' && this.phaseTicks >= (p.theftAfterTicks ?? 10)) {
        this.phase = 'pre_theft_park';
        this.phaseTicks = 0;
        this.ignitionOn = false;
        this.speedKph = 0;
        this.fuelAtPark = this.fuelLevel;
        return;
      }
    }

    if (this.phase === 'pre_theft_park') {
      if (this.phaseTicks >= (p.theftParkTicks ?? 3)) {
        this.phase = 'theft';
        this.phaseTicks = 0;
      }
      return;
    }

    // A parked or idle phase can run longer than a driving one: a delivery
    // van spends more of its day at the kerb than on the road, and the
    // driving-hours figure should say so.
    // The length of the current phase is drawn once, when it starts, and
    // varies ±30% around the profile's figure — a fleet whose every car
    // drove for exactly twelve minutes and parked for exactly fourteen read
    // as a metronome, and put a "P" on the map every ten minutes.
    if (this.cycleTarget == null) {
      // Minutes where the profile gives them, so the rhythm is the same
      // whatever the tick — the seeder steps 30 s, the live fleet 12 s.
      const driveTicks =
        p.driveMinutes != null ? (p.driveMinutes * 60_000) / this.tickIntervalMs : (p.driveCycleTicks ?? 20);
      const base = driveTicks * (this.phase === 'driving' ? 1 : p.restCycleFactor ?? 1);
      this.cycleTarget = Math.max(2, Math.round(base * (0.7 + Math.random() * 0.6)));
    }
    if (this.phaseTicks >= this.cycleTarget) {
      this.phaseTicks = 0;
      this.cycleTarget = null;
      if (this.phase === 'driving') {
        const idleChance = p.idleRatio ?? 0.2;
        if (p.idleTarget || idleChance > Math.random()) {
          this.phase = 'idle';
          this.ignitionOn = true;
        } else {
          this.phase = 'parked';
          this.ignitionOn = false;
        }
      } else if (this.phase !== 'theft') {
        this.phase = 'driving';
        this.ignitionOn = true;
      }
    }
  }
}

const buildCodecRecord = ({
  fuelLevel,
  odometerKm,
  lat,
  lng,
  speedKph,
  ignitionOn,
  headingDeg = 0,
  eventId = 0,
  extraIo = [],
  meta = {},
}) => {
  const ioElements = [
    { id: 239, size: 1, value: ignitionOn ? 1 : 0 },
    { id: 112, size: 4, value: odometerKm * 1000 },
    { id: 390, size: 4, value: Math.round(fuelLevel * 100) },
    ...extraIo,
  ];

  return {
    timestamp: Date.now(),
    priority: 0,
    eventId,
    gps: {
      latitude: lat,
      longitude: lng,
      altitude: 80 + Math.random() * 40,
      angle: Math.round(((headingDeg % 360) + 360) % 360),
      satellites: Math.floor(Math.random() * 4) + 10,
      speed: speedKph,
    },
    ioElements,
    meta: { fuelLevel, ignitionOn, speedKph, odometerKm, ...meta },
  };
};

// NOTE: these profiles intentionally carry NO startLat/startLng. Each
// vehicle's origin is resolved at runtime from its device's last real
// telemetry fix (fleet-simulator.js -> withResolvedOrigins). Re-adding a
// coordinate here would reintroduce the bug where the map asserted a location
// the device had never reported.
const DEFAULT_FLEET_PROFILES = [
  {
    imei: '356307042441013',
    label: 'LND-772-AA',
    model: 'Hilux',
    routeLoop: 'island',
    initialFuel: 42,
    tankCapacity: 60,
    initialOdometer: 45230,
    idleTarget: true,
    idleRatio: 0.45,
    driveCycleTicks: 14,
  },
  {
    imei: '356307042441014',
    label: 'IKD-109-BY',
    model: 'Hiace',
    routeLoop: 'mainland',
    initialFuel: 48,
    tankCapacity: 55,
    initialOdometer: 67890,
    theftTarget: true,
    theftAfterTicks: 14,
    theftDropLiters: 20,
    driveCycleTicks: 18,
    refuelEvery: 80,
  },
  {
    imei: '356307042441015',
    label: 'GGE-442-XM',
    model: 'Hilux',
    routeLoop: 'lekki',
    initialFuel: 35,
    tankCapacity: 70,
    initialOdometer: 102345,
    driveCycleTicks: 16,
  },
  {
    imei: '356307042441016',
    label: 'KJA-901-CS',
    model: 'Camry',
    routeLoop: 'ikeja',
    initialFuel: 52,
    tankCapacity: 50,
    initialOdometer: 8901,
    driveCycleTicks: 18,
  },
  {
    imei: '356307042441017',
    label: 'PHC-302-RY',
    model: 'RAV4',
    routeLoop: 'yaba',
    initialFuel: 40,
    tankCapacity: 55,
    initialOdometer: 15200,
    theftTarget: true,
    theftAfterTicks: 8,
    theftDropLiters: 22,
    driveCycleTicks: 16,
    securityDemo: true,
  },
];

module.exports = {
  VehicleSimulator,
  buildCodecRecord,
  DEFAULT_FLEET_PROFILES,
};
