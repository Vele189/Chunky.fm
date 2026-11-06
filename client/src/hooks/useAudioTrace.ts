import { type RefObject, useEffect, useRef } from 'react'
import type { StationAudio } from '../lib/audio-graph.js'
import {
  AudioTrace,
  type ElementContext,
  postTrace,
  traceEchoRequested,
} from '../lib/audio-trace.js'
import { outgoingPositionSeconds } from '../lib/decking.js'
import { expectedPositionSeconds } from '../lib/position.js'
import { type StateMessage, audioUrl } from '../lib/protocol.js'

export interface AudioTraceHookOptions {
  audioRef: RefObject<HTMLAudioElement | null>
  secondRef: RefObject<HTMLAudioElement | null>
  stage: StationAudio | null
  state: StateMessage | null
  joined: boolean
  synced: boolean
  serverNow: () => number
  offsetMs: number
  rttMs: number | null
  nickname: string | null
}

const FLUSH_MS = 5_000
const HEARTBEAT_MS = 30_000
/** A clock estimate moving less than this is not news. */
const CLOCK_NEWS_MS = 25

/**
 * Reports what this page's audio elements go through to the server's logs.
 * See `lib/audio-trace.ts`. Runs only once tuned in: before that the elements
 * are silent on purpose, and their events would be noise.
 */
export function useAudioTrace({
  audioRef,
  secondRef,
  stage,
  state,
  joined,
  synced,
  serverNow,
  offsetMs,
  rttMs,
  nickname,
}: AudioTraceHookOptions): AudioTrace {
  const live = useRef({ state, synced, serverNow, nickname })
  useEffect(() => {
    live.current = { state, synced, serverNow, nickname }
  })

  const traceRef = useRef<AudioTrace | null>(null)
  traceRef.current ??= new AudioTrace({
    send: postTrace,
    serverNow: () => (live.current.synced ? live.current.serverNow() : null),
    nickname: () => live.current.nickname,
    ua: typeof navigator === 'undefined' ? undefined : navigator.userAgent,
    echo: typeof window !== 'undefined' && traceEchoRequested(),
  })
  const trace = traceRef.current

  // Elements, page lifecycle, flushing and the heartbeat.
  useEffect(() => {
    if (!joined) return
    const contextFor = (audio: HTMLMediaElement): ElementContext => {
      const { state: current, synced: ready, serverNow: now } = live.current
      const track = current?.track?.id ?? null
      if (!current?.track || !ready) return { track, expected: null }
      const src = audio.getAttribute('src')
      if (src === audioUrl(current.track)) {
        return { track, expected: expectedPositionSeconds(current, now()) }
      }
      if (current.outgoing && src === audioUrl(current.outgoing.track)) {
        return { track, expected: outgoingPositionSeconds(current.outgoing, now()) }
      }
      return { track, expected: null }
    }

    trace.record('join')
    const decks = [
      ['a', audioRef.current],
      ['b', secondRef.current],
    ] as const
    const unwatch = decks.flatMap(([deck, audio]) =>
      audio ? [trace.watch(audio, deck, () => contextFor(audio))] : [],
    )

    const beat = window.setInterval(() => {
      for (const [deck, audio] of decks) {
        if (audio && !audio.paused) trace.recordElement('beat', deck, audio, contextFor(audio))
      }
    }, HEARTBEAT_MS)
    const flush = window.setInterval(() => trace.flush(), FLUSH_MS)

    // Safari backgrounding a tab is one of the ways music stops on a phone.
    const onVisibility = () => trace.record(document.visibilityState)
    const onHide = () => {
      trace.record('pagehide')
      trace.flush(true)
    }
    const onOnline = () => trace.record('online')
    const onOffline = () => trace.record('offline')
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onHide)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    return () => {
      for (const off of unwatch) off()
      window.clearInterval(beat)
      window.clearInterval(flush)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onHide)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      trace.flush()
    }
  }, [joined, audioRef, secondRef, trace])

  // The audio context: Safari suspends or "interrupts" it, and the music goes with it.
  useEffect(() => {
    const context = stage?.context
    if (!joined || !context) return
    trace.record('context', { detail: context.state })
    const onChange = () => trace.record('context', { detail: context.state })
    context.addEventListener('statechange', onChange)
    return () => context.removeEventListener('statechange', onChange)
  }, [joined, stage, trace])

  // What the station said, so each element event can be read against it.
  const trackId = state?.track?.id ?? null
  const pausedAt = state?.pausedAt ?? null
  const startedAt = state?.startedAt ?? null
  const outgoingId = state?.outgoing?.track.id ?? null
  useEffect(() => {
    if (!joined) return
    const current = live.current.state
    trace.record('state', {
      track: trackId,
      detail:
        `startedAt=${startedAt} pausedAt=${pausedAt} durationMs=${current?.track?.durationMs ?? null}` +
        (current?.outgoing
          ? ` outgoing=${outgoingId} endsAt=${current.outgoing.endsAt}`
          : ''),
    })
  }, [joined, trackId, pausedAt, startedAt, outgoingId, trace])

  // The clock estimate, when it moves enough to matter.
  const lastClock = useRef<number | null>(null)
  useEffect(() => {
    if (!joined || !synced) return
    if (lastClock.current !== null && Math.abs(offsetMs - lastClock.current) < CLOCK_NEWS_MS) return
    lastClock.current = offsetMs
    trace.record('clock', { detail: `offset=${Math.round(offsetMs)} rtt=${rttMs === null ? null : Math.round(rttMs)}` })
  }, [joined, synced, offsetMs, rttMs, trace])

  return trace
}
