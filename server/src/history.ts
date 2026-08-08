import type { Db, SessionRef, TrackRow } from './db.js'
import { type Track, toTrack } from './lib/track.js'

/**
 * What has been on.
 *
 * PLAN.md's `plays` table and the social half of it in one place: a row per time
 * a track went on air, and the list a listener reads to see what they walked in
 * on the end of. Written down rather than held in memory, like the chat and for
 * the same reason: someone who arrives at 9pm should be able to see the 8:40
 * they half-heard through a wall, and a page reloaded at 10 should not forget
 * the evening.
 *
 * Scoped to a session, so "the history" is this time on air rather than
 * everything ever played. A restarted station starts a new list.
 *
 * A play stores the *track id*, not a copy of its title, the opposite of what a
 * message does with a nickname. A nickname is copied because the person can
 * rename themselves and what they said keeps the name they said it under; a
 * track that gets retagged was mislabelled all along, and the history should
 * read correctly rather than preserve the typo. Nothing deletes tracks, so the
 * reference cannot dangle, and it is not a foreign key even so, because this
 * is written from inside playback's `change` event and an insert that could be
 * refused would throw into whatever put the track on. See the schema.
 */

/** How much of the evening a joiner is handed. */
export const DEFAULT_PLAY_LIMIT = 30

/** A track going on air, as it goes over the wire. `at` is server epoch ms. */
export interface Play {
  /** The play's id, not the track's: the same track can be on twice. */
  id: number
  track: Track
  at: number
}

/** A joined row: the play's own columns alongside the whole track. */
type PlayedRow = TrackRow & { play_id: number; played_at: number }

function toPlay(row: PlayedRow): Play {
  return { id: row.play_id, track: toTrack(row), at: row.played_at }
}

export interface PlayLogOptions {
  db: Db
  /** Which session's history this is. Reads `null` while the station is off air. */
  session: SessionRef
  limit?: number
  /**
   * The station clock: `PlaybackState.now`, not `Date.now`. A play's time and
   * the `startedAt` of the same track describe one instant, and a history
   * stamped from a different timebase would disagree with the state broadcast
   * it was written alongside.
   */
  now?: () => number
}

export class PlayLog {
  readonly #db: Db
  readonly #session: SessionRef
  readonly #limit: number
  readonly #now: () => number
  /** What is on as far as this log knows. See `record`. */
  #currentTrackId: number | null = null

  constructor({ db, session, limit = DEFAULT_PLAY_LIMIT, now = Date.now }: PlayLogOptions) {
    this.#db = db
    this.#session = session
    this.#limit = limit
    this.#now = now
  }

  /**
   * Writes down that a track went on, and hands back the row as stored. Null
   * when nothing went on, which is most of what it is called for.
   *
   * Driven by the same `change` event the state broadcast is, because that event
   * is the only place that sees every way a track can start: the end-of-track
   * timer, the admin pressing play, a queue advancing on its own. But most of
   * those changes are not a track *starting*: a pause, a seek and a resume all
   * leave the same song on, so the id is compared against what this log last
   * saw, and only a different one is a play.
   *
   * Going off air is recorded as nothing at all, and puts the log back to
   * knowing nothing: a track that goes on after a stop is a new play of it, even
   * if it is the same track that was on before.
   */
  record(track: Track | null): Play | null {
    const trackId = track?.id ?? null
    if (trackId === this.#currentTrackId) return null
    this.#currentTrackId = trackId
    if (!track) return null
    // Off air nothing is written down. Playback is stopped when a session ends,
    // so this is belt-and-braces, but a play with no session to belong to
    // would be a row no history query could ever reach.
    const sessionId = this.#session.current
    if (sessionId === null) return null

    const row = { session_id: sessionId, track_id: track.id, played_at: this.#now() }
    const result = this.#db
      .prepare(
        `INSERT INTO plays (session_id, track_id, played_at)
         VALUES (@session_id, @track_id, @played_at)`,
      )
      .run(row)
    return { id: Number(result.lastInsertRowid), track, at: row.played_at }
  }

  /**
   * The evening so far, oldest first.
   *
   * Read newest-first so the limit takes the *last* N of a long session rather
   * than the first, then reversed, the same treatment the chat's history gets,
   * and for the same reason: what a joiner wants is the end of the evening. The
   * page renders it the other way up, because what just played is the line
   * anyone looks for first.
   *
   * An inner join, so a play whose track is no longer in the library is left out
   * rather than rendered as a blank line. Nothing removes tracks today; this is
   * what keeps the list readable if anything ever does.
   */
  recent(limit = this.#limit): Play[] {
    // Off air the evening has not started. See the chat, which does the same.
    const sessionId = this.#session.current
    if (sessionId === null) return []
    const rows = this.#db
      .prepare(
        `SELECT tracks.*, plays.id AS play_id, plays.played_at AS played_at
           FROM plays
           JOIN tracks ON tracks.id = plays.track_id
          WHERE plays.session_id = ?
          ORDER BY plays.id DESC
          LIMIT ?`,
      )
      .all(sessionId, limit) as PlayedRow[]
    return rows.reverse().map(toPlay)
  }

  /**
   * Forget every play there has ever been. For the end of a session.
   *
   * The last of the three, and the one with the weakest case for going: a row
   * here is a track id and a time rather than anything anybody said, and the
   * library wipe that runs alongside it already leaves these stranded behind
   * the inner join in `recent`. Deleted anyway, because a stranded row is not a
   * kept record, it is litter: it can never be read again, and leaving it would
   * mean the disk grew a little on every evening the station ever ran.
   *
   * Everything rather than the session that just closed, for the reason
   * `ChatLog.forgetAll` gives.
   */
  forgetAll(): void {
    this.#db.prepare('DELETE FROM plays').run()
  }

  /** For tests, and for the log line on startup. */
  count(): number {
    const sessionId = this.#session.current
    if (sessionId === null) return 0
    const row = this.#db
      .prepare('SELECT COUNT(*) AS n FROM plays WHERE session_id = ?')
      .get(sessionId) as { n: number }
    return row.n
  }
}
