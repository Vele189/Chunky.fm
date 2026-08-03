/**
 * The room's opinion of what is on right now.
 *
 * PLAN.md's line is one sentence — "tally skip votes as a set of socket IDs;
 * clear it on every track change" — and the two halves matter for different
 * reasons. A *set of socket ids* is what makes a vote a vote rather than a
 * button somebody can lean on: a listener counts once, and pressing again
 * changes nothing. Clearing on every track change is what keeps the tally about
 * the track it is displayed against; a count that outlived the song it was about
 * would be a number nobody could interpret.
 *
 * **A vote does not skip anything.** Nothing here touches the decks, and that is
 * deliberate rather than unfinished: the socket carries no frame that changes
 * playback (see `realtime.ts`), and a threshold that advanced the station would
 * be exactly such a frame, wearing a quorum as a disguise. PLAN.md puts "see
 * skip tallies" on the *admin* surface for the same reason — the tally is the
 * room telling whoever runs the decks something, and what happens next is a
 * person's decision. So this counts, and stops.
 *
 * In memory, like presence and the queue: every id in the set names a socket
 * that dies with the process anyway.
 */

/** The tally as it goes over the wire, minus who is being told. */
export interface SkipTally {
  /** What the votes are about. Null when there is nothing on the decks. */
  trackId: number | null
  votes: number
}

export class SkipVotes {
  readonly #votes = new Set<number>()
  #trackId: number | null = null

  get size(): number {
    return this.#votes.size
  }

  /** What the current votes are about — the track they were cast against. */
  get trackId(): number | null {
    return this.#trackId
  }

  has(listenerId: number): boolean {
    return this.#votes.has(listenerId)
  }

  /**
   * Records where a listener stands, and answers with whether that moved the
   * tally — a second vote from the same socket, or a withdrawal from one that
   * never voted, changes nothing and says so.
   *
   * The boolean is what the socket layer paces on: a frame that changes nothing
   * broadcasts nothing, so it costs nothing, exactly as a re-join under the name
   * a listener already has does.
   */
  cast(listenerId: number, voted: boolean): boolean {
    if (voted === this.#votes.has(listenerId)) return false
    if (voted) this.#votes.add(listenerId)
    else this.#votes.delete(listenerId)
    return true
  }

  /**
   * Points the tally at whatever is on the decks now. True when votes were
   * actually thrown away, which is the socket layer's cue to say so.
   *
   * Keyed on the track rather than on playback changing at all, because most
   * playback changes are not track changes: a pause, a seek and a resume all
   * leave the same song on, and a tally cleared by a seek would let the admin
   * wipe the room's opinion by nudging the needle. Only what is on the decks
   * being a different track — including nothing at all — clears it.
   */
  retarget(trackId: number | null): boolean {
    if (trackId === this.#trackId) return false
    this.#trackId = trackId
    const had = this.#votes.size > 0
    this.#votes.clear()
    return had
  }

  tally(): SkipTally {
    return { trackId: this.#trackId, votes: this.#votes.size }
  }
}
