import type { Db, EpisodeRow, EpisodeStatus, TranscodeStatus } from '../db.js'
import type { MediaStore } from './store.js'

/**
 * An episode as it goes over the wire.
 *
 * camelCase where the row is snake_case, and `audioUrl` **whole** rather than a
 * bare filename — which is the one place this API departs from the shape
 * `toTrack` uses, and the departure is forced rather than chosen.
 *
 * Everything else here is served by this app, so a filename is enough and the
 * client builds the address: `/api/audio/${track.filename}`. An episode's audio
 * is not. On a station with R2 configured it is served from a Cloudflare
 * hostname this app does not own and cannot construct a rule for, and on one
 * without it is served from here — so the *only* thing that knows the address
 * is the server, and asking the client to guess would mean teaching it about
 * buckets. See `MediaStore.publicUrl`.
 *
 * `contentHash` is deliberately absent, unlike `toTrack`, which carries it. It
 * is a dedupe key for the admin and means nothing to a listener; the library's
 * shape is what the console drives its uploads with, and this list is read by
 * anyone at all. `transcodeError` is absent for a sharper reason — see
 * `toAdminEpisode`.
 */
export interface Episode {
  id: number
  slug: string
  title: string
  notes: string | null
  guests: string | null
  episodeNumber: number | null
  publishedAt: number
  status: EpisodeStatus
  durationMs: number
  /** Where the audio actually is. Absolute on R2, app-relative on disk. */
  audioUrl: string
  /** What that file is, so a player is not left sniffing. */
  audioType: string
  /** How big it is, so the page can say so before somebody starts an hour. */
  audioBytes: number
  /**
   * Whether the small serving copy exists yet.
   *
   * Public, and it earns its place: between the master landing and the encode
   * finishing there are minutes during which the episode plays *from the
   * master*, which on a phone is a very large download. A player that knows can
   * say so rather than silently spending somebody's data.
   */
  transcodeStatus: TranscodeStatus
  poster: string | null
  /**
   * Whether there is a transcript to fetch, rather than the transcript.
   *
   * An hour of talk is a hundred kilobytes of text, and the archive route hands
   * back sixty episodes at once: carrying the words here would make the grid —
   * a page of pictures and titles — a six-megabyte response so that one reader
   * in twenty can press a button. So the episode says *that there is one* and
   * `GET /api/episodes/:slug/transcript` says what it is, asked for only when
   * somebody opens it.
   *
   * A boolean rather than a length or a URL: the page's only question is
   * whether to draw the toggle at all.
   */
  hasTranscript: boolean
  uploadedAt: number
}

/** What the console sees and a listener does not. See `toAdminEpisode`. */
export interface AdminEpisode extends Episode {
  masterBytes: number
  /** ffmpeg's complaint, when there is one. */
  transcodeError: string | null
}

export function toEpisode(row: EpisodeRow, store: MediaStore): Episode {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    notes: row.notes,
    guests: row.guests,
    episodeNumber: row.episode_number,
    publishedAt: row.published_at,
    status: row.status,
    durationMs: row.duration_ms,
    audioUrl: store.publicUrl(row.audio_key),
    audioType: row.audio_type,
    audioBytes: row.audio_bytes,
    transcodeStatus: row.transcode_status,
    poster: row.poster,
    hasTranscript: row.transcript !== null && row.transcript !== '',
    uploadedAt: row.uploaded_at,
  }
}

/**
 * The same, plus what only the person running the archive should read.
 *
 * `transcodeError` is ffmpeg's own message, and ffmpeg's messages routinely
 * carry the *path it was working on* — which on this server is a temp directory
 * under the storage volume. That is nobody's business but the admin's, and it
 * is exactly the class of detail `lib/errors.ts` refuses to put in a public
 * response. `masterBytes` is withheld for a duller reason: it is a fact about
 * storage rather than about listening.
 */
