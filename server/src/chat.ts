import type { Db, MessageRow } from './db.js'

/**
 * Chat was the first thing here worth pacing, so the token bucket was written
 * in this file. It is not chat-specific — the admin sign-in gate needs the same
 * shape — so it now lives in `lib/rate-limit.ts` and is re-exported here for
 * everything that already knew where to find it.
 */
export { type RateLimitOptions, RateLimit } from './lib/rate-limit.js'

/**
 * The room's chat.
 *
 * Unlike playback and the queue, this one is written down: PLAN.md puts
 * `messages` in SQLite, and it has to be there for the thing chat is for —
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
 * The same shape as a nickname and for the same reason — the chat is a single
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
  sessionId: number
  historyLimit?: number
  now?: () => number
}

export class ChatLog {
  readonly #db: Db
  readonly #sessionId: number
  readonly #historyLimit: number
  readonly #now: () => number

  constructor({ db, sessionId, historyLimit = DEFAULT_HISTORY_LIMIT, now = Date.now }: ChatLogOptions) {
    this.#db = db
    this.#sessionId = sessionId
    this.#historyLimit = historyLimit
    this.#now = now
  }

  /**
   * Writes a message and hands back the row as stored.
   *
   * The nickname is passed in by the caller, which is the socket layer reading
   * it off the presence roster — never off the frame. A client that could name
   * the author of its own messages could sign someone else's name to them.
   */
  post(nickname: string, text: string): ChatMessage {
    const row = {
      session_id: this.#sessionId,
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
   * then reversed for display — a joiner wants the end of the conversation, not
   * its beginning.
   */
  recent(limit = this.#historyLimit): ChatMessage[] {
    const rows = this.#db
      .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?')
      .all(this.#sessionId, limit) as MessageRow[]
    return rows.reverse().map(toChatMessage)
  }

  /** For tests and for the log line on startup. */
  count(): number {
    const row = this.#db
      .prepare('SELECT COUNT(*) AS n FROM messages WHERE session_id = ?')
      .get(this.#sessionId) as { n: number }
    return row.n
  }
}

