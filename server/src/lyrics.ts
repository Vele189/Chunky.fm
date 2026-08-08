import type { Db, LyricsRow } from './db.js'

/**
 * The lyric sheet — what the station knows the words to.
 *
 * LRCLIB (lrclib.net) is a public, keyless archive of timestamped lyrics, and
 * the upload already extracts exactly the four things its lookup wants: title,
 * artist, album and duration. So the moment a track lands in the library, one
 * background errand asks the archive about it, and whatever comes back is
 * written down against the track. Listeners never talk to LRCLIB — they ask
 * this station, which answers from its own table — so a room of fifty people
 * costs the archive one request, not fifty.
 *
 * A lookup that finds nothing writes nothing, and the misses of a run are only
 * remembered in memory: lyrics get contributed to the archive all the time, so
 * a track nobody knew the words to last month is worth asking about again, and
 * "again" arriving with the next restart is about the right amount of retry.
 */

/** What a track needs to answer for before the archive can be asked about it. */
export interface LyricsSubject {
  id: number
  title: string
  artist: string | null
  album: string | null
  durationMs: number
}

/** The words themselves, as they go over the wire to a listener. */
export interface Lyrics {
  /** LRC text, `[mm:ss.xx] line` per line, or null when only plain was found. */
  synced: string | null
  plain: string | null
}

/** The shape LRCLIB answers with, on `/api/get` and per result on `/api/search`. */
interface LrclibRecord {
  syncedLyrics?: string | null
  plainLyrics?: string | null
  instrumental?: boolean
  duration?: number
}

/**
 * LRCLIB asks nicely that callers say who they are, since there is no API key
 * to say it for them.
 */
const USER_AGENT = 'chunky.fm (self-hosted web radio; https://lrclib.net/docs)'

/** How long one lookup is worth waiting on before the errand gives up. */
const LOOKUP_TIMEOUT_MS = 10_000

/**
 * How far a search result's duration may sit from the track's before it is
 * probably a different recording — the album cut when we are holding the live
 * one. The precise `/api/get` lookup does its own matching server-side; this
 * only guards the looser `/api/search` fallback.
 */
const DURATION_TOLERANCE_S = 10

function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export interface LyricsServiceOptions {
  db: Db
  /** The archive's address. Tests point this at nothing and inject `fetchFn`. */
  baseUrl?: string
  /** The seam tests mock the internet through. */
  fetchFn?: typeof fetch
  now?: () => number
}

export class LyricsService {
  readonly #db: Db
  readonly #baseUrl: string
  readonly #fetch: typeof fetch
  readonly #now: () => number
  /** Tracks this run already asked about and found nothing for. */
  readonly #misses = new Set<number>()
  /** One errand per track at a time, however many callers ask. */
  readonly #inFlight = new Map<number, Promise<Lyrics | null>>()

  constructor({
    db,
    baseUrl = 'https://lrclib.net',
    fetchFn = fetch,
    now = Date.now,
  }: LyricsServiceOptions) {
    this.#db = db
    this.#baseUrl = baseUrl.replace(/\/$/, '')
    this.#fetch = fetchFn
    this.#now = now
  }

  /** The words as stored, or null when the track has none written down. */
  get(trackId: number): Lyrics | null {
    const row = this.#db
      .prepare('SELECT * FROM lyrics WHERE track_id = ?')
      .get(trackId) as LyricsRow | undefined
    return row ? { synced: row.synced, plain: row.plain } : null
  }

  /**
   * The words, going as far as the archive to find them.
   *
   * Answers from the table when it can, joins an errand already running when
   * one is, and remembers this run's misses so a listener refreshing all night
   * costs the archive one question. Network trouble is a null, not a throw:
   * the caller is either an upload that has already succeeded or a listener
   * who would rather have no words than an error.
   */
  async fetchFor(subject: LyricsSubject): Promise<Lyrics | null> {
    const stored = this.get(subject.id)
    if (stored) return stored
    if (this.#misses.has(subject.id)) return null

    const running = this.#inFlight.get(subject.id)
    if (running) return running

    const errand = this.#lookup(subject)
      .then((found) => {
        if (found) {
          this.#db
            .prepare(
              `INSERT INTO lyrics (track_id, synced, plain, fetched_at)
               VALUES (@track_id, @synced, @plain, @fetched_at)
               ON CONFLICT(track_id) DO NOTHING`,
            )
            .run({
              track_id: subject.id,
              synced: found.synced,
              plain: found.plain,
              fetched_at: this.#now(),
            })
        } else {
          this.#misses.add(subject.id)
        }
        return found
      })
      .catch(() => null)
      .finally(() => {
        this.#inFlight.delete(subject.id)
      })

    this.#inFlight.set(subject.id, errand)
    return errand
  }

  /** Drop what was written about tracks that no longer exist. For the wipe. */
  forgetAll(): void {
    this.#db.prepare('DELETE FROM lyrics').run()
  }

  /**
   * Ask the archive. The precise lookup first — it matches on all four fields
   * including duration, so a hit is the right recording — then the search
   * fallback for tracks whose tags don't quite agree with the archive's,
   * taking the closest duration that is plausibly the same recording.
   */
  async #lookup(subject: LyricsSubject): Promise<Lyrics | null> {
    const durationS = Math.round(subject.durationMs / 1000)

    const exact = new URLSearchParams({ track_name: subject.title, duration: String(durationS) })
    if (subject.artist) exact.set('artist_name', subject.artist)
    if (subject.album) exact.set('album_name', subject.album)
    const direct = await this.#ask(`/api/get?${exact}`)
    if (direct !== null && !Array.isArray(direct)) {
      const lyrics = toLyrics(direct)
      if (lyrics) return lyrics
    }

    const loose = new URLSearchParams({ track_name: subject.title })
    if (subject.artist) loose.set('artist_name', subject.artist)
    const results = await this.#ask(`/api/search?${loose}`)
    if (!Array.isArray(results)) return null

    const candidates = results
      .map((record) => ({ record, lyrics: toLyrics(record) }))
      .filter((c): c is { record: LrclibRecord; lyrics: Lyrics } => c.lyrics !== null)
      .filter(
        (c) =>
          typeof c.record.duration === 'number' &&
          Math.abs(c.record.duration - durationS) <= DURATION_TOLERANCE_S,
      )
      // Timestamped words beat plain ones, then the nearest duration wins.
      .sort(
        (a, b) =>
          Number(b.lyrics.synced !== null) - Number(a.lyrics.synced !== null) ||
          Math.abs((a.record.duration ?? 0) - durationS) -
            Math.abs((b.record.duration ?? 0) - durationS),
      )
    return candidates[0]?.lyrics ?? null
  }

  /** One request to the archive: JSON on 200, null on anything else at all. */
  async #ask(pathAndQuery: string): Promise<LrclibRecord | LrclibRecord[] | null> {
    try {
      const response = await this.#fetch(`${this.#baseUrl}${pathAndQuery}`, {
        headers: { 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      })
      if (!response.ok) return null
      return (await response.json()) as LrclibRecord | LrclibRecord[]
    } catch {
      return null
    }
  }
}

/**
 * What the archive said, reduced to words worth keeping. An instrumental comes
 * back with both fields empty and lands as a miss, which is right: there are
 * no words to show, and asking again next run costs one request.
 */
function toLyrics(record: LrclibRecord): Lyrics | null {
  const synced = cleanText(record.syncedLyrics)
  const plain = cleanText(record.plainLyrics)
  if (!synced && !plain) return null
  return { synced, plain }
}