export function toAdminEpisode(row: EpisodeRow, store: MediaStore): AdminEpisode {
  return {
    ...toEpisode(row, store),
    masterBytes: row.master_bytes,
    transcodeError: row.transcode_error,
  }
}

/**
 * How long an episode title may be.
 *
 * Longer than a session title's eighty, because the two are different things
 * being written. A session title is a line on a poster; this is the name of a
 * conversation, and names of conversations run to "What we talk about when we
 * talk about leaving Johannesburg". Still bounded, because it has to sit on a
 * card in a grid and inside a `<title>`.
 */
export const TITLE_MAX_LENGTH = 140

/** Show notes. Paragraphs, not a caption, so this is generous and still finite. */
export const NOTES_MAX_LENGTH = 8_000

/** One line naming who was on. Not a list of credits. */
export const GUESTS_MAX_LENGTH = 200

/**
 * How long a transcript may be.
 *
 * Two hundred thousand characters, which is not a round guess: talk runs at
 * roughly nine hundred characters a minute, so this is about four hours of
 * conversation with the speaker labels and the timestamps on top of it — well
 * past the longest thing this archive is ever going to hold, and still bounded.
 *
 * The ceiling exists twice over. This is a column in a row that is read every
 * time the console lists the archive, and it is a multipart *field*, which
 * busboy holds in memory whole; the parser's own limit is a megabyte (see the
 * multipart registration in app.ts), and 200k characters cannot exceed that
 * even if every one of them is three bytes of UTF-8.
 *
 * Unlike the notes, going over is refused rather than truncated. A transcript
 * cut off at the ceiling would look complete and simply stop in the middle of
 * an answer, which is a worse thing to discover in six months than an upload
 * that would not go through today.
 */
export const TRANSCRIPT_MAX_LENGTH = 200_000

/**
 * The addresses an episode may not claim, because the page already means
 * something else by them.
 *
 * Only one of these is load-bearing today. The console lives at
 * `/podcast#admin` rather than at a path precisely so that an episode called
 * "Admin" cannot collide with it, so this is belt and braces — but a slug is
 * forever once a link to it exists, and the cheap moment to refuse one is
 * before it is minted rather than after somebody has shared it.
 */
const RESERVED_SLUGS = new Set(['admin', 'api', 'new', 'draft', 'drafts'])

/**
 * A title as it goes into the database.
 *
 * Control characters go with the whitespace, because this ends up in the markup
 * of a public page and inside an `alt` and a `<title>`: a newline in the middle
 * of an episode name is somebody's paste of a whole description arriving as a
 * title. The same treatment `toTitle` gives a session's, and the reason is the
 * same; the length is not, and neither is what happens to an empty one.
 *
 * Empty stays empty here rather than becoming null, because unlike a session
 * title this one is required and the route refuses it. A `null` out of a
 * cleaner is a different failure, from the caller's point of view, than "what
 * you typed was blank".
 */
export function toTitle(value: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().replace(/\s+/g, ' ').slice(0, TITLE_MAX_LENGTH)
}

/**
 * Show notes as they go into the database, or null for an episode with none.
 *
 * Newlines survive here, where a title's do not, and that is the whole
 * difference between the two: notes are paragraphs and the page renders them as
 * paragraphs. Everything else in the control range still goes, and runs of
 * blank lines collapse to one — a paste out of a word processor otherwise
 * arrives carrying six.
 */
export function toNotes(value: string): string | null {
  const clean = value
    .replace(/\r\n?/g, '\n')
    // Newline spared by name, which is the one character this differs from a
    // title on.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, NOTES_MAX_LENGTH)
  return clean.length > 0 ? clean : null
}

