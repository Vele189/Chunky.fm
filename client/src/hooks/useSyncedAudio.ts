import { type RefObject, useEffect } from 'react'
import { seekTo, setSource } from '../lib/audio-element.js'
import { expectedPositionSeconds } from '../lib/position.js'
import { audioUrl, type StateMessage } from '../lib/protocol.js'

export interface SyncedAudioOptions {
  audioRef: RefObject<HTMLAudioElement | null>
  state: StateMessage | null
  /** Nothing is allowed to make noise until the listener has tuned in. */
  joined: boolean
}

/**
 * Aligns the audio element to whatever the server last broadcast.
 *
 * This runs on every state change: a new track, a pause, a seek. Continuous
 * drift correction between broadcasts is a separate concern.
 */
export function useSyncedAudio({ audioRef, state, joined }: SyncedAudioOptions): void {
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !state) return

    const track = state.track
    setSource(audio, track ? audioUrl(track) : null)
    if (!track || !joined) return

    seekTo(audio, expectedPositionSeconds(state, Date.now()))

    if (state.pausedAt === null) {
      // Rejected when the browser hasn't seen a gesture yet; the join button
      // is that gesture, so by here it normally succeeds.
      void audio.play().catch(() => undefined)
    } else {
      audio.pause()
    }
  }, [audioRef, state, joined])
}
