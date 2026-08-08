import type { Play } from './protocol.js'

/**
 * The client's half of the now-playing history: folding in what arrives, and
 * deciding what is worth showing.
 *
 * Mirrors `server/src/history.ts` — keep the two in step. The station's list is
 * oldest first, because that is the order it happened in; everything below turns
 * it the other way up, because what just played is the line anyone looks for
 * first.
 */

/**
 * How much of the evening stays on screen. The station hands over thirty; this
 * is the same number, so nothing is thrown away that was sent.
 */
export const MAX_KEPT_PLAYS = 30

/**
 * Folds a batch of plays into what is already shown.
 *
 * Keyed on the play's id — not the track's, since the same track can be on twice
 * in an evening and both times are part of what happened. Idempotent, so the
 * whole history replayed after a reconnect changes nothing that is already
 * there, and whatever went on while the socket was down lands in the same pass.
 * Returns the original array when nothing was new, so React can skip a render.
 */
export function mergePlays(current: Play[], incoming: Play[]): Play[] {
  const seen = new Set(current.map((play) => play.id))
  const fresh = incoming.filter((play) => !seen.has(play.id))
  if (fresh.length === 0) return current

  const merged = [...current, ...fresh].sort((a, b) => a.id - b.id)
  return merged.length > MAX_KEPT_PLAYS ? merged.slice(-MAX_KEPT_PLAYS) : merged
}

/**
 * What has been on *before* now, newest first.
 *
 * The station writes a play down when the track starts, so the newest row is
 * whatever is on right now — which the page is already showing, in full, at the
 * top. Repeating it immediately underneath would read as if it had been on
 * twice, so it is dropped, and this list is only what a listener missed.
 *
 * Only the newest row, and only when it names the track that is on: a track
 * played earlier in the evening and again now is two plays, and the earlier one
 * belongs in the list.
 */
export function playedEarlier(plays: Play[], currentTrackId: number | null): Play[] {
  const newest = plays.at(-1)
  const earlier =
    newest && currentTrackId !== null && newest.track.id === currentTrackId
      ? plays.slice(0, -1)
      : plays
  return [...earlier].reverse()
}

/** How a track reads in the history: "Title — Artist", or just the title. */
export function playedLabel(play: Play): string {
  return play.track.artist ? `${play.track.title} — ${play.track.artist}` : play.track.title
}
