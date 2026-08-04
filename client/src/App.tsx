import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { AdminPanel } from './AdminPanel.js'
import { usePresence } from './hooks/usePresence.js'
import { useServerClock } from './hooks/useServerClock.js'
import { useStation } from './hooks/useStation.js'
import { useSyncedAudio } from './hooks/useSyncedAudio.js'
import { isAdminRoute } from './lib/admin.js'
import { seekTo } from './lib/audio-element.js'
import { type Availability, canTuneIn, outage, staleNotice, statusLabel } from './lib/availability.js'
import {
  chatRefusal,
  draftAfterRefusal,
  formatTime,
  isSendableMessage,
  MESSAGE_MAX_LENGTH,
  normalizeMessageText,
} from './lib/chat.js'
import type { Correction } from './lib/drift.js'
import { playedEarlier, playedLabel } from './lib/history.js'
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
  type Play,
  type QueueEntry,
  type ServerMessage,
  type SocketRefusal,
  type Wish,
  refusalAbout,
} from './lib/protocol.js'
import {
  type SkipTally,
  skipTallyLabel,
  tallyFor,
  voteButtonLabel,
  voteRefusal,
} from './lib/skips.js'
import type { StationConnection } from './lib/station.js'
import {
  isSendableWish,
  normalizeWishText,
  WISH_MAX_LENGTH,
  wishRefusal,
  wishStatusLabel,
} from './lib/wishes.js'

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
  const {
    status,
    reach,
    state,
    queue,
    listeners,
    messages,
    myWishes,
    history,
    skips,
    socketError,
    clearSocketError,
    connection,
    applyState,
    applyQueue,
  } = useStation(undefined, (message) => routeToClock.current(message))
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
  // Nothing left on the page that came from a station: either this listener
  // never got one, or the outage arrived before the first frame did. There is
  // no stale truth to keep showing, so the outage screen takes the whole panel.
  const stranded = reach !== 'live' && (!clock.synced || state === null)

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
          <span className={`status status--${reach}`}>{statusLabel(reach)}</span>
        </div>
      </header>

      {/* Above everything it is about. What is below stopped being live at the
          drop — the roster, the tally and the clock all did — and a page that
          kept presenting it as current would be the broken UI this replaces. */}
      {joined && !stranded && <StaleNotice state={reach} />}

      {!joined ? (
        canTuneIn(reach) ? (
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
        ) : (
          <Outage state={reach} />
        )
      ) : stranded ? (
        <Outage state={reach} />
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
        // The station is there and answering; it just isn't playing anything.
        // That reads exactly like a broken page unless the page says otherwise,
        // so it says both halves: nothing is on, and you have missed nothing.
        <section className="off-air" data-testid="off-air">
          <p className="off-air__headline">Nothing on the decks right now.</p>
          <p className="off-air__detail">
            You're tuned in — whatever goes on next starts here on its own.
          </p>
        </section>
      )}

      {/* Under the track it is about, and only for listeners: the admin has a
          Skip button, and voting for something you can simply do is theatre.
          The tally still reaches the panel — see AdminPanel. */}
      {joined && !admin && track && (
        <SkipVote
          tally={tallyFor(skips, track.id)}
          listeners={listeners?.length ?? 0}
          connection={connection}
          live={status === 'connected'}
          refusal={refusalAbout(socketError, 'vote')}
          clearRefusal={clearSocketError}
        />
      )}

      {joined && !admin && <UpNext queue={queue} />}
      {/* Directly under what's coming, because it is the same question pointed
          the other way: what is about to be on, and what already was. */}
      {joined && !admin && <Earlier plays={history} currentTrackId={track?.id ?? null} />}
      {/* Shown on the admin route too: the panel has the queue covered, but
          nothing in it says who is out there or what they are saying. */}
      {joined && <Listeners listeners={listeners} />}
      {/* Two composers, one socket: each is handed only the refusals that are
          about what it sends, or a refused wish would also read as a message
          that went nowhere. */}
      {joined && (
        <Wishes
          wishes={myWishes}
          connection={connection}
          live={status === 'connected'}
          refusal={refusalAbout(socketError, 'wish')}
          clearRefusal={clearSocketError}
        />
      )}
      {joined && (
        <Chat
          messages={messages}
          connection={connection}
          live={status === 'connected'}
          refusal={refusalAbout(socketError, 'say')}
          clearRefusal={clearSocketError}
        />
      )}

      {/* Owned imperatively — React never sets currentTime or calls play(). */}
      <audio ref={audioRef} preload="auto" />

      {/* The listener page ships no controls at all: off this route, none of
          this renders, and the server would refuse it anyway. */}
      {admin && (
        <AdminPanel
          state={state}
          queue={queue}
          skips={tallyFor(skips, track?.id ?? null)}
          status={status}
          applyState={applyState}
          applyQueue={applyQueue}
        />
      )}
    </main>
  )
}

