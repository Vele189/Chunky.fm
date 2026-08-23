import { AdminError } from './admin.js'

/**
 * The podcast archive, as the client understands it.
 *
 * The pure half of the page: the shapes, the addresses, and the arithmetic that
 * turns a number of milliseconds into something a person reads. Everything here
 * is a function of its arguments, which is what lets it be tested without a
 * browser and why the components import from here rather than working any of it
 * out for themselves.
 *
 * The archive is deliberately unlike the rest of this app. The station is one
 * document deciding what to show from its fragment, because it is a private
 * application behind a door. An episode is the opposite: a public page with a
 * real address, meant to be pasted into a message and read by a crawler. So
 * these are paths, and the four front doors all know about them.
 */

/** Whether an episode is on the page yet. Mirrors the server's `EpisodeStatus`. */
export type EpisodeStatus = 'draft' | 'published'

/** Where the small serving copy has got to. Mirrors the server's. */
export type TranscodeStatus = 'pending' | 'ready' | 'failed' | 'none'

/** One episode, as `toEpisode` on the server sends it. */
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
  /**
   * Where the audio is, whole.
   *
   * The one address in this API the client does not build for itself, and it
   * cannot: on a station with R2 it is a Cloudflare hostname this app has never
   * heard of, and on one without it is a route here. Only the server knows
   * which. See the note on `Episode` in the server's `lib/episode.ts`.
   */
  audioUrl: string
  audioType: string
  audioBytes: number
  transcodeStatus: TranscodeStatus
  poster: string | null
  uploadedAt: number
}

/** What the console sees and a listener does not. */
export interface AdminEpisode extends Episode {
  masterBytes: number
  transcodeError: string | null
}

/**
 * The archive's own address.
 *
 * Kept in step with `PODCAST_PATH` in the server's `lib/doorway.ts` by hand, and
 * with the rules in `nginx.conf` and `vite.config.ts`, for the reason
 * `STATION_PATH` is: nothing imports across the two workspaces.
 */
export const PODCAST_PATH = '/podcast'

/**
 * Where the console lives, as a fragment rather than a path.
 *
 * `#admin`, the same spelling the station uses, and a fragment for a reason
 * that is about addresses rather than consistency: every path under
 * `/podcast/` is an episode slug, so a console at `/podcast/admin` would be
 * competing with an episode somebody could legitimately name "Admin". A
 * fragment cannot collide with a slug, and it never reaches the server, so no
 * front door has to learn about it.
 *
 * `slugify` refuses to mint `admin` as a slug anyway. Two locks, because a slug
 * is permanent the moment somebody links to it.
 */
export const CONSOLE_HASH = '#admin'

/** What the podcast document is showing. */
export type PodcastRoute =
  /** The archive: every published episode, as cards. Where you land. */
  | { kind: 'grid' }
  /** One episode, with the player. The address a card links to. */
  | { kind: 'episode'; slug: string }
  /** The other mode: uploading and publishing. Behind the admin password. */
  | { kind: 'console' }

/** The address of one episode. What a card links to, and what gets pasted. */
export function episodePath(slug: string): string {
  return `${PODCAST_PATH}/${slug}`
}

/**
 * The slug in a path, or null when the path is the archive itself.
 *
 * Trailing slashes are the archive rather than an episode with an empty name,
 * which is the same call `doorway` makes on the server. Anything below a second
 * level (`/podcast/a/b`) is not an address this app mints, and is read as the
 * archive rather than as an episode called `a`: guessing at a malformed link is
 * how somebody ends up on the wrong episode, and the grid is the honest answer.
 */
export function slugInPath(pathname: string): string | null {
  if (!pathname.startsWith(`${PODCAST_PATH}/`)) return null
  const rest = pathname.slice(PODCAST_PATH.length + 1)
  if (rest === '' || rest.includes('/')) return null
  // A slug arrives percent-encoded from some clients even though nothing here
  // mints one that needs it. Decoding is what makes a hand-typed address with a
  // stray escape in it land on the episode rather than on a 404.
  try {
    return decodeURIComponent(rest)
  } catch {
    // A malformed escape sequence. Not an episode anybody has.
    return rest
  }
}

