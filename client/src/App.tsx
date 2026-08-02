import { useEffect, useRef, useState } from 'react'
import { useStation } from './hooks/useStation.js'
import { useSyncedAudio } from './hooks/useSyncedAudio.js'
import { expectedPositionSeconds, formatClock } from './lib/position.js'
import { artworkUrl } from './lib/protocol.js'

const STATUS_LABEL = {
  connecting: 'tuning in…',
  connected: 'on air',
  offline: 'reconnecting…',
} as const

export function App() {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [joined, setJoined] = useState(false)
  const { status, state } = useStation()

  useSyncedAudio({ audioRef, state, joined })

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
      audio.currentTime = expectedPositionSeconds(state, Date.now())
      void audio.play().catch(() => undefined)
    }
    setJoined(true)
  }

  const track = state?.track ?? null
  const artwork = track ? artworkUrl(track) : null

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
        </section>
      ) : (
        <section className="off-air">
          <p>Nothing on the decks right now.</p>
        </section>
      )}

      {/* Owned imperatively — React never sets currentTime or calls play(). */}
      <audio ref={audioRef} preload="auto" />
    </main>
  )
}
