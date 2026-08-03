import { useCallback, useEffect, useRef, useState } from 'react'
import { AdminPanel } from './AdminPanel.js'
import { useServerClock } from './hooks/useServerClock.js'
import { useStation } from './hooks/useStation.js'
import { useSyncedAudio } from './hooks/useSyncedAudio.js'
import { isAdminRoute } from './lib/admin.js'
import { seekTo } from './lib/audio-element.js'
import type { Correction } from './lib/drift.js'
import { expectedPositionSeconds, formatClock } from './lib/position.js'
import { artworkUrl, type QueueEntry, type ServerMessage } from './lib/protocol.js'

const STATUS_LABEL = {
  connecting: 'tuning in…',
  connected: 'on air',
  offline: 'reconnecting…',
} as const

export function App() {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [joined, setJoined] = useState(false)

  // The clock needs to see pongs but the station owns the socket, so the
  // handler goes through a ref to break what would otherwise be a cycle.
  const routeToClock = useRef<(message: ServerMessage) => void>(() => undefined)
  const { status, state, queue, connection, applyState, applyQueue } = useStation(
    undefined,
    (message) => routeToClock.current(message),
  )
  const admin = useAdminRoute()
  const clock = useServerClock(connection, { connected: status === 'connected' })
  // Assigned after commit, not during render — a render React throws away
  // must not leave a handler wired up behind it.
  useEffect(() => {
    routeToClock.current = clock.handleMessage
  }, [clock.handleMessage])

  const [drift, setDrift] = useState<{ correction: Correction; diff: number } | null>(null)
  const onCorrection = useCallback(
    (correction: Correction, diff: number) => setDrift({ correction, diff }),
    [],
  )

  useSyncedAudio({
    audioRef,
    state,
    joined,
    serverNow: clock.serverNow,
    synced: clock.synced,
    onCorrection,
  })

  const [position, setPosition] = useState(0)
  useEffect(() => {
    if (!joined) return
    const tick = () => setPosition(audioRef.current?.currentTime ?? 0)
    tick()
    const timer = window.setInterval(tick, 500)
    return () => window.clearInterval(timer)
  }, [joined])

  function tuneIn() {
    // Autoplay policy: play() has to be called synchronously inside the click
    // handler, not after an await, or the browser refuses it.
    const audio = audioRef.current
    if (audio && state?.track && state.pausedAt === null) {
      // Through seekTo, not currentTime: the click can land before the element
      // has metadata, and a bare assignment is silently dropped there — which
      // is a listener starting at 0:00 while everyone else is at 2:14.
      seekTo(audio, expectedPositionSeconds(state, clock.serverNow()))
      void audio.play().catch(() => undefined)
    }
    setJoined(true)
  }

  const track = state?.track ?? null
  const artwork = track ? artworkUrl(track) : null
  const tuning = joined && !clock.synced

  return (
    <main className="station">
      <header className="station__head">
        <h1>chunky.fm</h1>
        <span className={`status status--${status}`}>{STATUS_LABEL[status]}</span>
      </header>

      {!joined ? (
        <section className="join">
          <p className="join__blurb">
            One station. Everyone hears the same instant of the same song.
          </p>
          <button type="button" className="join__button" onClick={tuneIn}>
            Tune in
          </button>
        </section>
      ) : tuning ? (
        <section className="off-air">
          <p>tuning in…</p>
        </section>
      ) : track ? (
        <section className="now-playing">
          {artwork ? (
            <img className="now-playing__art" src={artwork} alt="" />
          ) : (
            <div className="now-playing__art now-playing__art--empty" aria-hidden="true" />
          )}
          <h2 className="now-playing__title">{track.title}</h2>
          <p className="now-playing__artist">{track.artist ?? 'Unknown artist'}</p>
          <p className="now-playing__time">
            {formatClock(position)} / {formatClock(track.durationMs / 1000)}
            {state?.pausedAt !== null && <span className="now-playing__paused"> — paused</span>}
          </p>
          <ClockReadout
            offsetMs={clock.offsetMs}
            rttMs={clock.rttMs}
            diff={drift?.diff ?? null}
            correction={drift?.correction ?? null}
          />
        </section>
      ) : (
        <section className="off-air">
          <p>Nothing on the decks right now.</p>
        </section>
      )}

      {joined && !admin && <UpNext queue={queue} />}

      {/* Owned imperatively — React never sets currentTime or calls play(). */}
      <audio ref={audioRef} preload="auto" />

      {/* The listener page ships no controls at all: off this route, none of
          this renders, and the server would refuse it anyway. */}
      {admin && (
        <AdminPanel
          state={state}
          queue={queue}
          status={status}
          applyState={applyState}
          applyQueue={applyQueue}
        />
      )}
    </main>
  )
}

/**
 * What's coming up, for listeners.
 *
 * The queue reaches every client, not just the admin — a station that has
 * decided what comes next may as well say so. Read-only: this is the same frame
 * the panel reorders, seen from the other side.
 */
function UpNext({ queue }: { queue: QueueEntry[] | null }) {
  if (!queue || queue.length === 0) return null

  return (
    <section className="up-next" data-testid="up-next">
      <h2 className="up-next__heading">Up next</h2>
      <ol className="up-next__list">
        {queue.map((entry) => (
          <li key={entry.id} data-entry={entry.id}>
            <span className="up-next__title">{entry.track.title}</span>
            <span className="up-next__artist">{entry.track.artist ?? 'Unknown artist'}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** True on #admin (or /admin), and follows the address bar without a reload. */
function useAdminRoute(): boolean {
  const [admin, setAdmin] = useState(() =>
    typeof window === 'undefined' ? false : isAdminRoute(window.location),
  )

  useEffect(() => {
    const update = () => setAdmin(isAdminRoute(window.location))
    window.addEventListener('hashchange', update)
    window.addEventListener('popstate', update)
    return () => {
      window.removeEventListener('hashchange', update)
      window.removeEventListener('popstate', update)
    }
  }, [])

  return admin
}

interface ClockReadoutProps {
  offsetMs: number
  rttMs: number | null
  diff: number | null
  correction: Correction | null
}

/** Visible sync diagnostics — the whole project lives or dies on these numbers. */
function ClockReadout({ offsetMs, rttMs, diff, correction }: ClockReadoutProps) {
  return (
    <dl className="sync" data-testid="sync-readout">
      <div>
        <dt>clock offset</dt>
        <dd data-testid="sync-offset">{Math.round(offsetMs)}ms</dd>
      </div>
      <div>
        <dt>rtt</dt>
        <dd data-testid="sync-rtt">{rttMs === null ? '—' : `${Math.round(rttMs)}ms`}</dd>
      </div>
      <div>
        <dt>drift</dt>
        <dd data-testid="sync-drift">{diff === null ? '—' : `${(diff * 1000).toFixed(0)}ms`}</dd>
      </div>
      <div>
        <dt>correcting</dt>
        <dd data-testid="sync-correction">
          {correction === null
            ? '—'
            : correction.kind === 'rate'
              ? `${correction.playbackRate.toFixed(3)}×`
              : correction.kind}
        </dd>
      </div>
    </dl>
  )
}
