import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CONSOLE_HASH,
  type Episode,
  EpisodeApi,
  PODCAST_PATH,
  formatBytes,
  episodePath,
  episodePosterUrl,
  formatDate,
  formatLength,
  formatPosition,
  paragraphs,
  routeFrom,
  slugInPath,
  subtitleFor,
  uploadVideo,
} from '../src/lib/episodes.js'

const at = (pathname: string, hash = '') => ({ pathname, hash })

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

describe('slugInPath', () => {
  it('reads the slug out of an episode address', () => {
    expect(slugInPath('/podcast/leaving-johannesburg')).toBe('leaving-johannesburg')
  })

  it('reads the archive itself as no slug', () => {
    expect(slugInPath('/podcast')).toBeNull()
    // A trailing slash is the archive rather than an episode with no name, the
    // same call `doorway` makes on the server.
    expect(slugInPath('/podcast/')).toBeNull()
  })

  it('is not fooled by a path that merely starts with the same letters', () => {
    expect(slugInPath('/podcastly')).toBeNull()
    expect(slugInPath('/podcasts/thing')).toBeNull()
  })

  it('refuses to guess at an address with too many parts', () => {
    // `/podcast/a/b` is not an address this app mints. Reading it as the
    // episode `a` would land somebody on the wrong page with no sign of it.
    expect(slugInPath('/podcast/a/b')).toBeNull()
  })

  it('decodes a slug that arrived escaped', () => {
    expect(slugInPath('/podcast/leaving%2Djohannesburg')).toBe('leaving-johannesburg')
  })

  it('survives a malformed escape rather than throwing', () => {
    // `decodeURIComponent` throws on a lone `%`. A bad link should be a 404,
    // not a blank page from an exception thrown during the first render.
    expect(() => slugInPath('/podcast/what%')).not.toThrow()
    expect(slugInPath('/podcast/what%')).toBe('what%')
  })
})

describe('routeFrom', () => {
  it('lands on the grid at the archive', () => {
    expect(routeFrom(at(PODCAST_PATH))).toEqual({ kind: 'grid' })
  })

  it('reads an episode off the path', () => {
    expect(routeFrom(at('/podcast/leaving-johannesburg'))).toEqual({
      kind: 'episode',
      slug: 'leaving-johannesburg',
    })
  })

  it('reads the console off the fragment', () => {
    expect(routeFrom(at(PODCAST_PATH, CONSOLE_HASH))).toEqual({ kind: 'console' })
  })

  it('lets the console win over an episode underneath it', () => {
    // `#admin` is a mode rather than a view: an admin opening the console from
    // an episode page should get the console, not the episode with a fragment
    // stuck on the end of it.
    expect(routeFrom(at('/podcast/leaving-johannesburg', CONSOLE_HASH))).toEqual({
      kind: 'console',
    })
  })
})

describe('episodePath', () => {
  it('is the address a card links to', () => {
    expect(episodePath('leaving-johannesburg')).toBe('/podcast/leaving-johannesburg')
  })

  it('round-trips with slugInPath', () => {
    const slug = 'q-and-a-with-lerato'
    expect(slugInPath(episodePath(slug))).toBe(slug)
  })
})

describe('addresses for the files', () => {
  it('takes the video address from the server rather than building one', () => {
    // The one address this client does not construct. On a station with R2 it
    // is a Cloudflare hostname this app has never heard of; only the server
    // knows which store an episode is in.
    expect(makeEpisode().videoUrl).toBe('https://media.example.test/video/abc.mp4')
    expect(episodePosterUrl(makeEpisode())).toBe('/api/episode-poster/b7f3.png')
  })

  it('answers null for an episode with no poster', () => {
    expect(episodePosterUrl(makeEpisode({ poster: null }))).toBeNull()
  })
})

describe('formatLength', () => {
  it('says whole minutes, which is what a card has room for', () => {
    expect(formatLength(48 * 60_000)).toBe('48 min')
    expect(formatLength(48 * 60_000 + 29_000)).toBe('48 min')
  })

  it('breaks an hour into hours and minutes', () => {
    // "83 min" is a number a reader has to do arithmetic on.
    expect(formatLength(83 * 60_000)).toBe('1 hr 23 min')
    expect(formatLength(120 * 60_000)).toBe('2 hr')
  })

  it('never says an episode lasts no time', () => {
    // Rounding a short episode to "0 min" reads as an error rather than as a
    // short episode.
    expect(formatLength(4_000)).toBe('1 min')
  })
})

describe('formatPosition', () => {
  it('is m:ss below the hour', () => {
    expect(formatPosition(0)).toBe('0:00')
    expect(formatPosition(9)).toBe('0:09')
    expect(formatPosition(634)).toBe('10:34')
  })

  it('grows to h:mm:ss past it', () => {
    expect(formatPosition(3600)).toBe('1:00:00')
    expect(formatPosition(3661)).toBe('1:01:01')
  })

  it('clamps below zero', () => {
    // The remaining-time readout counts down, and float drift at the very end
    // would otherwise flash `-0:00`.
    expect(formatPosition(-0.4)).toBe('0:00')
  })
})

