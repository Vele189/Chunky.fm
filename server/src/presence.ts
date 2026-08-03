/**
 * Who is listening right now.
 *
 * PLAN.md's presence story in full: a socket → nickname map, broadcast on join
 * and on leave. It is deliberately not the connection count. A tab that has
 * loaded the page holds a socket open before anyone has named themselves, and a
 * roster built from sockets would show those as phantom listeners — so a
 * listener enters this map when they say who they are, and leaves it when their
 * socket does.
 *
 * In memory only, like the queue and the decks: presence dies with the process,
 * because every socket it describes dies with it too.
 */

/** Mirrors `client/src/lib/nickname.ts` — keep the two in step. */
export const NICKNAME_MAX_LENGTH = 24

export interface Listener {
  /** Per-socket, so two listeners called "sam" are still two rows. */
  id: number
  nickname: string
}

/**
 * One line of printable text, trimmed and capped — the same rules the client
 * applies before storing a nickname, applied again because a socket is not a
 * browser and nothing obliges a client to have applied them.
 */
export function normalizeNickname(raw: string): string {
  return raw
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NICKNAME_MAX_LENGTH)
    .trim()
}

/**
 * The roster.
 *
 * Mutations answer with whether anything actually changed, rather than emitting
 * a `change` event the way the queue does. The queue needs the event because it
 * is mutated from the HTTP routes, a long way from the socket that has to
 * broadcast; presence is only ever touched by the socket layer itself, and a
 * boolean there says the same thing without the indirection — and says it
 * precisely enough that a re-join under the name a listener already has costs
 * no broadcast at all.
 */
export class Presence {
  readonly #listeners = new Map<number, string>()

  get size(): number {
    return this.#listeners.size
  }

  /** In join order: a Map keeps insertion order, and a rename keeps its place. */
  list(): Listener[] {
    return [...this.#listeners].map(([id, nickname]) => ({ id, nickname }))
  }

  has(id: number): boolean {
    return this.#listeners.has(id)
  }

  /**
   * What to call this socket, or null if it has not said. This is where chat
   * gets the name it signs a message with — a client never supplies its own.
   */
  nicknameOf(id: number): string | null {
    return this.#listeners.get(id) ?? null
  }

  /**
   * Name a socket, or rename one that already has a name. False when nothing
   * changed — an unusable nickname, or the one this socket is already listed
   * under.
   */
  join(id: number, nickname: string): boolean {
    const name = normalizeNickname(nickname)
    if (name.length === 0) return false
    if (this.#listeners.get(id) === name) return false
    this.#listeners.set(id, name)
    return true
  }

  /** False for a socket that was never named, which is the common case. */
  leave(id: number): boolean {
    return this.#listeners.delete(id)
  }
}