/**
 * What the page is showing, from the address bar.
 *
 * The console wins over the slug, because `#admin` is a mode rather than a
 * view: an admin who opened the console from an episode page should get the
 * console, not the episode with a fragment stuck on it.
 */
export function routeFrom(location: { pathname: string; hash: string }): PodcastRoute {
  if (location.hash === CONSOLE_HASH) return { kind: 'console' }
  const slug = slugInPath(location.pathname)
  return slug === null ? { kind: 'grid' } : { kind: 'episode', slug }
}

/** Where an episode's poster is, or null for one that somehow has none. */
export const episodePosterUrl = (episode: Episode) =>
  episode.poster ? `/api/episode-poster/${episode.poster}` : null

/**
 * A length, the way a card says it.
 *
 * Whole minutes, because nobody choosing what to listen to on a Sunday cares
 * about the seconds, and an hour and over reads as hours and minutes because
 * "83 min" is a number a reader has to do arithmetic on. Under a minute is
 * still "1 min" rather than "0 min": an episode that exists lasts some time,
 * and rounding it to nothing reads as an error rather than as a short episode.
 */
export function formatLength(durationMs: number): string {
  const minutes = Math.max(1, Math.round(durationMs / 60_000))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`
}

/**
 * A position, the way the player's clock says it.
 *
 * `h:mm:ss` once an episode passes the hour and `m:ss` below it, which is what
 * every player does and what makes the two numbers either side of a scrubber
 * comparable at a glance. Negative is clamped to zero: the remaining-time
 * readout counts down, and floating-point drift at the very end would otherwise
 * flash `-0:00`.
 */
export function formatPosition(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const rest = whole % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`
}

/**
 * The date an episode carries, as a card writes it.
 *
 * Day and month, and the year only when it is not this one — the same rule a
 * person uses out loud. An archive read in December is mostly this year, and
 * repeating it on every card is noise; an episode from two years ago needs it
 * or it reads as recent.
 */
