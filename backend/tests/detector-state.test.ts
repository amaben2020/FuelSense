import { describe, it, expect, beforeEach, jest } from '@jest/globals'

// The store must behave identically with Redis healthy, slow, down, or
// absent — only restart survival differs. These cases drive a fake client
// through each of those and check that memory always wins.
const fake = {
  get: jest.fn<(k: string) => Promise<unknown>>(),
  set: jest.fn<(k: string, v: unknown, o?: unknown) => Promise<unknown>>(),
  del: jest.fn<(k: string) => Promise<unknown>>(),
}
let configured = true
jest.mock('../src/config/redis', () => ({
  get redisConfigured() {
    return configured
  },
  redis: fake,
}))

import { DetectorState, detectorStateRedisStatus } from '../src/shared/detector-state'

const flush = () => new Promise((r) => setImmediate(r))

describe('DetectorState', () => {
  beforeEach(() => {
    fake.get.mockReset()
    fake.set.mockReset()
    fake.del.mockReset()
    fake.set.mockResolvedValue('OK')
    fake.del.mockResolvedValue(1)
    configured = true
    detectorStateRedisStatus.reset()
  })

  it('restores a device once from Redis, then answers from memory', async () => {
    fake.get.mockResolvedValueOnce({ idleSince: '2026-09-20T10:00:00.000Z', startEmitted: true })
    const store = new DetectorState<{ idleSince: Date; startEmitted: boolean }>('t', {
      ttlSeconds: 60,
      revive: (raw) => {
        const r = raw as { idleSince: string; startEmitted: boolean }
        return { ...r, idleSince: new Date(r.idleSince) }
      },
    })
    const first = await store.get('imei-1')
    expect(first?.idleSince).toBeInstanceOf(Date)
    expect(first?.idleSince.toISOString()).toBe('2026-09-20T10:00:00.000Z')
    await store.get('imei-1')
    expect(fake.get).toHaveBeenCalledTimes(1)
  })

  it('a miss in Redis is not asked again this boot', async () => {
    fake.get.mockResolvedValue(null)
    const store = new DetectorState<number>('t', { ttlSeconds: 60 })
    expect(await store.get('x')).toBeNull()
    expect(await store.get('x')).toBeNull()
    expect(fake.get).toHaveBeenCalledTimes(1)
  })

  it('writes through to Redis with the TTL and keeps memory current', async () => {
    fake.get.mockResolvedValue(null)
    const store = new DetectorState<number>('t', { ttlSeconds: 60 })
    store.set('x', 5)
    expect(await store.get('x')).toBe(5)
    await flush()
    expect(fake.set).toHaveBeenCalledWith('fs:detector:t:x', 5, { ex: 60 })
    store.delete('x')
    expect(await store.get('x')).toBeNull()
    await flush()
    expect(fake.del).toHaveBeenCalledWith('fs:detector:t:x')
    // Deleting settles the device: memory is authoritative, no re-read.
    expect(fake.get).not.toHaveBeenCalled()
  })

  it('a Redis failure falls back to memory and pauses Redis', async () => {
    fake.get.mockRejectedValue(new Error('ECONNREFUSED'))
    const store = new DetectorState<number>('t', { ttlSeconds: 60 })
    expect(await store.get('x')).toBeNull()
    expect(detectorStateRedisStatus.isPaused()).toBe(true)
    store.set('x', 1)
    expect(await store.get('x')).toBe(1)
    await flush()
    expect(fake.set).not.toHaveBeenCalled()
    // Another device during the pause never touches Redis either.
    expect(await store.get('y')).toBeNull()
    expect(fake.get).toHaveBeenCalledTimes(1)
  })

  it('a slow Redis is abandoned after the timeout, not waited on', async () => {
    fake.get.mockReturnValue(new Promise(() => {}))
    const store = new DetectorState<number>('t', { ttlSeconds: 60 })
    const started = Date.now()
    expect(await store.get('x')).toBeNull()
    expect(Date.now() - started).toBeLessThan(2000)
    expect(detectorStateRedisStatus.isPaused()).toBe(true)
  })

  it('an unconfigured Redis means memory only, with no calls at all', async () => {
    configured = false
    const store = new DetectorState<number>('t', { ttlSeconds: 60 })
    store.set('x', 2)
    expect(await store.get('x')).toBe(2)
    store.delete('x')
    await flush()
    expect(fake.get).not.toHaveBeenCalled()
    expect(fake.set).not.toHaveBeenCalled()
    expect(fake.del).not.toHaveBeenCalled()
  })

  it('clear() forgets memory but leaves the Redis copy alone', async () => {
    fake.get.mockResolvedValue(7)
    const store = new DetectorState<number>('t', { ttlSeconds: 60 })
    store.set('x', 3)
    store.clear()
    expect(await store.get('x')).toBe(7)
    await flush()
    expect(fake.del).not.toHaveBeenCalled()
  })
})
