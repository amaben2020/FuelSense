// The FMC130 and FMC150 digital-output command set, as documented in
// Teltonika's "FMC SMS/GPRS Commands" reference. Both units carry two
// open-collector outputs, DOUT1 and DOUT2; an immobilizer install drives a
// relay in the starter circuit from one of them.
//
//   setdigout ## Y1 Y2 Z1 Z2
//     #  – 0 (off), 1 (on) or ? (leave unchanged), one per output
//     Y  – timeout in seconds after which the output reverts; 0 = permanent
//     Z  – maximum speed: above it the device queues the command and only
//          executes once the vehicle has slowed below the threshold
//
//   reply: "DOUTS are set to:10 TMOs are: 0 0"
//
// The device also reports each output's level in every AVL record — element
// 179 for DOUT1, 180 for DOUT2 — which is the only evidence, other than the
// reply, that the relay side actually changed.

export const DOUT1_AVL_ID = 179;
export const DOUT2_AVL_ID = 180;
/** The device's own iButton/RFID authorisation scenario, not remote cutoff:
 *  0 no key, 1 authorised key, 2 unauthorised key. */
export const IMMOBILIZER_SCENARIO_AVL_ID = 248;

export type DoutOutput = 1 | 2;
export type DoutLevel = 0 | 1;

export interface SetDigoutOptions {
  output: DoutOutput;
  level: DoutLevel;
  /** Seconds before the output reverts. Omitted or 0 means it holds. */
  timeoutSeconds?: number;
  /** Speed ceiling (km/h) for the device to act; above it the command waits. */
  maxSpeedKph?: number;
}

/**
 * Builds a `setdigout` for one output, leaving the other exactly as it is.
 * A speed guard or timeout for DOUT1 still has to fill DOUT2's slots, since
 * the arguments are positional — those get `?` too.
 */
export function buildSetDigout(opts: SetDigoutOptions): string {
  const levels: string[] = ['?', '?'];
  levels[opts.output - 1] = String(opts.level);
  const parts = [`setdigout ${levels.join('')}`];

  const hasTimeout = opts.timeoutSeconds != null;
  const hasSpeed = opts.maxSpeedKph != null;
  if (hasTimeout || hasSpeed) {
    const timeouts = ['?', '?'];
    timeouts[opts.output - 1] = String(Math.max(0, Math.round(opts.timeoutSeconds ?? 0)));
    parts.push(...timeouts);
  }
  if (hasSpeed) {
    const speeds = ['?', '?'];
    speeds[opts.output - 1] = String(Math.max(0, Math.round(opts.maxSpeedKph!)));
    parts.push(...speeds);
  }
  return parts.join(' ');
}

export interface SetDigoutReply {
  /** One character per output as the device now holds them, e.g. "10". */
  levels: string;
  timeouts: number[];
}

const REPLY_RE = /DOUTS\s+are\s+set\s+to:\s*([01?]+)(?:\s+TMOs\s+are:\s*([\d\s]+))?/i;

/** Parses the device's reply to `setdigout`; null for any other text. */
export function parseSetDigoutReply(text: string): SetDigoutReply | null {
  const match = REPLY_RE.exec(text);
  if (!match) return null;
  const timeouts = (match[2] ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(Number);
  return { levels: match[1], timeouts };
}

/** The level a reply reports for one output, or null when it says nothing about it. */
export function levelFromReply(reply: SetDigoutReply, output: DoutOutput): DoutLevel | null {
  const ch = reply.levels[output - 1];
  return ch === '0' || ch === '1' ? (Number(ch) as DoutLevel) : null;
}

export interface ParsedSetDigout {
  levels: (DoutLevel | null)[];
  timeouts: (number | null)[];
  maxSpeeds: (number | null)[];
}

/**
 * Reads a `setdigout` line the way the firmware does — used by the simulated
 * FMC150 so it obeys the same syntax the real unit would. Null when the line
 * is not a setdigout at all.
 */
export function parseSetDigoutCommand(line: string): ParsedSetDigout | null {
  const tokens = line.trim().split(/\s+/);
  if (tokens[0]?.toLowerCase() !== 'setdigout' || !tokens[1]) return null;
  const states = tokens[1];
  if (!/^[01?]{1,2}$/.test(states)) return null;

  const slot = (token: string | undefined): number | null =>
    token == null || token === '?' || !/^\d+$/.test(token) ? null : Number(token);

  const count = 2;
  const levels: (DoutLevel | null)[] = [];
  for (let i = 0; i < count; i += 1) {
    const ch = states[i];
    levels.push(ch === '0' || ch === '1' ? (Number(ch) as DoutLevel) : null);
  }
  const timeouts = [slot(tokens[2]), slot(tokens[3])];
  const maxSpeeds = [slot(tokens[4]), slot(tokens[5])];
  return { levels, timeouts, maxSpeeds };
}

/** Formats the reply a device gives after applying a setdigout. */
export function formatSetDigoutReply(levels: DoutLevel[], timeouts: number[]): string {
  return `DOUTS are set to:${levels.join('')} TMOs are: ${timeouts.join(' ')}`;
}
