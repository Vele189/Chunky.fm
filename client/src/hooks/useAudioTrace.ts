import { type RefObject, useEffect, useRef } from 'react'
import type { StationAudio } from '../lib/audio-graph.js'
import {
  AudioTrace,
  ChopDetector,
  type ElementContext,
  describeChop,
  describeEnvironment,
  postTrace,
  traceEchoRequested,
} from '../lib/audio-trace.js'
import { outgoingPositionSeconds } from '../lib/decking.js'
import { canCorrect, driftPolicyFor } from '../lib/drift.js'
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
const CHOP_SAMPLE_MS = 500
/** At most one chop line per deck, and one for the context, in this long. */
const CHOP_REPORT_MS = 5_000
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

    const chops = decks.flatMap(([deck, audio]) =>
      audio ? [{ deck, audio, detector: new ChopDetector(), src: audio.getAttribute('src') }] : [],
    )
    const chopSample = window.setInterval(() => {
      const wall = performance.now()
      for (const chop of chops) {
        const src = chop.audio.getAttribute('src')
        if (src !== chop.src) {
          chop.src = src
          chop.detector.reset()
        }
        chop.detector.sample({
          wall,
          position: chop.audio.currentTime,
          rate: chop.audio.playbackRate,
          steady: canCorrect(chop.audio),
        })
      }
    }, CHOP_SAMPLE_MS)
    const chopReport = window.setInterval(() => {
      for (const { deck, audio, detector } of chops) {
        const summary = detector.drain()
        if (summary) trace.recordElement('chop', deck, audio, contextFor(audio), describeChop(summary))
      }
    }, CHOP_REPORT_MS)

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
      window.clearInterval(chopSample)
      window.clearInterval(chopReport)
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
    if (!joined) return
    trace.record('env', {
      detail: describeEnvironment(navigator, context, driftPolicyFor(navigator)),
    })
    if (!context) return
    trace.record('context', { detail: context.state })
    const onChange = () => trace.record('context', { detail: context.state })
    context.addEventListener('statechange', onChange)

    // The graph's own clock. If this stutters too, the sound is being lost in
    // Web Audio or the output, and not by the element feeding it.
    const detector = new ChopDetector()
    const sample = window.setInterval(() => {
      detector.sample({
        wall: performance.now(),
        position: context.currentTime,
        rate: 1,
        steady: context.state === 'running',
      })
    }, CHOP_SAMPLE_MS)
    const report = window.setInterval(() => {
      const summary = detector.drain()
      if (summary) trace.record('ctx-chop', { detail: describeChop(summary) })
    }, CHOP_REPORT_MS)

    return () => {
      context.removeEventListener('statechange', onChange)
      window.clearInterval(sample)
      window.clearInterval(report)
    }
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
