import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlaybackState } from '../src/playback.js'
import { Station } from '../src/station.js'
import { type FakeClock, advanceAll, fakeClock, makeTrack } from './helpers.js'

let clock: FakeClock
let station: Station
let playback: PlaybackState

const BACKSTOP_MS = 2_000

const first = makeTrack({ id: 1, title: 'Opening Number', durationMs: 200_000 })
const second = makeTrack({ id: 2, title: 'The Follow Up', durationMs: 180_000 })
const third = makeTrack({ id: 3, title: 'Closer', durationMs: 120_000 })

const nowPlaying = () => playback.snapshot().track?.title ?? null
const queued = () => station.queue.list().map((entry) => entry.track.title)

beforeEach(() => {
  vi.useFakeTimers()
  clock = fakeClock()
  playback = new PlaybackState({ now: clock.now })
  station = new Station({ playback, backstopIntervalMs: BACKSTOP_MS })
})

afterEach(() => {
  station.close()
  vi.useRealTimers()
})

describe('Station queueing', () => {
  it('starts an idle station on the first track queued', () => {
    station.enqueue(first)

    expect(nowPlaying()).toBe('Opening Number')
    expect(queued()).toEqual([])
    expect(playback.positionMs()).toBe(0)
  })

  it('leaves a playing station alone and queues behind it', () => {
    station.enqueue(first)
    station.enqueue(second)
    station.enqueue(third)

    expect(nowPlaying()).toBe('Opening Number')
    expect(queued()).toEqual(['The Follow Up', 'Closer'])
  })

  it('does not jump the gun on a paused station', () => {
    station.enqueue(first)
    playback.pause()

    station.enqueue(second)

    expect(nowPlaying()).toBe('Opening Number')
    expect(playback.isPlaying).toBe(false)
    expect(queued()).toEqual(['The Follow Up'])
  })
})

describe('Station advancement', () => {
  it('moves to the next track the moment the current one ends', async () => {
    station.enqueue(first)
    station.enqueue(second)

    await advanceAll(clock, first.durationMs - 1_000)
    expect(nowPlaying()).toBe('Opening Number')

    await advanceAll(clock, 1_000)

    expect(nowPlaying()).toBe('The Follow Up')
    expect(playback.snapshot().startedAt).toBe(clock.now())
    expect(queued()).toEqual([])
  })

  it('plays a whole queue through, in order', async () => {
    for (const track of [first, second, third]) station.enqueue(track)

    const heard = [nowPlaying()]
    for (const track of [first, second, third]) {
      await advanceAll(clock, track.durationMs)
      heard.push(nowPlaying())
    }

    expect(heard).toEqual(['Opening Number', 'The Follow Up', 'Closer', null])
  })

  it('goes off air when the last track ends', async () => {
    station.enqueue(first)

    await advanceAll(clock, first.durationMs)

    expect(nowPlaying()).toBeNull()
    expect(playback.isPlaying).toBe(false)
  })

  it('holds the track while paused, however long that is', async () => {
    station.enqueue(first)
    station.enqueue(second)

    await advanceAll(clock, 10_000)
    playback.pause()
    await advanceAll(clock, first.durationMs * 3)

    expect(nowPlaying()).toBe('Opening Number')
    expect(playback.positionMs()).toBe(10_000)
    expect(queued()).toEqual(['The Follow Up'])
  })

  it('advances on the time left after a resume, not the original duration', async () => {
    station.enqueue(first)
    station.enqueue(second)

    await advanceAll(clock, 150_000)
    playback.pause()
    await advanceAll(clock, 600_000) // dead air while paused
    playback.resume()

    await advanceAll(clock, 49_000)
    expect(nowPlaying()).toBe('Opening Number')

    await advanceAll(clock, 1_000)
    expect(nowPlaying()).toBe('The Follow Up')
  })

  it('reschedules when a seek moves the end of the track', async () => {
    station.enqueue(first)
    station.enqueue(second)

    playback.seek(first.durationMs - 5_000)
    await advanceAll(clock, 5_000)

    expect(nowPlaying()).toBe('The Follow Up')
  })

  it('advances immediately when resumed at the very end', async () => {
    station.enqueue(first)
    station.enqueue(second)

    playback.seek(first.durationMs)
    playback.pause()
    expect(nowPlaying()).toBe('Opening Number')

    playback.resume()
    await vi.advanceTimersByTimeAsync(1)

    expect(nowPlaying()).toBe('The Follow Up')
  })

  it('keeps a hand-picked track on the decks until it ends, then follows the queue', async () => {
    station.enqueue(first)
    station.enqueue(second)

    playback.play(third) // admin drops something on top of what's queued

    expect(nowPlaying()).toBe('Closer')
    await advanceAll(clock, third.durationMs)

    expect(nowPlaying()).toBe('The Follow Up')
  })
})

describe('Station backstop', () => {
  it('catches a track that outlived its timer', async () => {
    station.enqueue(first)
    station.enqueue(second)

    // The wall clock jumps past the end of the track without the timer wheel
    // reaching it: an event loop blocked under load, as far as the station is
    // concerned. Only the backstop sweep runs.
    clock.advance(first.durationMs + 30_000)
    await vi.advanceTimersByTimeAsync(BACKSTOP_MS)

    expect(nowPlaying()).toBe('The Follow Up')
    // The overrun is not carried over: the next track starts at 0:00 however
    // late the station noticed the last one had finished.
    expect(playback.positionMs()).toBe(0)
  })

  it('leaves a track that is merely playing alone', async () => {
    station.enqueue(first)
    station.enqueue(second)

    clock.advance(60_000)
    await vi.advanceTimersByTimeAsync(BACKSTOP_MS * 3)

    expect(nowPlaying()).toBe('Opening Number')
  })

  it('does not advance a paused station, however far behind it falls', async () => {
    station.enqueue(first)
    station.enqueue(second)
    playback.pause()

    clock.advance(first.durationMs * 2)
    await vi.advanceTimersByTimeAsync(BACKSTOP_MS * 3)

    expect(nowPlaying()).toBe('Opening Number')
  })

  it('does not run when nothing is on the decks', async () => {
    clock.advance(600_000)
    await vi.advanceTimersByTimeAsync(BACKSTOP_MS * 3)

    expect(nowPlaying()).toBeNull()
  })
})

describe('Station skip', () => {
  it('advances on demand, without waiting for the track to end', () => {
    station.enqueue(first)
    station.enqueue(second)

    station.advance()

    expect(nowPlaying()).toBe('The Follow Up')
    expect(playback.positionMs()).toBe(0)
  })

  it('goes off air when there is nothing to skip to', () => {
    station.enqueue(first)

    station.advance()

    expect(nowPlaying()).toBeNull()
  })
})

describe('Station shutdown', () => {
  it('stops advancing once closed', async () => {
    station.enqueue(first)
    station.enqueue(second)

    station.close()
    await advanceAll(clock, first.durationMs * 2)

    expect(nowPlaying()).toBe('Opening Number')
  })
})
