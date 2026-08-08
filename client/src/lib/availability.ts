import type { StationStatus } from './station.js'

/**
 * Whether there is a station there at all, and what to say when there isn't.
 *
 * `StationStatus` is about one socket (opening, open, closed) and that is the
 * wrong grain for a screen. A page loaded while the server is down cycles
 * `connecting → offline → connecting → offline` forever as the backoff runs, so
 * a message hung off the raw status flickers between "tuning in" and
 * "reconnecting" while the truth stays the same: nothing has ever answered.
 *
 * The missing piece is whether this page has *ever* reached the station, which
 * is what separates "we cannot find it" from "we had it and lost it", a
 * distinction worth making, because the second one usually fixes itself in a
 * second or two and the first one usually does not.
 */

export type Availability =
  /** The socket is open; everything on screen is the station's own. */
  | 'live'
  /** First attempt, still in flight. Nothing has failed yet. */
  | 'reaching'
  /** Nothing has ever answered: the station is down, or this is the wrong URL. */
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
 * and `connecting` is not news at all: it is the backoff opening yet another
 * socket, which says nothing new about the station and must not change what the
 * listener is being told. Map each status on its own and a page waiting out a
 * dead server alternates between "no signal" and "tuning in…" forever, once per
 * retry, which is the flicker this whole type exists to prevent.
 */
/**
 * What the page should actually say, once the broadcast is folded in.
 *
 * `Availability` is about the *socket*: can this page reach the station. That
 * is only half the question. A station that answers perfectly well and is not
 * broadcasting tonight is a third thing, and telling somebody to check their
 * connection about it would be a lie.
 *
 * Connectivity wins when the two disagree, because it has to: a page that
 * cannot reach the station does not know whether anyone is on air, and the last
 * thing it heard is no longer evidence of anything.
 */
export type Standing = Availability | 'off-air'

/**
 * @param live What the station last said about itself, or null before it has
 *   said anything. Null reads as on air, since the `air` frame arrives first of all
 *   on connect, so the gap is a few milliseconds, and guessing "off" would
 *   flash "off the air tonight" at the start of every healthy page load.
 */
export function standing(reach: Availability, live: boolean | null): Standing {
  if (reach !== 'live') return reach
  return live === false ? 'off-air' : 'live'
}

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
export function statusLabel(state: Standing): string {
  switch (state) {
    case 'live':
      return 'on air'
    case 'reaching':
      return 'tuning in…'
    case 'dropped':
      return 'reconnecting…'
    case 'unreachable':
      return 'no signal'
    case 'off-air':
      return 'off air'
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
 * that long every time it loaded would be crying wolf. The header already says
 * "tuning in…", which is the honest amount of noise to make about it.
 *
 * Every message ends by saying the page retries on its own, because it does,
 * and the alternative is a room full of people reloading a page that was
 * already going to fix itself.
 */
export function outage(state: Standing): Outage | null {
  switch (state) {
    case 'off-air':
      // Not an outage in the sense the other two are: nothing is broken, and
      // there is nothing to retry. The page is right, the room is just closed.
      // It still belongs here because it is the same screen: no music, and
      // nothing on the page that came from a station.
      return {
        headline: 'chunky.fm is off the air',
        detail:
          'Nobody is on the decks tonight. This page stays connected, so leave it ' +
          'open and the music starts the moment somebody goes live.',
      }
    case 'unreachable':
      return {
        headline: 'Can’t find the station',
        detail:
          'Nothing is answering at the station right now. This page keeps trying, so ' +
          'leave it open and it will tune itself in the moment the station is back.',
      }
    case 'dropped':
      return {
        headline: 'Lost the station',
        detail:
          'The connection dropped. This page keeps trying, so leave it open and the ' +
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
 * through it out of the buffer, so the page keeps showing what is on rather
 * than blanking a track the listener can still hear. What it must not do is
 * keep presenting that as live: the roster, the tally and the clock all stopped
 * at the drop, and this line is what says so.
 */
export function staleNotice(state: Standing): string | null {
  switch (state) {
    case 'unreachable':
      return 'No signal. Trying to reach the station. Nothing here is up to date.'
    case 'dropped':
      return 'Reconnecting. What is on screen is from before the station dropped.'
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
export function canTuneIn(state: Standing): boolean {
  // Off air is a no for the same reason `unreachable` is, and it matters more
  // here: browsers start audio from inside a user gesture and nowhere else, so
  // a listener who spends their click on a station with nothing to play gets
  // silence now *and* silence when it comes back, because `play()` will then be
  // called from a broadcast handler rather than a click.
  return state === 'live' || state === 'reaching'
}
