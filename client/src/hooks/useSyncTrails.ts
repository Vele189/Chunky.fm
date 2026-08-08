import { useEffect, useRef, useState } from 'react'
import { TRAIL_SAMPLE_MS, type TrailPoint, record } from '../lib/trail.js'

export interface SyncTrails {
  offset: TrailPoint[]
  rtt: TrailPoint[]
  drift: TrailPoint[]
}

const EMPTY: SyncTrails = { offset: [], rtt: [], drift: [] }

export interface SyncTrailCurrents {
  /** Null while there is no honest number — unsynced, off air, not joined. */
  offsetMs: number | null
  rttMs: number | null
  driftMs: number | null
}

/**
 * The last few minutes of the sync numbers, sampled for drawing.
 *
 * On a timer rather than on change, and the distinction matters for the
 * graphs: the RTT estimate keeps the best sample of a window, so its *value*
 * can sit unchanged for whole minutes — a trail that only grew on change
 * would age out and vanish while the number it describes was at its most
 * boringly healthy. A steady line is the picture of that health, so steady
 * gets sampled too.
 *
 * One timer and one state for all three, so a tick is one render, not three.
 */
export function useSyncTrails(currents: SyncTrailCurrents): SyncTrails {
  const [trails, setTrails] = useState<SyncTrails>(EMPTY)

  // Read through a ref so the timer never restarts on a value change —
  // restarting it on every drift tick would sample at the beat of the thing
  // being measured, which is how aliasing gets invented.
  const now = useRef(currents)
  now.current = currents

  useEffect(() => {
    const tick = () => {
      const { offsetMs, rttMs, driftMs } = now.current
      const at = Date.now()
      setTrails((current) => ({
        offset: offsetMs === null ? current.offset : record(current.offset, offsetMs, at),
        rtt: rttMs === null ? current.rtt : record(current.rtt, rttMs, at),
        drift: driftMs === null ? current.drift : record(current.drift, driftMs, at),
      }))
    }
    tick()
    const timer = setInterval(tick, TRAIL_SAMPLE_MS)
    return () => clearInterval(timer)
  }, [])

  return trails
}
