import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type PlaybackSnapshot, PlaybackState } from '../src/playback.js'
import { fakeClock, makeTrack } from './helpers.js'

let clock: ReturnType<typeof fakeClock>
let playback: PlaybackState
let changes: PlaybackSnapshot[]

const track = makeTrack({ id: 1, durationMs: 200_000 })
const other = makeTrack({ id: 2, durationMs: 90_000 })

beforeEach(() => {
  clock = fakeClock()
  playback = new PlaybackState({ now: clock.now })
  changes = []
  playback.on('change', (snapshot) => changes.push(snapshot))
})

describe('PlaybackState', () => {
  it('starts off air', () => {
    const snapshot = playback.snapshot()

    expect(snapshot.track).toBeNull()
    expect(snapshot.pausedAt).toBeNull()
    expect(playback.positionMs()).toBe(0)
    expect(playback.isPlaying).toBe(false)
  })

  it('puts startedAt in the past so position is derivable from the clock alone', () => {
    playback.play(track)
    expect(playback.positionMs()).toBe(0)

    clock.advance(30_000)
    expect(playback.positionMs()).toBe(30_000)

    const { startedAt } = playback.snapshot()
    expect(clock.now() - startedAt).toBe(30_000)
  })

  it('lets a track start partway in, as a mid-song joiner sees it', () => {
    playback.play(track, 134_000)

    expect(playback.positionMs()).toBe(134_000)
    clock.advance(1_000)
    expect(playback.positionMs()).toBe(135_000)
  })

  it('never reports a position past the end of the track', () => {
    playback.play(track)
    clock.advance(track.durationMs + 60_000)

    expect(playback.positionMs()).toBe(track.durationMs)
  })

  it('freezes the position while paused', () => {
    playback.play(track)
    clock.advance(45_000)
    playback.pause()

    clock.advance(600_000)

    expect(playback.positionMs()).toBe(45_000)
    expect(playback.snapshot().pausedAt).toBe(45_000)
    expect(playback.isPlaying).toBe(false)
  })

  it('picks up where it left off on resume', () => {
    playback.play(track)
    clock.advance(45_000)
    playback.pause()
    clock.advance(600_000)

    playback.resume()

    expect(playback.positionMs()).toBe(45_000)
    expect(playback.snapshot().pausedAt).toBeNull()
    clock.advance(5_000)
    expect(playback.positionMs()).toBe(50_000)
  })

  it('seeks while playing by moving startedAt', () => {
    playback.play(track)
    clock.advance(10_000)

    playback.seek(120_000)

    expect(playback.positionMs()).toBe(120_000)
    expect(playback.snapshot().pausedAt).toBeNull()
    clock.advance(2_000)
    expect(playback.positionMs()).toBe(122_000)
  })

  it('seeks while paused without resuming', () => {
    playback.play(track)
    playback.pause()

    playback.seek(75_000)

    expect(playback.snapshot().pausedAt).toBe(75_000)
    expect(playback.isPlaying).toBe(false)
    clock.advance(10_000)
    expect(playback.positionMs()).toBe(75_000)
  })

  it('clamps seeks to the track', () => {
    playback.play(track)

    playback.seek(-5_000)
    expect(playback.positionMs()).toBe(0)

    playback.seek(track.durationMs + 5_000)
    expect(playback.positionMs()).toBe(track.durationMs)
  })

  it('clears the decks on stop', () => {
    playback.play(track)
    playback.stop()

    expect(playback.snapshot().track).toBeNull()
    expect(playback.positionMs()).toBe(0)
    expect(playback.isPlaying).toBe(false)
  })

  it('switches tracks cleanly', () => {
    playback.play(track)
    clock.advance(50_000)

    playback.play(other)

    expect(playback.snapshot().track?.id).toBe(other.id)
    expect(playback.positionMs()).toBe(0)
  })
})

describe('PlaybackState change events', () => {
  it('emits exactly once per real change', () => {
    playback.play(track)
    playback.pause()
    playback.resume()
    playback.seek(1_000)
    playback.stop()

    expect(changes.map((c) => c.track?.id ?? null)).toEqual([1, 1, 1, 1, null])
  })

  it('stays quiet when a command changes nothing', () => {
    playback.pause() // nothing loaded
    playback.resume()
    playback.seek(5_000)
    playback.stop()

    expect(changes).toHaveLength(0)

    playback.play(track)
    playback.pause()
    changes.length = 0

    playback.pause() // already paused
    expect(changes).toHaveLength(0)
  })

  it('hands listeners the state as of the change', () => {
    playback.play(track, 60_000)

    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({
      pausedAt: null,
      startedAt: clock.now() - 60_000,
      serverTime: clock.now(),
    })
    expect(changes[0]!.track?.id).toBe(track.id)
  })

  it('uses the real clock when none is injected', () => {
    const spy = vi.spyOn(Date, 'now').mockReturnValue(1_234_567_890)
    try {
      expect(new PlaybackState().snapshot().serverTime).toBe(1_234_567_890)
    } finally {
      spy.mockRestore()
    }
  })
})
