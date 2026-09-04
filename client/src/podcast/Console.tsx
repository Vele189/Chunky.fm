import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
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
  uploadAudio,
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
 * belt-and-braces for its own sake: an episode upload is an audio file that may
 * be eighty megabytes, and finding out after all of it has crossed a phone's
 * connection that the poster was 1080x1080 is a genuinely bad minute. The
 * server still refuses — this is the form being honest, not the rule.
 */

/** The one size a poster may be. Mirrors `routes/podcast.ts`; keep in step. */
const POSTER_WIDTH = 1080
const POSTER_HEIGHT = 1350

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
          <span aria-hidden="true">&larr;</span> All episodes
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
          <span aria-hidden="true">&larr;</span> All episodes
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
  const [notes, setNotes] = useState('')
  const [guests, setGuests] = useState('')
  const [episodeNumber, setEpisodeNumber] = useState('')
  const [publishedAt, setPublishedAt] = useState(() => toDateInput(Date.now()))
  const [status, setStatus] = useState<EpisodeStatus>('draft')
  const [posterNote, setPosterNote] = useState<string | null>(null)
  /**
   * The transcript, read out of its file the moment one is chosen.
   *
   * Held here rather than pulled off the form at submit time, because reading a
   * file is asynchronous and the note under the field is the point: by the time
   * anybody presses the button, the console has already said how many timed
   * lines are in it. Null for an episode uploaded without one, which is most of
   * them — see the row control below, which is how a transcript usually arrives.
   */
  const [transcript, setTranscript] = useState<string | null>(null)
  const [transcriptNote, setTranscriptNote] = useState<string | null>(null)

  /** Say something about the poster the moment it is chosen, not after upload. */
  const inspect = useCallback(async (file: File | undefined) => {
    if (!file) {
      setPosterNote(null)
      return
    }
    const size = await posterSize(file)
    if (!size) {
      setPosterNote('could not read that image here; the station will have the last word')
      return
    }
    setPosterNote(
      size.width === POSTER_WIDTH && size.height === POSTER_HEIGHT
        ? `${size.width}x${size.height} — good`
        : `${size.width}x${size.height} — has to be ${POSTER_WIDTH}x${POSTER_HEIGHT}`,
    )
  }, [])

  /** The same courtesy the poster gets: say what it is, before it goes. */
  const inspectTranscript = useCallback(
    async (file: File | undefined) => {
      if (!file) {
        setTranscript(null)
        setTranscriptNote(null)
        return
      }
      const read = await readTranscript(file)
      if ('error' in read) {
        setTranscript(null)
        setTranscriptNote(read.error)
        onError(read.error)
        return
      }
      setTranscript(read.text)
      setTranscriptNote(read.note)
      onError(null)
    },
    [onError],
  )

  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()
      const element = form.current
      if (!element || busy) return

      const data = new FormData(element)
      const poster = data.get('poster')
      const audio = data.get('audio')
      if (!(audio instanceof File) || audio.size === 0) {
        onError('choose an audio file')
        return
      }
      if (!(poster instanceof File) || poster.size === 0) {
        onError('choose a poster')
        return
      }

      // The same check the server makes, made here so eighty megabytes of audio
      // does not cross a phone's connection before the poster is refused.
      const size = await posterSize(poster)
      if (size && (size.width !== POSTER_WIDTH || size.height !== POSTER_HEIGHT)) {
        onError(
          `that poster is ${size.width}x${size.height}; it has to be ${POSTER_WIDTH}x${POSTER_HEIGHT}`,
        )
        return
      }

      const at = fromDateInput(publishedAt)
      if (at !== null) data.set('publishedAt', String(at))
      else data.delete('publishedAt')

      // The audio is not part of this form any more. It goes to the store in
      // its own chunked upload first, and what the form carries is the receipt.
      data.delete('audio')

      /*
        The transcript goes as text, not as the file it was chosen from — see
        `readTranscript`. Deleting the input's own entry is not tidiness: the
        server's multipart parser is configured for exactly one file part and
        the poster is it, so a second one arriving here would be refused by
        busboy rather than by anything that could explain itself.
      */
      data.delete('transcriptFile')
      if (transcript !== null) data.set('transcript', transcript)

      setBusy(true)
      onError(null)
      const controller = new AbortController()
      cancelling.current = controller

      try {
        const finished = await uploadAudio(api, audio, {
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
        setNotes('')
        setGuests('')
        setEpisodeNumber('')
        setStatus('draft')
        setPosterNote(null)
        setTranscript(null)
        setTranscriptNote(null)
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
    [api, busy, publishedAt, transcript, onDone, onError, setBusy],
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

      <label className="console__field">
        <span>Show notes</span>
        <textarea
          name="notes"
          rows={5}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="What this one is about. Blank lines become paragraphs."
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

      <div className="console__row">
        <label className="console__field">
          <span>Audio (mp3, wav, flac, m4a&hellip;)</span>
          <input name="audio" type="file" accept="audio/*,.mp3,.wav,.flac,.m4a,.ogg" required />
        </label>

        <label className="console__field">
          <span>
            Poster &mdash; {POSTER_WIDTH}&times;{POSTER_HEIGHT}
          </span>
          <input
            name="poster"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            required
            onChange={(event) => void inspect(event.target.files?.[0])}
          />
          {posterNote && <small className="upload__poster-note">{posterNote}</small>}
        </label>
      </div>

      {/* Optional, and last of the three files, because it is the one that
          usually is not ready yet: a machine transcription takes as long as the
          conversation did. An episode uploaded without one gains it later from
          the row control on the right. */}
      <label className="console__field">
        <span>Transcript &mdash; optional (.txt, .vtt, .srt)</span>
        <input
          name="transcriptFile"
          type="file"
          accept=".txt,.vtt,.srt,.md,text/plain"
          onChange={(event) => void inspectTranscript(event.target.files?.[0])}
        />
        {transcriptNote && <small className="upload__poster-note">{transcriptNote}</small>}
      </label>

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

/** What the encode did to an episode, in one short line. */
function TranscodeNote({ episode }: { episode: AdminEpisode }) {
  if (episode.transcodeStatus === 'pending') {
    return <span className="row__encoding">encoding…</span>
  }
  if (episode.transcodeStatus === 'failed') {
    return (
      <span className="row__encode-failed" title={episode.transcodeError ?? undefined}>
        serving the master &mdash; encode failed
      </span>
    )
  }
  // The number this whole feature exists for: what a listener downloads,
  // against what was uploaded.
  const saved =
    episode.masterBytes > 0 && episode.audioBytes < episode.masterBytes
      ? Math.round((1 - episode.audioBytes / episode.masterBytes) * 100)
      : 0
  return (
    <span className="row__sizes">
      {formatBytes(episode.audioBytes)}
      {saved > 0 && (
        <>
          {' '}
          <span className="row__saved">&minus;{saved}% from {formatBytes(episode.masterBytes)}</span>
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
                // one irreversible control on the page — it deletes the audio
                // as well as the row — and a bespoke dialog here would be
                // effort spent making a thing look nicer that should mostly be
                // making somebody stop.
                if (!window.confirm(`Delete "${episode.title}"? The audio goes too.`)) return
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
