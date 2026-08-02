/**
 * Clock offset estimation.
 *
 * Browser clocks are wrong by seconds, and every sync decision is made against
 * `startedAt` — a server timestamp. So the client has to know how far its own
 * clock sits from the server's before it can align to anything.
 */

export interface ClockSample {
  /** Client clock when the probe was sent. */
  t0: number
  /** Server clock when the probe was answered. */
  t1: number
  /** Client clock when the reply arrived. */
  t2: number
}

export interface ClockEstimate {
  offsetMs: number
  rttMs: number
}

export function estimateFromSample({ t0, t1, t2 }: ClockSample): ClockEstimate {
  const rttMs = t2 - t0
  return { offsetMs: t1 - (t0 + rttMs / 2), rttMs }
}

/**
 * Picks the sample with the lowest round trip, not the average.
 *
 * The fastest round trip is the least contaminated by queueing delay; averaging
 * folds every slow, asymmetric round trip straight into the answer.
 */
export function bestEstimate(samples: ClockSample[]): ClockEstimate | null {
  let best: ClockEstimate | null = null
  for (const sample of samples) {
    const estimate = estimateFromSample(sample)
    if (best === null || estimate.rttMs < best.rttMs) best = estimate
  }
  return best
}

export const DEFAULT_PROBE_COUNT = 5
/** Spacing between probes, so they don't share one queueing delay. */
export const DEFAULT_PROBE_SPACING_MS = 150
/** Re-measured on this interval to catch drift in the browser's own clock. */
export const DEFAULT_RESYNC_INTERVAL_MS = 30_000
