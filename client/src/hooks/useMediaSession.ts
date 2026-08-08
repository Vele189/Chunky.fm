import { useEffect, useRef } from 'react'
import { nowPlaying } from '../lib/now-playing.js'
import type { Track } from '../lib/protocol.js'

/**
 * The station in the notification shade, on the lock screen, in the car.
 *
 * On a phone the page is usually not what a listener is looking at. It is in a
 * pocket with the screen off, and the only thing the station gets to say is
 * whatever the OS draws from the Media Session API: three lines, a picture, and
 * a couple of buttons. Left alone the browser fills that in by itself, and what
 * it fills in is wrong for a radio station in two specific ways.
 *
 * **The scrubber.** The `<audio>` element is holding a four-minute file, so the
 * phone draws a seek bar and counts down to the end of it. Both are lies here:
 * a listener cannot seek, because seeking is how you stop being in the same
 * second as everybody else, and the end of the file is not the end of anything
 * they are going to be alone for. An unbounded duration is how the spec says
 * "live", and it is what puts LIVE where the numbers were.
 *
 * **The buttons.** Next, previous, and a ten-second rewind all appear on their
 * own if nothing says otherwise, and every one of them offers something this
 * station does not have: what plays next is one person's decision, and there is
 * nowhere to rewind to. So they are refused by name, which is the only way to
 * stop the OS drawing them.
 *
 * What is left is a play/pause pair, which maps onto the one control a listener
 * actually has: their own ears. See the callbacks below.
 */

/**
 * A duration with no end, which is the spec's way of saying live media, and the
 * reason the notification carries a word instead of a clock.
 */
const LIVE_POSITION: MediaPositionState = { duration: Infinity }

/**
 * What this station has no answer for.
 *
 * Not tidiness: an action with a handler on it is a button the phone draws, and
 * an action explicitly set to null is one it does not. Leaving these unset is
 * not the same as refusing them, because the browser supplies its own defaults
 * for a media element and those defaults are seek, skip and skip.
 */
const REFUSED = [
  'seekto',
  'seekbackward',
  'seekforward',
  'previoustrack',
  'nexttrack',
] as const satisfies readonly MediaSessionAction[]

const OFFERED = ['play', 'pause', 'stop'] as const satisfies readonly MediaSessionAction[]

export interface MediaSessionOptions {
  /** What is on the decks, or null when nothing is. */
  track: Track | null
  /**
   * True while sound is actually reaching this listener: on air, tuned in, and
   * not muted. It is what decides which of play and pause the phone draws.
   */
  playing: boolean
  /**
   * The notification's play button. Unmute, and rejoin at the live edge if the
   * audio was stopped rather than merely silenced.
   */
  onResume: () => void
  /** Its pause and stop buttons. This listener's own ears, nothing else. */
  onPause: () => void
}

/**
 * `navigator.mediaSession`, or null where there is no such thing.
 *
 * Everything below is an enhancement to a station that already works, so a
 * browser without the API gets the station and no notification, rather than an
 * exception thrown out of an effect on the first render.
 */
function session(): MediaSession | null {
  if (typeof navigator === 'undefined') return null
  return 'mediaSession' in navigator ? navigator.mediaSession : null
}

/**
 * Set a handler, or refuse the action, without trusting that the browser has
 * heard of it.
 *
 * `setActionHandler` throws a `TypeError` for an action the browser does not
 * implement, and the list of actions has grown over time. A browser that does
 * not know `seekto` was never going to draw a seek button for it, so there is
 * nothing to do about it and nothing worth reporting.
 */
function handle(
  media: MediaSession,
  action: MediaSessionAction,
  handler: MediaSessionActionHandler | null,
): void {
  try {
    media.setActionHandler(action, handler)
  } catch {
    // An action this browser has never heard of is one it cannot draw either.
  }
}

/**
 * Say that this has no end.
 *
 * Guarded, because `duration: Infinity` is a claim about unbounded media that
 * the spec allows and an implementation is free to be stricter about. The worst
 * case if it refuses is the scrubber we did not want; the worst case without
 * the guard is a `TypeError` out of an effect, which is the whole page.
 */
function declareLive(media: MediaSession): void {
  try {
    media.setPositionState?.(LIVE_POSITION)
  } catch {
    // Left to the browser's own idea of the position, which is the file's.
  }
}

export function useMediaSession({
  track,
  playing,
  onResume,
  onPause,
}: MediaSessionOptions): void {
  // Read through refs so the handlers registered with the OS are registered
  // once, rather than being torn down and replaced on every render of a page
  // that re-renders whenever the clock says anything.
  const onResumeRef = useRef(onResume)
  const onPauseRef = useRef(onPause)
  const trackRef = useRef(track)
  useEffect(() => {
    onResumeRef.current = onResume
    onPauseRef.current = onPause
    trackRef.current = track
  })

  useEffect(() => {
    const media = session()
    if (!media) return

    handle(media, 'play', () => onResumeRef.current())
    handle(media, 'pause', () => onPauseRef.current())
    // Stop is pause. There is nothing to stop: the station plays on either way,
    // and a listener who presses it wants to stop hearing it, not to end it.
    handle(media, 'stop', () => onPauseRef.current())
    for (const action of REFUSED) handle(media, action, null)

    return () => {
      for (const action of [...OFFERED, ...REFUSED]) handle(media, action, null)
      media.metadata = null
      media.playbackState = 'none'
    }
  }, [])

  // Keyed on the track rather than on the frame it arrived in. `state` is
  // rebroadcast on every pause, seek and resume, and handing the OS the same
  // metadata again on each one makes some phones redraw the card, which reads
  // as a flicker for a song that never changed.
  const trackId = track?.id ?? null
  useEffect(() => {
    const media = session()
    if (!media) return

    const sheet = nowPlaying(trackRef.current)
    if (!sheet) {
      media.metadata = null
      return
    }
    media.metadata = new MediaMetadata(sheet)
    // Alongside the metadata, because a phone that has just been handed a new
    // card is exactly where it would otherwise go looking for a duration.
    declareLive(media)
  }, [trackId])

  useEffect(() => {
    const media = session()
    if (!media) return
    // Muted is `paused`, so the button the phone draws is the one that turns
    // the sound back on. 'none' only for a station with nothing on the decks,
    // where there is no notification to put a button in.
    media.playbackState = trackId === null ? 'none' : playing ? 'playing' : 'paused'
  }, [playing, trackId])
}