describe('formatDate', () => {
  it('leaves the year off when it is this one', () => {
    const march = Date.UTC(2026, 2, 14, 12)
    const formatted = formatDate(march, Date.UTC(2026, 10, 1, 12))
    expect(formatted).not.toContain('2026')
  })

  it('names the year when it is not', () => {
    const march = Date.UTC(2024, 2, 14, 12)
    expect(formatDate(march, Date.UTC(2026, 10, 1, 12))).toContain('2024')
  })
})

describe('subtitleFor', () => {
  it('joins the number and the guests when there are both', () => {
    expect(subtitleFor(makeEpisode({ episodeNumber: 12, guests: 'Thabo M.' }))).toBe(
      'Ep. 12 · with Thabo M.',
    )
  })

  it('lets either stand alone', () => {
    expect(subtitleFor(makeEpisode({ episodeNumber: 12 }))).toBe('Ep. 12')
    expect(subtitleFor(makeEpisode({ guests: 'Thabo M.' }))).toBe('with Thabo M.')
  })

  it('is null when there is nothing to say', () => {
    // Null rather than an empty string, so a card leaves the line out instead
    // of drawing an empty one that still takes up space.
    expect(subtitleFor(makeEpisode())).toBeNull()
  })
})

describe('paragraphs', () => {
  it('breaks on a blank line and not on a single newline', () => {
    expect(paragraphs('One.\nStill one.\n\nTwo.')).toEqual(['One.\nStill one.', 'Two.'])
  })

  it('is empty for an episode with no notes', () => {
    expect(paragraphs(null)).toEqual([])
    expect(paragraphs('   ')).toEqual([])
  })
})

describe('formatBytes', () => {
  it('says what an upload is about to cost, the way a person reads it', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(64 * 1024)).toBe('64 kB')
    expect(formatBytes(Math.round(4.2 * 1024 * 1024))).toBe('4.2 MB')
    // Past ten megabytes the tenth stops meaning anything on a console.
    expect(formatBytes(512 * 1024 * 1024)).toBe('512 MB')
    // And a master is measured in gigabytes, which is the whole point.
    expect(formatBytes(Math.round(1.5 * 1024 * 1024 * 1024))).toBe('1.50 GB')
  })
})

/**
 * The chunked upload, which is the one path in this file an hour of video has
 * to survive.
 *
 * Driven against a fake store rather than a real one, because what is being
 * checked is the *protocol* — every part sent once, in order, the hash computed
 * over exactly those bytes, and a failure recovered from — and none of that
 * needs a bucket. The parts themselves are the file's own bytes, so a test that
 * sliced them wrongly would show up as a hash that does not match.
 */
