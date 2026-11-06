import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { BackChevron } from './Chevron.js'
import { FileDrop } from './FileDrop.js'
import { refusalMessage } from '../lib/admin.js'
import {
  type AdminEpisode,
  type EpisodeApi,
  type EpisodeStatus,
  type UploadProgress,
  TRANSCRIPT_MAX_LENGTH,
  episodePath,
  formatBytes,
  formatDate,
  formatLength,
  uploadVideo,
} from '../lib/episodes.js'
import { parseTranscript } from '../lib/transcript.js'
import { useAdminSession } from '../hooks/useAdminSession.js'

/**
 * The other side of the archive: putting an episode up, and taking one down.
 *
 * Behind the same door as the decks — the same password, the same signed
 * cookie, the same `useAdminSession` — because it is the same person and a
 * second credential to lose would be a second credential to lose. `AdminApi`
 * and `EpisodeApi` are separate objects over one session; see `lib/episodes.ts`.
 *
 * Reached at `/podcast#admin`, a fragment rather than a path, because every
 * path under `/podcast/` is an episode slug and a console at `/podcast/admin`
 * would be competing with an episode somebody could legitimately name "Admin".
 *
 * The poster is checked here as well as at the server, and that is not
 * belt-and-braces for its own sake: an episode upload is a video file that may
 * be a gigabyte, and finding out after all of it has crossed somebody's
 * connection that the thumbnail was the wrong shape is a genuinely bad quarter
 * of an hour. The
 * server still refuses — this is the form being honest, not the rule.
 */

/**
 * What each picture has to be. Mirrors `routes/podcast.ts`; keep in step.
 *
 * Two of them, because an episode carries two: the portrait card the collection
 * draws, at one exact size, and the 16:9 still the player shows, at a ratio
 * with a floor. The note over `checkImage` on the server says why neither is a
 * crop of the other.
 */
const POSTER_WIDTH = 1080
const POSTER_HEIGHT = 1350
const THUMB_RATIO = 16 / 9
const THUMB_TOLERANCE = 0.01
const THUMB_MIN_WIDTH = 1280

/**
 * What is wrong with this picture, or null if nothing is.
 *
 * The same rules the server applies, in the same order, said in the same words
 * — this is the form being honest about what will happen rather than a second
 * opinion. The server still has the last word.
 */
function complaintAbout(
  what: 'poster' | 'thumbnail',
  size: { width: number; height: number },
): string | null {
  if (what === 'poster') {
    return size.width === POSTER_WIDTH && size.height === POSTER_HEIGHT
      ? null
      : `it has to be exactly ${POSTER_WIDTH}x${POSTER_HEIGHT}`
  }
  if (Math.abs(size.width / size.height - THUMB_RATIO) > THUMB_RATIO * THUMB_TOLERANCE) {
    return 'it has to be 16:9'
  }
  if (size.width < THUMB_MIN_WIDTH) return `it has to be at least ${THUMB_MIN_WIDTH} wide`
  return null
}

/**
 * A poster's real dimensions, read in the browser before anything is sent.
 *
 * `createImageBitmap` where it exists, because it decodes off the main thread
 * and does not need an element in the document; an `<img>` with an object URL
 * everywhere else. Null when neither can read the file, which is not the same
 * as "wrong size" — the caller sends it anyway and lets the server be the judge,
 * because a browser that cannot decode a perfectly good WebP should not be able
 * to block a publish.
 */
async function posterSize(file: File): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file)
      const size = { width: bitmap.width, height: bitmap.height }
      bitmap.close()
      return size
    } catch {
      // Fall through to the element, which reads some files this does not.
    }
  }

  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
      URL.revokeObjectURL(url)
    }
    image.onerror = () => {
      resolve(null)
      URL.revokeObjectURL(url)
    }
    image.src = url
  })
}

/**
 * A chosen transcript file, read and looked over before it is sent anywhere.
 *
 * Read here rather than posted as a file part, and that is a decision worth
 * stating: an episode upload already carries one file (the poster) through a
 * multipart parser configured for exactly one, and a transcript is text — a few
 * hundred kilobytes of it — which travels perfectly well as a field. It also
 * means the console can *say something about it* before it is sent, which is
 * the same courtesy the poster gets.
 *
 * What it says is what the player will make of it, using the player's own
 * parser: how many lines carry a time, and where the last one falls. A file
 * with no timestamps in it is not refused — it is still the words that were
 * said, and the page lays it out as paragraphs — but somebody who thought they
 * were uploading a timed transcript should find out here rather than from a
 * pane that does not move.
 */
