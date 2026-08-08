import type { Db, SessionRef, WishRow } from './db.js'

/**
 * The wish book: PLAN.md's requests story.
 *
 * "Free-text wishes, no library browsing for listeners" is the decision this
 * implements, and the free-text part is the whole of it: a listener asks for
 * something in their own words, and nothing here tries to match what they typed
 * against the library. A wish is a note to whoever runs the decks, not a queue
 * operation. The queue is still the admin's alone, and a wish that gets played
 * gets played because a person read it and chose to.
 *
 * Written down, and scoped to a session like the chat is, so the book is what
 * has been asked for during this time on air rather than everything ever asked.
 */

/** Where a wish stands with whoever runs the decks. */
export type WishStatus = WishRow['status']

export const WISH_STATUSES: readonly WishStatus[] = ['new', 'handled']

export function isWishStatus(value: unknown): value is WishStatus {
  return typeof value === 'string' && (WISH_STATUSES as readonly string[]).includes(value)
}

/**
 * Shorter than a chat message on purpose. A wish is "something off Rumours,
 * anything", a line the admin reads at a glance in a list of them, and the
 * room already has a place for saying more than that.
 */
export const WISH_MAX_LENGTH = 200

/** How many of a session's wishes the admin is handed at once. */
export const DEFAULT_WISH_LIMIT = 200

/** A wish as it goes over the wire. `at` is server epoch ms. */
export interface Wish {
  id: number
  nickname: string
  text: string
  at: number
  status: WishStatus
}

export function toWish(row: WishRow): Wish {
  return { id: row.id, nickname: row.nick, text: row.text, at: row.created_at, status: row.status }
}

/**
 * One line of printable text, trimmed and capped: the same treatment a message
 * and a nickname get, and for the same reason: the composer is a single line,
 * and a pasted newline should not become a wish that breaks the list it renders
 * in. Sliced by code point rather than UTF-16 unit, so a wish that ends on an
 * emoji is cut between characters instead of through the middle of one.
 */
export function normalizeWishText(raw: string): string {
  const collapsed = raw
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return [...collapsed].slice(0, WISH_MAX_LENGTH).join('').trim()
}

/** Is this something worth asking for? The composer's button asks this too. */
export function isSendableWish(raw: string): boolean {
  return normalizeWishText(raw).length > 0
}

export interface WishBookOptions {
  db: Db
  /** Which session's book this is. Reads `null` while the station is off air. */
  session: SessionRef
  limit?: number
  now?: () => number
}

export class WishBook {
  readonly #db: Db
  readonly #session: SessionRef
  readonly #limit: number
  readonly #now: () => number

  constructor({ db, session, limit = DEFAULT_WISH_LIMIT, now = Date.now }: WishBookOptions) {
    this.#db = db
    this.#session = session
    this.#limit = limit
    this.#now = now
  }

  /**
   * Writes a wish down and hands back the row as stored.
   *
   * The nickname is passed in by the caller (the socket layer reading it off
   * the presence roster), never taken off the frame, for the reason `ChatLog`
   * does the same: a client that could name the author of its own wishes could
   * put someone else's name to a request the admin is about to read out.
   */
  make(nickname: string, text: string): Wish {
    const sessionId = this.#session.current
    if (sessionId === null) {
      // Refused at the socket before it gets here. See `realtime.ts`. A wish
      // written to no session would never appear in the book the admin reads.
      throw new Error('nothing can be wished for off air: there is no session to ask in')
    }
    const row = {
      session_id: sessionId,
      nick: nickname,
      text: normalizeWishText(text),
      created_at: this.#now(),
    }
    const result = this.#db
      .prepare(
        `INSERT INTO wishes (session_id, nick, text, created_at, status)
         VALUES (@session_id, @nick, @text, @created_at, 'new')`,
      )
      .run(row)
    return {
      id: Number(result.lastInsertRowid),
      nickname: row.nick,
      text: row.text,
      at: row.created_at,
      status: 'new',
    }
  }

  /**
   * This session's wishes, oldest first: the order they were asked in, which
   * is the order they are worked through.
   *
   * Read newest-first so the limit takes the *last* N of a long session rather
   * than the first, then reversed for display.
   */
  list(limit = this.#limit): Wish[] {
    // Off air the book is empty rather than last night's, by the same rule the
    // chat and the history follow, for the same reason.
    const sessionId = this.#session.current
    if (sessionId === null) return []
    const rows = this.#db
      .prepare('SELECT * FROM wishes WHERE session_id = ? ORDER BY id DESC LIMIT ?')
      .all(sessionId, limit) as WishRow[]
    return rows.reverse().map(toWish)
  }

  /** One wish of this session's, or null when there is no such wish. */
  find(id: number): Wish | null {
    const sessionId = this.#session.current
    if (sessionId === null) return null
    const row = this.#db
      .prepare('SELECT * FROM wishes WHERE id = ? AND session_id = ?')
      .get(id, sessionId) as WishRow | undefined
    return row ? toWish(row) : null
  }

  /**
   * Marks a wish handled, or puts it back. Null when this session has no such
   * wish, which is what the route turns into a 404.
   *
   * Reversible on purpose: the admin's mark is a note to themselves about a
   * list they are reading live, and a misclick on the wrong row should not be
   * the end of somebody's request.
   */
  setStatus(id: number, status: WishStatus): Wish | null {
    const sessionId = this.#session.current
    if (sessionId === null) return null
    const changed = this.#db
      .prepare('UPDATE wishes SET status = ? WHERE id = ? AND session_id = ?')
      .run(status, id, sessionId)
    return changed.changes === 0 ? null : this.find(id)
  }

  /**
   * Forget every wish there has ever been. For the end of a session.
   *
   * The same treatment the chat gets, and for the same reason. Scoping already
   * means an ended session's book is unreadable, so this is about the rows: a
   * wish is free text somebody typed, signed with the name they were using, and
   * it was asked of a room that no longer exists. Nobody who asked for
   * something off Rumours at midnight expects the sentence to still be on a
   * disk next Tuesday.
   *
   * Everything rather than the session that just closed, because by the time
   * anything hears about the ending there is no session left to scope to. See
   * `ChatLog.forgetAll`, which says the same thing at more length.
   */
  forgetAll(): void {
    this.#db.prepare('DELETE FROM wishes').run()
  }

  /** How many are still waiting on somebody. For the heading, and for tests. */
  outstanding(): number {
    const sessionId = this.#session.current
    if (sessionId === null) return 0
    const row = this.#db
      .prepare(`SELECT COUNT(*) AS n FROM wishes WHERE session_id = ? AND status = 'new'`)
      .get(sessionId) as { n: number }
    return row.n
  }
}
