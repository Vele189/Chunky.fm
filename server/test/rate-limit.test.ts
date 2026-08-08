import { describe, expect, it } from 'vitest'
import { KeyedRateLimit, RateLimit } from '../src/lib/rate-limit.js'
import { fakeClock } from './helpers.js'

/**
 * `RateLimit` itself is covered by the chat suite, which is where it was
 * written. What is new here is everything that comes of keying it on something
 * a stranger chooses: the map that holds the buckets, and what stops it from
 * being the thing that falls over instead.
 */
describe('RateLimit', () => {
  it('says how long until the next token, without spending one', () => {
    const clock = fakeClock()
    const limit = new RateLimit({ burst: 1, refillMs: 1_000, now: clock.now })

    expect(limit.retryAfterMs()).toBe(0)
    expect(limit.take()).toBe(true)
    expect(limit.retryAfterMs()).toBe(1_000)

    clock.advance(400)
    expect(limit.retryAfterMs()).toBe(600)
    // Asking twice is not spending: the answer is the same both times.
    expect(limit.retryAfterMs()).toBe(600)

    clock.advance(600)
    expect(limit.retryAfterMs()).toBe(0)
    expect(limit.take()).toBe(true)
  })

  it('is full again after a reset', () => {
    const clock = fakeClock()
    const limit = new RateLimit({ burst: 2, refillMs: 1_000, now: clock.now })

    expect(limit.take()).toBe(true)
    expect(limit.take()).toBe(true)
    expect(limit.take()).toBe(false)

    limit.reset()
    expect(limit.take()).toBe(true)
    expect(limit.take()).toBe(true)
  })
})

describe('KeyedRateLimit', () => {
  it('paces each key on its own', () => {
    const clock = fakeClock()
    const limits = new KeyedRateLimit({ burst: 1, refillMs: 1_000, now: clock.now })

    expect(limits.take('a')).toBe(true)
    expect(limits.take('a')).toBe(false)
    // What one caller has been doing is not the next caller's problem.
    expect(limits.take('b')).toBe(true)
  })

  it('forgets a key on reset', () => {
    const clock = fakeClock()
    const limits = new KeyedRateLimit({ burst: 1, refillMs: 1_000, now: clock.now })

    expect(limits.take('a')).toBe(true)
    expect(limits.take('a')).toBe(false)
    limits.reset('a')
    expect(limits.take('a')).toBe(true)
  })

  it('refills over time like the bucket it is', () => {
    const clock = fakeClock()
    const limits = new KeyedRateLimit({ burst: 1, refillMs: 1_000, now: clock.now })

    expect(limits.take('a')).toBe(true)
    expect(limits.take('a')).toBe(false)
    clock.advance(1_000)
    expect(limits.take('a')).toBe(true)
  })

  it('holds no more buckets than it said it would', () => {
    const clock = fakeClock()
    const limits = new KeyedRateLimit({ burst: 3, refillMs: 1_000, maxKeys: 8, now: clock.now })

    // The key is an address, which is to say it is whatever the caller decides
    // to be. Unbounded, that map is a memory leak anyone can drive; the cap is
    // what makes the worst case a fixed size rather than an open question.
    for (let i = 0; i < 10_000; i++) limits.take(`caller-${i}`)

    expect(limits.size).toBeLessThanOrEqual(8)
  })

  it('drops the buckets that have refilled on their own, which cost nothing', () => {
    const clock = fakeClock()
    const limits = new KeyedRateLimit({ burst: 2, refillMs: 1_000, maxKeys: 4, now: clock.now })

    for (const key of ['a', 'b', 'c']) limits.take(key)
    // Past the point where an empty bucket would have refilled completely, a
    // held bucket says nothing a fresh one wouldn't, so dropping it to make
    // room forgives nobody anything.
    clock.advance(2_001)
    for (let i = 0; i < 20; i++) limits.take(`newcomer-${i}`)

    expect(limits.size).toBeLessThanOrEqual(4)
  })

  it('does not let a caller rotate keys to flush their own throttle', () => {
    const clock = fakeClock()
    const limits = new KeyedRateLimit({ burst: 1, refillMs: 60_000, maxKeys: 4, now: clock.now })

    const guesser = 'still-guessing'
    expect(limits.take(guesser)).toBe(true)
    expect(limits.take(guesser)).toBe(false)

    // Every bucket here is live: no time passes, so nothing has refilled and
    // the cap has to evict something real. Whoever is still knocking is the
    // most recently used, so it is the last thing dropped: filling the map with
    // fresh keys is not a way to buy your own tokens back.
    for (let i = 0; i < 50; i++) {
      limits.take(`newcomer-${i}`)
      expect(limits.take(guesser), `after ${i} newcomers`).toBe(false)
    }

    expect(limits.size).toBeLessThanOrEqual(4)
  })
})
