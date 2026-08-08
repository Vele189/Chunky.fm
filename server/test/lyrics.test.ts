import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LyricsService } from '../src/lyrics.js'
import { openDb } from '../src/db.js'
import {
  type Harness,
  fixture,
  listDir,
  multipartBody,
  multipartHeaders,
  signIn,
  startHarness,
} from './helpers.js'

/** LRCLIB's shape, as the probe against the real archive showed it. */
function archiveRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    trackName: 'Test Track',
    artistName: 'Test Artist',
    albumName: 'Test Album',
    duration: 240,
    instrumental: false,
    plainLyrics: 'so you think you can tell',
    syncedLyrics: '[00:05.69] so you think you can tell',
    ...overrides,
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * An archive that answers from a script and writes down what it was asked.
 * `answers` maps a path prefix ('/api/get' or '/api/search') to a response.
 */
function fakeArchive(answers: Record<string, () => Response>) {
  const asked: string[] = []
  const fetchFn: typeof fetch = async (input) => {
    const url = String(input)
    asked.push(url)
    const key = Object.keys(answers).find((prefix) => url.includes(prefix))
    return key ? answers[key]!() : new Response(null, { status: 404 })
  }
  return { asked, fetchFn }
}

const SUBJECT = {
  id: 1,
  title: 'Test Track',
  artist: 'Test Artist',
  album: 'Test Album',
  durationMs: 240_000,
}

