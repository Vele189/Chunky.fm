import { clamp } from './position.js'

/**
 * Drift correction.
 *
 * Audio clocks drift from system clocks, so being aligned once is not the same
 * as staying aligned. The fix is to nudge playback *rate* rather than seek: a
 * seek is an audible glitch, a 2% rate change is not. Browsers default
 * `preservesPitch` to true, so the rate change time-stretches instead of
 * pitch-shifting, and at 2% there is no perceptible artifact.
 *
 * Convergence takes a few seconds, which is fine.
 */

/** Past this, a seek is less bad than waiting minutes for a nudge to catch up. */
export const HARD_SEEK_THRESHOLD_S = 1.0
/** Below this, we're close enough that correcting would be fidgeting. */
export const NUDGE_THRESHOLD_S = 0.05
/** Cap on the rate change, in either direction. */
export const MAX_RATE_ADJUSTMENT = 0.02
/** How aggressively a given error is turned into a rate change. */
export const RATE_GAIN = 0.5

export type Correction =
  | { kind: 'seek'; toSeconds: number }
  | { kind: 'rate'; playbackRate: number }
  | { kind: 'none' }

/**
 * @param actual   the audio element's current position, in seconds
 * @param expected where the server says it should be, in seconds
 */
export function correctionFor(actual: number, expected: number): Correction {
  const diff = actual - expected

  if (Math.abs(diff) > HARD_SEEK_THRESHOLD_S) {
    return { kind: 'seek', toSeconds: expected }
  }
  if (Math.abs(diff) > NUDGE_THRESHOLD_S) {
    // Ahead of the server (diff > 0) means slow down, hence the subtraction.
    return {
      kind: 'rate',
      playbackRate: 1 - clamp(diff * RATE_GAIN, -MAX_RATE_ADJUSTMENT, MAX_RATE_ADJUSTMENT),
    }
  }
  return { kind: 'none' }
}

export function applyCorrection(audio: HTMLAudioElement, correction: Correction): void {
  switch (correction.kind) {
    case 'seek':
      audio.currentTime = correction.toSeconds
      audio.playbackRate = 1
      break
    case 'rate':
      audio.playbackRate = correction.playbackRate
      break
    case 'none':
      if (audio.playbackRate !== 1) audio.playbackRate = 1
      break
  }
}

/** HTMLMediaElement.HAVE_FUTURE_DATA, spelled out so this runs outside a browser. */
const HAVE_FUTURE_DATA = 3

/**
 * Whether an element is actually playing, and so whether its position means
 * anything to correct against.
 *
 * Not paused is not enough. An element waiting on the network is not paused,
 * but its `currentTime` stands still while the station clock moves on. The
 * loop then sees the gap grow past the hard-seek threshold and seeks forward.
 * That seek throws away the bytes in flight and starts a new range request,
 * which stalls again, which grows the gap again. On a slow link the result is
 * a record skipped forward in chunks every two seconds. So a stalled or
 * seeking element is left alone, and corrected once, after it plays again.
 */
export function canCorrect(
  audio: Pick<HTMLMediaElement, 'paused' | 'seeking' | 'readyState'>,
): boolean {
  return !audio.paused && !audio.seeking && audio.readyState >= HAVE_FUTURE_DATA
}

export const DEFAULT_DRIFT_CHECK_INTERVAL_MS = 2_000
