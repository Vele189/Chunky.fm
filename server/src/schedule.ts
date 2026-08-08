import { EventEmitter } from 'node:events'
import type { Db, ScheduleRow } from './db.js'

/**
 * The next session, announced before it happens.
 *
 * Everything else the station holds is about tonight and dies with it. This is
 * the one thing that is about a night that has not happened yet, which is why
 * it is not scoped to a session and does not go when one ends: it is what a
 * listener who arrives to a dark station is told instead of nothing.
 *
 * **It starts nothing.** PLAN.md locks availability as "you go live, you end
 * it", and a clock that put the station on air by itself would take that
 * decision away from the person holding it, most likely into an empty queue and
 * an empty room. So the time here is a promise to whoever reads it and nothing
 * more; going on air is still a button. What the time changes is only what the
 * off-air screen says, which is the whole point: "off the air" is a fact about
 * now, and "back Saturday at nine" is the thing somebody actually wants.
 *
 * **One at a time.** A station is an evening rather than a calendar. Setting a
 * schedule replaces whatever was there, and the database enforces that with a
 * `CHECK (id = 1)` rather than trusting this class to remember.
 *
 * **It is public**, unlike the library, the roster and the chat. A poster is an
 * advertisement: it goes on the page in front of the station, where the people
 * who have not been invited yet are. Nothing here should ever carry anything
 * that is not meant for them.
 */

/** The next session, as it goes over the wire and onto the page. */
export interface ScheduledSession {
  /** When it starts. Epoch ms on the station clock, like everything else. */
  startsAt: number
  /** The poster's filename under `posterDir`, or null for a time alone. */
  poster: string | null
}

export declare interface Schedule {
  on(event: 'change', listener: (next: ScheduledSession | null) => void): this
  off(event: 'change', listener: (next: ScheduledSession | null) => void): this
  emit(event: 'change', next: ScheduledSession | null): boolean
}

export interface ScheduleOptions {
  db: Db
  now?: () => number
}

export class Schedule extends EventEmitter {
  readonly #db: Db
  readonly #now: () => number

  constructor({ db, now = Date.now }: ScheduleOptions) {
    super()
    this.#db = db
    this.#now = now
  }

  /** What is announced, or null when nothing is. */
  get(): ScheduledSession | null {
    const row = this.#db.prepare('SELECT * FROM schedule WHERE id = 1').get() as
      | ScheduleRow
      | undefined
    return row ? { startsAt: row.starts_at, poster: row.poster } : null
  }

  /**
   * Announce a session, replacing whatever was announced before.
   *
   * Hands back the poster that has just been displaced, if there was one, so
   * the caller can unlink the file. This class owns a row and not a disk: the
   * same split `emptyLibrary` makes, and for the same reason, which is that a
   * failed unlink must never leave a row half-written.
   */
  set(next: ScheduledSession): { poster: string | null } {
    const previous = this.get()
    this.#db
      .prepare(
        `INSERT INTO schedule (id, starts_at, poster, set_at)
         VALUES (1, @starts_at, @poster, @set_at)
         ON CONFLICT(id) DO UPDATE SET
           starts_at = excluded.starts_at,
           poster    = excluded.poster,
           set_at    = excluded.set_at`,
      )
      .run({ starts_at: next.startsAt, poster: next.poster, set_at: this.#now() })

    this.emit('change', this.get())
    // Only when it is genuinely gone. Keeping the same poster over a change of
    // time is the ordinary edit, and unlinking it there would blank the page.
    return { poster: previous && previous.poster !== next.poster ? previous.poster : null }
  }

  /** Take the announcement down. Hands back its poster, as `set` does. */
  clear(): { poster: string | null } {
    const previous = this.get()
    if (!previous) return { poster: null }
    this.#db.prepare('DELETE FROM schedule WHERE id = 1').run()
    this.emit('change', null)
    return { poster: previous.poster }
  }
}
