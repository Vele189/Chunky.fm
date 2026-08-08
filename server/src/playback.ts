import { EventEmitter } from 'node:events'
import type { Track } from './lib/track.js'

/**
 * The station's entire notion of playback.
 *
 * There is no per-listener state and nothing is streamed: listeners are handed
 * this tuple and align themselves to it. Because `startedAt` is a point in the
 * past, a listener joining at 2:14 computes 2:14 and seeks there, so joining
 * mid-song is the same code path as joining at the start.
 */
export interface PlaybackSnapshot {
  track: Track | null
  /** Server epoch ms at which the current track was at 0:00. */
  startedAt: number
  /** Position in ms while paused; null while playing. */
  pausedAt: number | null
  /** Server clock when this snapshot was taken, for client offset checks. */
  serverTime: number
}

export interface PlaybackStateOptions {
  /** Injectable clock. Tests drive this; production leaves it alone. */
  now?: () => number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export declare interface PlaybackState {
  on(event: 'change', listener: (snapshot: PlaybackSnapshot) => void): this
  off(event: 'change', listener: (snapshot: PlaybackSnapshot) => void): this
  emit(event: 'change', snapshot: PlaybackSnapshot): boolean
}

export class PlaybackState extends EventEmitter {
  readonly #now: () => number
  #track: Track | null = null
  #startedAt: number
  #pausedAt: number | null = null

  constructor({ now = Date.now }: PlaybackStateOptions = {}) {
    super()
    this.#now = now
    this.#startedAt = now()
  }

  get track(): Track | null {
    return this.#track
  }

  get isPlaying(): boolean {
    return this.#track !== null && this.#pausedAt === null
  }

  /**
   * The station clock. Everything time-shaped the server says (`startedAt`,
   * `serverTime`, the pong in the offset handshake) must read from here, or
   * clients would be aligning to a timebase that isn't the one `startedAt` is
   * expressed in.
   */
  now(): number {
    return this.#now()
  }

  /** Where the needle is right now, in ms. Zero when nothing is loaded. */
  positionMs(): number {
    if (!this.#track) return 0
    const raw = this.#pausedAt ?? this.#now() - this.#startedAt
    return clamp(raw, 0, this.#track.durationMs)
  }

  snapshot(): PlaybackSnapshot {
    return {
      track: this.#track,
      startedAt: this.#startedAt,
      pausedAt: this.#pausedAt,
      serverTime: this.#now(),
    }
  }

  /** Put a track on the decks and start it, optionally partway in. */
  play(track: Track, atMs = 0): PlaybackSnapshot {
    const position = clamp(atMs, 0, track.durationMs)
    this.#track = track
    this.#startedAt = this.#now() - position
    this.#pausedAt = null
    return this.#changed()
  }

  pause(): PlaybackSnapshot {
    if (!this.#track || this.#pausedAt !== null) return this.snapshot()
    this.#pausedAt = this.positionMs()
    return this.#changed()
  }

  resume(): PlaybackSnapshot {
    if (!this.#track || this.#pausedAt === null) return this.snapshot()
    // Rewrite history so the elapsed time still lands on the paused position.
    this.#startedAt = this.#now() - this.#pausedAt
    this.#pausedAt = null
    return this.#changed()
  }

  seek(positionMs: number): PlaybackSnapshot {
    if (!this.#track) return this.snapshot()
    const position = clamp(positionMs, 0, this.#track.durationMs)
    if (this.#pausedAt === null) {
      this.#startedAt = this.#now() - position
    } else {
      this.#pausedAt = position
    }
    return this.#changed()
  }

  /** Clear the decks: off air, nothing loaded. */
  stop(): PlaybackSnapshot {
    if (!this.#track) return this.snapshot()
    this.#track = null
    this.#startedAt = this.#now()
    this.#pausedAt = null
    return this.#changed()
  }

  #changed(): PlaybackSnapshot {
    const snapshot = this.snapshot()
    this.emit('change', snapshot)
    return snapshot
  }
}
