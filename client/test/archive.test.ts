import { describe, expect, it } from 'vitest'
import type { Episode } from '../src/lib/episodes.js'
import { KEPT } from '../src/landing/session.js'
import { fromEpisode, fromFixture } from '../src/landing/useArchive.js'

function makeEpisode(overrides: Partial<Episode> = {}): Episode {
  return {
    id: 1,
    slug: 'leaving-johannesburg',
    title: 'Leaving Johannesburg',
    notes: null,
    guests: null,
    episodeNumber: null,
    publishedAt: Date.UTC(2026, 2, 14, 12),
    status: 'published',
    durationMs: 48 * 60_000,
    videoUrl: 'https://media.example.test/video/abc.mp4',
    videoType: 'video/mp4',
    videoBytes: 42 * 1024 * 1024,
    transcodeStatus: 'ready',
    poster: 'b7f3.png',
    thumbnail: 'still.jpg',
    hasTranscript: false,
    uploadedAt: Date.UTC(2026, 2, 14, 12),
    ...overrides,
  }
}

/**
 * The half of the archive strip that comes from the station. Whatever else
 * changes about the section, a real episode has to arrive on a card carrying
 * the address somebody can go to.
 */
describe('a real episode, on the shelf', () => {
  it('keeps the address the archive gave it', () => {
    const card = fromEpisode(makeEpisode({ slug: 'what-a-song-is-for' }))
    expect(card.href).toBe('/podcast/what-a-song-is-for')
  })

  it('reads its facts the way the archive’s own cards do', () => {
    const card = fromEpisode(
      makeEpisode({ episodeNumber: 6, guests: 'Lerato', durationMs: 74 * 60_000 }),
    )
    expect(card.sub).toBe('Ep. 6 · with Lerato')
    expect(card.length).toBe('1 hr 14 min')
  })

  it('has a poster to draw, and says so where there is none', () => {
    expect(fromEpisode(makeEpisode()).poster).toBe('/api/episode-poster/b7f3.png')
    expect(fromEpisode(makeEpisode({ poster: null })).poster).toBeNull()
  })

  it('breaks the notes where the show notes were broken', () => {
    const card = fromEpisode(makeEpisode({ notes: 'One thing.\n\nThen another.' }))
    expect(card.notes).toEqual(['One thing.', 'Then another.'])
  })
})

/**
 * The other half, and the one that has to be unmistakable: these stand in for
 * episodes on a page that could not reach the station, and the whole safety of
 * doing that at all rests on them going nowhere.
 */
describe('the invented archive', () => {
  const now = Date.UTC(2026, 8, 4, 12)

  it('leads nowhere, so no card can land on a 404', () => {
    for (const kept of KEPT) {
      expect(fromFixture(kept, now).href).toBeNull()
    }
  })

  it('borrows nobody’s artwork', () => {
    for (const kept of KEPT) {
      expect(fromFixture(kept, now).poster).toBeNull()
    }
  })

  it('is dated from today, so it never reads as stale', () => {
    // Two weeks back from the 4th of September is the 21st of August, whatever
    // year this is being read in. A written-down date in the fixture would be
    // wrong by next year and nobody would notice.
    const card = fromFixture({ ...KEPT[0]!, weeksAgo: 2 }, now)
    expect(card.when).toBe(new Date(Date.UTC(2026, 7, 21, 12)).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
    }))
  })

  it('is newest first, like the archive it stands in for', () => {
    const numbers = KEPT.map((kept) => kept.number)
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a))

    const ages = KEPT.map((kept) => kept.weeksAgo)
    expect(ages).toEqual([...ages].sort((a, b) => a - b))
  })

  it('numbers each episode once', () => {
    expect(new Set(KEPT.map((kept) => kept.number)).size).toBe(KEPT.length)
  })

  it('says something under every title', () => {
    for (const kept of KEPT) {
      const card = fromFixture(kept, now)
      expect(card.sub).toContain(`Ep. ${kept.number}`)
      expect(card.notes.length).toBeGreaterThan(0)
    }
  })
})
