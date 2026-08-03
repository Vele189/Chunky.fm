import { type RefObject, useEffect, useRef } from 'react'
import { seekTo, setSource } from '../lib/audio-element.js'
import {
  type Correction,
  DEFAULT_DRIFT_CHECK_INTERVAL_MS,
  applyCorrection,
  correctionFor,
} from '../lib/drift.js'
import { expectedPositionSeconds } from '../lib/position.js'
import { audioUrl, type StateMessage } from '../lib/protocol.js'

export interface SyncedAudioOptions {
  audioRef: RefObject<HTMLAudioElement | null>
  state: StateMessage | null
  /** Nothing is allowed to make noise until the listener has tuned in. */
  joined: boolean
  serverNow: () => number
  /** Until the clock handshake lands, aligning would align to the wrong time. */
  synced: boolean
  driftIntervalMs?: number
  onCorrection?: (correction: Correction, diffSeconds: number) => void
}

/**
 * Keeps the audio element on the station's clock.
 *
 * Two loops. The first realigns whenever the server broadcasts a change — new
 * track, pause, seek. The second runs continuously, because being aligned once
 * is not the same as staying aligned: audio clocks drift from system clocks.
 */
export function useSyncedAudio({
  audioRef,
  state,
  joined,
  serverNow,
  synced,
  driftIntervalMs = DEFAULT_DRIFT_CHECK_INTERVAL_MS,
  onCorrection,
}: SyncedAudioOptions): void {
  // Read through refs in the loops below so neither is torn down and restarted
  // on every render — the drift interval should be genuinely continuous, and
  // realignment should happen only when the station actually says something.
  const stateRef = useRef(state)
  const serverNowRef = useRef(serverNow)
  const onCorrectionRef = useRef(onCorrection)
  useEffect(() => {
    stateRef.current = state
    serverNowRef.current = serverNow
    onCorrectionRef.current = onCorrection
  })

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !state) return

    const track = state.track
    setSource(audio, track ? audioUrl(track) : null)
    if (!track || !joined || !synced) return

    // The clock is read through the ref on purpose. serverNow's identity
    // changes every time the offset estimate improves, and keying this effect
    // on it would hard-seek the element mid-song — exactly the audible glitch
    // the rate nudge exists to avoid. Offset refinements are the drift loop's
    // job, and it corrects them gently.
    seekTo(audio, expectedPositionSeconds(state, serverNowRef.current()))
    audio.playbackRate = 1

    if (state.pausedAt === null) {
      // Rejected when the browser hasn't seen a gesture yet; the join button
      // is that gesture, so by here it normally succeeds.
      void audio.play().catch(() => undefined)
    } else {
      audio.pause()
    }
  }, [audioRef, state, joined, synced])

  useEffect(() => {
    if (!joined || !synced) return

    const timer = window.setInterval(() => {
      const audio = audioRef.current
      const current = stateRef.current
      // Nothing to correct against while paused or off air.
      if (!audio || !current?.track || current.pausedAt !== null || audio.paused) return

      const expected = expectedPositionSeconds(current, serverNowRef.current())
      const correction = correctionFor(audio.currentTime, expected)
      applyCorrection(audio, correction)
      onCorrectionRef.current?.(correction, audio.currentTime - expected)
    }, driftIntervalMs)

    return () => window.clearInterval(timer)
  }, [audioRef, joined, synced, driftIntervalMs])
}
