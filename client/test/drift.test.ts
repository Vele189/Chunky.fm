import { describe, expect, it } from 'vitest'
import {
  HARD_SEEK_THRESHOLD_S,
  MAX_RATE_ADJUSTMENT,
  NUDGE_THRESHOLD_S,
  applyCorrection,
  correctionFor,
} from '../src/lib/drift.js'

describe('correctionFor', () => {
  it('does nothing when the error is inaudible', () => {
    expect(correctionFor(100, 100)).toEqual({ kind: 'none' })
    expect(correctionFor(100.04, 100)).toEqual({ kind: 'none' })
    expect(correctionFor(99.96, 100)).toEqual({ kind: 'none' })
  })

  it('hard seeks when way off, because a nudge would take minutes', () => {
    expect(correctionFor(100, 97)).toEqual({ kind: 'seek', toSeconds: 97 })
    expect(correctionFor(97, 100)).toEqual({ kind: 'seek', toSeconds: 100 })
  })

  it('nudges the rate for anything in between', () => {
    // Running 0.4s ahead: slow down by 0.4 * 0.5 = 0.2, capped at 0.02.
    const ahead = correctionFor(100.4, 100)
    expect(ahead).toEqual({ kind: 'rate', playbackRate: 1 - MAX_RATE_ADJUSTMENT })

    const behind = correctionFor(99.6, 100)
    expect(behind).toEqual({ kind: 'rate', playbackRate: 1 + MAX_RATE_ADJUSTMENT })
  })

  it('always runs at the cap inside the nudge band', () => {
    // Worth being explicit about: with PLAN.md's constants the clamp always
    // binds. The smallest error that escapes the dead zone is just over
    // 0.05s, and 0.05 * RATE_GAIN = 0.025, already past the 0.02 cap. So the
    // proportional term is currently inert and correction is effectively
    // bang-bang: ±2% until back inside 50ms. That is fine: it converges from
    // the worst non-seeking case in well under a minute, inaudibly, but the
    // gain would only start mattering if the dead zone shrank below 0.04s.
    for (const diff of [0.051, 0.2, 0.6, 0.99]) {
      const correction = correctionFor(100 + diff, 100)
      if (correction.kind !== 'rate') throw new Error(`expected a rate nudge for ${diff}`)
      expect(correction.playbackRate).toBeCloseTo(1 - MAX_RATE_ADJUSTMENT, 9)
    }
  })

  it('never changes the rate by more than 2%', () => {
    for (const diff of [-0.9, -0.5, -0.2, 0.2, 0.5, 0.9]) {
      const correction = correctionFor(100 + diff, 100)
      if (correction.kind !== 'rate') throw new Error(`expected a rate nudge for ${diff}`)
      expect(Math.abs(correction.playbackRate - 1)).toBeLessThanOrEqual(MAX_RATE_ADJUSTMENT + 1e-9)
    }
  })

  it('corrects in the direction that closes the gap', () => {
    // Ahead of the server means play slower; behind means play faster.
    const ahead = correctionFor(100.3, 100)
    const behind = correctionFor(99.7, 100)
    if (ahead.kind !== 'rate' || behind.kind !== 'rate') throw new Error('expected rate nudges')

    expect(ahead.playbackRate).toBeLessThan(1)
    expect(behind.playbackRate).toBeGreaterThan(1)
  })

  it('switches from nudge to seek exactly at the threshold', () => {
    expect(correctionFor(100 + HARD_SEEK_THRESHOLD_S, 100).kind).toBe('rate')
    expect(correctionFor(100 + HARD_SEEK_THRESHOLD_S + 0.001, 100).kind).toBe('seek')
  })

  it('switches from silence to nudge exactly at the threshold', () => {
    expect(correctionFor(100 + NUDGE_THRESHOLD_S, 100).kind).toBe('none')
    expect(correctionFor(100 + NUDGE_THRESHOLD_S + 0.001, 100).kind).toBe('rate')
  })
})

describe('applyCorrection', () => {
  const audioStub = () => ({ currentTime: 100, playbackRate: 1 }) as HTMLAudioElement

  it('seeks and resets the rate', () => {
    const audio = audioStub()
    audio.playbackRate = 0.98

    applyCorrection(audio, { kind: 'seek', toSeconds: 42 })

    expect(audio.currentTime).toBe(42)
    expect(audio.playbackRate).toBe(1)
  })

  it('nudges without touching the position', () => {
    const audio = audioStub()

    applyCorrection(audio, { kind: 'rate', playbackRate: 0.99 })

    expect(audio.currentTime).toBe(100)
    expect(audio.playbackRate).toBe(0.99)
  })

  it('returns to normal speed once back in sync', () => {
    const audio = audioStub()
    audio.playbackRate = 1.02

    applyCorrection(audio, { kind: 'none' })

    expect(audio.playbackRate).toBe(1)
    expect(audio.currentTime).toBe(100)
  })
})

describe('convergence', () => {
  it('closes a half-second gap without ever seeking', () => {
    // Simulate the loop: 2s ticks, audio playing at the corrected rate.
    let actual = 100.5
    let expected = 100
    let seeks = 0

    for (let tick = 0; tick < 60; tick++) {
      const correction = correctionFor(actual, expected)
      if (correction.kind === 'seek') seeks++
      const rate = correction.kind === 'rate' ? correction.playbackRate : 1
      // Two seconds of wall time pass; audio advances at `rate`.
      actual += 2 * rate
      expected += 2
    }

    expect(seeks).toBe(0)
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(NUDGE_THRESHOLD_S)
  })
})
