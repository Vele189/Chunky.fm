import { describe, expect, it } from 'vitest'
import { type ClockSample, bestEstimate, estimateFromSample } from '../src/lib/clock.js'

describe('estimateFromSample', () => {
  it('splits the round trip evenly between the two legs', () => {
    // Client sent at 1000, server answered at 5100, reply landed at 1200.
    // Midpoint of the round trip is client-time 1100, so the server is 4000 ahead.
    expect(estimateFromSample({ t0: 1_000, t1: 5_100, t2: 1_200 })).toEqual({
      offsetMs: 4_000,
      rttMs: 200,
    })
  })

  it('reports a zero offset when the clocks already agree', () => {
    expect(estimateFromSample({ t0: 1_000, t1: 1_050, t2: 1_100 })).toEqual({
      offsetMs: 0,
      rttMs: 100,
    })
  })

  it('handles a client clock running ahead of the server', () => {
    const { offsetMs } = estimateFromSample({ t0: 10_000, t1: 7_000, t2: 10_100 })
    expect(offsetMs).toBe(-3_050)
  })
})

describe('bestEstimate', () => {
  it('returns null with nothing to go on', () => {
    expect(bestEstimate([])).toBeNull()
  })

  it('keeps the lowest-RTT sample rather than averaging', () => {
    // The two slow samples are asymmetrically delayed and would drag an
    // average badly off; the fast one is the honest measurement.
    const samples: ClockSample[] = [
      { t0: 0, t1: 5_400, t2: 800 }, // rtt 800, offset 5000
      { t0: 1_000, t1: 6_010, t2: 1_020 }, // rtt 20,  offset 5000
      { t0: 2_000, t1: 7_600, t2: 3_200 }, // rtt 1200, offset 5000
    ]

    const best = bestEstimate(samples)
    expect(best).toEqual({ offsetMs: 5_000, rttMs: 20 })
  })

  it('is not fooled by an asymmetric slow path', () => {
    // A reply delayed on the return leg makes the server look further behind
    // than it is. The fast sample is the one to trust.
    const samples: ClockSample[] = [
      { t0: 0, t1: 1_000, t2: 2_000 }, // rtt 2000 -> offset 0
      { t0: 5_000, t1: 6_010, t2: 5_020 }, // rtt 20   -> offset 1000
    ]

    expect(bestEstimate(samples)?.offsetMs).toBe(1_000)

    const naiveAverage =
      samples.reduce((sum, s) => sum + estimateFromSample(s).offsetMs, 0) / samples.length
    expect(naiveAverage).toBe(500) // what averaging would have given: wrong by 500ms
  })
})
