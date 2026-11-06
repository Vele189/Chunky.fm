import { EventEmitter } from 'node:events'
import type { Db, ScheduleRow, SessionKind } from './db.js'

/**
 * Sessions announced before they happen.
 *
 * Everything else the station holds is about tonight and dies with it. This is
 * about nights that have not happened yet, which is why it is not scoped to a
 * session and does not go when one ends: it is what a listener who arrives to
 * a dark station is told instead of nothing, and what the page in front of the
 * station lists under "Upcoming sessions".
 *
 * **It starts nothing.** PLAN.md locks availability as "you go live, you end
 * it", and a clock that put the station on air by itself would take that
 * decision away from the person holding it, most likely into an empty queue and
 * an empty room. So each time here is a promise to whoever reads it and nothing
 * more; going on air is still a button.
 *
 * **A list, with one of them first.** It used to hold one announcement, on the
 * grounds that a station is an evening rather than a calendar. It holds as many
 * as somebody has planned now, and the soonest one that has not gone stale is
 * still "the next session": the thing the off-air screen and the top bar say,
 * through `get()`, exactly as before.
 *
 * **It is public**, unlike the library, the roster and the chat. A poster is an
 * advertisement: it goes on the page in front of the station, where the people
 * who have not been invited yet are. Nothing here should ever carry anything
 * that is not meant for them.
 */

/**
 * How long an announcement outlives the time it named.
 *
 * The same six hours the client waits (`isUpcoming` in client/src/lib/
 * schedule.ts), and for the same reason: a station that starts late is the
 * ordinary case, so a night stays listed past its hour, but not until Tuesday.
 * Kept in step by hand, because the two sides share no code.
 */
export const STALE_MS = 6 * 60 * 60 * 1000

/** An announced session, as it goes over the wire and onto the page. */
export interface ScheduledSession {
  /**
   * Which announcement this is, so the console can change or take down one
   * night without touching the others. Assigned by the database.
   */
  id: number
  /** When it starts. Epoch ms on the station clock, like everything else. */
  startsAt: number
  /** The poster's filename under `posterDir`, or null for a time alone. */
  poster: string | null
  /**
   * Which kind of night is being promised.
   *
   * A poster for a conversation and a poster for a set are advertisements for
   * different evenings, and somebody deciding whether to turn up is deciding
   * about the difference. It is the one thing the page in front of the station
   * could not say before, so every announcement said "records" by omission.
   */
  kind: SessionKind
  /**
   * What it is called: the theme, or who is coming on. Null for a time and a
   * picture, which is what an announcement was until now and is still one.
   *
   * The one field here that is free text somebody typed, which is why the route
   * that accepts it caps and trims it. It is also public in a way nothing else
   * on this station is: it goes on the page in front of the station, where the
   * people who have not been invited yet are. Nothing may go in it that is not
   * meant for them.
   */
  title: string | null
}

/** What a caller writes. The id is the database's to give. */
export type Announcement = Omit<ScheduledSession, 'id'>

/**
 * `change` carries nothing: a listener reads `get()` and `list()` afresh, so the
 * next session and the list it heads can never be sent out of step.
 */
export declare interface Schedule {
  on(event: 'change', listener: () => void): this
  off(event: 'change', listener: () => void): this
  emit(event: 'change'): boolean
}

export interface ScheduleOptions {
  db: Db
  now?: () => number
}

function fromRow(row: ScheduleRow): ScheduledSession {
  return {
    id: row.id,
    startsAt: row.starts_at,
    poster: row.poster,
    kind: row.kind,
    title: row.title,
  }
}

export class Schedule extends EventEmitter {
  readonly #db: Db
  readonly #now: () => number

  constructor({ db, now = Date.now }: ScheduleOptions) {
    super()
    this.#db = db
    this.#now = now
  }

  /**
   * Every announcement still worth showing, soonest first.
   *
   * Stale ones are left out rather than deleted here: a read should not write,
   * and `prune` is what clears them, when somebody next announces something.
   * Ties on the time go to whichever was announced first.
   */
  list(): ScheduledSession[] {
    const rows = this.#db
      .prepare('SELECT * FROM schedule WHERE starts_at > ? ORDER BY starts_at, id')
      .all(this.#now() - STALE_MS) as ScheduleRow[]
    return rows.map(fromRow)
  }

  /** The next session: the soonest one on the list, or null when nothing is. */
  get(): ScheduledSession | null {
    return this.list()[0] ?? null
  }

  /** One announcement by id, stale or not, or null if there is no such one. */
  find(id: number): ScheduledSession | null {
    const row = this.#db.prepare('SELECT * FROM schedule WHERE id = ?').get(id) as
      | ScheduleRow
      | undefined
    return row ? fromRow(row) : null
  }

  /** Announce another session, alongside whatever is already announced. */
  add(next: Announcement): ScheduledSession {
    const result = this.#db
      .prepare(
        `INSERT INTO schedule (starts_at, poster, set_at, kind, title)
         VALUES (@starts_at, @poster, @set_at, @kind, @title)`,
      )
      .run({
        starts_at: next.startsAt,
        poster: next.poster,
        set_at: this.#now(),
        kind: next.kind,
        title: next.title,
      })
    this.emit('change')
    return this.find(Number(result.lastInsertRowid)) as ScheduledSession
  }

  /**
   * Change one announcement: its time, its poster, what it is.
   *
   * Hands back the poster that has just been displaced, if there was one, so
   * the caller can unlink the file. This class owns rows and not a disk: the
   * same split `emptyLibrary` makes, and for the same reason, which is that a
   * failed unlink must never leave a row half-written. Null when there is no
   * announcement by that id.
   */
  update(id: number, next: Announcement): { poster: string | null } | null {
    const previous = this.find(id)
    if (!previous) return null
    this.#db
      .prepare(
        `UPDATE schedule SET
           starts_at = @starts_at, poster = @poster, set_at = @set_at,
           kind = @kind, title = @title
         WHERE id = @id`,
      )
      .run({
        id,
        starts_at: next.startsAt,
        poster: next.poster,
        set_at: this.#now(),
        kind: next.kind,
        title: next.title,
      })
    this.emit('change')
    // Only when it is genuinely gone. Keeping the same poster over a change of
    // time is the ordinary edit, and unlinking it there would blank the page.
    return { poster: previous.poster !== next.poster ? previous.poster : null }
  }

  /** Take one announcement down. Hands back its poster, or null for no such one. */
  remove(id: number): { poster: string | null } | null {
    const previous = this.find(id)
    if (!previous) return null
    this.#db.prepare('DELETE FROM schedule WHERE id = ?').run(id)
    this.emit('change')
    return { poster: previous.poster }
  }

  /**
   * Delete the announcements whose night has passed, and hand back their
   * posters for the caller to unlink.
   *
   * Without this a station announcing a night a week would keep every poster it
   * ever put up. It is not a change anybody can see, because `list` already
   * leaves these out, so it says nothing on the `change` event.
   */
  prune(): string[] {
    const cutoff = this.#now() - STALE_MS
    const rows = this.#db
      .prepare('SELECT poster FROM schedule WHERE starts_at <= ?')
      .all(cutoff) as { poster: string | null }[]
    this.#db.prepare('DELETE FROM schedule WHERE starts_at <= ?').run(cutoff)
    return rows.flatMap((row) => (row.poster ? [row.poster] : []))
  }
}
