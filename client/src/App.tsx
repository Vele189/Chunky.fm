import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { AdminPanel } from './AdminPanel.js'
import { usePresence } from './hooks/usePresence.js'
import { useServerClock } from './hooks/useServerClock.js'
import { useStation } from './hooks/useStation.js'
import { useSyncedAudio } from './hooks/useSyncedAudio.js'
import { isAdminRoute } from './lib/admin.js'
import { seekTo } from './lib/audio-element.js'
import {
  formatTime,
  isSendableMessage,
  MESSAGE_MAX_LENGTH,
  normalizeMessageText,
} from './lib/chat.js'
import type { Correction } from './lib/drift.js'
import {
  isValidNickname,
  loadNickname,
  NICKNAME_MAX_LENGTH,
  saveNickname,
} from './lib/nickname.js'
import { expectedPositionSeconds, formatClock } from './lib/position.js'
import {
  artworkUrl,
  type ChatMessage,
  type Listener,
  type QueueEntry,
  type ServerMessage,
} from './lib/protocol.js'
import type { StationConnection } from './lib/station.js'

const STATUS_LABEL = {
  connecting: 'tuning in…',
  connected: 'on air',
  offline: 'reconnecting…',
} as const

export function App() {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [joined, setJoined] = useState(false)
  // Read once, at mount: what a previous visit left behind is the starting
  // point for the field, not a decision to join. The gesture still has to
  // happen — a browser will not start audio because localStorage had a name in
  // it — so a returning listener finds the field filled and presses the button.
  const [nickname, setNickname] = useState(() => loadNickname() ?? '')

  // The clock needs to see pongs but the station owns the socket, so the
  // handler goes through a ref to break what would otherwise be a cycle.
  const routeToClock = useRef<(message: ServerMessage) => void>(() => undefined)
  const { status, state, queue, listeners, messages, connection, applyState, applyQueue } =
    useStation(undefined, (message) => routeToClock.current(message))
  const admin = useAdminRoute()
  const clock = useServerClock(connection, { connected: status === 'connected' })
  // Only once tuned in: a socket is open from the moment the page loads, and a
  // name typed into the field is not yet a listener in the room.
  usePresence(connection, {
    connected: status === 'connected',
    nickname: joined ? nickname : null,
  })
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

  function joinStation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    // The gate: no nickname, no session. The button is disabled without one,
    // but Enter in the field arrives here too, and refusing to join belongs
    // next to joining rather than only in what the button looks like.
    const stored = saveNickname(nickname)
    if (stored === null) return
    setNickname(stored)

    // Autoplay policy: play() has to be called synchronously inside the submit
    // handler, not after an await, or the browser refuses it. That is why the
    // nickname is a field on the form the button submits rather than a step
    // before it — naming yourself and tuning in are one gesture, and splitting
    // them would leave the audio starting outside any gesture at all.
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
        <div className="station__who">
          {joined && (
            <span className="station__nick" data-testid="nickname">
              listening as {nickname}
            </span>
          )}
          <span className={`status status--${status}`}>{STATUS_LABEL[status]}</span>
        </div>
      </header>

      {!joined ? (
        <section className="join">
          <p className="join__blurb">
            One station. Everyone hears the same instant of the same song.
          </p>
          <form className="join__form" onSubmit={joinStation}>
            <label className="join__label" htmlFor="nickname">
              What should everyone call you?
            </label>
            <input
              id="nickname"
              className="join__input"
              name="nickname"
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              placeholder="nickname"
              maxLength={NICKNAME_MAX_LENGTH}
              autoComplete="nickname"
              autoFocus
              required
            />
            <button type="submit" className="join__button" disabled={!isValidNickname(nickname)}>
              Tune in
            </button>
          </form>
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
      {/* Shown on the admin route too: the panel has the queue covered, but
          nothing in it says who is out there or what they are saying. */}
      {joined && <Listeners listeners={listeners} />}
      {joined && (
        <Chat messages={messages} connection={connection} live={status === 'connected'} />
      )}

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

/**
 * Who else is here.
 *
 * The roster arrives whole on every change rather than as joins and leaves, so
 * there is nothing to reconcile: render what the last frame said. Rows are
 * keyed on the socket's id, not the nickname, because two listeners are allowed
 * to pick the same name and both of them should show up.
 *
 * Null before the first roster arrives, and empty for the moment between tuning
 * in and this listener's own join landing — neither is worth a heading.
 */
function Listeners({ listeners }: { listeners: Listener[] | null }) {
  if (!listeners || listeners.length === 0) return null

  return (
    <section className="listeners" data-testid="listeners">
      <h2 className="listeners__heading">
        Listening now
        <span className="listeners__count" data-testid="listener-count">
          {listeners.length}
        </span>
      </h2>
      <ul className="listeners__list">
        {listeners.map((listener) => (
          <li key={listener.id} className="listeners__name" data-listener={listener.id}>
            {listener.nickname}
          </li>
        ))}
      </ul>
    </section>
  )
}

interface ChatProps {
  messages: ChatMessage[]
  connection: StationConnection | null
  /** False while reconnecting — a send would go on the floor unannounced. */
  live: boolean
}

/**
 * The room, talking.
 *
 * Nothing is rendered optimistically: what was typed goes out, and appears when
 * it comes back with the id and timestamp the server gave it. That costs a
 * round trip on a station where everyone is already listening to the same
 * server, and it buys a list that is the same list for everyone in the room —
 * no local-only line that a refused message would leave sitting there looking
 * sent.
 */
function Chat({ messages, connection, live }: ChatProps) {
  const [draft, setDraft] = useState('')
  const list = useRef<HTMLOListElement>(null)

  // Follow the conversation. Reading back through it is a scroll away, but a
  // new line arriving should not leave the listener looking at an old one.
  useEffect(() => {
    const element = list.current
    if (element) element.scrollTop = element.scrollHeight
  }, [messages])

  function say(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = normalizeMessageText(draft)
    if (text.length === 0 || !connection || !live) return
    connection.send({ type: 'say', text })
    setDraft('')
  }

  return (
    <section className="chat" data-testid="chat">
      <h2 className="chat__heading">Chat</h2>
      {messages.length === 0 ? (
        <p className="chat__empty">Nobody has said anything yet.</p>
      ) : (
        <ol className="chat__list" data-testid="chat-list" ref={list}>
          {messages.map((message) => (
            <li key={message.id} className="chat__line" data-message={message.id}>
              <time className="chat__at" dateTime={new Date(message.at).toISOString()}>
                {formatTime(message.at)}
              </time>
              <span className="chat__nick">{message.nickname}</span>
              <span className="chat__text">{message.text}</span>
            </li>
          ))}
        </ol>
      )}
      <form className="chat__form" onSubmit={say}>
        <label className="chat__label" htmlFor="chat-input">
          Say something
        </label>
        <input
          id="chat-input"
          className="chat__input"
          data-testid="chat-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={live ? 'say something' : 'reconnecting…'}
          maxLength={MESSAGE_MAX_LENGTH}
          autoComplete="off"
          disabled={!live}
        />
        <button
          type="submit"
          className="chat__send"
          disabled={!live || !isSendableMessage(draft)}
        >
          Send
        </button>
      </form>
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