describe('LyricsService', () => {
  it('asks the precise lookup, stores what it finds, and never asks twice', async () => {
    const db = openDb(':memory:')
    const archive = fakeArchive({ '/api/get': () => json(archiveRecord()) })
    const lyrics = new LyricsService({ db, baseUrl: 'http://archive', fetchFn: archive.fetchFn })

    const found = await lyrics.fetchFor(SUBJECT)
    expect(found).toEqual({
      synced: '[00:05.69] so you think you can tell',
      plain: 'so you think you can tell',
    })
    // Written down: the table answers now, and the archive is left alone.
    expect(lyrics.get(1)).toEqual(found)
    await lyrics.fetchFor(SUBJECT)
    expect(archive.asked).toHaveLength(1)
    // All four fields went with the question.
    expect(archive.asked[0]).toContain('track_name=Test+Track')
    expect(archive.asked[0]).toContain('artist_name=Test+Artist')
    expect(archive.asked[0]).toContain('album_name=Test+Album')
    expect(archive.asked[0]).toContain('duration=240')
    db.close()
  })

  it('falls back to search and takes a synced match near the right duration', async () => {
    const db = openDb(':memory:')
    const archive = fakeArchive({
      '/api/get': () => new Response(null, { status: 404 }),
      '/api/search': () =>
        json([
          // The album cut: closer in name, minutes off in length.
          archiveRecord({ duration: 471, syncedLyrics: '[00:01.00] wrong recording' }),
          // Plain-only but the right length.
          archiveRecord({ duration: 238, syncedLyrics: null, plainLyrics: 'just words' }),
          // Synced and near enough: this is the one.
          archiveRecord({ duration: 243, syncedLyrics: '[00:02.00] the right one' }),
        ]),
    })
    const lyrics = new LyricsService({ db, baseUrl: 'http://archive', fetchFn: archive.fetchFn })

    const found = await lyrics.fetchFor(SUBJECT)
    expect(found?.synced).toBe('[00:02.00] the right one')
    db.close()
  })

  it('keeps looking when the precise lookup only knows the words, not the timings', async () => {
    const db = openDb(':memory:')
    const archive = fakeArchive({
      // Filed under our exact tags, but somebody typed it out by hand.
      '/api/get': () => json(archiveRecord({ syncedLyrics: null, plainLyrics: 'just words' })),
      '/api/search': () =>
        json([archiveRecord({ duration: 241, syncedLyrics: '[00:02.00] with timings' })]),
    })
    const lyrics = new LyricsService({ db, baseUrl: 'http://archive', fetchFn: archive.fetchFn })

    const found = await lyrics.fetchFor(SUBJECT)
    expect(found?.synced).toBe('[00:02.00] with timings')
    expect(archive.asked).toHaveLength(2)
    db.close()
  })

  it('borrows the plain sheet when the synced winner arrived without one', async () => {
    const db = openDb(':memory:')
    const archive = fakeArchive({
      '/api/get': () => json(archiveRecord({ syncedLyrics: null, plainLyrics: 'just words' })),
      '/api/search': () =>
        json([
          archiveRecord({ duration: 241, syncedLyrics: '[00:02.00] timed', plainLyrics: null }),
        ]),
    })
    const lyrics = new LyricsService({ db, baseUrl: 'http://archive', fetchFn: archive.fetchFn })

    expect(await lyrics.fetchFor(SUBJECT)).toEqual({
      synced: '[00:02.00] timed',
      plain: 'just words',
    })
    db.close()
  })

  it('tries the free-text search when the fielded one turns up nothing timed', async () => {
    const db = openDb(':memory:')
    let searches = 0
    const archive = fakeArchive({
      '/api/get': () => new Response(null, { status: 404 }),
      '/api/search': () => {
        searches += 1
        return searches === 1
          ? json([archiveRecord({ syncedLyrics: null, plainLyrics: 'just words' })])
          : json([archiveRecord({ duration: 240, syncedLyrics: '[00:03.00] found at last' })])
      },
    })
    const lyrics = new LyricsService({ db, baseUrl: 'http://archive', fetchFn: archive.fetchFn })

    const found = await lyrics.fetchFor(SUBJECT)
    expect(found?.synced).toBe('[00:03.00] found at last')
    expect(archive.asked[2]).toContain('q=Test+Track+Test+Artist')
    db.close()
  })

  it('asks once more for timings the stored sheet lacks, and upgrades in place', async () => {
    const db = openDb(':memory:')
    let synced: string | null = null
    const archive = fakeArchive({
      '/api/get': () => json(archiveRecord({ syncedLyrics: synced, plainLyrics: 'just words' })),
      '/api/search': () => json([]),
    })
    const lyrics = new LyricsService({ db, baseUrl: 'http://archive', fetchFn: archive.fetchFn })

    expect(await lyrics.fetchFor(SUBJECT)).toEqual({ synced: null, plain: 'just words' })

    // Somebody contributes a timestamped sheet; the next ask this run finds it.
    synced = '[00:04.00] timed at last'
    expect(await lyrics.fetchFor(SUBJECT)).toEqual({ synced, plain: 'just words' })
    expect(lyrics.get(1)?.synced).toBe(synced)

    // And now that it has timings it is settled: no further asks.
    const before = archive.asked.length
    await lyrics.fetchFor(SUBJECT)
    expect(archive.asked).toHaveLength(before)
    db.close()
  })

  it('asks a plain-only track no more than twice a run', async () => {
    const db = openDb(':memory:')
    const archive = fakeArchive({
      '/api/get': () => json(archiveRecord({ syncedLyrics: null, plainLyrics: 'just words' })),
      '/api/search': () => json([]),
    })
    const lyrics = new LyricsService({ db, baseUrl: 'http://archive', fetchFn: archive.fetchFn })

    await lyrics.fetchFor(SUBJECT)
    await lyrics.fetchFor(SUBJECT)
    const settled = archive.asked.length
    await lyrics.fetchFor(SUBJECT)
    await lyrics.fetchFor(SUBJECT)
    expect(archive.asked).toHaveLength(settled)
    expect(lyrics.get(1)).toEqual({ synced: null, plain: 'just words' })
    db.close()
  })

  it('remembers a miss for the run instead of hammering the archive', async () => {
    const db = openDb(':memory:')
    const archive = fakeArchive({})
    const lyrics = new LyricsService({ db, baseUrl: 'http://archive', fetchFn: archive.fetchFn })

    expect(await lyrics.fetchFor(SUBJECT)).toBeNull()
    expect(await lyrics.fetchFor(SUBJECT)).toBeNull()
    // One get and both searches: the second ask never left the process.
    expect(archive.asked).toHaveLength(3)
    expect(lyrics.get(1)).toBeNull()
    db.close()
  })

  it('treats network trouble as a miss rather than an error', async () => {
    const db = openDb(':memory:')
    const lyrics = new LyricsService({
      db,
      baseUrl: 'http://archive',
      fetchFn: async () => {
        throw new Error('the internet is down')
      },
    })
    expect(await lyrics.fetchFor(SUBJECT)).toBeNull()
    db.close()
  })
})

