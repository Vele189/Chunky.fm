import type { Db, MessageRow, SessionRef } from './db.js'

/**
 * Chat was the first thing here worth pacing, so the token bucket was written
 * in this file. It is not chat-specific, since the admin sign-in gate needs
 * the same shape, so it now lives in `lib/rate-limit.ts` and is re-exported
 * here for everything that already knew where to find it.
 */
export { type RateLimitOptions, RateLimit } from './lib/rate-limit.js'

/**
 * The room's chat.
 *
 * Unlike playback and the queue, this one is written down: PLAN.md puts
 * `messages` in SQLite, and it has to be there for the thing chat is for:
 * someone who joins at 2:14, or whose train went into a tunnel, arriving to a
 * conversation already in progress rather than an empty box.
 *
 * Scoped to a session, so "the chat" is this time on air. Nothing here reads or
 * writes any other session's rows.
 */

/**
 * Long enough to say something, short enough that one listener cannot push the
 * room's history out of the window on their own.
 */
export const MESSAGE_MAX_LENGTH = 500

/** How much of the conversation a joiner is handed. */
export const DEFAULT_HISTORY_LIMIT = 50

/** A message as it goes over the wire. `at` is server epoch ms. */
export interface ChatMessage {
  id: number
  nickname: string
  text: string
  at: number
}

export function toChatMessage(row: MessageRow): ChatMessage {
  return { id: row.id, nickname: row.nick, text: row.text, at: row.created_at }
}

/**
 * One line of printable text, trimmed and capped.
 *
 * The same shape as a nickname and for the same reason: the chat is a single
 * line of input, and a newline pasted into it should not become a message that
 * breaks the list it renders in. Sliced by code point rather than by UTF-16
 * unit, so a message that ends on an emoji is cut between characters instead of
 * through the middle of one.
 */
export function normalizeMessageText(raw: string): string {
  const collapsed = raw
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return [...collapsed].slice(0, MESSAGE_MAX_LENGTH).join('').trim()
}

/** Is this something worth sending? The composer's send button asks this too. */
export function isSendableMessage(raw: string): boolean {
  return normalizeMessageText(raw).length > 0
}

export interface ChatLogOptions {
  db: Db
  /** Which session's chat this is. Reads `null` while the station is off air. */
  session: SessionRef
  historyLimit?: number
  now?: () => number
}

export class ChatLog {
  readonly #db: Db
  readonly #session: SessionRef
  readonly #historyLimit: number
  readonly #now: () => number

  constructor({ db, session, historyLimit = DEFAULT_HISTORY_LIMIT, now = Date.now }: ChatLogOptions) {
    this.#db = db
    this.#session = session
    this.#historyLimit = historyLimit
    this.#now = now
  }

  /**
   * Writes a message and hands back the row as stored.
   *
   * The nickname is passed in by the caller, which is the socket layer reading
   * it off the presence roster, never off the frame. A client that could name
   * the author of its own messages could sign someone else's name to them.
   */
  post(nickname: string, text: string): ChatMessage {
    const sessionId = this.#session.current
    if (sessionId === null) {
      // The socket layer refuses a `say` before it gets here, so reaching this
      // is a bug rather than a listener doing something unusual, and a message
      // written to no session would be invisible the moment it was stored.
      throw new Error('nothing can be said off air: there is no session to say it in')
    }
    const row = {
      session_id: sessionId,
      nick: nickname,
      text: normalizeMessageText(text),
      created_at: this.#now(),
    }
    const result = this.#db
      .prepare(
        `INSERT INTO messages (session_id, nick, text, created_at)
         VALUES (@session_id, @nick, @text, @created_at)`,
      )
      .run(row)
    return { id: Number(result.lastInsertRowid), nickname: row.nick, text: row.text, at: row.created_at }
  }

  /**
   * The tail of the conversation, oldest first.
   *
   * Read newest-first so the limit takes the *last* N rather than the first,
   * then reversed for display, because a joiner wants the end of the
   * conversation, not its beginning.
   */
  recent(limit = this.#historyLimit): ChatMessage[] {
    // Off air there is no conversation, rather than last night's. Going live
    // opens a fresh room, which is what scoping the chat to a session is for.
    const sessionId = this.#session.current
    if (sessionId === null) return []
    const rows = this.#db
      .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?')
      .all(sessionId, limit) as MessageRow[]
    return rows.reverse().map(toChatMessage)
  }

  /**
   * Forget every conversation there has ever been. For the end of a session.
   *
   * Scoping already means an ended session's chat is unreadable: `recent`
   * answers with nothing off air, and going live opens a room with nothing in
   * it. This is about the rows rather than about what can be read. A chat is
   * the most personal thing the station holds, it was said to a room that no
   * longer exists, and nobody who said any of it expects it to still be on a
   * disk somewhere next Tuesday. So the evening takes it along with the set it
   * was talked over; see where this is wired in `app.ts`.
   *
   * Everything rather than the session that just closed, because by the time
   * anything hears about the ending there is no session to scope to. Which is
   * the right answer anyway: a row from a session two evenings ago is no more
   * readable and no less personal than one from this evening.
   */
  forgetAll(): void {
    this.#db.prepare('DELETE FROM messages').run()
  }

  /** For tests and for the log line on startup. */
  count(): number {
    const sessionId = this.#session.current
    if (sessionId === null) return 0
    const row = this.#db
      .prepare('SELECT COUNT(*) AS n FROM messages WHERE session_id = ?')
      .get(sessionId) as { n: number }
    return row.n
  }
}

