import { normalizeNickname } from './presence.js'

/**
 * Who has been asked to stop talking.
 *
 * PLAN.md puts "mute a nickname" on the admin surface, and this is it. By
 * nickname rather than by socket, deliberately: a mute that lived on the
 * connection would last until the tab was reloaded, which is about as long as
 * it takes to notice you have been muted. The name is the thing the room sees
 * and the thing the admin clicked, so the name is what carries it.
 *
 * That has a limit worth being honest about: someone can rename themselves out
 * of a mute, and nothing here stops them. Making it stick would mean identity,
 * and PLAN.md's decision is "nickname only, stored in localStorage": there is
 * nothing to pin a person to. This is a volume knob for a small room, not a ban
 * hammer, and the room is under thirty people who mostly know each other.
 *
 * In memory, and cleared when the session ends, like the queue and the roster,
 * and for the same reason: a mute is about tonight. Somebody who was shouting
 * over the music at midnight should not find themselves silenced next Tuesday
 * by a rule nobody remembers making.
 */
export class Mutes {
  readonly #muted = new Set<string>()

  get size(): number {
    return this.#muted.size
  }

  /**
   * Compared on the normalised name, so a mute survives the whitespace and
   * control characters a hand-written client could pad a nickname with.
   * Otherwise "sam " would walk straight past a mute on "sam".
   */
  has(nickname: string): boolean {
    return this.#muted.has(normalizeNickname(nickname))
  }

  /** In the order they were muted. False when nothing changed. */
  set(nickname: string, muted: boolean): boolean {
    const name = normalizeNickname(nickname)
    if (name.length === 0) return false
    if (muted === this.#muted.has(name)) return false
    if (muted) this.#muted.add(name)
    else this.#muted.delete(name)
    return true
  }

  list(): string[] {
    return [...this.#muted]
  }

  /** What the end of a session does. See the note above. */
  clear(): void {
    this.#muted.clear()
  }
}