/**
 * A transcript as it goes into the database, or null for an episode with none.
 *
 * Barely touched, and that is deliberate: this is somebody's transcription tool
 * output and every line of it is load-bearing, so unlike the notes there is no
 * collapsing of blank runs and no reflowing. Three things happen. Line endings
 * are normalised, because a file written on Windows and one written on a Mac
 * must parse the same way in the browser; the control characters that are not
 * newline or tab go, for the reason they go everywhere else in this file — this
 * ends up in the markup of a public page; and a BOM is dropped, which a text
 * file exported from a word processor routinely opens with and which would
 * otherwise sit in front of the first timestamp and stop it being one.
 *
 * Length is *not* enforced here. The route refuses an over-long transcript with
 * its actual size named, because silently returning a shortened one is exactly
 * the failure this is trying to avoid; see `TRANSCRIPT_MAX_LENGTH`.
 */
export function toTranscript(value: string): string | null {
  const clean = value
    .replace(/^\ufeff/, '')
    .replace(/\r\n?/g, '\n')
    // Newline and tab spared by name; a transcript's own indentation is the
    // only thing here that ever means anything.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, '')
    .trim()
  return clean.length > 0 ? clean : null
}

/** One line, like a title, and null when nobody was on but the host. */
export function toGuests(value: string): string | null {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
  const clean = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().replace(/\s+/g, ' ').slice(0, GUESTS_MAX_LENGTH)
  return clean.length > 0 ? clean : null
}

/**
 * The address form of a title.
 *
 * Deliberately ASCII-only, and that is a decision rather than an oversight
 * about the rest of the world. A slug is a thing people read off a screen, type
 * into a phone, and paste into a message that may re-encode it on the way;
 * percent-escapes in a shared link are how an address stops being something
 * anybody can repeat out loud. So accents fold to the letters underneath them
 * (`Sé` becomes `se`) via NFD, which keeps a title recognisable in its address,
 * and anything with no ASCII form at all drops out.
 *
 * A title that leaves nothing behind — one written entirely in a script this
 * cannot fold — yields the empty string, and `uniqueSlug` answers that with a
 * dated fallback rather than a refusal. The alternative is telling somebody
 * their episode cannot be published because of the alphabet it is named in.
 */
export function slugify(title: string): string {
  return (
    title
      .normalize('NFD')
      // The combining marks NFD has just split off. Without this they would go
      // through the strip below one at a time and leave the bare letters
      // anyway, but only after `é` had briefly been two characters, one of
      // which is not one.
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      // Ampersand is worth a word rather than a gap: "Q & A" reading as `q-a`
      // is a worse address than `q-and-a`, and it is the one punctuation mark
      // that routinely carries meaning in a title.
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
      // The slice can land on a hyphen, which would otherwise be a trailing one
      // that the strip above has already ruled out.
      .replace(/-+$/g, '')
  )
}

/**
 * A slug nothing else is already using.
 *
 * Counts up rather than appending a random suffix, because these are read by
 * people: an archive holding `leaving-johannesburg` and
 * `leaving-johannesburg-2` is legible, and one holding
 * `leaving-johannesburg-f3a9` is a database leaking into an address bar. Two
 * episodes genuinely called the same thing is rare enough that the count will
 * never reach double figures.
 *
 * Takes a `taken` predicate rather than a `Db`, so this is testable without one
 * and so the caller decides what "taken" means — which matters on an edit,
 * where an episode keeping its own slug must not collide with itself.
 */
export function uniqueSlug(
  title: string,
  taken: (slug: string) => boolean,
  now = Date.now(),
): string {
  // A title with no ASCII in it at all, or one that was entirely punctuation.
  // Dated rather than random, for the reason the counter is not random: it is
  // still something a person can look at and place.
  const base = slugify(title) || `episode-${new Date(now).toISOString().slice(0, 10)}`

  const free = (slug: string) => !taken(slug) && !RESERVED_SLUGS.has(slug)
  if (free(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (free(candidate)) return candidate
  }
}

/** Whether any episode other than `exceptId` already answers to this slug. */
export function slugTaken(db: Db, slug: string, exceptId: number | null = null): boolean {
  const row = db.prepare('SELECT id FROM episodes WHERE slug = ?').get(slug) as
    | { id: number }
    | undefined
  if (!row) return false
  return exceptId === null || row.id !== exceptId
}
