import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_KEPT_PLAYS,
  mergePlays,
  playedEarlier,
  playedLabel,
} from '../src/lib/history.js'
import type { HistoryMessage, Play, ServerMessage, Track } from '../src/lib/protocol.js'
import { StationConnection } from '../src/lib/station.js'
import { FakeSocket, fakeSocketFactory } from './fake-socket.js'

const track = (id: number, title = `Track ${id}`, artist: string | null = 'Test Artist'): Track => ({
  id,
  title,
  artist,
  album: null,
  durationMs: 200_000,
  filename: `${id}.mp3`,
  artworkPath: null,
  contentHash: `hash-${id}`,
  gainDb: 0,
  uploadedAt: 1_700_000_000_000,
})

const play = (id: number, trackId = id): Play => ({
  id,
  track: track(trackId),
  at: 1_700_000_000_000 + id * 1_000,
})

describe('mergePlays', () => {
  it('appends what is new, oldest first', () => {
    expect(mergePlays([play(1)], [play(2)]).map((p) => p.id)).toEqual([1, 2])
  })

  it('ignores a play already shown, so a reconnect replays nothing twice', () => {
    const current = [play(1), play(2)]

    // The same array back, so a re-render is skipped entirely.
    expect(mergePlays(current, [play(1), play(2)])).toBe(current)
  })

  it('fills the gap an outage left, in one pass with the replay', () => {
    // What this client saw before it dropped, and the whole evening as the
    // station replays it on the new socket.
    const merged = mergePlays([play(1), play(2)], [play(1), play(2), play(3), play(4)])

    expect(merged.map((p) => p.id)).toEqual([1, 2, 3, 4])
  })

  it('keys on the play, not the track: the same track twice is two rows', () => {
    const merged = mergePlays([play(1, 7)], [play(2, 7)])

    expect(merged).toHaveLength(2)
    expect(merged.map((p) => p.track.id)).toEqual([7, 7])
  })

  it('keeps a bounded list of a long evening', () => {
    const many = Array.from({ length: MAX_KEPT_PLAYS + 5 }, (_, i) => play(i + 1))

    const merged = mergePlays([], many)

    expect(merged).toHaveLength(MAX_KEPT_PLAYS)
    expect(merged.at(-1)!.id).toBe(MAX_KEPT_PLAYS + 5)
  })
})

/**
 * The station writes a play down when a track *starts*, so the newest row is
 * whatever is on right now, which the page already shows in full at the top.
 */
describe('what counts as earlier', () => {
  it('drops the row for the track that is on, and turns the rest newest first', () => {
    const plays = [play(1, 10), play(2, 11), play(3, 12)]

    expect(playedEarlier(plays, 12).map((p) => p.id)).toEqual([2, 1])
  })

  it('shows everything when what is on was never written down', () => {
    // Nothing on the decks, or a track playing since before this session.
    expect(playedEarlier([play(1, 10), play(2, 11)], null).map((p) => p.id)).toEqual([2, 1])
    expect(playedEarlier([play(1, 10), play(2, 11)], 99).map((p) => p.id)).toEqual([2, 1])
  })

  it('keeps an earlier play of the track that happens to be on again', () => {
    // 10 was on at the start of the evening and is on again now. The first time
    // is part of what happened; only the row for *this* play is the duplicate.
    const plays = [play(1, 10), play(2, 11), play(3, 10)]

    expect(playedEarlier(plays, 10).map((p) => p.id)).toEqual([2, 1])
  })

  it('is empty when the only thing that has been on is what is on', () => {
    expect(playedEarlier([play(1, 10)], 10)).toEqual([])
    expect(playedEarlier([], 10)).toEqual([])
  })

  it('does not disturb the list it was handed', () => {
    const plays = [play(1, 10), play(2, 11)]

    playedEarlier(plays, 11)

    // Reversed into a copy: the station's order is oldest first, and merging
    // depends on it staying that way.
    expect(plays.map((p) => p.id)).toEqual([1, 2])
  })

  it('names a track with its artist, and copes without one', () => {
    expect(playedLabel({ id: 1, track: track(1, 'Dreams', 'Fleetwood Mac'), at: 0 })).toBe(
      'Dreams · Fleetwood Mac',
    )
    expect(playedLabel({ id: 2, track: track(2, 'Untitled', null), at: 0 })).toBe('Untitled')
  })
})

describe('history over the socket', () => {
  let messages: ServerMessage[]
  let station: StationConnection

  beforeEach(() => {
    vi.useFakeTimers()
    FakeSocket.reset()
    messages = []
    station = new StationConnection({
      url: 'ws://station/ws',
      socketFactory: fakeSocketFactory,
      reconnectDelaysMs: [100],
      onMessage: (message) => messages.push(message),
      onStatus: () => undefined,
    })
  })

  afterEach(() => {
    station.close()
    vi.useRealTimers()
  })

  it('passes batches through as they arrive', () => {
    station.connect()
    FakeSocket.last.open()

    const evening: HistoryMessage = { type: 'history', plays: [play(1), play(2)] }
    const started: HistoryMessage = { type: 'history', plays: [play(3)] }
    FakeSocket.last.deliver(evening)
    FakeSocket.last.deliver(started)

    // One frame type for both, so there is one code path on the other side.
    expect(messages).toEqual([evening, started])
  })

  it('gets the whole evening again on a new socket after a reconnect', () => {
    station.connect()
    FakeSocket.last.open()
    FakeSocket.last.deliver({ type: 'history', plays: [play(1)] })

    FakeSocket.last.drop()
    vi.advanceTimersByTime(100)
    FakeSocket.last.open()
    FakeSocket.last.deliver({ type: 'history', plays: [play(1), play(2)] })

    // Which is why the merge is by id: the replay overlaps what is on screen.
    const merged = (messages as HistoryMessage[]).reduce<Play[]>(
      (current, message) => mergePlays(current, message.plays),
      [],
    )
    expect(merged.map((p) => p.id)).toEqual([1, 2])
  })
})