/**
 * The station is not there.
 *
 * PLAN.md's offline screen. What it is for is the case where every other part
 * of this page is a lie: no socket, so no track, no roster, no chat, and a
 * layout full of empty boxes that reads like a page that broke rather than a
 * station that went away. This says which one it is.
 *
 * There is no Retry button and there deliberately never will be. The connection
 * is already retrying on a backoff (`lib/station.ts`), so the only thing a
 * button could do is exactly what is happening anyway, while implying the page
 * had given up and was waiting to be told to try again.
 */
function Outage({ state }: { state: Availability }) {
  const notice = outage(state)
  if (!notice) return null

  return (
    <section className="outage" data-testid="outage" data-reach={state} role="status">
      <p className="outage__headline">{notice.headline}</p>
      <p className="outage__detail">{notice.detail}</p>
    </section>
  )
}

/**
 * The station is not there, but the page still has what it last said.
 *
 * A drop of a second or two is the common one, and the audio usually plays
 * straight through it out of the buffer — so blanking a track the listener can
 * still hear would be worse than the outage. What the page must not do is go on
 * presenting a frozen roster and a dead tally as live, and this line is the
 * difference between the two.
 */
function StaleNotice({ state }: { state: Availability }) {
  const notice = staleNotice(state)
  if (!notice) return null

  return (
    <p className="stale" data-testid="stale-notice" data-reach={state} role="status">
      {notice}
    </p>
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
 * What has already been on.
 *
 * PLAN.md's now-playing history, from the listener's side: the evening so far,
 * newest first, so somebody who walked in on the end of something can see what
 * it was. The station writes a play down when the track starts, which makes the
 * newest row whatever is on right now — already shown in full at the top of the
 * page — so `playedEarlier` drops it and this list is only what was missed.
 *
 * Written down rather than held on the socket, so unlike the roster and the skip
 * tally it survives a reload and covers an outage: whatever went on while a
 * listener was reconnecting arrives in the replay, merged by id.
 */
function Earlier({ plays, currentTrackId }: { plays: Play[]; currentTrackId: number | null }) {
  const earlier = playedEarlier(plays, currentTrackId)
  if (earlier.length === 0) return null

  return (
    <section className="earlier" data-testid="earlier">
      <h2 className="earlier__heading">Earlier</h2>
      <ol className="earlier__list">
        {earlier.map((play) => (
          <li key={play.id} className="earlier__line" data-play={play.id} data-track={play.track.id}>
            <time className="earlier__at" dateTime={new Date(play.at).toISOString()}>
              {formatTime(play.at)}
            </time>
            <span className="earlier__title">{playedLabel(play)}</span>
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

interface SkipVoteProps {
  /** As the station last described it, and only ever about the track that is on. */
  tally: SkipTally
  /** How many are in the room — the tally is a fraction of this. */
  listeners: number
  connection: StationConnection | null
  live: boolean
  /** The last refusal that was about a vote, if any. */
  refusal: SocketRefusal | null
  clearRefusal(): void
}

/**
 * Voting on what is on.
 *
 * PLAN.md's last social piece: the room can say it would rather hear something
 * else, everyone can see how many agree, and the count starts again with every
 * track. What it deliberately is *not* is a control — no threshold here advances
 * the station, because the socket carries nothing that drives the decks and a
 * quorum that did would be exactly that, wearing a vote as a disguise. The tally
 * is the room telling whoever runs the decks something; what happens next is a
 * person's decision.
 *
 * Nothing is rendered optimistically, for the reason the chat renders nothing
 * optimistically: the count and the state of this listener's own vote both come
 * back from the station, so what is on screen is what the station holds — even
 * across a reconnect, which drops the vote this page just cast.
 */
function SkipVote({ tally, listeners, connection, live, refusal, clearRefusal }: SkipVoteProps) {
  function vote() {
    if (!connection || !live) return
    // Only this control's own notice — see the same line under the wishes.
    if (refusal) clearRefusal()
    // Where the listener now stands, not "toggle": a second press of a button
    // that has not caught up yet leaves one vote rather than cancelling itself.
    connection.send({ type: 'vote_skip', voted: !tally.voted })
  }

  const refusalNotice = refusal ? voteRefusal(refusal.error.code) : null

  return (
    <section className="skips" data-testid="skips">
      <p className="skips__tally" data-testid="skips-tally" data-votes={tally.votes}>
        {skipTallyLabel(tally.votes, listeners)}
      </p>
      <button
        type="button"
        className={`skips__vote${tally.voted ? ' skips__vote--in' : ''}`}
        data-testid="skips-vote"
        aria-pressed={tally.voted}
        disabled={!live}
        onClick={vote}
      >
        {voteButtonLabel(tally.voted)}
      </button>
      {refusalNotice && (
        <p className="skips__refusal" role="status" data-testid="skips-refusal">
          {refusalNotice}
        </p>
      )}
    </section>
  )
}

interface WishesProps {
  /** This listener's own — the only ones the station tells them about. */
  wishes: Wish[]
  connection: StationConnection | null
  live: boolean
  /** The last refusal that was about a wish, if any. */
  refusal: SocketRefusal | null
  clearRefusal(): void
}

/**
 * Asking for something.
 *
 * PLAN.md's requests decision, in full: free text, and no library to browse.
 * There is nothing to pick from here on purpose — a listener asks in their own
 * words for something the station may not even have, and whoever runs the decks
 * reads it and decides. So this composer promises nothing, and says so.
 *
 * What comes back is the wish as the station wrote it down, and that is the
 * whole confirmation — nothing is rendered optimistically, for the reason the
 * chat renders nothing optimistically: a line that says "asked" for something
 * that was refused is worse than no line at all.
 */
function Wishes({ wishes, connection, live, refusal, clearRefusal }: WishesProps) {
  const [draft, setDraft] = useState('')
  // What went out and has not been answered, so a refusal can hand it back.
  const unanswered = useRef<string | null>(null)

  const seq = refusal?.seq
  useEffect(() => {
    if (seq === undefined) return
    const text = unanswered.current
    unanswered.current = null
    setDraft((current) => draftAfterRefusal(current, text))
  }, [seq])

  function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = normalizeWishText(draft)
    if (text.length === 0 || !connection || !live) return
    // Only when this composer has a notice up. The station keeps one refusal at
    // a time for the whole socket, and clearing it from here would take down
    // the chat's "not sent" because somebody asked for a song.
    if (refusal) clearRefusal()
    unanswered.current = text
    connection.send({ type: 'wish', text })
    setDraft('')
  }

  const refusalNotice = refusal ? wishRefusal(refusal.error.code) : null

  return (
    <section className="wishes" data-testid="wishes">
      <h2 className="wishes__heading">Wishes</h2>
      {wishes.length === 0 ? (
        <p className="wishes__blurb">
          Ask for anything. Whoever's on the decks reads these — no promises.
        </p>
      ) : (
        <ol className="wishes__list" data-testid="wishes-list">
          {wishes.map((wish) => (
            <li key={wish.id} className="wishes__line" data-wish={wish.id}>
              <span className="wishes__text">{wish.text}</span>
              {/* Only ever "asked" for now: nothing tells a listener their wish
                  was played, so a status that could change is rendered rather
                  than assumed. */}
              <span className="wishes__status">{wishStatusLabel(wish.status)}</span>
            </li>
          ))}
        </ol>
      )}
      {refusalNotice && (
        <p className="wishes__refusal" role="status" data-testid="wishes-refusal">
          {refusalNotice}
        </p>
      )}
      <form className="wishes__form" onSubmit={ask}>
        <label className="wishes__label" htmlFor="wish-input">
          Ask for something
        </label>
        <input
          id="wish-input"
          className="wishes__input"
          data-testid="wish-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={live ? 'anything off Rumours…' : 'reconnecting…'}
          maxLength={WISH_MAX_LENGTH}
          autoComplete="off"
          disabled={!live}
        />
        <button
          type="submit"
          className="wishes__send"
          disabled={!live || !isSendableWish(draft)}
        >
          Ask
        </button>
      </form>
    </section>
  )
}

interface ChatProps {
  messages: ChatMessage[]
  connection: StationConnection | null
  /** False while reconnecting — a send would go on the floor unannounced. */
  live: boolean
  /** The last refusal that was about a message, if any. */
  refusal: SocketRefusal | null
  clearRefusal(): void
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
function Chat({ messages, connection, live, refusal, clearRefusal }: ChatProps) {
  const [draft, setDraft] = useState('')
  const list = useRef<HTMLOListElement>(null)
  // What went out and has not been answered, so a refusal can hand it back.
  const unanswered = useRef<string | null>(null)

  // Follow the conversation. Reading back through it is a scroll away, but a
  // new line arriving should not leave the listener looking at an old one.
  useEffect(() => {
    const element = list.current
    if (element) element.scrollTop = element.scrollHeight
  }, [messages])

  // A refused message is not a sent message, so give the text back rather than
  // leaving the listener to retype something they watched disappear. Keyed on
  // the sequence number, so a second identical refusal is still a refusal.
  //
  // Only into a composer they have not started refilling: whatever they are
  // typing now is newer than whatever was refused, and restoring over the top
  // of it would destroy the one thing here that isn't recoverable.
  const seq = refusal?.seq
  useEffect(() => {
    if (seq === undefined) return
    const text = unanswered.current
    unanswered.current = null
    setDraft((current) => draftAfterRefusal(current, text))
  }, [seq])

  function say(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = normalizeMessageText(draft)
    if (text.length === 0 || !connection || !live) return
    // Only this composer's own — see the same line under the wishes.
    if (refusal) clearRefusal()
    unanswered.current = text
    connection.send({ type: 'say', text })
    setDraft('')
  }

  const refusalNotice = refusal ? chatRefusal(refusal.error.code) : null

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
      {refusalNotice && (
        <p className="chat__refusal" role="status" data-testid="chat-refusal">
          {refusalNotice}
        </p>
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
