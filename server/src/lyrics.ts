import type { Db, LyricsRow } from './db.js'

/**
 * The lyric sheet: what the station knows the words to.
 *
 * LRCLIB (lrclib.net) is a public, keyless archive of timestamped lyrics, and
 * the upload already extracts exactly the four things its lookup wants: title,
 * artist, album and duration. So the moment a track lands in the library, one
 * background errand asks the archive about it, and whatever comes back is
 * written down against the track. Listeners never talk to LRCLIB. They ask
 * this station, which answers from its own table, so a room of fifty people
 * costs the archive one request, not fifty.
 *
 * A lookup that finds nothing writes nothing, and the misses of a run are only
 * remembered in memory: lyrics get contributed to the archive all the time, so
 * a track nobody knew the words to last month is worth asking about again, and
 * "again" arriving with the next restart is about the right amount of retry.
 * Words with no timings on them are a half-miss and get the same treatment:
 * kept, shown, and quietly asked about once more each run in case a
 * timestamped sheet has turned up since.
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
 * probably a different recording: the album cut when we are holding the live
 * one. The precise `/api/get` lookup does its own matching server-side; this
 * only guards the looser `/api/search` fallback.
 */
const DURATION_TOLERANCE_S = 10

/** One version of the words, with how far its recording is from ours. */
interface Candidate {
  lyrics: Lyrics
  /** Seconds between that recording's length and this track's. */
  distance: number
}

/**
 * Best first: timestamped words beat plain ones outright, and among equals the
 * recording closest to ours wins. A synced sheet written against a cut ten
 * seconds longer drifts further with every chorus.
 */
function bestFirst(a: Candidate, b: Candidate): number {
  return (
    Number(b.lyrics.synced !== null) - Number(a.lyrics.synced !== null) || a.distance - b.distance
  )
}

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
  /** Tracks this run already asked a second time about, hoping for timings. */
  readonly #reasked = new Set<number>()
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
   *
   * A row holding only plain text is not quite an answer, so it gets one more
   * ask per run. The reasoning is the misses' reasoning, for the same reason:
   * timestamped sheets get contributed to the archive all the time, and a
   * track that had none last week is worth asking about again. Whatever comes
   * back, the plain sheet already written down is never lost.
   */
  async fetchFor(subject: LyricsSubject): Promise<Lyrics | null> {
    const stored = this.get(subject.id)
    if (stored?.synced) return stored
    if (stored && this.#reasked.has(subject.id)) return stored
    if (!stored && this.#misses.has(subject.id)) return null

    const running = this.#inFlight.get(subject.id)
    if (running) return running

    const errand = this.#lookup(subject)
      .then((found) => {
        if (found) this.#write(subject.id, found)
        if (stored) {
          this.#reasked.add(subject.id)
          // The table is the authority on what we now hold: the write above
          // only takes an upgrade, so re-reading it is how we say so.
          return this.get(subject.id) ?? stored
        }
        if (!found) this.#misses.add(subject.id)
        return found
      })
      .catch(() => stored)
      .finally(() => {
        this.#inFlight.delete(subject.id)
      })

    this.#inFlight.set(subject.id, errand)
    return errand
  }

  /**
   * Write the words down, but never write over words that are already better
   * than these. A row with timestamps stands; a plain-only row is replaced
   * only by a find that has the timings it lacked, and even then it keeps its
   * own plain text if the newcomer brought none.
   */
  #write(trackId: number, found: Lyrics): void {
    this.#db
      .prepare(
        `INSERT INTO lyrics (track_id, synced, plain, fetched_at)
         VALUES (@track_id, @synced, @plain, @fetched_at)
         ON CONFLICT(track_id) DO UPDATE SET
           synced     = excluded.synced,
           plain      = COALESCE(excluded.plain, lyrics.plain),
           fetched_at = excluded.fetched_at
         WHERE lyrics.synced IS NULL AND excluded.synced IS NOT NULL`,
      )
      .run({
        track_id: trackId,
        synced: found.synced,
        plain: found.plain,
        fetched_at: this.#now(),
      })
  }

  /** Drop what was written about tracks that no longer exist. For the wipe. */
  forgetAll(): void {
    this.#db.prepare('DELETE FROM lyrics').run()
  }

  /**
   * Ask the archive, and keep asking until the words have a clock on them.
   *
   * The precise `/api/get` lookup goes first: it matches on all four fields
   * including duration, so a hit is the right recording. But it answers with
   * one record, and the record filed under our exact tags is often somebody's
   * plain-text contribution while a timestamped sheet for the same song sits
   * one album name or two seconds away. So a plain-only hit is a floor, not an
   * answer: the search runs anyway, and only what it turns up decides.
   *
   * The searches stop the moment timestamped words are in hand, which for the
   * common case (the exact lookup already synced) means no search at all.
   */
  async #lookup(subject: LyricsSubject): Promise<Lyrics | null> {
    const durationS = Math.round(subject.durationMs / 1000)
    const candidates: Candidate[] = []

    const exact = new URLSearchParams({ track_name: subject.title, duration: String(durationS) })
    if (subject.artist) exact.set('artist_name', subject.artist)
    if (subject.album) exact.set('album_name', subject.album)
    const direct = await this.#ask(`/api/get?${exact}`)
    if (direct !== null && !Array.isArray(direct)) {
      const lyrics = toLyrics(direct)
      // The archive matched the duration itself, so this is our recording.
      if (lyrics) candidates.push({ lyrics, distance: 0 })
    }

    for (const query of searchQueries(subject)) {
      if (candidates.some((c) => c.lyrics.synced !== null)) break
      const results = await this.#ask(`/api/search?${query}`)
      if (Array.isArray(results)) candidates.push(...gather(results, durationS))
    }

    candidates.sort(bestFirst)
    const best = candidates[0]
    if (!best) return null
    // A synced winner that arrived without plain text still borrows the plain
    // sheet another candidate had: two ways of reading the same song, both kept.
    const plain = candidates.find((c) => c.lyrics.plain !== null)?.lyrics.plain ?? null
    return { synced: best.lyrics.synced, plain: best.lyrics.plain ?? plain }
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
 * The searches worth trying, narrowest first, and only as far down the list as
 * it takes to find timestamped words.
 *
 * The first is the fielded search: same title and artist as the tags claim,
 * every version the archive holds of it. The second is the free-text one, for
 * tags the archive spells differently: a featured artist in the title field,
 * a remaster suffix, "&" against "and". It is looser, so it is asked second
 * and only when the first came back with nothing timestamped.
 */
function searchQueries(subject: LyricsSubject): string[] {
  const fielded = new URLSearchParams({ track_name: subject.title })
  if (subject.artist) fielded.set('artist_name', subject.artist)
  const queries = [String(fielded)]

  if (subject.artist) {
    queries.push(String(new URLSearchParams({ q: `${subject.title} ${subject.artist}` })))
  }
  return queries
}

/** Search results reduced to versions that are plausibly this recording. */
function gather(results: LrclibRecord[], durationS: number): Candidate[] {
  const candidates: Candidate[] = []
  for (const record of results) {
    const lyrics = toLyrics(record)
    // No length, no way to tell the single from the twelve-minute live cut.
    if (!lyrics || typeof record.duration !== 'number') continue
    const distance = Math.abs(record.duration - durationS)
    if (distance > DURATION_TOLERANCE_S) continue
    candidates.push({ lyrics, distance })
  }
  return candidates
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