describe('uploading an hour of video', () => {
  /** Small enough to be quick, and more than one part, which is the point. */
  const PART = 8 * 1024 * 1024

  /*
   * The part PUTs go through the *global* fetch rather than the API's own, and
   * that is deliberate in the code being tested: a part goes cross-origin to
   * the store and must not carry this app's credentials or headers. So the
   * fake is installed in both places.
   */
  afterEach(() => vi.unstubAllGlobals())

  function fileOf(bytes: number): File {
    const data = new Uint8Array(bytes)
    // Not zeroes: a hash over a megabyte of nothing is the same hash however
    // many of the slices were skipped, which is the bug this would hide.
    for (let i = 0; i < bytes; i++) data[i] = (i * 31 + 7) % 251
    return new File([data], 'talk.mp4', { type: 'video/mp4' })
  }

  interface Store {
    fetch: typeof globalThis.fetch
    puts: { url: string; bytes: number }[]
    signed: number[]
  }

  function store(options: { failPart?: number } = {}): Store {
    const puts: { url: string; bytes: number }[] = []
    const signed: number[] = []
    let failed = false

    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url.endsWith('/api/episodes/uploads') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { bytes: number }
        const partCount = Math.max(1, Math.ceil(body.bytes / PART))
        return Response.json(
          {
            uploadId: 'u1',
            key: 'masters/one.mp4',
            partSize: PART,
            partCount,
            urls: Array.from({ length: partCount }, (_, i) => `https://store.test/part/${i + 1}?minted=first`),
            direct: true,
          },
          { status: 201 },
        )
      }

      // A fresh URL for one part.
      const remint = /\/parts\/(\d+)\/url/.exec(url)
      if (remint) {
        signed.push(Number(remint[1]))
        return Response.json({ url: `https://store.test/part/${remint[1]}?minted=again` })
      }

      if (url.startsWith('https://store.test/part/')) {
        const n = Number(/\/part\/(\d+)/.exec(url)?.[1])
        // One part refuses once, the way an expired credential does.
        if (options.failPart === n && !failed) {
          failed = true
          return new Response(null, { status: 403 })
        }
        const bytes = (init?.body as Uint8Array).byteLength
        puts.push({ url, bytes })
        return new Response(null, { status: 200, headers: { etag: `"etag-${n}"` } })
      }

      throw new Error(`unexpected request: ${url}`)
    }) as typeof globalThis.fetch

    return { fetch, puts, signed }
  }

  /** What the browser's own implementation makes of the same bytes. */
  async function digestOf(file: File): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  it('sends every part once, in order, and hashes exactly what it sent', async () => {
    const file = fileOf(PART * 2 + 1024)
    const fake = store()
    vi.stubGlobal('fetch', fake.fetch)
    const finished = await uploadVideo(new EpisodeApi({ fetch: fake.fetch }), file)

    expect(fake.puts).toHaveLength(3)
    expect(fake.puts.map((put) => put.bytes)).toEqual([PART, PART, 1024])
    expect(finished.parts.map((part) => part.partNumber)).toEqual([1, 2, 3])
    // The hash is computed inside the upload loop now, over the slices as they
    // go; this is the check that it is still the hash of the whole file.
    expect(finished.contentHash).toBe(await digestOf(file))
  })

  it('asks for a fresh URL before retrying a part, which is what an expired one needs', async () => {
    const file = fileOf(PART * 2)
    const fake = store({ failPart: 2 })
    vi.stubGlobal('fetch', fake.fetch)
    const finished = await uploadVideo(new EpisodeApi({ fetch: fake.fetch }), file)

    // Part two was signed again and then went up with the new credential.
    expect(fake.signed).toEqual([2])
    expect(fake.puts.at(-1)?.url).toContain('minted=again')
    expect(finished.parts).toHaveLength(2)
    expect(finished.contentHash).toBe(await digestOf(file))
  })

  it('reports progress against the bytes the store has taken', async () => {
    const file = fileOf(PART + 512)
    const fake = store()
    vi.stubGlobal('fetch', fake.fetch)
    const seen: number[] = []
    await uploadVideo(new EpisodeApi({ fetch: fake.fetch }), file, {
      onProgress: (progress) => seen.push(progress.sent),
    })
    expect(seen.at(0)).toBe(0)
    expect(seen.at(-1)).toBe(file.size)
  })
})

describe('EpisodeApi', () => {
  const episode = makeEpisode()

  function stub(handler: (url: string, init?: RequestInit) => Response) {
    const calls: { url: string; init?: RequestInit }[] = []
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      return handler(url, init)
    }) as typeof globalThis.fetch
    return { fetch, calls }
  }

  it('reads the archive', async () => {
    const { fetch } = stub(() => Response.json({ episodes: [episode] }))
    expect(await new EpisodeApi({ fetch }).list()).toEqual([episode])
  })

  it('answers null for an episode that is not there', async () => {
    // Null rather than a throw: "no episode at that address" is a page this app
    // draws, not an error it reports.
    const { fetch } = stub(() => new Response(null, { status: 404 }))
    expect(await new EpisodeApi({ fetch }).get('gone')).toBeNull()
  })

  it('escapes a slug on its way into the address', async () => {
    const { fetch, calls } = stub(() => Response.json({ episode }))
    await new EpisodeApi({ fetch }).get('a b')
    expect(calls[0]!.url).toBe('/api/episodes/a%20b')
  })

  it('repeats what the station said about a refusal', async () => {
    const { fetch } = stub(() =>
      Response.json(
        { error: 'poster_dimensions', message: 'that one is 900x1200' },
        { status: 422 },
      ),
    )
    await expect(new EpisodeApi({ fetch }).create(new FormData())).rejects.toThrow(
      'that one is 900x1200',
    )
  })

  it('falls back to the status when the body is not this API', async () => {
    // A proxy's HTML error page. Showing somebody a fragment of markup is
    // worse than showing them a number.
    const { fetch } = stub(() => new Response('<html>502</html>', { status: 502 }))
    await expect(new EpisodeApi({ fetch }).list()).rejects.toThrow('502')
  })

  it('never names a content type for the upload', async () => {
    // Multipart needs a boundary in the header that only the browser knows;
    // setting the type by hand is the classic way to send a body the server
    // cannot parse.
    const { fetch, calls } = stub(() => Response.json({ episode }, { status: 201 }))
    await new EpisodeApi({ fetch }).create(new FormData())
    expect(calls[0]!.init?.headers).toBeUndefined()
  })

  it('sends a patch as JSON', async () => {
    const { fetch, calls } = stub(() => Response.json({ episode }))
    await new EpisodeApi({ fetch }).update(1, { status: 'published' })
    expect(calls[0]!.init?.method).toBe('PATCH')
    expect(calls[0]!.init?.body).toBe('{"status":"published"}')
  })
})
