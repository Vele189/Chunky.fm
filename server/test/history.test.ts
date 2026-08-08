import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Db, closeSession, openDb, openSession } from '../src/db.js'
import { PlayLog } from '../src/history.js'
import type { Track } from '../src/lib/track.js'
import { fakeClock, makeTrack } from './helpers.js'

let db: Db
let sessionId: number

/**
 * The history joins onto `tracks`, so unlike the chat's rows these need a real
 * library behind them. This is that library.
 */
function upload(track: Track): Track {
  db.prepare(
    `INSERT INTO tracks (id, title, artist, album, duration_ms, filename, artwork_path,
                         content_hash, gain_db, uploaded_at)
     VALUES (@id, @title, @artist, @album, @durationMs, @filename, @artworkPath,
             @contentHash, @gainDb, @uploadedAt)`,
  ).run(track)
  return track
}

const opener = makeTrack({ id: 1, title: 'Opening Number', filename: 'a.mp3', contentHash: 'a' })
const follow = makeTrack({ id: 2, title: 'The Follow Up', filename: 'b.mp3', contentHash: 'b' })

beforeEach(() => {
  db = openDb(':memory:')
  sessionId = openSession(db, 1_700_000_000_000)
  upload(opener)
  upload(follow)
})

afterEach(() => {
  db.close()
})

const log = (options: { limit?: number; now?: () => number } = {}) =>
  new PlayLog({ db, session: { current: sessionId }, ...options })

describe('PlayLog', () => {
  it('is empty before anything has been on', () => {
    expect(log().recent()).toEqual([])
  })

  it('writes down a track going on, and hands it back as stored', () => {
    const clock = fakeClock(1_700_000_005_000)
    const plays = log({ now: clock.now })

    const played = plays.record(opener)

    expect(played).toMatchObject({ at: 1_700_000_005_000 })
    expect(played!.track).toEqual(opener)
    expect(played!.id).toEqual(expect.any(Number))
    expect(plays.recent()).toEqual([played])
  })

  /**
   * The line the whole module turns on. It is driven by playback's `change`
   * event, which fires for pauses and seeks too, and a history that grew a row
   * every time the admin nudged the needle would be a list of one song, forty
   * times.
   */
  it('records nothing when the same track is still on', () => {
    const plays = log()
    plays.record(opener)

    expect(plays.record(opener)).toBeNull()
    expect(plays.record(opener)).toBeNull()
    expect(plays.count()).toBe(1)
  })

  it('records the next track, and keeps them in the order they were on', () => {
    const clock = fakeClock()
    const plays = log({ now: clock.now })

    plays.record(opener)
    clock.advance(200_000)
    plays.record(follow)

    expect(plays.recent().map((play) => play.track.title)).toEqual([
      'Opening Number',
      'The Follow Up',
    ])
    expect(plays.recent().map((play) => play.at)).toEqual([
      1_700_000_000_000,
      1_700_000_200_000,
    ])
  })

  it('writes down a track that comes back on later as a second play', () => {
    const plays = log()

    plays.record(opener)
    plays.record(follow)
    plays.record(opener)

    const history = plays.recent()
    expect(history.map((play) => play.track.id)).toEqual([1, 2, 1])
    // Two plays of one track, so the ids are the plays' own and all distinct.
    expect(new Set(history.map((play) => play.id)).size).toBe(3)
  })

  it('records nothing for going off air, and starts the same track again after', () => {
    const plays = log()
    plays.record(opener)

    expect(plays.record(null)).toBeNull()
    expect(plays.count()).toBe(1)

    // Back on after a stop is a new play of it, even though it is what was on
    // before: the station went quiet in between.
    expect(plays.record(opener)).not.toBeNull()
    expect(plays.count()).toBe(2)
  })

  it('reads the track as it is now, not as it was tagged then', () => {
    const plays = log()
    plays.record(opener)

    db.prepare('UPDATE tracks SET title = ? WHERE id = ?').run('Opening Number (remaster)', 1)

    // The opposite of what a message does with a nickname: a retagged track was
    // mislabelled all along, so the history should read correctly rather than
    // preserve the typo.
    expect(plays.recent()[0]!.track.title).toBe('Opening Number (remaster)')
  })

  it('hands over the end of a long evening, still oldest first', () => {
    const plays = log({ limit: 2 })
    plays.record(opener)
    plays.record(follow)
    plays.record(opener)

    expect(plays.recent().map((play) => play.track.title)).toEqual([
      'The Follow Up',
      'Opening Number',
    ])
  })

  it('survives being reopened: the plays are in the database', () => {
    log().record(opener)

    expect(log().recent().map((play) => play.track.title)).toEqual(['Opening Number'])
  })

  it('keeps one session out of another', () => {
    log().record(opener)
    closeSession(db, sessionId, 1_700_000_100_000)

    // A restarted station is a new time on air, and its history starts empty
    // even though the old rows are still there.
    const next = new PlayLog({ db, session: { current: openSession(db, 1_700_000_200_000) } })
    expect(next.recent()).toEqual([])
    expect(next.count()).toBe(0)

    next.record(follow)
    expect(log().recent().map((play) => play.track.title)).toEqual(['Opening Number'])
  })
})

describe('the plays table', () => {
  it('refuses a play that belongs to no session', () => {
    expect(() =>
      db.prepare('INSERT INTO plays (session_id, track_id, played_at) VALUES (?, ?, ?)').run(
        9_999,
        1,
        1_700_000_000_000,
      ),
    ).toThrow(/FOREIGN KEY/i)
  })

  /**
   * The one place this table is looser than the others, and on purpose: a play
   * is written from inside playback's `change` event, so an insert that could be
   * refused would throw into whatever put the track on: an admin command
   * answering 500 after the track already changed, or the end-of-track timer
   * dying mid-set. A note about what happened must not be able to break the
   * thing it is a note about.
   */
  it('takes a play of a track the library does not have, rather than throwing', () => {
    const plays = log()

    expect(() => plays.record(makeTrack({ id: 9_999 }))).not.toThrow()
    expect(plays.count()).toBe(1)
  })

  it('leaves a play it cannot name out of the history rather than showing a blank', () => {
    const plays = log()
    plays.record(makeTrack({ id: 9_999 }))
    plays.record(opener)

    expect(plays.recent().map((play) => play.track.title)).toEqual(['Opening Number'])
  })
})