describe('GET /api/lyrics/:trackId', () => {
  let harness: Harness

  afterEach(() => harness.cleanup())

  async function uploadTagged(): Promise<number> {
    const cookie = await signIn(harness)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/upload',
      headers: { ...multipartHeaders(), cookie },
      payload: multipartBody([
        {
          name: 'file',
          filename: 'tagged.mp3',
          contentType: 'audio/mpeg',
          data: await fixture('tagged.mp3'),
        },
      ]),
    })
    expect(res.statusCode).toBe(201)
    return (res.json() as { track: { id: number } }).track.id
  }

  it('answers with the words once the upload errand has written them down', async () => {
    harness = await startHarness(undefined, {
      lyricsFetch: async (input) =>
        String(input).includes('/api/get')
          ? json(archiveRecord())
          : new Response(null, { status: 404 }),
    })
    const trackId = await uploadTagged()

    // The lookup rides behind the upload response; give the errand its tick.
    await expect
      .poll(() => harness.lyrics.get(trackId), { timeout: 2000 })
      .not.toBeNull()

    const res = await harness.app.inject({ url: `/api/lyrics/${trackId}` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      lyrics: {
        synced: '[00:05.69] so you think you can tell',
        plain: 'so you think you can tell',
      },
    })
  })

  it('404s a track that exists but has no words, and one that does not exist', async () => {
    harness = await startHarness()
    const trackId = await uploadTagged()

    const none = await harness.app.inject({ url: `/api/lyrics/${trackId}` })
    expect(none.statusCode).toBe(404)
    expect(none.json()).toMatchObject({ error: 'no_lyrics' })

    const unknown = await harness.app.inject({ url: '/api/lyrics/9999' })
    expect(unknown.statusCode).toBe(404)
    expect(unknown.json()).toMatchObject({ error: 'unknown_track' })
  })

  it('is gated like the audio on a private station', async () => {
    harness = await startHarness({ stationKey: 'sesame' })
    const refused = await harness.app.inject({ url: '/api/lyrics/1' })
    expect(refused.statusCode).toBe(401)
  })
})

describe('ending a session empties the library', () => {
  let harness: Harness

  afterEach(() => harness.cleanup())

  it('deletes every track row, its files and its lyrics, and spares later uploads', async () => {
    harness = await startHarness(undefined, {
      lyricsFetch: async (input) =>
        String(input).includes('/api/get')
          ? json(archiveRecord())
          : new Response(null, { status: 404 }),
    })
    const cookie = await signIn(harness)

    const upload = async (name: string, contentType: string) => {
      const res = await harness.app.inject({
        method: 'POST',
        url: '/api/upload',
        headers: { ...multipartHeaders(), cookie },
        payload: multipartBody([
          { name: 'file', filename: name, contentType, data: await fixture(name) },
        ]),
      })
      expect(res.statusCode).toBe(201)
      return (res.json() as { track: { id: number } }).track.id
    }

    const trackId = await upload('tagged.mp3', 'audio/mpeg')
    await upload('untagged.flac', 'audio/flac')
    await expect
      .poll(() => harness.lyrics.get(trackId), { timeout: 2000 })
      .not.toBeNull()
    expect(await listDir(harness.config.audioDir)).toHaveLength(2)

    harness.air.end()

    // The wipe rides behind the air change, not on it, so poll it settled.
    await expect
      .poll(() => harness.db.prepare('SELECT COUNT(*) AS n FROM tracks').get(), { timeout: 2000 })
      .toEqual({ n: 0 })
    await expect.poll(() => listDir(harness.config.audioDir), { timeout: 2000 }).toEqual([])
    expect(await listDir(harness.config.artworkDir)).toEqual([])
    expect(harness.db.prepare('SELECT COUNT(*) AS n FROM lyrics').get()).toEqual({ n: 0 })

    // The wipe is a moment, not a state: a track uploaded after it (the next
    // set being prepped) lands in the emptied library and stays there.
    const nextId = await upload('tagged.mp3', 'audio/mpeg')
    expect(nextId).toBeGreaterThan(trackId)
    expect(harness.db.prepare('SELECT COUNT(*) AS n FROM tracks').get()).toEqual({ n: 1 })
    expect(await listDir(harness.config.audioDir)).toHaveLength(1)
  })
})
