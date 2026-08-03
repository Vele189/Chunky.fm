import type { Track } from './lib/track.js'
import { type PlaybackSnapshot, PlaybackState } from './playback.js'
import { type QueueEntry, TrackQueue } from './queue.js'

export interface StationOptions {
  /** Supply your own state (and clock) in tests; production builds its own. */
  playback?: PlaybackState
  queue?: TrackQueue
  /**
   * How often the backstop sweep checks whether the current track has run out.
   * This is the safety net, not the mechanism — the setTimeout below is what
   * normally advances the station.
   */
  backstopIntervalMs?: number
}

/** Slow enough to be free, fast enough that a missed timer isn't dead air. */
const DEFAULT_BACKSTOP_MS = 2_000

/**
 * The decks plus what's coming up next.
 *
 * PlaybackState knows only about the track that is on right now, and nothing in
 * it advances by itself. The Station adds the two pieces that make it a radio
 * station rather than a player: a queue, and a timer that moves to the next
 * track the moment the current one runs out.
 *
 * Scheduling hangs off PlaybackState's `change` event rather than off the
 * Station's own methods, so a caller that reaches for `station.playback`
 * directly — pause, seek, a track swapped from the admin routes — still gets a
 * correctly rescheduled advance.
 */
export class Station {
  readonly playback: PlaybackState
  readonly queue: TrackQueue
  readonly #backstopIntervalMs: number
  #advanceTimer: NodeJS.Timeout | null = null
  #backstop: NodeJS.Timeout | null = null
  #closed = false

  constructor({
    playback = new PlaybackState(),
    queue = new TrackQueue(),
    backstopIntervalMs = DEFAULT_BACKSTOP_MS,
  }: StationOptions = {}) {
    this.playback = playback
    this.queue = queue
    this.#backstopIntervalMs = backstopIntervalMs

    this.playback.on('change', this.#onPlaybackChange)

    // A setTimeout can fire late — or, if the event loop is blocked long
    // enough, effectively not at all — and the failure mode is silence until
    // someone notices. The sweep costs a comparison every couple of seconds.
    this.#backstop = setInterval(() => this.#advanceIfFinished(), this.#backstopIntervalMs)
    this.#backstop.unref()

    this.#reschedule()
  }

  /** Everything a client needs: the tuple, plus what's coming. */
  snapshot(): PlaybackSnapshot & { queue: QueueEntry[] } {
    return { ...this.playback.snapshot(), queue: this.queue.list() }
  }

  /**
   * Put a track at the back of the queue.
   *
   * An idle station starts playing it immediately — with nothing on the decks
   * there is nothing to wait for, and a queue that needs a separate `play` to
   * get going isn't a station. A *paused* station stays paused: that's the
   * admin's decision, not an empty deck.
   */
  enqueue(track: Track): QueueEntry {
    const entry = this.queue.add(track)
    if (this.playback.track === null) this.advance()
    return entry
  }

  /**
   * Move to the next queued track, or go off air when nothing is queued.
   * This is both what the end-of-track timer does and what `skip` does.
   */
  advance(): PlaybackSnapshot {
    const next = this.queue.take()
    return next ? this.playback.play(next.track) : this.playback.stop()
  }

  close(): void {
    this.#closed = true
    this.playback.off('change', this.#onPlaybackChange)
    if (this.#advanceTimer) clearTimeout(this.#advanceTimer)
    if (this.#backstop) clearInterval(this.#backstop)
    this.#advanceTimer = null
    this.#backstop = null
  }

  #onPlaybackChange = (): void => {
    this.#reschedule()
  }

  /** Time left on the current track, or null when nothing is running out. */
  #remainingMs(): number | null {
    const track = this.playback.track
    if (!track || !this.playback.isPlaying) return null
    return track.durationMs - this.playback.positionMs()
  }

  #reschedule(): void {
    if (this.#advanceTimer) {
      clearTimeout(this.#advanceTimer)
      this.#advanceTimer = null
    }
    if (this.#closed) return

    const remaining = this.#remainingMs()
    if (remaining === null) return

    this.#advanceTimer = setTimeout(() => {
      this.#advanceTimer = null
      this.#advanceIfFinished()
    }, Math.max(remaining, 0))
    this.#advanceTimer.unref()
  }

  #advanceIfFinished(): void {
    const remaining = this.#remainingMs()
    if (remaining === null) return
    if (remaining > 0) {
      // The station clock is the authority, not whatever woke us. A timer that
      // fired early, or a sweep that found no timer at all, both end up here —
      // and the fix for both is to sleep for what is actually left.
      if (this.#advanceTimer === null) this.#reschedule()
      return
    }
    this.advance()
  }
}