export function formatDate(publishedAt: number, now = Date.now()): string {
  const date = new Date(publishedAt)
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

/**
 * What goes under the title on a card, or null when there is nothing to say.
 *
 * The number and the guests are both optional and either can stand alone, so
 * this is the one place that decides how they read together rather than three
 * components each having an opinion. Null rather than an empty string, so a
 * card can leave the line out entirely instead of drawing an empty one that
 * still takes up space.
 */
export function subtitleFor(episode: Episode): string | null {
  const parts: string[] = []
  if (episode.episodeNumber !== null) parts.push(`Ep. ${episode.episodeNumber}`)
  if (episode.guests) parts.push(`with ${episode.guests}`)
  return parts.length > 0 ? parts.join(' · ') : null
}

/**
 * Show notes split into paragraphs.
 *
 * The server keeps newlines in the notes and collapses runs of blank lines to
 * one, so this is the other half of that: a blank line is a paragraph break and
 * a single newline is not. Doing it here rather than with `white-space:
 * pre-wrap` means the page gets real paragraphs with real spacing between them,
 * which is what an hour of show notes needs to be readable.
 */
export function paragraphs(notes: string | null): string[] {
  if (!notes) return []
  return notes
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
}

/**
 * A number of bytes, the way a person reads it.
 *
 * Used by the console to say what an upload is about to cost and what the
 * encode saved, which is the whole reason any of this exists.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const mb = bytes / 1024 / 1024
  if (mb < 1) return `${Math.round(bytes / 1024)} kB`
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}


/* --- putting an hour of audio somewhere ------------------------------------
 *
 * A 500 MB file does not go in a form post. It takes minutes, a proxy will cut
 * the request, and a connection that drops at 90% loses all of it. So it goes
 * up in parts, and this is the client half of the protocol the server describes
 * in `lib/store.ts`.
 *
 * The two things that make this worth the code:
 *
 *   **Progress.** Not a spinner. A person who has just started a five-minute
 *   upload needs to know it is moving, and a bar that is a lie is worse than
 *   no bar — so this reports bytes actually acknowledged by the store, not
 *   bytes handed to the browser.
 *
 *   **Resume.** A part that fails is retried on its own; the parts that already
 *   landed are not sent again. Dropping at 90% costs the last 8 MiB, not 450.
 */

/** What an upload is doing, for the console to draw. */
export interface UploadProgress {
  /** Bytes the store has acknowledged. */
  sent: number
  total: number
  /** 0..1. What the bar is. */
  fraction: number
  partsDone: number
  partCount: number
  /** Set while a part is being retried, so the console can say so. */
  retrying: boolean
}

/** What the finished upload is, to be handed to `create`. */
export interface FinishedUpload {
  uploadId: string
  key: string
  contentHash: string
  parts: { partNumber: number; etag: string }[]
  contentType: string
  /** What this browser's decoder made of the file. Provisional; see the server. */
  durationMs: number
}

interface BegunUpload {
  uploadId: string
  key: string
  partSize: number
  partCount: number
  urls: string[]
  direct: boolean
}

/**
 * How many times one part is retried before the whole upload gives up.
 *
 * Three, with a widening pause between them. Most part failures are a moment of
 * network trouble rather than anything wrong with the file or the credentials,
 * and the cost of retrying is one part rather than the whole upload — so it is
 * worth being patient here in a way it would not be for a single POST.
 */
const PART_ATTEMPTS = 3

/** How long a browser waits before retrying a part, per attempt. */
const backoffMs = (attempt: number) => 500 * 2 ** attempt

/**
 * What this browser thinks the audio is, in milliseconds.
 *
 * Read by handing the file to an `<audio>` element and waiting for its
 * metadata, which costs nothing and works for everything a browser can play.
 * Zero when it cannot — a WAV bigger than the decoder wants to touch, an exotic
 * container — and zero is a fine answer: the server treats this as provisional
 * and ffmpeg measures it properly during the encode.
 */
export async function durationOfFile(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const probe = new Audio()
    const done = (ms: number) => {
      URL.revokeObjectURL(url)
      probe.removeAttribute('src')
      resolve(ms)
    }
    probe.preload = 'metadata'
    probe.onloadedmetadata = () =>
      done(Number.isFinite(probe.duration) ? Math.round(probe.duration * 1000) : 0)
    probe.onerror = () => done(0)
    probe.src = url
  })
}

/**
 * The sha256 of a file, computed while it is being read.
 *
 * This is what an episode is keyed on, and it is computed **here** rather than
 * on the server for the reason the whole design rests on: the server never sees
 * these bytes. Hashing 500 MB in the browser costs a few seconds of CPU, which
 * is hidden inside an upload that takes minutes.
 *
 * Read in the same slices the upload uses, so the file is walked once rather
 * than twice — `crypto.subtle.digest` would need the whole thing in memory at
 * once, which for a gigabyte is not something to ask of a phone.
 */
