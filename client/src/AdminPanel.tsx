import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { useAdminSession } from './hooks/useAdminSession.js'
import { AdminError, type AdminApi, type PlaybackCommand, type WishBook } from './lib/admin.js'
import { formatTime } from './lib/chat.js'
import { formatClock } from './lib/position.js'
import type { PlaybackSnapshot, QueueEntry, StateMessage, Track } from './lib/protocol.js'
import { type SkipTally, skipVotesLabel } from './lib/skips.js'
import type { StationStatus } from './lib/station.js'

export interface AdminPanelProps {
  /** The station's own broadcast — the panel never keeps its own copy. */
  state: StateMessage | null
  queue: QueueEntry[] | null
  /**
   * What the room thinks of what is on. PLAN.md puts "see skip tallies" on the
   * admin surface, and this is it: a number next to the Skip button, because
   * the vote does not press it.
   */
  skips: SkipTally
  status: StationStatus
  /** Fold a command's own answer straight in; see useStation. */
  applyState(snapshot: PlaybackSnapshot): void
  applyQueue(entries: QueueEntry[]): void
}

/**
 * The decks, for whoever runs the station.
 *
 * Reachable only at #admin and only once the server has accepted a session, so
 * the listener page ships no controls — though the gate that matters is the one
 * on the server, since a hidden button is not a permission.
 *
 * Nothing here holds playback or queue state: both arrive over the websocket
 * the listener already has open, so a command issued from another tab, or a
 * track ending on its own, moves this panel too.
 */
export function AdminPanel({
  state,
  queue,
  skips,
  status,
  applyState,
  applyQueue,
}: AdminPanelProps) {
  const { status: session, api, error: sessionError, signIn, signOut } = useAdminSession()

  if (session === 'checking') {
    return (
      <section className="admin" data-testid="admin-panel">
        <p className="admin__note">checking credentials…</p>
      </section>
    )
  }

  if (session !== 'signed-in' || !api) {
    return <SignIn onSubmit={signIn} error={sessionError} />
  }

  return (
    <Controls
      api={api}
      state={state}
      queue={queue}
      skips={skips}
      connected={status === 'connected'}
      applyState={applyState}
      applyQueue={applyQueue}
      onSignOut={signOut}
    />
  )
}

function SignIn({
  onSubmit,
  error,
}: {
  onSubmit: (password: string) => Promise<boolean>
  error: string | null
}) {
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    const accepted = await onSubmit(password)
    setSubmitting(false)
    if (accepted) setPassword('')
  }

  return (
    <section className="admin" data-testid="admin-signin">
      <h2 className="admin__heading">Admin</h2>
      <form className="admin__signin" onSubmit={submit}>
        <input
          type="password"
          className="admin__input"
          placeholder="station password"
          aria-label="Admin password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          data-testid="admin-password"
        />
        <button type="submit" className="admin__button" disabled={submitting || !password}>
          Sign in
        </button>
      </form>
      {error && (
        <p className="admin__error" data-testid="admin-error">
          {error}
        </p>
      )}
    </section>
  )
}

/** How often the panel asks for the wish book while it is open. */
const WISH_POLL_MS = 10_000

interface ControlsProps {
  api: AdminApi
  state: StateMessage | null
  queue: QueueEntry[] | null
  skips: SkipTally
  connected: boolean
  applyState(snapshot: PlaybackSnapshot): void
  applyQueue(entries: QueueEntry[]): void
  onSignOut: () => void
}