async function readTranscript(file: File): Promise<{ text: string; note: string } | { error: string }> {
  let text: string
  try {
    text = await file.text()
  } catch {
    return { error: 'that file could not be read' }
  }
  if (text.trim() === '') return { error: 'that transcript is empty' }
  if (text.length > TRANSCRIPT_MAX_LENGTH) {
    return {
      error: `that transcript is ${text.length.toLocaleString('en')} characters; the limit is ${TRANSCRIPT_MAX_LENGTH.toLocaleString('en')}`,
    }
  }

  const cues = parseTranscript(text)
  if (cues.length === 0) {
    return { text, note: 'no timestamps in it — it will be shown as plain paragraphs' }
  }
  const last = cues[cues.length - 1]?.timeMs ?? 0
  const named = new Set(cues.map((cue) => cue.speaker).filter(Boolean)).size
  return {
    text,
    note: `${cues.length.toLocaleString('en')} timed lines${named > 0 ? `, ${named} speakers` : ''}, up to ${formatLength(last)}`,
  }
}

/** `<input type="date">` wants `yyyy-mm-dd` in the *local* calendar. */
function toDateInput(at: number): string {
  const date = new Date(at)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * A date field back to epoch milliseconds, at midday local time.
 *
 * Midday rather than midnight, and it matters: `new Date('2026-03-14')` is
 * parsed as UTC midnight, which in any timezone west of Greenwich is the 13th.
 * An archive that quietly dated every episode a day early would be a bug
 * nobody noticed for months. Constructing from parts keeps it local, and midday
 * puts it far enough from either boundary that no offset can move the day.
 */
function fromDateInput(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12).getTime()
}

export interface ConsoleProps {
  api: EpisodeApi
  /** Back to the archive. */
  onBack: () => void
}

