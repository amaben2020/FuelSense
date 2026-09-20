// Per-device detector state that survives a restart.
//
// Every detector on the ingest path (idling, trip start, fuel stop, the
// write floor) keeps a small piece of state per IMEI. That used to live only
// in a Map, so a deploy mid-idle forgot the episode and the next frame
// started a fresh one — the driver was under-reported, and the same restart
// could re-announce a trip that was already under way.
//
// The design here is memory first, Redis second:
//
//   - The in-process Map is the source of truth while the process runs. Reads
//     never wait on the network once a device's state is in memory.
//   - Redis holds a copy, written through on every change and read exactly
//     once per device: the first time a frame arrives after boot.
//   - Redis being slow, down, or unconfigured changes nothing except that a
//     restart forgets state — which is precisely the behaviour before this
//     file existed. No frame is ever dropped or delayed past one short
//     timeout, and after a failure Redis is left alone for a while rather
//     than paid for on every record.
//
// Keys are namespaced per detector and carry a TTL, so a device that goes
// dark cannot leave a stale episode waiting for it weeks later.
import { redis, redisConfigured } from '../config/redis';
import { detectorStateOps } from '../config/metrics';

/** How long a single Redis read may hold up a frame. */
const READ_TIMEOUT_MS = Number(process.env.DETECTOR_STATE_REDIS_TIMEOUT_MS || 800);

/** After a failure, how long to run memory-only before trying Redis again. */
const BACKOFF_MS = Number(process.env.DETECTOR_STATE_REDIS_BACKOFF_MS || 30_000);

let redisPausedUntil = 0;

const redisAvailable = (): boolean => redisConfigured && Date.now() >= redisPausedUntil;

const pauseRedis = (): void => {
  redisPausedUntil = Date.now() + BACKOFF_MS;
};

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`redis timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });

export interface DetectorStateOptions<T> {
  /** Seconds a device's entry lives in Redis without being touched. */
  ttlSeconds: number;
  /** Turn the stored JSON back into the live shape (revive Dates, etc.). */
  revive?: (raw: unknown) => T;
}

export class DetectorState<T> {
  private readonly memory = new Map<string, T>();
  /** Devices whose Redis copy has been consulted since boot. */
  private readonly hydrated = new Set<string>();

  constructor(
    private readonly name: string,
    private readonly options: DetectorStateOptions<T>
  ) {}

  private key(imei: string): string {
    return `fs:detector:${this.name}:${imei}`;
  }

  /**
   * The device's current state, or null. Memory answers whenever it can;
   * Redis is asked once per device after boot, and only while it is healthy.
   */
  async get(imei: string): Promise<T | null> {
    const inMemory = this.memory.get(imei);
    if (inMemory !== undefined) return inMemory;
    if (this.hydrated.has(imei) || !redisAvailable()) return null;

    // Whatever happens below, the device is not asked about again this
    // boot: a second lookup could only return what memory already holds.
    this.hydrated.add(imei);
    try {
      const raw = await withTimeout(redis.get<unknown>(this.key(imei)), READ_TIMEOUT_MS);
      if (raw === null || raw === undefined) {
        detectorStateOps.inc({ store: this.name, op: 'restore', outcome: 'miss' });
        return null;
      }
      const value = this.options.revive ? this.options.revive(raw) : (raw as T);
      this.memory.set(imei, value);
      detectorStateOps.inc({ store: this.name, op: 'restore', outcome: 'hit' });
      return value;
    } catch (err) {
      detectorStateOps.inc({ store: this.name, op: 'restore', outcome: 'error' });
      pauseRedis();
      console.warn(`[detector-state] ${this.name}: restore skipped — ${(err as Error).message}`);
      return null;
    }
  }

  /** Records the new state. Memory is updated before this returns; the Redis
   *  copy is written in the background and its failure is not the caller's. */
  set(imei: string, value: T): void {
    this.memory.set(imei, value);
    this.hydrated.add(imei);
    this.persist(imei, value);
  }

  delete(imei: string): void {
    this.memory.delete(imei);
    this.hydrated.add(imei);
    if (!redisAvailable()) return;
    redis
      .del(this.key(imei))
      .then(() => detectorStateOps.inc({ store: this.name, op: 'delete', outcome: 'ok' }))
      .catch((err: Error) => {
        detectorStateOps.inc({ store: this.name, op: 'delete', outcome: 'error' });
        pauseRedis();
        console.warn(`[detector-state] ${this.name}: delete not persisted — ${err.message}`);
      });
  }

  /** Forgets everything in memory. Tests and backfills only — Redis is left
   *  as it is, so a test cannot wipe production state by accident. */
  clear(imei?: string): void {
    if (imei) {
      this.memory.delete(imei);
      this.hydrated.delete(imei);
    } else {
      this.memory.clear();
      this.hydrated.clear();
    }
  }

  private persist(imei: string, value: T): void {
    if (!redisAvailable()) return;
    redis
      .set(this.key(imei), value, { ex: this.options.ttlSeconds })
      .then(() => detectorStateOps.inc({ store: this.name, op: 'persist', outcome: 'ok' }))
      .catch((err: Error) => {
        detectorStateOps.inc({ store: this.name, op: 'persist', outcome: 'error' });
        pauseRedis();
        console.warn(`[detector-state] ${this.name}: state not persisted — ${err.message}`);
      });
  }
}

/** Exposed so tests can prove the backoff, and reset it between cases. */
export const detectorStateRedisStatus = {
  isPaused: (): boolean => Date.now() < redisPausedUntil,
  reset: (): void => {
    redisPausedUntil = 0;
  },
};
