/**
 * Whether the DJ is on camera right now.
 *
 * Asked of the video server rather than told by it, and that is what keeps this
 * small. MediaMTX answers its playlist with a 200 while OBS is publishing and a
 * 404 while it is not, so going live needs no button, no webhook and no
 * credentials shared between the two machines: start streaming in OBS and every
 * page finds out.
 *
 * It is separate from `OnAir` on purpose. That is the session the decks and the
 * chat belong to; this is one camera that may or may not be pointing at them.
 */

export interface VideoSnapshot {
  live: boolean
  /** Where a player should fetch the stream, and null while there is none. */
  url: string | null
}

export interface LiveVideoOptions {
  /** The public HLS playlist, or null on a station with no video server. */
  url: string | null
  fetchFn?: typeof fetch
  intervalMs?: number
  timeoutMs?: number
  /**
   * How many failed checks in a row end the broadcast. More than one, because
   * a single dropped poll would otherwise tear the player out of every page in
   * the middle of a set.
   */
  missesToEnd?: number
}

export class LiveVideo {
  private readonly url: string | null
  private readonly fetchFn: typeof fetch
  private readonly intervalMs: number
  private readonly timeoutMs: number
  private readonly missesToEnd: number
  private live = false
  private misses = 0
  private timer: NodeJS.Timeout | null = null

  constructor(options: LiveVideoOptions) {
    this.url = options.url
    this.fetchFn = options.fetchFn ?? fetch
    this.intervalMs = options.intervalMs ?? 5_000
    this.timeoutMs = options.timeoutMs ?? 4_000
    this.missesToEnd = options.missesToEnd ?? 3
  }

  snapshot(): VideoSnapshot {
    return { live: this.live, url: this.live ? this.url : null }
  }

  /** One look at the video server. Public so the tests need no timers. */
  async check(): Promise<void> {
    if (this.url === null) return
    if (await this.isPublishing(this.url)) {
      this.live = true
      this.misses = 0
      return
    }
    this.misses += 1
    if (this.misses >= this.missesToEnd) this.live = false
  }

  start(): void {
    if (this.url === null || this.timer !== null) return
    const tick = (): void => {
      void this.check().finally(() => {
        if (this.timer === null) return
        this.timer = setTimeout(tick, this.intervalMs)
        this.timer.unref()
      })
    }
    this.timer = setTimeout(tick, 0)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  private async isPublishing(url: string): Promise<boolean> {
    try {
      const response = await this.fetchFn(url, {
        signal: AbortSignal.timeout(this.timeoutMs),
      })
      await response.body?.cancel()
      return response.ok
    } catch {
      return false
    }
  }
}
