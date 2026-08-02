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

export const DEFAULT_DRIFT_CHECK_INTERVAL_MS = 2_000
