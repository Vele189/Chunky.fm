import { EventEmitter } from 'node:events'

/**
 * Heads the decks add to the headcount.
 *
 * The roster is the truth about who is in the room: one row per socket that has
 * named itself, and nothing can put a row there but a browser with a person
 * behind it. This is the other number, and it is worth being plain about what
 * it is: a figure whoever runs the station types in, added to the tally the top
 * bar shows and to the "+N more" line under the roster. Nobody is behind it.
 *
 * It is kept apart from `Presence` rather than folded into it for exactly that
 * reason. A padded roster would put invented names in the room, and those names
 * would be indistinguishable from listeners: they would sit in the same list,
 * and somebody would say hello to one of them. Keeping the two numbers separate
 * means every name on the roster is a person, and the padding is a count with
 * no name attached, which is the most honest shape a made-up number can take.
 *
 * In memory, and cleared when the session ends, like the queue and the mutes,
 * and for the same reason: it is about tonight. A station that came back up
 * still claiming last Saturday's crowd would be lying without anyone deciding
 * to, which is the one way this could go wrong on its own.
 */

/**
 * Four figures is far past anything this station will hold and still small
 * enough to render in the space the top bar gives a number. The cap is here
 * rather than only in the route's schema so that nothing can set a count the
 * page cannot draw, whatever it came through.
 */
export const MAX_PADDING = 9_999

export declare interface Padding {
  on(event: 'change', listener: (count: number) => void): this
  off(event: 'change', listener: (count: number) => void): this
  emit(event: 'change', count: number): boolean
}

export class Padding extends EventEmitter {
  #count = 0

  get count(): number {
    return this.#count
  }

  /**
   * Where the number now stands, not a step, which is what makes the panel's
   * plus button safe to lean on: two identical requests leave one value, so a
   * retry after a dropped response cannot double the crowd. Whole numbers only,
   * clamped into range; the emit is what tells the socket layer to re-broadcast
   * the roster, so a set that changes nothing says so and costs nothing.
   */
  set(next: number): boolean {
    const count = Math.min(MAX_PADDING, Math.max(0, Math.trunc(next)))
    if (!Number.isFinite(count) || count === this.#count) return false
    this.#count = count
    this.emit('change', count)
    return true
  }

  /** What the end of a session does. See the note above. */
  clear(): void {
    this.set(0)
  }
}
