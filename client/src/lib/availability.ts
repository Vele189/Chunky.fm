import type { StationStatus } from './station.js'

/**
 * Whether there is a station there at all, and what to say when there isn't.
 *
 * `StationStatus` is about one socket — opening, open, closed — and that is the
 * wrong grain for a screen. A page loaded while the server is down cycles
 * `connecting → offline → connecting → offline` forever as the backoff runs, so
 * a message hung off the raw status flickers between "tuning in" and
 * "reconnecting" while the truth stays the same: nothing has ever answered.
 *
 * The missing piece is whether this page has *ever* reached the station, which
 * is what separates "we cannot find it" from "we had it and lost it" — a
 * distinction worth making, because the second one usually fixes itself in a
 * second or two and the first one usually does not.
 */

export type Availability =
  /** The socket is open; everything on screen is the station's own. */
  | 'live'
  /** First attempt, still in flight. Nothing has failed yet. */
  | 'reaching'
  /** Nothing has ever answered — the station is down, or this is the wrong URL. */
  | 'unreachable'
  /** We had it and lost it. The backoff is running; this usually comes back. */
  | 'dropped'

/** Before anything has been tried. */
export const INITIALLY: Availability = 'reaching'

/**
 * Fold one status into what the page already knows.
 *
 * A fold rather than a mapping, because no single status carries the answer.
 * `offline` is "we cannot find it" the first time and "we lost it" afterwards,
 * and `connecting` is not news at all — it is the backoff opening yet another
 * socket, which says nothing new about the station and must not change what the
 * listener is being told. Map each status on its own and a page waiting out a
 * dead server alternates between "no signal" and "tuning in…" forever, once per
 * retry, which is the flicker this whole type exists to prevent.
 */
export function nextAvailability(current: Availability, status: StationStatus): Availability {
  switch (status) {
    case 'connected':
      return 'live'
    case 'offline':
      // Never having found it and having lost it both arrive here; which one
      // this is depends entirely on where the page had got to.
      return current === 'reaching' || current === 'unreachable' ? 'unreachable' : 'dropped'
    case 'connecting':
      // An attempt in flight. Only the very first one is worth reporting as
      // such; every later one leaves the last conclusion standing until it
      // resolves one way or the other.
      if (current === 'reaching') return 'reaching'
      return current === 'live' ? 'dropped' : current
  }
}

/** What the corner of the header says. */
export function statusLabel(state: Availability): string {
  switch (state) {
    case 'live':
      return 'on air'
    case 'reaching':
      return 'tuning in…'
    case 'dropped':
      return 'reconnecting…'
    case 'unreachable':
      return 'no signal'
  }
}

export interface Outage {
  headline: string
  detail: string
}

/**
 * The screen to show when there is nothing else to show: no station, and
 * nothing on the page that came from one.
 *
 * Null while reaching, on purpose. The first attempt takes a few hundred
 * milliseconds on a healthy station, and a page that announced a problem for
 * that long every time it loaded would be crying wolf — the header already says
 * "tuning in…", which is the honest amount of noise to make about it.
 *
 * Every message ends by saying the page retries on its own, because it does,
 * and the alternative is a room full of people reloading a page that was
 * already going to fix itself.
 */
export function outage(state: Availability): Outage | null {
  switch (state) {
    case 'unreachable':
      return {
        headline: 'chunky.fm is off the air',
        detail:
          'Nothing is answering at the station right now. This page keeps trying — ' +
          'leave it open and it will tune itself in the moment the station is back.',
      }
    case 'dropped':
      return {
        headline: 'Lost the station',
        detail:
          'The connection dropped. This page keeps trying — leave it open and the ' +
          'music picks back up on its own.',
      }
    default:
      return null
  }
}

/**
 * The line to run above a page that still has something on it.
 *
 * A short outage is the common one, and the audio usually plays straight
 * through it out of the buffer — so the page keeps showing what is on rather
 * than blanking a track the listener can still hear. What it must not do is
 * keep presenting that as live: the roster, the tally and the clock all stopped
 * at the drop, and this line is what says so.
 */
export function staleNotice(state: Availability): string | null {
  switch (state) {
    case 'unreachable':
      return 'No signal — trying to reach the station. Nothing here is up to date.'
    case 'dropped':
      return 'Reconnecting — what is on screen is from before the station dropped.'
    default:
      return null
  }
}

/**
 * Whether tuning in is worth offering.
 *
 * Refused while the station is unreachable, and not only because the join frame
 * would go on the floor: browsers start audio from inside a user gesture and
 * nowhere else, so a listener who joins an absent station spends their gesture
 * on silence. When the station comes back, `play()` is called from a broadcast
 * handler rather than a click, the browser refuses it, and they sit watching a
 * page that says a track is on and hearing nothing. Better to hold the button
 * back and hand it over when there is a station to hand it to.
 *
 * Still offered while reaching: the first attempt is usually already succeeding,
 * and a button that greys out on every page load is worse than a rare click
 * that lands a few hundred milliseconds early.
 */
export function canTuneIn(state: Availability): boolean {
  return state === 'live' || state === 'reaching'
}