function Controls({
  api,
  state,
  queue,
  skips,
  connected,
  applyState,
  applyQueue,
  onSignOut,
}: ControlsProps) {
  const [tracks, setTracks] = useState<Track[]>([])
  const [book, setBook] = useState<WishBook>({ wishes: [], outstanding: 0 })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [uploads, setUploads] = useState<{ id: number; line: string }[]>([])

  const refreshLibrary = useCallback(async () => {
    try {
      setTracks(await api.tracks())
    } catch {
      setError('could not load the library')
    }
  }, [api])

  useEffect(() => {
    void refreshLibrary()
  }, [refreshLibrary])

  /**
   * Not through `run`: this fires on a timer, and a poll that set `busy` would
   * flicker every control on the panel twice a minute. A lapsed session still
   * has to end the same way it does everywhere else, though — the poll is the
   * one request here that happens without the admin touching anything, so it is
   * also the first thing to notice.
   */
  const refreshWishes = useCallback(async () => {
    try {
      setBook(await api.wishes())
    } catch (err) {
      if (err instanceof AdminError && err.unauthorized) return onSignOut()
      setError('could not load the wishes')
    }
  }, [api, onSignOut])

  /**
   * Polled, because a wish arrives over a socket that carries no privileged
   * frames — the gate is on HTTP, and the station deliberately tells a socket
   * holding an admin cookie nothing it would not tell a stranger. So the panel
   * asks, rather than the station pushing. Ten seconds is well inside how long
   * a track lasts, which is the pace anyone is actually working at.
   */
  useEffect(() => {
    void refreshWishes()
    const timer = window.setInterval(() => void refreshWishes(), WISH_POLL_MS)
    return () => window.clearInterval(timer)
  }, [refreshWishes])

  /**
   * Every control goes through here. A 401 means the session stopped being
   * accepted — it lapsed, or the server restarted with a different password —
   * and the only honest response is to put the sign-in form back rather than
   * let the admin keep pressing buttons that quietly do nothing.
   */
  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      setBusy(true)
      setError(null)
      try {
        await action()
      } catch (err) {
        if (err instanceof AdminError && err.unauthorized) {
          onSignOut()
          return
        }
        setError(err instanceof Error ? err.message : 'something went wrong')
      } finally {
        setBusy(false)
      }
    },
    [onSignOut],
  )

  // Both fold the server's answer straight into the station's state, so a
  // control responds to the click rather than to the broadcast that follows it.
  const command = useCallback(
    (body: PlaybackCommand) => run(async () => applyState(await api.command(body))),
    [api, applyState, run],
  )
  const queueAction = useCallback(
    (act: () => Promise<{ entries: QueueEntry[] }>) =>
      run(async () => applyQueue((await act()).entries)),
    [applyQueue, run],
  )

  const report = (line: string) => setUploads((seen) => [...seen, { id: seen.length, line }])

  async function upload(files: File[]) {
    if (files.length === 0) return
    // One file per request is what the endpoint takes, and uploading in
    // sequence keeps the report in the order the admin picked them.
    for (const file of files) {
      try {
        const { track, duplicate } = await api.upload(file)
        report(`${track.title} — ${duplicate ? 'already in the library' : 'uploaded'}`)
      } catch (err) {
        if (err instanceof AdminError && err.unauthorized) return onSignOut()
        report(`${file.name} — ${err instanceof Error ? err.message : 'failed'}`)
      }
    }
    await refreshLibrary()
  }

  const track = state?.track ?? null
  const paused = state !== null && state.pausedAt !== null
  const entries = queue ?? []

  return (
    <section className="admin" data-testid="admin-panel">
      <header className="admin__head">
        <h2 className="admin__heading">Admin</h2>
        <button type="button" className="admin__link" onClick={onSignOut}>
          Sign out
        </button>
      </header>

      {error && (
        <p className="admin__error" data-testid="admin-error">
          {error}
        </p>
      )}

      {/* Commands go over HTTP and still land while the socket is down, but
          what the panel shows arrives on the socket — so say so rather than
          quietly showing a queue that may have moved on. */}
      {!connected && (
        <p className="admin__note" data-testid="admin-offline">
          reconnecting — what's shown here may be out of date
        </p>
      )}

      <div className="admin__transport">
        <button
          type="button"
          className="admin__button"
          disabled={busy || !track}
          data-testid="admin-playpause"
          onClick={() => command({ action: paused ? 'resume' : 'pause' })}
        >
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button
          type="button"
          className="admin__button"
          disabled={busy || (!track && entries.length === 0)}
          data-testid="admin-skip"
          onClick={() => command({ action: 'skip' })}
        >
          Skip
        </button>
        <button
          type="button"
          className="admin__button admin__button--quiet"
          disabled={busy || !track}
          data-testid="admin-stop"
          onClick={() => command({ action: 'stop' })}
        >
          Stop
        </button>
        <span className="admin__now" data-testid="admin-now">
          {track ? `${track.title}${paused ? ' (paused)' : ''}` : 'off air'}
        </span>
        {/* Next to Skip, because that is the button it is about — and the only
            thing that acts on it. A tally is what the room wants; whether the
            track comes off is still this panel's decision. */}
        {track && (
          <span
            className={`admin__votes${skips.votes > 0 ? ' admin__votes--wanted' : ''}`}
            data-testid="admin-skip-votes"
            data-votes={skips.votes}
          >
            {skipVotesLabel(skips.votes)}
          </span>
        )}
      </div>

      <h3 className="admin__subheading">
        Up next <span className="admin__count">{entries.length}</span>
        {entries.length > 0 && (
          <button
            type="button"
            className="admin__link"
            disabled={busy}
            data-testid="admin-queue-clear"
            onClick={() => queueAction(() => api.clearQueue())}
          >
            Clear
          </button>
        )}
      </h3>

      {entries.length === 0 ? (
        <p className="admin__note">Nothing queued.</p>
      ) : (
        <ol className="admin__queue" data-testid="admin-queue">
          {entries.map((entry, index) => (
            <li key={entry.id} className="admin__row" data-entry={entry.id}>
              <span className="admin__row-title">{entry.track.title}</span>
              <span className="admin__row-time">{formatClock(entry.track.durationMs / 1000)}</span>
              {/* Positions come from this render, and the queue can advance
                  underneath it — which is exactly why the server addresses
                  entries by id and clamps the index it is given. */}
              <button
                type="button"
                className="admin__icon"
                aria-label={`Move ${entry.track.title} up`}
                disabled={busy || index === 0}
                onClick={() => queueAction(() => api.move(entry.id, index - 1))}
              >
                ↑
              </button>
              <button
                type="button"
                className="admin__icon"
                aria-label={`Move ${entry.track.title} down`}
                disabled={busy || index === entries.length - 1}
                onClick={() => queueAction(() => api.move(entry.id, index + 1))}
              >
                ↓
              </button>
              <button
                type="button"
                className="admin__icon admin__icon--remove"
                aria-label={`Remove ${entry.track.title}`}
                disabled={busy}
                onClick={() => queueAction(() => api.remove(entry.id))}
              >
                ✕
              </button>
            </li>
          ))}
        </ol>
      )}

      {/* Above the library on purpose: a wish is read, and then answered by
          queueing something from the list below it. */}
      <h3 className="admin__subheading">
        Wishes <span className="admin__count">{book.outstanding}</span>
      </h3>

      {book.wishes.length === 0 ? (
        <p className="admin__note">Nobody has asked for anything.</p>
      ) : (
        <ul className="admin__wishes" data-testid="admin-wishes">
          {book.wishes.map((wish) => (
            <li
              key={wish.id}
              className={`admin__row${wish.status === 'handled' ? ' admin__row--handled' : ''}`}
              data-wish={wish.id}
              data-status={wish.status}
            >
              <span className="admin__row-time">{formatTime(wish.at)}</span>
              <span className="admin__wish-nick">{wish.nickname}</span>
              <span className="admin__wish-text">{wish.text}</span>
              {/* Reversible: the mark is a note to whoever is reading the list,
                  and a misclick should not be the end of somebody's request. */}
              <button
                type="button"
                className="admin__link"
                disabled={busy}
                onClick={() =>
                  run(async () =>
                    setBook(await api.markWish(wish.id, wish.status === 'handled' ? 'new' : 'handled')),
                  )
                }
              >
                {wish.status === 'handled' ? 'Undo' : 'Mark handled'}
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3 className="admin__subheading">Library</h3>
      <label className="admin__upload">
        <span>Upload audio</span>
        <input
          type="file"
          accept="audio/*"
          multiple
          data-testid="admin-upload"
          onChange={(event) => {
            // Copied out before the input is reset: clearing `value` empties
            // `files` too, so handing the FileList straight to an async upload
            // would leave it with nothing to send.
            const picked = Array.from(event.target.files ?? [])
            event.target.value = '' // so the same file can be picked twice
            void upload(picked)
          }}
        />
      </label>

      {uploads.length > 0 && (
        <ul className="admin__uploads" data-testid="admin-uploads">
          {uploads.map((line) => (
            <li key={line.id}>{line.line}</li>
          ))}
        </ul>
      )}

      {tracks.length === 0 ? (
        <p className="admin__note">Nothing uploaded yet.</p>
      ) : (
        <ul className="admin__library" data-testid="admin-library">
          {tracks.map((libraryTrack) => (
            <li key={libraryTrack.id} className="admin__row" data-track={libraryTrack.id}>
              <span className="admin__row-title">{libraryTrack.title}</span>
              <span className="admin__row-time">
                {formatClock(libraryTrack.durationMs / 1000)}
              </span>
              <button
                type="button"
                className="admin__link"
                disabled={busy}
                onClick={() => queueAction(() => api.enqueue(libraryTrack.id))}
              >
                Queue
              </button>
              <button
                type="button"
                className="admin__link"
                disabled={busy}
                onClick={() => command({ action: 'play', trackId: libraryTrack.id })}
              >
                Play now
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