export function Console({ api, onBack }: ConsoleProps) {
  const session = useAdminSession()
  const [episodes, setEpisodes] = useState<AdminEpisode[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [password, setPassword] = useState('')

  const load = useCallback(async () => {
    try {
      setEpisodes(await api.listAll())
      setError(null)
    } catch (err) {
      setError(refusalMessage(err) ?? 'could not reach the station')
    }
  }, [api])

  useEffect(() => {
    if (session.status === 'signed-in') void load()
  }, [session.status, load])

  if (session.status === 'checking') {
    return (
      <section className="console console--signin">
        <p className="console__waiting">Asking the station&hellip;</p>
      </section>
    )
  }

  if (session.status === 'signed-out') {
    return (
      <section className="console console--signin">
        <button type="button" className="console__back" onClick={onBack}>
          <BackChevron /> All episodes
        </button>
        <h1 className="console__heading">The archive</h1>
        <form
          className="console__signin"
          onSubmit={(event: FormEvent) => {
            event.preventDefault()
            void session.signIn(password).then((ok) => {
              // Never kept after it has been exchanged for a cookie, which is
              // the whole point of exchanging it.
              if (ok) setPassword('')
            })
          }}
        >
          <label className="console__field">
            <span>Admin password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          <button type="submit" className="console__go">
            Sign in
          </button>
          {session.error && <p className="console__error">{session.error}</p>}
        </form>
      </section>
    )
  }

  return (
    /*
      The same three regions the player has, and for the same reason: a bar
      across the top, then two columns on a desk and a stack on a phone. What
      goes in them is the console's own split — the form you fill in on one
      side, the archive you are changing on the other, so publishing something
      does not mean scrolling past the form to find it.

      Both columns scroll on their own; the page does not.
    */
    <section className="console">
      <div className="console__bar">
        <button type="button" className="console__back" onClick={onBack}>
          <BackChevron /> All episodes
        </button>
        <h1 className="console__heading">The archive</h1>
        <button type="button" className="console__signout" onClick={session.signOut}>
          Sign out
        </button>
      </div>

      <div className="console__left">
        <UploadForm
          api={api}
          busy={busy}
          setBusy={setBusy}
          onDone={() => void load()}
          onError={setError}
        />

        {error && (
          <p className="console__error" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="console__right">
        <EpisodeList
          episodes={episodes}
          api={api}
          busy={busy}
          setBusy={setBusy}
          onChanged={() => void load()}
          onError={setError}
        />
      </div>
    </section>
  )
}

interface UploadFormProps {
  api: EpisodeApi
  busy: boolean
  setBusy: (busy: boolean) => void
  onDone: () => void
  onError: (message: string | null) => void
}

function UploadForm({ api, busy, setBusy, onDone, onError }: UploadFormProps) {
  const form = useRef<HTMLFormElement>(null)
  const [progress, setProgress] = useState<UploadProgress | null>(null)
  // Held in a ref rather than in state: cancelling must reach the in-flight
  // upload, and a controller captured in a closure would be the one from the
  // render that started it, which is the one that has already gone.
  const cancelling = useRef<AbortController | null>(null)
  const [title, setTitle] = useState('')
  const [guests, setGuests] = useState('')
  const [episodeNumber, setEpisodeNumber] = useState('')
  const [publishedAt, setPublishedAt] = useState(() => toDateInput(Date.now()))
  const [status, setStatus] = useState<EpisodeStatus>('draft')
  /** A line under each file the moment it is chosen, not after the upload. */
  const [videoNote, setVideoNote] = useState<string | null>(null)
  const [posterNote, setPosterNote] = useState<string | null>(null)
  const [thumbNote, setThumbNote] = useState<string | null>(null)

  /** Say something about a picture the moment it is chosen, not after upload. */
  const inspect = useCallback(
    async (what: 'poster' | 'thumbnail', file: File | undefined) => {
      const say = what === 'poster' ? setPosterNote : setThumbNote
      if (!file) {
        say(null)
        return
      }
      const size = await posterSize(file)
      if (!size) {
        say('could not read that image here; the station will have the last word')
        return
      }
      say(`${size.width}x${size.height} — ${complaintAbout(what, size) ?? 'good'}`)
    },
    [],
  )

  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()
      const element = form.current
      if (!element || busy) return

      const data = new FormData(element)
      const poster = data.get('poster')
      const thumbnail = data.get('thumbnail')
      const video = data.get('video')
      if (!(video instanceof File) || video.size === 0) {
        onError('choose a video file')
        return
      }
      if (!(poster instanceof File) || poster.size === 0) {
        onError('choose a poster')
        return
      }
      if (!(thumbnail instanceof File) || thumbnail.size === 0) {
        onError('choose a thumbnail')
        return
      }

      // Both, and the same checks the server makes, made here so a gigabyte of
      // video does not cross somebody's connection before a picture is refused.
      for (const [what, file] of [
        ['poster', poster],
        ['thumbnail', thumbnail],
      ] as const) {
        const size = await posterSize(file)
        const complaint = size && complaintAbout(what, size)
        if (complaint) {
          onError(`that ${what} is ${size.width}x${size.height}; ${complaint}`)
          return
        }
      }

      const at = fromDateInput(publishedAt)
      if (at !== null) data.set('publishedAt', String(at))
      else data.delete('publishedAt')

      // The video is not part of this form any more. It goes to the store in
      // its own chunked upload first, and what the form carries is the receipt.
      data.delete('video')

      setBusy(true)
      onError(null)
      const controller = new AbortController()
      cancelling.current = controller

      try {
        const finished = await uploadVideo(api, video, {
          onProgress: setProgress,
          signal: controller.signal,
        })

        data.set('uploadId', finished.uploadId)
        data.set('key', finished.key)
        data.set('contentHash', finished.contentHash)
        data.set('parts', JSON.stringify(finished.parts))
        data.set('contentType', finished.contentType)
        data.set('durationMs', String(finished.durationMs))

        await api.create(data)
        element.reset()
        setTitle('')
        setGuests('')
        setEpisodeNumber('')
        setStatus('draft')
        setVideoNote(null)
        setPosterNote(null)
        setThumbNote(null)
        onDone()
      } catch (err) {
        if (controller.signal.aborted) {
          onError('upload cancelled')
        } else {
          onError(refusalMessage(err) ?? 'the upload did not go through')
        }
      } finally {
        cancelling.current = null
        setProgress(null)
        setBusy(false)
      }
    },
    [api, busy, publishedAt, onDone, onError, setBusy],
  )

  return (
    <form className="upload" ref={form} onSubmit={submit}>
      <h2 className="upload__heading">Add an episode</h2>

      <label className="console__field">
        <span>Title</span>
        <input
          name="title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
        />
      </label>

      <div className="console__row">
        <label className="console__field">
          <span>Guests</span>
          <input
            name="guests"
            value={guests}
            onChange={(event) => setGuests(event.target.value)}
            placeholder="Thabo M., Lerato K."
          />
        </label>

        <label className="console__field console__field--narrow">
          <span>Episode no.</span>
          <input
            name="episodeNumber"
            type="number"
            min={0}
            value={episodeNumber}
            onChange={(event) => setEpisodeNumber(event.target.value)}
          />
        </label>

        <label className="console__field console__field--narrow">
          <span>Dated</span>
          <input
            type="date"
            value={publishedAt}
            onChange={(event) => setPublishedAt(event.target.value)}
          />
        </label>
      </div>

      {/* The two files, side by side and both droppable. There were three: a
          transcript used to be chosen here as well, and it is gone from this
          form because it is the one thing that is never ready at upload time —
          a machine transcription takes as long as the conversation did. It
          arrives afterwards, from the row control on the right, which is how it
          arrived in practice anyway. */}
      <div className="console__row">
        <FileDrop
          name="video"
          label="Video"
          accept="video/*,.mp4,.mov,.m4v,.webm,.mkv"
          required
          hint="mp4, mov or webm — or press to choose"
          onFile={(file) => setVideoNote(file ? formatBytes(file.size) : null)}
          note={videoNote}
        />

        <FileDrop
          name="poster"
          label="Poster — the card in the collection"
          accept="image/jpeg,image/png,image/webp"
          required
          hint={`portrait, exactly ${POSTER_WIDTH}×${POSTER_HEIGHT}`}
          onFile={(file) => void inspect('poster', file)}
          note={posterNote}
        />

        <FileDrop
          name="thumbnail"
          label="Thumbnail — the still on the video"
          accept="image/jpeg,image/png,image/webp"
          required
          hint={`16:9, at least ${THUMB_MIN_WIDTH} wide`}
          onFile={(file) => void inspect('thumbnail', file)}
          note={thumbNote}
        />
      </div>

      <div className="console__row console__row--end">
        <label className="console__check">
          <input
            name="status"
            type="checkbox"
            value="published"
            checked={status === 'published'}
            onChange={(event) => setStatus(event.target.checked ? 'published' : 'draft')}
          />
          <span>Publish straight away</span>
        </label>

        <button type="submit" className="console__go" disabled={busy}>
          {busy ? 'Uploading…' : 'Add episode'}
        </button>
      </div>

      {progress && (
        /*
          Bytes the *store* has acknowledged, not bytes handed to the browser's
          socket. A bar that reaches 100% while the upload is still going is
          worse than no bar, and on a 500 MB file the difference is minutes.
        */
        <div className="upload__progress" role="status" aria-live="polite">
          <div className="upload__bar">
            <span
              className="upload__bar-fill"
              style={{ width: `${Math.round(progress.fraction * 100)}%` }}
            />
          </div>
          <div className="upload__progress-line">
            <span>
              {formatBytes(progress.sent)} of {formatBytes(progress.total)} &middot;{' '}
              {Math.round(progress.fraction * 100)}%
            </span>
            <span>
              {progress.retrying
                ? 'retrying a part…'
                : `part ${Math.min(progress.partsDone + 1, progress.partCount)} of ${progress.partCount}`}
            </span>
            <button
              type="button"
              className="upload__cancel"
              onClick={() => cancelling.current?.abort()}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </form>
  )
}

/** What this station made of an episode's file, in one short line. */
function TranscodeNote({ episode }: { episode: AdminEpisode }) {
  if (episode.transcodeStatus === 'pending') {
    return <span className="row__encoding">checking the file…</span>
  }
  if (episode.transcodeStatus === 'failed') {
    return (
      <span className="row__encode-failed" title={episode.transcodeError ?? undefined}>
        serving the master &mdash; it may start slowly
      </span>
    )
  }
  // What a listener downloads. A remux is the same size as what went in, so
  // there is no saving to report any more — only, when the two keys differ, the
  // fact that this episode needed rewriting to start quickly at all.
  const rewritten = episode.videoBytes !== episode.masterBytes
  return (
    <span className="row__sizes">
      {formatBytes(episode.videoBytes)}
      {rewritten && (
        <>
          {' '}
          <span className="row__saved">rewritten to start quickly</span>
        </>
      )}
    </span>
  )
}

interface EpisodeListProps {
  episodes: AdminEpisode[] | null
  api: EpisodeApi
  busy: boolean
  setBusy: (busy: boolean) => void
  onChanged: () => void
  onError: (message: string | null) => void
}

/**
 * Giving an episode its words, after the fact.
 *
 * The ordinary way a transcript arrives, and the reason this is a row control
 * rather than only a field on the upload form: an episode goes up on the night
 * it is finished, and the transcription is done afterwards — a machine one
 * takes as long as the conversation did, and then somebody reads it through.
 * An archive where the only chance to add one was at upload time would be an
 * archive whose existing episodes could never have any.
 *
 * A label wrapping a hidden file input rather than a button, because the
 * browser will not open a file picker for anything else, and because a `<label>`
 * is already a real control for the keyboard and for a screen reader. It reads
 * "Transcript" when there is none and carries a tick when there is, and the
 * clear button only exists in the second case — a transcript uploaded against
 * the wrong episode has to be removable, and nothing else here can remove it.
 */
function TranscriptControl({
  api,
  episode,
  busy,
  act,
  onError,
}: {
  api: EpisodeApi
  episode: AdminEpisode
  busy: boolean
  act: (run: () => Promise<unknown>) => Promise<void>
  onError: (message: string | null) => void
}) {
  const input = useRef<HTMLInputElement>(null)

  const chose = useCallback(
    async (file: File | undefined) => {
      // Cleared here rather than after the request, so choosing the same file
      // twice — which is what somebody does after fixing it — fires `change`
      // again. A file input does not, if its value has not changed.
      if (input.current) input.current.value = ''
      if (!file) return
      const read = await readTranscript(file)
      if ('error' in read) {
        onError(read.error)
        return
      }
      await act(() => api.update(episode.id, { transcript: read.text }))
    },
    [act, api, episode.id, onError],
  )

  return (
    <span className="row__transcript">
      <label
        className="row__toggle"
        title={
          episode.hasTranscript
            ? 'Replace the transcript for this episode'
            : 'Add a transcript to this episode'
        }
      >
        {episode.hasTranscript ? 'Transcript ✓' : 'Transcript'}
        <input
          ref={input}
          className="row__file"
          type="file"
          accept=".txt,.vtt,.srt,.md,text/plain"
          disabled={busy}
          onChange={(event) => void chose(event.target.files?.[0])}
        />
      </label>

      {episode.hasTranscript && (
        <button
          type="button"
          className="row__clear"
          disabled={busy}
          title="Take the transcript off this episode"
          onClick={() => {
            if (!window.confirm(`Take the transcript off "${episode.title}"?`)) return
            void act(() => api.update(episode.id, { transcript: null }))
          }}
        >
          clear
        </button>
      )}
    </span>
  )
}

function EpisodeList({ episodes, api, busy, setBusy, onChanged, onError }: EpisodeListProps) {
  const act = useCallback(
    async (run: () => Promise<unknown>) => {
      if (busy) return
      setBusy(true)
      onError(null)
      try {
        await run()
        onChanged()
      } catch (err) {
        onError(refusalMessage(err) ?? 'the station refused that')
      } finally {
        setBusy(false)
      }
    },
    [busy, setBusy, onChanged, onError],
  )

  if (episodes === null) return <p className="console__waiting">Reading the archive&hellip;</p>
  if (episodes.length === 0) {
    return <p className="console__waiting">Nothing in the archive yet.</p>
  }

  return (
    <ul className="rows">
      {episodes.map((episode) => (
        <li className="row" key={episode.id} data-status={episode.status}>
          <div className="row__what">
            <span className="row__title">{episode.title}</span>
            <span className="row__facts">
              {episode.status === 'draft' && <span className="row__draft">Draft</span>}
              {episode.episodeNumber !== null && <span>Ep. {episode.episodeNumber}</span>}
              <span>{formatDate(episode.publishedAt)}</span>
              {episode.durationMs > 0 && <span>{formatLength(episode.durationMs)}</span>}
              <TranscodeNote episode={episode} />
              <code className="row__slug">/{episode.slug}</code>
            </span>
          </div>

          <div className="row__controls">
            {/* A published episode is reachable by anybody; a draft is
                reachable by this admin, because the server lets credentials
                through to its own address. Either way the link is real. */}
            <a className="row__view" href={episodePath(episode.slug)}>
              View
            </a>

            <TranscriptControl
              api={api}
              episode={episode}
              busy={busy}
              act={act}
              onError={onError}
            />

            <button
              type="button"
              className="row__toggle"
              disabled={busy}
              onClick={() =>
                void act(() =>
                  api.update(episode.id, {
                    status: episode.status === 'published' ? 'draft' : 'published',
                  }),
                )
              }
            >
              {episode.status === 'published' ? 'Unpublish' : 'Publish'}
            </button>

            <button
              type="button"
              className="row__delete"
              disabled={busy}
              onClick={() => {
                // A native confirm rather than a modal of our own. This is the
                // one irreversible control on the page — it deletes the video
                // as well as the row — and a bespoke dialog here would be
                // effort spent making a thing look nicer that should mostly be
                // making somebody stop.
                if (!window.confirm(`Delete "${episode.title}"? The video goes too.`)) return
                void act(() => api.remove(episode.id))
              }}
            >
              Delete
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}
