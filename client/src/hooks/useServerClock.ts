import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type ClockSample,
  DEFAULT_PROBE_COUNT,
  DEFAULT_PROBE_SPACING_MS,
  DEFAULT_RESYNC_INTERVAL_MS,
  bestEstimate,
} from '../lib/clock.js'
import type { ServerMessage } from '../lib/protocol.js'
import type { StationConnection } from '../lib/station.js'

export interface ServerClock {
  /** The server's clock, as best we can tell. */
  serverNow: () => number
  offsetMs: number
  rttMs: number | null
  /** False until the first probe is answered — nothing should align yet. */
  synced: boolean
  /** Feed every server message here so pongs get matched to their probes. */
  handleMessage: (message: ServerMessage) => void
}

export interface ServerClockOptions {
  probeCount?: number
  probeSpacingMs?: number
  resyncIntervalMs?: number
  now?: () => number
}

/**
 * Runs the NTP-style handshake against the station and keeps it current.
 *
 * Probes are spaced rather than fired in one burst: five packets sent at once
 * share the same queueing delay, which is exactly the contamination that
 * picking the lowest RTT is supposed to avoid.
 *
 * Samples live in a rolling window instead of being cleared per round, so a
 * single slow round trip can never briefly become the estimate — a bad offset
 * would show up as an audible hard seek.
 */
export function useServerClock(
  connection: StationConnection | null,
  {
    probeCount = DEFAULT_PROBE_COUNT,
    probeSpacingMs = DEFAULT_PROBE_SPACING_MS,
    resyncIntervalMs = DEFAULT_RESYNC_INTERVAL_MS,
    now = Date.now,
  }: ServerClockOptions = {},
): ServerClock {
  const [offsetMs, setOffsetMs] = useState(0)
  const [rttMs, setRttMs] = useState<number | null>(null)
  const [synced, setSynced] = useState(false)

  const inFlight = useRef(new Set<number>())
  const samples = useRef<ClockSample[]>([])
  const windowSize = probeCount * 2

  const handleMessage = useCallback(
    (message: ServerMessage) => {
      if (message.type !== 'pong' || !inFlight.current.delete(message.t0)) return

      samples.current.push({ t0: message.t0, t1: message.t1, t2: now() })
      if (samples.current.length > windowSize) samples.current.shift()

      const estimate = bestEstimate(samples.current)
      if (!estimate) return
      setOffsetMs(estimate.offsetMs)
      setRttMs(estimate.rttMs)
      setSynced(true)
    },
    [now, windowSize],
  )

  useEffect(() => {
    if (!connection) return
    const timers: number[] = []

    const probeOnce = () => {
      let t0 = now()
      // t0 is the probe's identity as well as its timestamp; two probes landing
      // on the same millisecond would collide.
      while (inFlight.current.has(t0)) t0 += 0.001
      inFlight.current.add(t0)
      connection.send({ type: 'ping', t0 })
    }

    const round = () => {
      for (let i = 0; i < probeCount; i++) {
        timers.push(window.setTimeout(probeOnce, i * probeSpacingMs))
      }
    }

    round()
    const resync = window.setInterval(round, resyncIntervalMs)

    return () => {
      window.clearInterval(resync)
      for (const timer of timers) window.clearTimeout(timer)
      inFlight.current.clear()
    }
  }, [connection, probeCount, probeSpacingMs, resyncIntervalMs, now])

  const serverNow = useCallback(() => now() + offsetMs, [now, offsetMs])

  return { serverNow, offsetMs, rttMs, synced, handleMessage }
}
