import {
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { AdminPanel } from './AdminPanel.js'
import { Sidebar } from './Sidebar.js'
import { Topbar } from './Topbar.js'
import { Deck, Mute, OnAir, Waveform, WishShortcut } from './Turntable.js'
import { type AdminSession, useAdminSession } from './hooks/useAdminSession.js'
import { type Access, useStationAccess } from './hooks/useStationAccess.js'
import { usePresence } from './hooks/usePresence.js'
import { useServerClock } from './hooks/useServerClock.js'
import { useStation } from './hooks/useStation.js'
import { useSyncedAudio } from './hooks/useSyncedAudio.js'
import { seekTo } from './lib/audio-element.js'
import { type Availability, canTuneIn, outage, staleNotice } from './lib/availability.js'
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
import { DEFAULT_ROUTE, type Route, isConsole, needsJoin, routeFrom } from './lib/routes.js'
import { matchesFilter } from './lib/search.js'
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

/** How much of the evening the history shows before "View all" is pressed. */
const EARLIER_SHOWN = 4

/**
 * The door, and then the station.
 *
 * Split in two so that nothing below opens a socket, starts a clock or asks for
 * a roster until the station has said this browser may hear it. On an open
 * station — the default, and what PLAN.md describes — that answer is yes and
 * this costs one request; on a private one it is the difference between a page
 * that explains itself and a page that reconnects forever.
 */
export function App() {
  const route = useRoute()
  const session = useAdminSession()
  const access = useStationAccess()

  const admitted =
    // The console is never behind the invite gate. It is how whoever runs the
    // station gets in, and needing an invite to reach the sign-in form would
    // lock the owner out of their own station — there being no way to issue
    // themselves one. Nothing is given away by rendering it: every route it
    // calls is gated on the server, and the gate is the password.
    isConsole(route) ||
    // And once signed in, admitted everywhere else too. The station already
    // agrees — admin credentials satisfy the listener gate — but this browser
    // asked before it had any, and the answer it got is now out of date.
    session.status === 'signed-in' ||
    access === 'admitted' ||
    // A station that has not answered has refused nothing. The offline screen
    // is what that case is for: it keeps retrying and tunes in by itself, and
    // the probe keeps asking, so a private station still gets to say so.
    access === 'unreachable'

  if (!admitted) return <Doorway access={access} />
  return <Station route={route} session={session} />
}

/**
 * What stands in for the whole page while the station decides, or instead of it
 * when the answer is no.
 *
 * Deliberately not the outage screen: an outage is the station being gone and
 * fixing itself, and neither is true here. Somebody without an invite needs to
 * know there is nothing wrong and nothing to wait for — the only thing that
 * helps is a link from whoever runs it.
 */
function Doorway({ access }: { access: Access }) {
  return (
    <div className="doorway">
      <h1 className="wordmark">
        chunky<span className="wordmark__tld">.fm</span>
      </h1>
      {access === 'refused' ? (
        <>
          <div className="outage" data-testid="not-invited" role="status">
            <p className="outage__headline">This station is private.</p>
            <p className="outage__detail">
              You need a link from whoever runs it. If you had one that worked before, it has been
              replaced — ask for the new one.
            </p>
          </div>
          {/* The one screen where somebody is standing outside wondering what
              they have been sent, so it is the one screen that says. Outside
              the status region rather than in it: what is being reported is
              that the door is shut, and a link is not part of that report.

              Only here. Somebody on the unreachable screen has an invite that
              works and a station that is away — they know what this is, and
              they are waiting rather than asking. */}
          <a className="button button--quiet" href="/">
            What chunky.fm is
          </a>
        </>
      ) : access === 'unreachable' ? (
        <div className="outage" data-testid="doorway-unreachable" role="status">
          <p className="outage__headline">Nothing is answering.</p>
          <p className="outage__detail">
            That is the station being away rather than being shut to you. Leave the page open and
            reload when it is back.
          </p>
        </div>
      ) : (
        <p className="off-air__detail">knocking…</p>
      )}
    </div>
  )
}

function Station({ route: requested, session }: { route: Route; session: AdminSession }) {
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
  const admin = isConsole(requested)
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

  // Only this listener's own ears — muting is not leaving, so the socket, the
  // roster and the clock all carry on exactly as they were.
  const [muted, setMuted] = useState(false)
  function toggleMute() {
    const audio = audioRef.current
    if (!audio) return
    audio.muted = !audio.muted
    setMuted(audio.muted)
  }

  // What the top bar's field narrows — see lib/search.ts. Every list on the
  // view you are looking at, and nothing you cannot see: the field is not
  // rendered at all on the one view that has no list on it.
  const [filter, setFilter] = useState('')

  // Where the heart beside the title sends you.
  const wishInput = useRef<HTMLInputElement>(null)
  const askForSomething = useCallback(() => {
    document.getElementById('wishes')?.scrollIntoView({ block: 'nearest' })
    wishInput.current?.focus()
  }, [])

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
  const paused = state?.pausedAt !== null && state?.pausedAt !== undefined
  // Nothing left on the page that came from a station: either this listener
  // never got one, or the outage arrived before the first frame did. There is
  // no stale truth to keep showing, so the outage screen takes the whole panel.
  const stranded = reach !== 'live' && (!clock.synced || state === null)
  // The record turns for exactly one reason: audio is coming out of it.
  const onAir = Boolean(joined && !stranded && !tuning && track && !paused)

  // Somebody can type `#chat` into the address bar before tuning in, and there
  // is nothing behind it when they do — the station has not told this browser
  // who is in the room or what has been on. So the address is honoured only
  // once it leads somewhere, and until then every view is the one you land on.
  const route: Route = needsJoin(requested) && !joined ? 'on-air' : requested

  const wishes = (
    <Wishes
      wishes={myWishes}
      connection={connection}
      live={status === 'connected'}
      refusal={refusalAbout(socketError, 'wish')}
      clearRefusal={clearSocketError}
      inputRef={wishInput}
      filter={filter}
    />
  )
  const chat = (
    <Chat
      messages={messages}
      filter={filter}
      connection={connection}
      live={status === 'connected'}
      refusal={refusalAbout(socketError, 'say')}
      clearRefusal={clearSocketError}
    />
  )
  const readout = (
    <ClockReadout
      offsetMs={clock.offsetMs}
      rttMs={clock.rttMs}
      diff={drift?.diff ?? null}
      correction={drift?.correction ?? null}
    />
  )

  return (
    <div className="station">
      <Sidebar
        active={route}
        joined={joined}
        showConsole={session.status === 'signed-in'}
      />

      <div className="station__main">
        <Topbar
          reach={reach}
          listeners={listeners?.length ?? null}
          admin={admin}
          showConsole={session.status === 'signed-in'}
          filter={filter}
          onFilterChange={setFilter}
          // The console always has a library to narrow; a listener has nothing
          // at all until they are in the room, and `sync` has no list on it.
          searchable={admin || (joined && route !== 'sync')}
          searchHint={searchHint(route, admin)}
        />

        {/* Above everything it is about. What is below stopped being live at the
            drop — the roster, the tally and the clock all did — and a page that
            kept presenting it as current would be the broken UI this replaces.
            The console says the same thing in its own words, so this is only
            for the listener page. */}
        {!admin && joined && !stranded && <StaleNotice state={reach} />}

        {/* The two sides of the station, and never both at once: the console
            takes the whole page, because whoever is running the decks is
            working, not listening. The chip in the top bar is the way back. */}
        {admin ? (
          <AdminPanel
            state={state}
            queue={queue}
            skips={tallyFor(skips, track?.id ?? null)}
            messages={messages}
            filter={filter}
            serverNow={clock.serverNow}
            session={session}
            status={status}
            applyState={applyState}
            applyQueue={applyQueue}
          />
        ) : !joined ? (
          canTuneIn(reach) ? (
            <div className="station__columns">
              <section className="column column--stage">
                <Deck artwork={null} spinning={false} />
                <div className="join">
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
                    <button
                      type="submit"
                      className="join__button"
                      disabled={!isValidNickname(nickname)}
                    >
                      Tune in
                    </button>
                  </form>
                </div>
              </section>
            </div>
          ) : (
            <Outage state={reach} />
          )
        ) : stranded ? (
          <Outage state={reach} />
        ) : route === 'on-air' ? (
          // The design's listener page, whole: the deck and what it is playing
          // on the left, what is coming and what the room is saying on the
          // right. Every other view below is one of these given the screen.
          <div className="station__columns">
            <section className="column column--stage">
              <Deck artwork={artwork} spinning={onAir} />

              {tuning ? (
                <div className="off-air">
                  <p className="off-air__headline">tuning in…</p>
                </div>
              ) : track ? (
                <div className="stage">
                  <OnAir live={onAir} idleLabel={paused ? 'PAUSED' : 'OFF AIR'} />

                  <div className="stage__head">
                    <div>
                      <h2 className="now-playing__title">{track.title}</h2>
                      <p className="now-playing__artist">{track.artist ?? 'Unknown artist'}</p>
                    </div>
                    <WishShortcut onPress={askForSomething} />
                  </div>

                  <p className="now-playing__time">
                    {formatClock(position)} / {formatClock(track.durationMs / 1000)}
                    {paused && <span className="now-playing__paused"> — paused</span>}
                  </p>

                  <Waveform live={onAir} />

                  <Mute muted={muted} onToggle={toggleMute} enabled={Boolean(track)} />

                  {/* Under the track it is about. Only listeners ever see it:
                      the console has a Play next button, and voting for
                      something you can simply do is theatre. The tally still
                      reaches the console — see AdminPanel. */}
                  <SkipVote
                    tally={tallyFor(skips, track.id)}
                    listeners={listeners?.length ?? 0}
                    connection={connection}
                    live={status === 'connected'}
                    refusal={refusalAbout(socketError, 'vote')}
                    clearRefusal={clearSocketError}
                  />

                  {readout}
                </div>
              ) : (
                // The station is there and answering; it just isn't playing
                // anything. That reads exactly like a broken page unless the
                // page says otherwise, so it says both halves: nothing is on,
                // and you have missed nothing.
                <div className="off-air" data-testid="off-air">
                  <p className="off-air__headline">Nothing on the decks right now.</p>
                  <p className="off-air__detail">
                    You're tuned in — whatever goes on next starts here on its own.
                  </p>
                </div>
              )}

              {wishes}
              <Listeners listeners={listeners} />
            </section>

            <section className="column column--aside">
              <UpNext queue={queue} filter={filter} />
              {/* Directly under what's coming, because it is the same question
                  pointed the other way: what is about to be on, and what
                  already was. */}
              <Earlier plays={history} currentTrackId={track?.id ?? null} filter={filter} />
              {chat}
            </section>
          </div>
        ) : (
          // One thing, with the whole screen. Nothing here is new data — it is
          // the same panel the landing view carries in a column, without the
          // column, which is the only thing a rail full of destinations can
          // honestly offer on a station this size.
          <div className={`view view--${route}`}>
            {route === 'sync' && <SyncView readout={readout} synced={clock.synced} reach={reach} />}
            {route === 'queue' && <UpNext queue={queue} filter={filter} standalone />}
            {route === 'chat' && chat}
            {route === 'wishes' && wishes}
            {route === 'history' && (
              <Earlier
                plays={history}
                currentTrackId={track?.id ?? null}
                filter={filter}
                standalone
              />
            )}
          </div>
        )}
      </div>

      {/* Owned imperatively — React never sets currentTime or calls play(). */}
      <audio ref={audioRef} preload="auto" />
    </div>
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
    <div className="outage" data-testid="outage" data-reach={state} role="status">
      <p className="outage__headline">{notice.headline}</p>
      <p className="outage__detail">{notice.detail}</p>
    </div>
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
function UpNext({
  queue,
  filter,
  standalone,
}: {
  queue: QueueEntry[] | null
  filter: string
  /**
   * True when this panel is the whole page. An empty queue is worth no space at
   * all in a column beside the deck, but on its own view a blank screen is a
   * dead end — so there it says that nothing is queued rather than nothing.
   */
  standalone?: boolean
}) {
  const entries = queue ?? []
  if (entries.length === 0 && !standalone) return null
  const shown = entries.filter((entry) =>
    matchesFilter(filter, entry.track.title, entry.track.artist),
  )

  return (
    <section className="panel" id="up-next" data-testid="up-next">
      <div className="panel__head">
        <h2 className="panel__title">Up next</h2>
        <p className="panel__aside">{countLabel(shown.length, entries.length, 'queued')}</p>
      </div>
      {entries.length === 0 ? (
        <p className="panel__empty">Nothing is queued. Whatever is on now plays out on its own.</p>
      ) : shown.length === 0 ? (
        <p className="panel__empty">Nothing queued matches “{filter.trim()}”.</p>
      ) : (
        <ol className="rows">
          {shown.map((entry, index) => (
            <li className="row" key={entry.id} data-entry={entry.id}>
              <span className="row__index">{trackNumber(index)}</span>
              <span className="row__body">
                <span className="row__title">{entry.track.title}</span>
                <span className="row__sub">
                  {entry.track.artist ?? 'Unknown artist'}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

/**
 * What has already been on — the design's "Recently Played".
 *
 * PLAN.md's now-playing history, from the listener's side: the evening so far,
 * newest first, so somebody who walked in on the end of something can see what
 * it was. The station writes a play down when the track starts, which makes the
 * newest row whatever is on right now — already shown in full beside this list —
 * so `playedEarlier` drops it and this list is only what was missed.
 *
 * Written down rather than held on the socket, so unlike the roster and the skip
 * tally it survives a reload and covers an outage: whatever went on while a
 * listener was reconnecting arrives in the replay, merged by id.
 */
function Earlier({
  plays,
  currentTrackId,
  filter,
  standalone,
}: {
  plays: Play[]
  currentTrackId: number | null
  filter: string
  /** True when this panel is the whole page — see the same prop on UpNext. */
  standalone?: boolean
}) {
  // Four rows, as the design draws it, and the rest a press away. On its own
  // view there is room for the evening, so the cap does not apply.
  const [all, setAll] = useState(false)

  const earlier = playedEarlier(plays, currentTrackId)
  if (earlier.length === 0 && !standalone) return null

  const matching = earlier.filter((play) =>
    matchesFilter(filter, play.track.title, play.track.artist),
  )
  const capped = !standalone && !all && filter.trim().length === 0
  const shown = capped ? matching.slice(0, EARLIER_SHOWN) : matching

  return (
    <section className="panel" id="earlier" data-testid="earlier">
      <div className="panel__head">
        <h2 className="panel__title">Recently Played</h2>
        {standalone ? (
          <p className="panel__aside">{countLabel(matching.length, earlier.length, 'played')}</p>
        ) : (
          matching.length > EARLIER_SHOWN &&
          filter.trim().length === 0 && (
            <button type="button" className="panel__more" onClick={() => setAll(!all)}>
              {all ? 'Show less' : 'View all'}
            </button>
          )
        )}
      </div>
      {earlier.length === 0 ? (
        <p className="panel__empty">
          Nothing has been on yet this session. What plays from here shows up in this list.
        </p>
      ) : shown.length === 0 ? (
        <p className="panel__empty">Nothing played earlier matches “{filter.trim()}”.</p>
      ) : (
        <ol className="rows">
          {shown.map((play, index) => (
            <li className="row" key={play.id} data-play={play.id} data-track={play.track.id}>
              <span className="row__index">{trackNumber(index)}</span>
              {/* Two lines here, because the row has two lines to give — but the
                  one-line reading is what a tooltip and a screen reader want,
                  and it is the same string either way. */}
              <span className="row__body" title={playedLabel(play)}>
                <span className="row__title earlier__title">{play.track.title}</span>
                <span className="row__sub">{play.track.artist ?? 'Unknown artist'}</span>
              </span>
              <time className="row__at" dateTime={new Date(play.at).toISOString()}>
                {formatTime(play.at)}
              </time>
            </li>
          ))}
        </ol>
      )}
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
    <section className="panel panel--stage" data-testid="listeners">
      <div className="panel__head">
        <h2 className="panel__title">Listening now</h2>
        <p className="panel__aside">{listeners.length}</p>
      </div>
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
    <div className="skips" id="skips" data-testid="skips">
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
    </div>
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
  /** So the heart beside the title can put the cursor in here. */
  inputRef: RefObject<HTMLInputElement | null>
  /** From the top bar. Narrows what is listed, never what can be sent. */
  filter: string
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
function Wishes({
  wishes,
  connection,
  live,
  refusal,
  clearRefusal,
  inputRef,
  filter,
}: WishesProps) {
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
  const shownWishes = wishes.filter((wish) => matchesFilter(filter, wish.text))

  return (
    <section className="panel panel--stage" id="wishes" data-testid="wishes">
      <div className="panel__head">
        <h2 className="panel__title">Wishes</h2>
        <p className="panel__aside">no promises</p>
      </div>
      {wishes.length === 0 ? (
        <p className="panel__empty">
          Ask for anything. Whoever's on the decks reads these — no promises.
        </p>
      ) : shownWishes.length === 0 ? (
        <p className="panel__empty">None of your wishes match “{filter.trim()}”.</p>
      ) : (
        <ol className="wishes__list" data-testid="wishes-list">
          {shownWishes.map((wish) => (
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
        <p className="refusal" role="status" data-testid="wishes-refusal">
          {refusalNotice}
        </p>
      )}
      <form className="compose" onSubmit={ask}>
        <label className="compose__label" htmlFor="wish-input">
          Ask for something
        </label>
        <input
          id="wish-input"
          className="compose__input"
          data-testid="wish-input"
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={live ? 'anything off Rumours…' : 'reconnecting…'}
          maxLength={WISH_MAX_LENGTH}
          autoComplete="off"
          disabled={!live}
        />
        <button type="submit" className="compose__send" disabled={!live || !isSendableWish(draft)}>
          Ask
        </button>
      </form>
    </section>
  )
}

interface ChatProps {
  messages: ChatMessage[]
  /** From the top bar. Narrows what is listed, never what can be sent. */
  filter: string
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
function Chat({ messages, filter, connection, live, refusal, clearRefusal }: ChatProps) {
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
  // Nickname as well as text: "what did ben say" is the question people
  // actually have about a scrollback.
  const shownMessages = messages.filter((message) =>
    matchesFilter(filter, message.text, message.nickname),
  )

  return (
    <section className="panel" id="chat" data-testid="chat">
      <div className="panel__head">
        <h2 className="panel__title">Live Chat</h2>
        <p className="panel__aside">
          <span className="panel__dot" aria-hidden="true" />
          {countLabel(shownMessages.length, messages.length, 'messages')}
        </p>
      </div>
      <div className="chat__panel">
        {messages.length === 0 ? (
          <p className="panel__empty">Nobody has said anything yet.</p>
        ) : shownMessages.length === 0 ? (
          <p className="panel__empty">Nothing said matches “{filter.trim()}”.</p>
        ) : (
          <ol className="chat__list" data-testid="chat-list" ref={list}>
            {shownMessages.map((message) => (
              <li key={message.id} className="chat__line" data-message={message.id}>
                <Avatar nickname={message.nickname} />
                <span className="chat__body">
                  {/* The time sits beside the name, not inside it: `.chat__nick`
                      is read as the name on its own, here and in the QA runs. */}
                  <span className="chat__head">
                    <span className="chat__nick">{message.nickname}</span>
                    <time className="chat__at" dateTime={new Date(message.at).toISOString()}>
                      {formatTime(message.at)}
                    </time>
                  </span>
                  <span className="chat__text">{message.text}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
        {refusalNotice && (
          <p className="refusal" role="status" data-testid="chat-refusal">
            {refusalNotice}
          </p>
        )}
        <form className="compose" onSubmit={say}>
          <label className="compose__label" htmlFor="chat-input">
            Say something
          </label>
          <input
            id="chat-input"
            className="compose__input"
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
            className="compose__send"
            disabled={!live || !isSendableMessage(draft)}
          >
            Send
          </button>
        </form>
      </div>
    </section>
  )
}

/**
 * The circle beside a message.
 *
 * The design puts a photograph here; the station has no photographs and never
 * asks for one, so this is the most the page honestly knows about a listener —
 * their name, drawn as an initial over a colour derived from the same name. The
 * derivation is pure, so the same nickname is the same colour on every screen
 * in the room without a byte crossing the wire to arrange it.
 */
function Avatar({ nickname }: { nickname: string }) {
  const hue = useMemo(() => hueFor(nickname), [nickname])
  return (
    <span
      className="chat__avatar"
      aria-hidden="true"
      style={{ '--hue': `${hue}` } as CSSProperties}
    >
      {[...nickname.trim()][0] ?? '?'}
    </span>
  )
}

/** A stable hue in [0, 360) for a nickname. Not a hash anyone relies on. */
function hueFor(nickname: string): number {
  let total = 0
  for (const character of nickname) total = (total * 31 + character.codePointAt(0)!) % 360
  return total
}

/**
 * What the top bar's field promises on the view you are looking at.
 *
 * Named for what it will actually narrow, rather than a single vague "Search"
 * everywhere — the field reaches only the lists on screen, and saying so is the
 * difference between a control and a guess.
 */
function searchHint(route: Route, admin: boolean): string {
  if (admin) return 'Search the library'
  switch (route) {
    case 'queue':
      return "Search what's coming"
    case 'history':
      return "Search what's been on"
    case 'chat':
      return 'Search the conversation'
    case 'wishes':
      return 'Search your wishes'
    default:
      return 'Search tracks and artists'
  }
}

/** "01", "02" — the design's numbering, which is a position and not an id. */
function trackNumber(index: number): string {
  return String(index + 1).padStart(2, '0')
}

/** How a filtered list reports itself: "4 queued", or "2 of 9 queued". */
function countLabel(shown: number, total: number, noun: string): string {
  return shown === total ? `${total} ${noun}` : `${shown} of ${total} ${noun}`
}

/**
 * Where the address bar says we are, following it without a reload.
 *
 * Both events, not just `hashchange`: the back button after a same-document
 * navigation fires `popstate`, and a rail that only listened for the first one
 * would leave the browser's own history buttons doing nothing.
 */
function useRoute(): Route {
  const read = () => (typeof window === 'undefined' ? DEFAULT_ROUTE : routeFrom(window.location))
  const [route, setRoute] = useState(read)

  useEffect(() => {
    const update = () => setRoute(routeFrom(window.location))
    // The address may have moved between first render and this effect running.
    update()
    window.addEventListener('hashchange', update)
    window.addEventListener('popstate', update)
    return () => {
      window.removeEventListener('hashchange', update)
      window.removeEventListener('popstate', update)
    }
  }, [])

  return route
}

interface SyncViewProps {
  readout: ReactNode
  synced: boolean
  reach: Availability
}

/**
 * The clock numbers, with the whole screen.
 *
 * PLAN.md: "the whole project lives or dies on these numbers." The landing view
 * carries them as a strip under the deck, where they are a glance; this is the
 * same strip with what each one means beside it, which is what you want when
 * the glance said something you did not like.
 *
 * The readout itself is passed in rather than rebuilt, so there is exactly one
 * of it in the app and no chance of the two disagreeing.
 */
function SyncView({ readout, synced, reach }: SyncViewProps) {
  return (
    <section className="panel" data-testid="sync-view">
      <div className="panel__head">
        <h2 className="panel__title">Sync</h2>
        <p className="panel__aside">
          <span
            className="panel__dot"
            style={{ background: synced ? undefined : 'var(--faint)' }}
            aria-hidden="true"
          />
          {synced ? 'locked to the station' : 'not locked yet'}
        </p>
      </div>

      {readout}

      <dl className="glossary">
        <div>
          <dt>clock offset</dt>
          <dd>
            How far this browser's clock is from the station's. Any size is fine — it is measured,
            not assumed, and every position on the page is worked out through it.
          </dd>
        </div>
        <div>
          <dt>rtt</dt>
          <dd>
            How long a round trip to the station takes. It sets how precisely the offset can be
            known, so a big number here is the one worth caring about.
          </dd>
        </div>
        <div>
          <dt>drift</dt>
          <dd>
            How far this player has wandered from where the station says it should be. Small
            numbers are normal; they are what the correction below is answering.
          </dd>
        </div>
        <div>
          <dt>correcting</dt>
          <dd>
            What is being done about the drift right now — a rate nudge of a fraction of a percent,
            a hard seek when it has gone too far to nudge, or nothing at all.
          </dd>
        </div>
      </dl>

      {reach !== 'live' && (
        <p className="panel__empty">
          These stopped updating when the station went away. They will pick up again by themselves
          the moment it is back.
        </p>
      )}
    </section>
  )
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
