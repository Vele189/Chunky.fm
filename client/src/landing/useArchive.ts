import { useEffect, useMemo, useState } from 'react'
import {
  type Episode,
  episodePath,
  episodePosterUrl,
  formatDate,
  formatLength,
  paragraphs,
  subtitleFor,
} from '../lib/episodes.js'
import { type Invented, KEPT } from './session.js'

/**
 * The archive, on the page in front of the station.
 *
 * The second true thing on this page, after `NextSession`, and it is true for
 * the same reason: `GET /api/episodes` is **open**, on a station where every
 * other read is behind a door. See the podcast archive's own note in the
 * README — an episode is public by design, meant to be pasted into a message
 * and read by a crawler, so a landing page asking for the list is asking for
 * something already addressed to strangers.
 *
 * Unlike `NextSession`, this one **falls back rather than disappearing**. A
 * poster is a single announcement and a page with nothing announced should
 * simply not have that block on it; this is a whole section making the case
 * that the station keeps things, and a case that vanishes when the station is
 * unreachable is a case missing on the one day the page has to make it alone.
 *
 * So: real episodes when the station answers, an invented three when it does
 * not, and the section is told which it got. What that changes is in the
 * section, not here — the invented ones are drawn inert and `aria-hidden`,
 * because a card that looks like an episode and leads to a 404 is worse than
 * no card. See `KEPT` in session.ts.
 *
 * Both shapes are normalised to one here rather than in the component. A card
 * that had to ask "am I an episode or am I a fixture" at every field would
 * carry the fallback all the way into the markup, and the two would drift the
 * first time either changed.
 */

/**
 * How many the strip shows.
 *
 * The archive route hands back everything it has (up to its own ceiling) and
 * this is a strip on somebody else's page, not the archive itself. Six is a
 * row and a half at every width the section has, which is enough to read as a
 * shelf with more behind it — and the link beside them goes to all of them.
 */
const MOST = 6

/** Milliseconds in a week, for dating the invented ones from today. */
const WEEK = 7 * 24 * 60 * 60 * 1000

/** One card in the strip, whichever kind of archive it came from. */
export interface ArchiveCard {
  key: string
  title: string
  /** "Ep. 6 · with Lerato", or null when there is nothing to say. */
  sub: string | null
  when: string
  length: string
  notes: string[]
  poster: string | null
  /**
   * Where it is, or null for the invented ones.
   *
   * Null is what makes a fixture inert. The section reads this rather than a
   * flag of its own, so there is exactly one thing to get wrong and it is
   * spelled the same way in both branches below.
   */
  href: string | null
}

export interface Archive {
  cards: ArchiveCard[]
  /** Whether the station answered. Drives what the section says, not how it looks. */
  real: boolean
}

/** The one fetch this section makes. Anything other than an answer is a fixture. */
async function fetchEpisodes(signal: AbortSignal): Promise<Episode[] | null> {
  try {
    const response = await fetch('/api/episodes', { signal })
    if (!response.ok) return null
    const body = (await response.json()) as { episodes?: Episode[] }
    return body.episodes ?? null
  } catch {
    return null
  }
}

/**
 * The two shapes, flattened to the one the card draws.
 *
 * Exported for the same reason `session.ts` keeps its arithmetic apart from the
 * components: the interesting part of this file is what an episode and a
 * fixture each turn into, and that is a pair of pure functions that can be
 * asked without a window. See test/archive.test.ts.
 */
export function fromEpisode(episode: Episode): ArchiveCard {
  return {
    key: episode.slug,
    title: episode.title,
    sub: subtitleFor(episode),
    when: formatDate(episode.publishedAt),
    length: formatLength(episode.durationMs),
    notes: paragraphs(episode.notes),
    poster: episodePosterUrl(episode),
    href: episodePath(episode.slug),
  }
}

export function fromFixture(kept: Invented, now: number): ArchiveCard {
  const parts: string[] = [`Ep. ${kept.number}`]
  if (kept.guests) parts.push(`with ${kept.guests}`)

  return {
    key: `kept-${kept.number}`,
    title: kept.title,
    // Spelled out rather than run through `subtitleFor`, which takes an
    // `Episode`: building half a row of an API shape to borrow one string is
    // how a fixture ends up having to grow a slug and a byte count.
    sub: parts.join(' · '),
    when: formatDate(now - kept.weeksAgo * WEEK, now),
    length: formatLength(kept.minutes * 60_000),
    notes: paragraphs(kept.notes),
    // No artwork. There is no poster for an episode that does not exist, and
    // putting a real record's sleeve on an invented conversation would be the
    // page borrowing somebody's cover to illustrate a thing that never
    // happened. The card draws a title where the picture would be; a real
    // episode with no poster takes the same path.
    poster: null,
    href: null,
  }
}

export function useArchive(): Archive {
  const [episodes, setEpisodes] = useState<Episode[] | null>(null)

  useEffect(() => {
    const stop = new AbortController()
    void fetchEpisodes(stop.signal).then(setEpisodes)
    return () => stop.abort()
  }, [])

  return useMemo(() => {
    // An empty archive is a station with nothing published yet, which reads to
    // a visitor exactly like a station that could not be reached: either way
    // there is nothing to show, and the invented three are what the section is
    // for. The words beside them are the same in both cases.
    if (episodes === null || episodes.length === 0) {
      const now = Date.now()
      return { cards: KEPT.map((kept) => fromFixture(kept, now)), real: false }
    }
    return { cards: episodes.slice(0, MOST).map(fromEpisode), real: true }
  }, [episodes])
}
