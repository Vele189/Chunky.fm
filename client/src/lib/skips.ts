import type { SkipsMessage, SocketErrorCode } from './protocol.js'

/**
 * The client's half of skip votes: what the tally is about, and how it reads.
 *
 * Mirrors `server/src/skips.ts` — keep the two in step. The counting is the
 * station's; nothing here holds a vote of its own, because the station drops a
 * vote when the socket that cast it closes and a page that remembered "I voted"
 * would keep showing one the station had already forgotten.
 */

/** The tally as the station last described it. */
export type SkipTally = Omit<SkipsMessage, 'type'>

export const NO_VOTES: SkipTally = { trackId: null, votes: 0, voted: false }

/**
 * The tally, but only if it is about the track that is on now.
 *
 * The station clears votes on every track change and says so, so in practice
 * the two agree. This is for the moment in between — a `state` frame read
 * before the `skips` frame that follows it, or a tally left over from before a
 * reconnect — where showing the old count against the new song would be a
 * number about a track nobody is listening to.
 */
export function tallyFor(tally: SkipTally | null, trackId: number | null): SkipTally {
  if (!tally || trackId === null || tally.trackId !== trackId) return NO_VOTES
  return tally
}

/**
 * How the tally reads to the room.
 *
 * As a fraction of who is here, because that is the only thing that makes a
 * count mean anything: three out of four is the room, three out of thirty is
 * three people. The roster is where the denominator comes from — the same list
 * rendered above it — so the two can never disagree about how full the room is.
 */
export function skipTallyLabel(votes: number, listeners: number): string {
  if (votes === 0) return 'Nobody wants the next one yet.'
  // No roster yet — a vote counted before this client's own presence frame
  // arrived. Rare, and "3 of 0" would read worse than a plain count.
  if (listeners <= 0) {
    return votes === 1 ? '1 vote to skip this one.' : `${votes} votes to skip this one.`
  }
  return votes === 1
    ? `1 of ${listeners} wants the next one.`
    : `${votes} of ${listeners} want the next one.`
}

/** What the button says, given where this listener stands. */
export function voteButtonLabel(voted: boolean): string {
  return voted ? 'Take my vote back' : 'Skip this one'
}

/** The tally, for whoever runs the decks — no roster to be a fraction of. */
export function skipVotesLabel(votes: number): string {
  if (votes === 0) return 'no skip votes'
  return votes === 1 ? '1 skip vote' : `${votes} skip votes`
}

/**
 * What to tell a listener whose vote the station would not take.
 *
 * Null for anything that is not about a vote — the composers have their own
 * notices, and `about` on the frame is what separates the three. Only the codes
 * a vote button can actually cause are explained here.
 */
export function voteRefusal(code: SocketErrorCode): string | null {
  switch (code) {
    case 'slow_down':
      return 'Not counted — you are changing your mind faster than the station will take it.'
    case 'not_joined':
      return 'Not counted — the station has not finished putting you in the room yet.'
    case 'nothing_playing':
      return 'Not counted — there is nothing on to skip.'
    default:
      return null
  }
}