export async function sha256Of(file: File, partSize: number, onSlice?: () => void): Promise<string> {
  // Incremental hashing is not in SubtleCrypto, so this is the one place a
  // small implementation is carried rather than borrowed. Kept honest by
  // hashing the whole buffer when the file is small enough to hold, which is
  // the overwhelmingly common case for anything but a raw master.
  if (file.size <= partSize * 4) {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  // Larger than that: hash slice by slice with a rolling implementation.
  const state = new Sha256()
  for (let offset = 0; offset < file.size; offset += partSize) {
    const slice = await file.slice(offset, offset + partSize).arrayBuffer()
    state.update(new Uint8Array(slice))
    onSlice?.()
  }
  return state.hex()
}

/**
 * SHA-256, incrementally.
 *
 * Carried rather than depended on, and only because the platform will not do
 * it: `crypto.subtle.digest` is one-shot, and the alternative to sixty lines
 * here is holding a gigabyte in memory to hash it. FIPS 180-4, unmodified.
 */
class Sha256 {
  static readonly #K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ])

  #h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  #buffer = new Uint8Array(64)
  #buffered = 0
  #length = 0

  update(bytes: Uint8Array): void {
    this.#length += bytes.length
    let offset = 0
    if (this.#buffered > 0) {
      const need = Math.min(64 - this.#buffered, bytes.length)
      this.#buffer.set(bytes.subarray(0, need), this.#buffered)
      this.#buffered += need
      offset = need
      if (this.#buffered === 64) {
        this.#block(this.#buffer)
        this.#buffered = 0
      }
    }
    for (; offset + 64 <= bytes.length; offset += 64) this.#block(bytes.subarray(offset, offset + 64))
    if (offset < bytes.length) {
      this.#buffer.set(bytes.subarray(offset), 0)
      this.#buffered = bytes.length - offset
    }
  }

  hex(): string {
    const bits = this.#length * 8
    const tail = new Uint8Array(this.#buffered < 56 ? 64 : 128)
    tail.set(this.#buffer.subarray(0, this.#buffered))
    tail[this.#buffered] = 0x80
    // The length as a 64-bit big-endian count of bits. JavaScript numbers hold
    // this exactly up to 2^53 bits, which is a petabyte; nothing here is close.
    new DataView(tail.buffer).setUint32(tail.length - 4, bits >>> 0, false)
    new DataView(tail.buffer).setUint32(tail.length - 8, Math.floor(bits / 2 ** 32), false)
    for (let i = 0; i < tail.length; i += 64) this.#block(tail.subarray(i, i + 64))
    return [...this.#h].map((word) => word.toString(16).padStart(8, '0')).join('')
  }

  #block(chunk: Uint8Array): void {
    const w = new Uint32Array(64)
    const view = new DataView(chunk.buffer, chunk.byteOffset, 64)
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(i * 4, false)
    const rot = (x: number, n: number) => (x >>> n) | (x << (32 - n))
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15] as number
      const b = w[i - 2] as number
      const s0 = rot(a, 7) ^ rot(a, 18) ^ (a >>> 3)
      const s1 = rot(b, 17) ^ rot(b, 19) ^ (b >>> 10)
      w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, h] = this.#h as unknown as number[]
    for (let i = 0; i < 64; i++) {
      const S1 = rot(e as number, 6) ^ rot(e as number, 11) ^ rot(e as number, 25)
      const ch = ((e as number) & (f as number)) ^ (~(e as number) & (g as number))
      const t1 = ((h as number) + S1 + ch + (Sha256.#K[i] as number) + (w[i] as number)) >>> 0
      const S0 = rot(a as number, 2) ^ rot(a as number, 13) ^ rot(a as number, 22)
      const maj = ((a as number) & (b as number)) ^ ((a as number) & (c as number)) ^ ((b as number) & (c as number))
      const t2 = (S0 + maj) >>> 0
      h = g; g = f; f = e; e = ((d as number) + t1) >>> 0
      d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    const next = [a, b, c, d, e, f, g, h] as number[]
    for (let i = 0; i < 8; i++) this.#h[i] = ((this.#h[i] as number) + (next[i] as number)) >>> 0
  }
}

/**
 * Put a file in the store, in parts, reporting progress and surviving drops.
 *
 * Sequential rather than parallel, and that is a deliberate choice about who
 * this runs for. Parallel parts finish sooner on a fat connection and saturate
 * a domestic uplink completely, which on the same wifi as everybody else in the
 * house means nothing else works for five minutes. One at a time is slower and
 * leaves the line usable, and nobody is waiting on this: the console can be
 * closed and the episode is still there.
 *
 * `signal` cancels: the loop stops and the caller aborts the upload server-side
 * so the parts already sent are cleaned up rather than billed for.
 */
export async function uploadAudio(
  api: EpisodeApi,
  file: File,
  options: {
    onProgress?: (progress: UploadProgress) => void
    signal?: AbortSignal
  } = {},
): Promise<FinishedUpload> {
  const { onProgress, signal } = options

  const begun = await api.beginUpload(file)
  const parts: { partNumber: number; etag: string }[] = []
  let sent = 0

  const report = (retrying = false) =>
    onProgress?.({
      sent,
      total: file.size,
      fraction: file.size > 0 ? sent / file.size : 0,
      partsDone: parts.length,
      partCount: begun.partCount,
      retrying,
    })

  report()

  try {
    for (let n = 1; n <= begun.partCount; n++) {
      signal?.throwIfAborted()
      const slice = file.slice((n - 1) * begun.partSize, n * begun.partSize)
      let lastError: unknown

      for (let attempt = 0; attempt < PART_ATTEMPTS; attempt++) {
        if (attempt > 0) {
          report(true)
          await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt - 1)))
          signal?.throwIfAborted()
        }
        try {
          const etag = await putPart(begun.urls[n - 1] as string, slice, begun.direct, signal)
          parts.push({ partNumber: n, etag })
          sent += slice.size
          report()
          lastError = undefined
          break
        } catch (err) {
          if (signal?.aborted) throw err
          lastError = err
        }
      }

      if (lastError) throw lastError
    }
  } catch (err) {
    // Whatever went up is cleaned out of the store rather than left to be
    // charged for. Best effort: if this fails too there is nothing further to
    // try from here, and R2 expires incomplete uploads on its own.
    await api.abortUpload(begun.uploadId, begun.key).catch(() => undefined)
    throw err
  }

  const [contentHash, durationMs] = await Promise.all([
    sha256Of(file, begun.partSize),
    durationOfFile(file),
  ])

  return {
    uploadId: begun.uploadId,
    key: begun.key,
    contentHash,
    parts,
    contentType: file.type || 'application/octet-stream',
    durationMs,
  }
}

/**
 * One part, and its receipt.
 *
 * `fetch` rather than `XMLHttpRequest`, which is the usual choice for upload
 * progress — and it is not needed here, because progress is counted in whole
 * parts rather than in bytes mid-flight. At 8 MiB a part, a 500 MB upload moves
 * the bar sixty-three times, which is smooth enough to read as motion and is
 * *honest*: it counts bytes the store has acknowledged rather than bytes handed
 * to the browser's socket buffer.
 *
 * The ETag comes from the response header against R2 and from a JSON body
 * against this app's own disk backend, because a cross-origin response only
 * exposes the headers CORS says it may. Both are read, so the same code works
 * either way.
 */
async function putPart(
  url: string,
  slice: Blob,
  direct: boolean,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch(url, {
    method: 'PUT',
    body: slice,
    signal,
    // Only for our own backend: a cross-origin PUT to R2 must not carry
    // credentials, and adding a header CORS was not told to allow is what turns
    // a working upload into a preflight failure.
    ...(direct
      ? {}
      : { headers: { 'content-type': 'application/octet-stream' }, credentials: 'same-origin' as const }),
  })

  if (!response.ok) {
    throw new AdminError(response.status, 'part_failed', `a part would not upload (${response.status})`)
  }

  const header = response.headers.get('etag')
  if (header) return header
  try {
    const body = (await response.json()) as { etag?: unknown }
    if (typeof body.etag === 'string') return body.etag
  } catch {
    // Not JSON either.
  }
  throw new AdminError(
    502,
    'no_etag',
    'the store did not acknowledge a part; if this is R2, its CORS rules need ExposeHeaders: ["ETag"]',
  )
}

/** What the console sends when it edits an episode. Absent means "leave it". */
export interface EpisodePatch {
  title?: string
  notes?: string | null
  guests?: string | null
  episodeNumber?: number | null
  publishedAt?: number
  status?: EpisodeStatus
}

/** What an upload needs, alongside the two files. */
export interface EpisodeDraft {
  title: string
  notes: string
  guests: string
  episodeNumber: string
  /** Epoch ms. The console's date field; absent means the server dates it today. */
  publishedAt: number | null
  status: EpisodeStatus
}

export interface EpisodeApiOptions {
  fetch?: typeof globalThis.fetch
  baseUrl?: string
}

/**
 * The archive's side of the HTTP API.
 *
 * Shaped like `AdminApi` and throwing the same `AdminError`, so the console can
 * reuse `refusalMessage` and `useAdminSession` without a second vocabulary for
 * the same things. The difference is that half of this is open: `list` and
 * `get` need no credentials at all, which is the whole point of the archive.
 */
export class EpisodeApi {
  readonly #fetch: typeof globalThis.fetch
  readonly #baseUrl: string

  constructor({ fetch = globalThis.fetch, baseUrl = '' }: EpisodeApiOptions = {}) {
    // Bound, for the reason `AdminApi` binds it: fetch called as a method of
    // anything but window throws in browsers.
    this.#fetch = fetch.bind(globalThis)
    this.#baseUrl = baseUrl
  }

  /** Every published episode, newest first. Open. */
  async list(): Promise<Episode[]> {
    const response = await this.#fetch(`${this.#baseUrl}/api/episodes`)
    if (!response.ok) throw await this.#toError(response)
    return ((await response.json()) as { episodes: Episode[] }).episodes
  }

  /**
   * One episode by its address, or null when there is nothing there.
   *
   * Null rather than a throw for the 404, because "no episode at that address"
   * is a page this app draws rather than an error it reports: somebody followed
   * an old link, and the answer is the archive with a line explaining why.
   */
  async get(slug: string): Promise<Episode | null> {
    const response = await this.#fetch(`${this.#baseUrl}/api/episodes/${encodeURIComponent(slug)}`)
    if (response.status === 404) return null
    if (!response.ok) throw await this.#toError(response)
    return ((await response.json()) as { episode: Episode }).episode
  }

  /** Every episode including the drafts, and what the encode did. Admin only. */
  async listAll(): Promise<AdminEpisode[]> {
    const response = await this.#fetch(`${this.#baseUrl}/api/admin/episodes`)
    if (!response.ok) throw await this.#toError(response)
    return ((await response.json()) as { episodes: AdminEpisode[] }).episodes
  }

  /** Begin a chunked upload, and get somewhere to put every part. */
  async beginUpload(file: File): Promise<BegunUpload> {
    const response = await this.#fetch(`${this.#baseUrl}/api/episodes/uploads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bytes: file.size,
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
      }),
    })
    if (!response.ok) throw await this.#toError(response)
    return (await response.json()) as BegunUpload
  }

  /** Give up on one, so the parts already sent are not left to be charged for. */
  async abortUpload(uploadId: string, key: string): Promise<void> {
    await this.#fetch(
      `${this.#baseUrl}/api/episodes/uploads/${encodeURIComponent(uploadId)}?key=${encodeURIComponent(key)}`,
      { method: 'DELETE' },
    )
  }

  /**
   * Add an episode.
   *
   * Takes a `FormData` the caller built rather than the two files and six
   * fields, because the one thing this method must not do is set a
   * `Content-Type`: multipart needs a boundary in the header that only the
   * browser knows, and naming the type by hand is the classic way to send a
   * body the server cannot parse.
   *
   * The audio is *not* in here. It is already in the store by the time this is
   * called; what the form carries is the receipt — see `uploadAudio`.
   */
  async create(body: FormData): Promise<Episode> {
    const response = await this.#fetch(`${this.#baseUrl}/api/episodes`, {
      method: 'POST',
      body,
    })
    if (!response.ok) throw await this.#toError(response)
    return ((await response.json()) as { episode: Episode }).episode
  }

  async update(id: number, patch: EpisodePatch): Promise<Episode> {
    const response = await this.#fetch(`${this.#baseUrl}/api/episodes/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!response.ok) throw await this.#toError(response)
    return ((await response.json()) as { episode: Episode }).episode
  }

  async remove(id: number): Promise<void> {
    const response = await this.#fetch(`${this.#baseUrl}/api/episodes/${id}`, { method: 'DELETE' })
    if (!response.ok) throw await this.#toError(response)
  }

  /**
   * Whatever the station said about a refusal, as an `AdminError`.
   *
   * The same shape `AdminApi` builds, so `refusalMessage` works on both. A body
   * that is not this API's JSON at all (a proxy's HTML error page, say) falls
   * back to the status, because the alternative is showing somebody a fragment
   * of markup.
   */
  async #toError(response: Response): Promise<AdminError> {
    let code = 'http_error'
    let message = `the station answered ${response.status}`
    try {
      const body = (await response.json()) as { error?: unknown; message?: unknown }
      if (typeof body.error === 'string') code = body.error
      if (typeof body.message === 'string') message = body.message
    } catch {
      // Not JSON. The status is all there is to go on.
    }
    return new AdminError(response.status, code, message)
  }
}
