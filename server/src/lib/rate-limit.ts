/**
 * Pacing, for the two things a stranger can ask the station to do repeatedly:
 * talk in the room, and guess the admin password.
 *
 * A token bucket rather than a fixed window because the natural way to do either
 * is a burst and then nothing, which a window either refuses or barely limits.
 */

export interface RateLimitOptions {
  /** How many times something can be done back to back. */
  burst: number
  /** How long one of those costs to earn back. */
  refillMs: number
  now?: () => number
}

export class RateLimit {
  readonly #burst: number
  readonly #refillMs: number
  readonly #now: () => number
  #tokens: number
  #last: number

  constructor({ burst, refillMs, now = Date.now }: RateLimitOptions) {
    this.#burst = burst
    this.#refillMs = refillMs
    this.#now = now
    this.#tokens = burst
    this.#last = now()
  }

  /** True if this one is allowed, and spends the token if so. */
  take(): boolean {
    const at = this.#now()
    this.#tokens = Math.min(this.#burst, this.#tokens + (at - this.#last) / this.#refillMs)
    this.#last = at
    if (this.#tokens < 1) return false
    this.#tokens -= 1
    return true
  }

  /** How long until the next token, in ms. Zero when one is available now. */
  retryAfterMs(): number {
    const at = this.#now()
    const tokens = Math.min(this.#burst, this.#tokens + (at - this.#last) / this.#refillMs)
    return tokens >= 1 ? 0 : Math.ceil((1 - tokens) * this.#refillMs)
  }

  /** Back to a full bucket: what a success earns after a run of failures. */
  reset(): void {
    this.#tokens = this.#burst
    this.#last = this.#now()
  }
}

export interface KeyedRateLimitOptions extends RateLimitOptions {
  /**
   * Ceiling on how many buckets are held at once.
   *
   * Without it, a key that anyone can choose (a client address) is a map an
   * attacker grows for free. The eviction it forces only ever *resets* a
   * limiter, so the cost of being wrong here is bounded by the cap.
   */
  maxKeys?: number
}

const DEFAULT_MAX_KEYS = 1_024

/**
 * One bucket per key, with the map kept bounded.
 *
 * Buckets that have sat long enough to refill completely are indistinguishable
 * from ones that never existed, so they are dropped first and nothing is lost by
 * it. Only when that isn't enough does this fall back to evicting the least
 * recently used, which is why every access moves its key to the end of the map.
 */
export class KeyedRateLimit {
  readonly #options: RateLimitOptions
  readonly #now: () => number
  readonly #maxKeys: number
  /** Time for an empty bucket to refill completely. See `#prune`. */
  readonly #idleMs: number
  readonly #buckets = new Map<string, { limit: RateLimit; seenAt: number }>()

  constructor({ burst, refillMs, now = Date.now, maxKeys = DEFAULT_MAX_KEYS }: KeyedRateLimitOptions) {
    this.#options = { burst, refillMs, now }
    this.#now = now
    this.#maxKeys = maxKeys
    this.#idleMs = burst * refillMs
  }

  get size(): number {
    return this.#buckets.size
  }

  take(key: string): boolean {
    return this.#bucket(key).take()
  }

  retryAfterMs(key: string): number {
    return this.#buckets.get(key)?.limit.retryAfterMs() ?? 0
  }

  /** Forget a key's history. What a success earns after a run of failures. */
  reset(key: string): void {
    this.#buckets.delete(key)
  }

  #bucket(key: string): RateLimit {
    const existing = this.#buckets.get(key)
    if (existing) {
      // Delete and re-set so the map's insertion order is recency order, which
      // is what makes the eviction below least-recently-used.
      this.#buckets.delete(key)
      existing.seenAt = this.#now()
      this.#buckets.set(key, existing)
      return existing.limit
    }

    if (this.#buckets.size >= this.#maxKeys) this.#prune()

    const limit = new RateLimit(this.#options)
    this.#buckets.set(key, { limit, seenAt: this.#now() })
    return limit
  }

  #prune(): void {
    const cutoff = this.#now() - this.#idleMs
    for (const [key, entry] of this.#buckets) {
      if (entry.seenAt <= cutoff) this.#buckets.delete(key)
    }
    // Still full of live buckets: drop the oldest until there is room. Iteration
    // order is oldest-first, so the first key is the least recently used.
    while (this.#buckets.size >= this.#maxKeys) {
      const oldest = this.#buckets.keys().next()
      if (oldest.done) return
      this.#buckets.delete(oldest.value)
    }
  }
}
