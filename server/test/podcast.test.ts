import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EpisodeRow } from '../src/db.js'
import type { Episode } from '../src/lib/episode.js'
import {
  ADMIN_PASSWORD,
  type Harness,
  fixture,
  listDir,
  multipartBody,
  multipartHeaders,
  startHarness,
} from './helpers.js'

/**
 * The podcast archive.
 *
 * The assertion this file exists for is the last one in it: ending a broadcast
 * empties the library, and it must not touch an episode. Everything above that
 * is the ordinary shape of a resource — who may write, what is refused, what a
 * draft is — and it is all in service of that one, because an archive that
 * deletes itself on a Tuesday evening is not an archive.
 */

let harness: Harness

const authHeaders = { authorization: `Bearer ${ADMIN_PASSWORD}` }

/**
 * A real PNG header at whatever size is asked for.
 *
 * A signature and one IHDR chunk with a correct CRC, and nothing after it. That
 * is not a complete PNG — there is no image data — and it is exactly the part
 * the station reads: `lib/poster.ts` parses the header and never decodes a
 * pixel, so this exercises the real path rather than standing in for it. It
 * also means a test can ask for 900x1200 without anybody having to keep a
 * wrong-sized picture in the fixtures directory.
 */
function pngOf(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // truecolour with alpha
  const type = Buffer.from('IHDR', 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(ihdr.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([type, ihdr])))
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    length,
    type,
    ihdr,
    crc,
  ])
}

/** The one in the PNG spec. Small enough to write out rather than depend on. */
function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** A poster of the one size the archive accepts. */
const goodPoster = () => pngOf(1080, 1350)

interface UploadOptions {
  audio?: { filename: string; contentType: string; data: Buffer } | null
  poster?: { filename: string; contentType: string; data: Buffer } | null
  fields?: Record<string, string>
  headers?: Record<string, string>
  /** Skip the chunked upload and finish with these, to test the refusals. */
  finishWith?: Record<string, string>
}

/**
 * Put the audio in the store, the way the console does.
 *
 * Three steps, and the test drives all three rather than shortcutting to the
 * end: begin, PUT each part, and hand the receipts back at completion. That is
 * the whole point of the disk backend implementing the same multipart protocol
 * R2 does — the path under test here is the path production runs.
 */
async function putAudio(
  h: Harness,
  audio: { filename: string; contentType: string; data: Buffer },
  headers: Record<string, string> = authHeaders,
): Promise<{ uploadId: string; key: string; parts: unknown[]; contentHash: string } | number> {
  const begun = await h.app.inject({
    method: 'POST',
    url: '/api/episodes/uploads',
    headers,
    payload: {
      bytes: audio.data.length,
      filename: audio.filename,
      contentType: audio.contentType,
    },
  })
  if (begun.statusCode !== 201) return begun.statusCode

  const { uploadId, key, partSize, urls } = begun.json() as {
    uploadId: string
    key: string
    partSize: number
    urls: string[]
  }

  const parts: { partNumber: number; etag: string }[] = []
  for (let i = 0; i < urls.length; i++) {
    const slice = audio.data.subarray(i * partSize, (i + 1) * partSize)
    const put = await h.app.inject({
      method: 'PUT',
      url: urls[i]!,
      headers: { ...headers, 'content-type': 'application/octet-stream' },
      payload: slice,
    })
    if (put.statusCode !== 200) return put.statusCode
    parts.push({ partNumber: i + 1, etag: (put.json() as { etag: string }).etag })
  }

  return {
    uploadId,
    key,
    parts,
    contentHash: createHash('sha256').update(audio.data).digest('hex'),
  }
}

async function upload(h: Harness, options: UploadOptions = {}) {
  const audio =
    options.audio === undefined
      ? { filename: 'tagged.mp3', contentType: 'audio/mpeg', data: await fixture('tagged.mp3') }
      : options.audio
  const poster =
    options.poster === undefined
      ? { filename: 'poster.png', contentType: 'image/png', data: goodPoster() }
      : options.poster
  const headers = options.headers ?? authHeaders

  let audioFields: Record<string, string> = {}
  if (options.finishWith) {
    audioFields = options.finishWith
  } else if (audio) {
    const put = await putAudio(h, audio, headers)
    if (typeof put === 'number') {
      // The upload itself was refused; hand the status back in the shape the
      // caller asserts on.
      return { statusCode: put, json: () => ({ error: 'upload_refused' }) } as never
    }
    audioFields = {
      uploadId: put.uploadId,
      key: put.key,
      contentHash: put.contentHash,
      parts: JSON.stringify(put.parts),
      contentType: audio.contentType,
    }
  }

  const parts = [
    ...Object.entries({
      ...(options.fields ?? { title: 'Leaving Johannesburg' }),
      ...audioFields,
    }).map(([name, data]) => ({ name, data })),
    ...(poster ? [{ name: 'poster', ...poster }] : []),
  ]

  return h.app.inject({
    method: 'POST',
    url: '/api/episodes',
    headers: { ...multipartHeaders(), ...headers },
    payload: multipartBody(parts),
  })
}

function episodeRows(h: Harness): EpisodeRow[] {
  return h.db.prepare('SELECT * FROM episodes ORDER BY id').all() as EpisodeRow[]
}

/** Upload and publish in one go, for the tests that are about the read side. */
async function publish(h: Harness, fields: Record<string, string> = {}): Promise<Episode> {
  const res = await upload(h, { fields: { title: 'Leaving Johannesburg', ...fields } })
  expect(res.statusCode).toBe(201)
  const { episode } = res.json() as { episode: Episode }
  const patched = await h.app.inject({
    method: 'PATCH',
    url: `/api/episodes/${episode.id}`,
    headers: authHeaders,
    payload: { status: 'published' },
  })
  expect(patched.statusCode).toBe(200)
  return (patched.json() as { episode: Episode }).episode
}

beforeEach(async () => {
  harness = await startHarness()
})

afterEach(async () => {
  await harness.cleanup()
})

describe('POST /api/episodes: auth', () => {
  it('refuses a request with no credentials', async () => {
    const res = await upload(harness, { headers: {} })
    expect(res.statusCode).toBe(401)
    expect(episodeRows(harness)).toHaveLength(0)
  })

  it('refuses the station door code, which is a different secret', async () => {
    const res = await upload(harness, { headers: { authorization: 'Bearer not-the-password' } })
    expect(res.statusCode).toBe(401)
    expect(episodeRows(harness)).toHaveLength(0)
  })
})

describe('POST /api/episodes', () => {
  it('takes an episode, and leaves it a draft', async () => {
    const res = await upload(harness, {
      fields: {
        title: 'Leaving Johannesburg',
        notes: 'What we talk about when we talk about leaving.',
        guests: 'Thabo M.',
        episodeNumber: '12',
        durationMs: '2726000',
      },
    })

    expect(res.statusCode).toBe(201)
    const { episode } = res.json() as { episode: Episode }
    expect(episode).toMatchObject({
      title: 'Leaving Johannesburg',
      slug: 'leaving-johannesburg',
      notes: 'What we talk about when we talk about leaving.',
      guests: 'Thabo M.',
      episodeNumber: 12,
      // The whole point of having a status: an episode nobody has finished
      // describing should not already be on the page.
      status: 'draft',
      // What the browser's own decoder made of the master. Provisional: ffmpeg
      // measures the encode properly and overwrites this. Taken on trust
      // because it is a number on a card, not a claim anything depends on.
      durationMs: 2_726_000,
    })
  })

  it('takes an episode whose length nobody could measure', async () => {
    // No `durationMs` at all, which is what a browser that could not decode the
    // master reports. Zero rather than a refusal: the encode will measure it,
    // and an episode is not less of an episode for not knowing its own length
    // yet.
    const res = await upload(harness)
    expect(res.statusCode).toBe(201)
    expect((res.json() as { episode: Episode }).episode.durationMs).toBe(0)
  })

  it('writes both files into the archive, not the library', async () => {
    await upload(harness)

    // The archive has them...
    expect(await listDir(harness.config.episodeAudioDir)).toHaveLength(1)
    expect(await listDir(harness.config.episodePosterDir)).toHaveLength(1)
    // ...and the library, which the nightly wipe empties, does not.
    expect(await listDir(harness.config.audioDir)).toHaveLength(0)
    expect(harness.db.prepare('SELECT * FROM tracks').all()).toHaveLength(0)
  })

  it('leaves no staged parts behind', async () => {
    // The `uploads/` directory itself stays — it is the staging area, not a
    // leftover — so what is asserted is that nothing is *in* it.
    await upload(harness)
    expect(await listDir(path.join(harness.config.tmpDir, 'uploads'))).toHaveLength(0)
  })

  it('serves the master until an encode replaces it', async () => {
    // The property that makes an episode playable the instant the upload
    // answers: there is never a moment where a row exists and its audio does
    // not. The encode is an improvement queued afterwards, not a step.
    const res = await upload(harness)
    const { episode } = res.json() as { episode: Episode }

    expect(episode.audioUrl).toContain('/api/episode-media/')
    expect(episode.audioBytes).toBeGreaterThan(0)
    // No ffmpeg in the test harness's expectations either way: `none` when the
    // build has none, `pending` or `ready` when it does. What must never appear
    // is an episode with no audio at all.
    expect(['none', 'pending', 'ready', 'failed']).toContain(episode.transcodeStatus)
  })

  it('refuses a poster that is not 1080x1350, and says what it got', async () => {
    const res = await upload(harness, {
      poster: { filename: 'poster.png', contentType: 'image/png', data: pngOf(900, 1200) },
    })

    expect(res.statusCode).toBe(422)
    const body = res.json() as { error: string; message: string }
    expect(body.error).toBe('poster_dimensions')
    // Naming the size received is the difference between a refusal somebody can
    // act on and one they have to guess at.
    expect(body.message).toContain('900x1200')
    expect(body.message).toContain('1080x1350')
    expect(episodeRows(harness)).toHaveLength(0)
  })

  it('keeps nothing on disk when the poster is the wrong size', async () => {
    // By the time the poster is checked, the audio is already staged in the
    // store — hundreds of megabytes of it, for a real episode. A refusal that
    // cleaned up only the poster would strand all of it, once per rejected
    // attempt, with nothing referencing it and nothing looking for orphans.
    await upload(harness, {
      poster: { filename: 'poster.png', contentType: 'image/png', data: pngOf(900, 1200) },
    })

    expect(await listDir(path.join(harness.config.tmpDir, 'uploads'))).toHaveLength(0)
    expect(await listDir(harness.config.episodeAudioDir)).toHaveLength(0)
    expect(await listDir(harness.config.episodePosterDir)).toHaveLength(0)
  })

  it('keeps nothing when the same audio is uploaded twice', async () => {
    // The same leak by another route: a duplicate is refused *after* its bytes
    // have already been staged.
    await upload(harness)
    const again = await upload(harness, { fields: { title: 'A different name' } })

    expect(again.statusCode).toBe(409)
    expect(await listDir(path.join(harness.config.tmpDir, 'uploads'))).toHaveLength(0)
    // One episode's audio, not two.
    expect(await listDir(harness.config.episodeAudioDir)).toHaveLength(1)
  })

  it('refuses a poster that is not an image at all', async () => {
    const res = await upload(harness, {
      poster: {
        filename: 'poster.png',
        contentType: 'image/png',
        data: Buffer.from('this is not a picture'),
      },
    })
    expect(res.statusCode).toBe(415)
    expect((res.json() as { error: string }).error).toBe('unsupported_poster')
  })

  it('refuses audio that is not audio', async () => {
    const res = await upload(harness, {
      audio: {
        filename: 'not-audio.txt',
        contentType: 'text/plain',
        data: await fixture('not-audio.txt'),
      },
    })
    expect(res.statusCode).toBe(415)
    expect(episodeRows(harness)).toHaveLength(0)
  })

  it('needs a title', async () => {
    const res = await upload(harness, { fields: { title: '   ' } })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { error: string }).error).toBe('no_title')
  })

  it('needs a poster', async () => {
    const res = await upload(harness, { poster: null })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { error: string }).error).toBe('no_poster')
  })

  it('needs audio', async () => {
    const res = await upload(harness, { audio: null })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { error: string }).error).toBe('no_audio')
  })

  it('refuses the same audio twice, and hands back the episode it already is', async () => {
    const first = await upload(harness)
    const again = await upload(harness, { fields: { title: 'A different name for it' } })

    expect(again.statusCode).toBe(409)
    const body = again.json() as { error: string; episode: Episode }
    expect(body.error).toBe('duplicate')
    expect(body.episode.id).toBe((first.json() as { episode: Episode }).episode.id)
    expect(episodeRows(harness)).toHaveLength(1)
    // And the second attempt left nothing behind.
    expect(await listDir(harness.config.episodeAudioDir)).toHaveLength(1)
  })

  it('gives two episodes of the same name distinct addresses', async () => {
    await upload(harness, { fields: { title: 'Leaving Johannesburg' } })
    const second = await upload(harness, {
      fields: { title: 'Leaving Johannesburg' },
      audio: { filename: 'other.flac', contentType: 'audio/flac', data: await fixture('untagged.flac') },
    })

    expect(second.statusCode).toBe(201)
    // Counted up rather than suffixed at random: these are read by people.
    expect((second.json() as { episode: Episode }).episode.slug).toBe('leaving-johannesburg-2')
  })
})

describe('reading the archive', () => {
  it('shows nobody the drafts', async () => {
    await upload(harness) // a draft
    const res = await harness.app.inject({ method: 'GET', url: '/api/episodes' })

    expect(res.statusCode).toBe(200)
    expect((res.json() as { episodes: Episode[] }).episodes).toHaveLength(0)
  })

  it('shows a published episode to a stranger', async () => {
    // No credentials of any kind: the whole point of publishing is somebody who
    // was never in the room and has no key to present.
    const episode = await publish(harness)
    const res = await harness.app.inject({ method: 'GET', url: '/api/episodes' })

    const { episodes } = res.json() as { episodes: Episode[] }
    expect(episodes).toHaveLength(1)
    expect(episodes[0]!.slug).toBe(episode.slug)
  })

  it('stays open on a private station', async () => {
    // Everything that *is* the station is refused without the key. The archive
    // is not the station; it is the thing that outlives it.
    const priv = await startHarness({ stationKey: 'a-door-code' })
    try {
      await publish(priv)
      const archive = await priv.app.inject({ method: 'GET', url: '/api/episodes' })
      const library = await priv.app.inject({ method: 'GET', url: '/api/tracks' })

      expect(archive.statusCode).toBe(200)
      expect((archive.json() as { episodes: Episode[] }).episodes).toHaveLength(1)
      expect(library.statusCode).toBe(401)
    } finally {
      await priv.cleanup()
    }
  })

  it('answers a draft address with 404 rather than 403', async () => {
    // A 403 on a slug confirms the slug is real, and whether an unpublished
    // episode exists is not a stranger's business.
    const res = await upload(harness)
    const { episode } = res.json() as { episode: Episode }

    const asStranger = await harness.app.inject({
      method: 'GET',
      url: `/api/episodes/${episode.slug}`,
    })
    expect(asStranger.statusCode).toBe(404)
  })

  it('lets the admin read a draft at its own address', async () => {
    const res = await upload(harness)
    const { episode } = res.json() as { episode: Episode }

    const asAdmin = await harness.app.inject({
      method: 'GET',
      url: `/api/episodes/${episode.slug}`,
      headers: authHeaders,
    })
    expect(asAdmin.statusCode).toBe(200)
  })

  it('gives the console the drafts, behind the password', async () => {
    await upload(harness)
    const open = await harness.app.inject({ method: 'GET', url: '/api/admin/episodes' })
    const asAdmin = await harness.app.inject({
      method: 'GET',
      url: '/api/admin/episodes',
      headers: authHeaders,
    })

    expect(open.statusCode).toBe(401)
    expect((asAdmin.json() as { episodes: Episode[] }).episodes).toHaveLength(1)
  })

  it('orders the archive newest first, on the date the episode claims', async () => {
    await publish(harness, { title: 'The old one', publishedAt: '1700000000000' })
    const newer = await upload(harness, {
      fields: {
        title: 'The new one',
        publishedAt: '1800000000000',
        status: 'published',
      },
      audio: {
        filename: 'other.flac',
        contentType: 'audio/flac',
        data: await fixture('untagged.flac'),
      },
    })
    expect(newer.statusCode).toBe(201)

    const res = await harness.app.inject({ method: 'GET', url: '/api/episodes' })
    const { episodes } = res.json() as { episodes: Episode[] }
    expect(episodes.map((e) => e.title)).toEqual(['The new one', 'The old one'])
  })

  it('serves the audio, and serves a byte range of it', async () => {
    // The load-bearing half of a podcast player: somebody resuming at 34:10 has
    // to fetch that range rather than pulling the whole hour from zero.
    const episode = await publish(harness)
    const whole = await harness.app.inject({ method: 'GET', url: episode.audioUrl })
    const ranged = await harness.app.inject({
      method: 'GET',
      url: episode.audioUrl,
      headers: { range: 'bytes=0-99' },
    })

    expect(whole.statusCode).toBe(200)
    expect(ranged.statusCode).toBe(206)
    expect(ranged.rawPayload).toHaveLength(100)
  })

  it('serves the poster to anybody', async () => {
    const episode = await publish(harness)
    const res = await harness.app.inject({
      method: 'GET',
      url: `/api/episode-poster/${episode.poster}`,
    })
    expect(res.statusCode).toBe(200)
  })
})

describe('PATCH /api/episodes/:id', () => {
  it('publishes a draft', async () => {
    const { episode } = (await upload(harness)).json() as { episode: Episode }
    const res = await harness.app.inject({
      method: 'PATCH',
      url: `/api/episodes/${episode.id}`,
      headers: authHeaders,
      payload: { status: 'published' },
    })

    expect((res.json() as { episode: Episode }).episode.status).toBe('published')
  })

  it('leaves alone what it was not asked about', async () => {
    // The trap this route exists to avoid: flipping the status must not clear
    // the notes, which is what a PUT-shaped handler would have done.
    const { episode } = (await upload(harness, {
      fields: { title: 'Leaving Johannesburg', notes: 'Recorded in a kitchen.', guests: 'Thabo M.' },
    })).json() as { episode: Episode }

    const res = await harness.app.inject({
      method: 'PATCH',
      url: `/api/episodes/${episode.id}`,
      headers: authHeaders,
      payload: { status: 'published' },
    })

    expect((res.json() as { episode: Episode }).episode).toMatchObject({
      notes: 'Recorded in a kitchen.',
      guests: 'Thabo M.',
    })
  })

  it('clears a field when asked to, explicitly', async () => {
    const { episode } = (await upload(harness, {
      fields: { title: 'Leaving Johannesburg', guests: 'Thabo M.' },
    })).json() as { episode: Episode }

    const res = await harness.app.inject({
      method: 'PATCH',
      url: `/api/episodes/${episode.id}`,
      headers: authHeaders,
      payload: { guests: null },
    })

    expect((res.json() as { episode: Episode }).episode.guests).toBeNull()
  })

  it('re-mints the address while the episode is still a draft', async () => {
    const { episode } = (await upload(harness, { fields: { title: 'Levaing Johannesburg' } })).json() as {
      episode: Episode
    }
    expect(episode.slug).toBe('levaing-johannesburg')

    const res = await harness.app.inject({
      method: 'PATCH',
      url: `/api/episodes/${episode.id}`,
      headers: authHeaders,
      payload: { title: 'Leaving Johannesburg' },
    })

    expect((res.json() as { episode: Episode }).episode.slug).toBe('leaving-johannesburg')
  })

  it('holds the address still once the episode is published', async () => {
    // A slug is a promise the moment anything links to it. Fixing a typo in a
    // published title must not break every link already in a message thread.
    const episode = await publish(harness, { title: 'Leaving Johannesburg' })

    const res = await harness.app.inject({
      method: 'PATCH',
      url: `/api/episodes/${episode.id}`,
      headers: authHeaders,
      payload: { title: 'Leaving Johannesburg, properly' },
    })

    const patched = (res.json() as { episode: Episode }).episode
    expect(patched.title).toBe('Leaving Johannesburg, properly')
    expect(patched.slug).toBe('leaving-johannesburg')
  })

  it('is admin-only', async () => {
    const { episode } = (await upload(harness)).json() as { episode: Episode }
    const res = await harness.app.inject({
      method: 'PATCH',
      url: `/api/episodes/${episode.id}`,
      payload: { status: 'published' },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('DELETE /api/episodes/:id', () => {
  it('takes the episode and both its files', async () => {
    const { episode } = (await upload(harness)).json() as { episode: Episode }

    const res = await harness.app.inject({
      method: 'DELETE',
      url: `/api/episodes/${episode.id}`,
      headers: authHeaders,
    })

    expect(res.statusCode).toBe(200)
    expect(episodeRows(harness)).toHaveLength(0)
    expect(await listDir(harness.config.episodeAudioDir)).toHaveLength(0)
    expect(await listDir(harness.config.episodePosterDir)).toHaveLength(0)
  })

  it('is admin-only', async () => {
    const { episode } = (await upload(harness)).json() as { episode: Episode }
    const res = await harness.app.inject({ method: 'DELETE', url: `/api/episodes/${episode.id}` })
    expect(res.statusCode).toBe(401)
    expect(episodeRows(harness)).toHaveLength(1)
  })
})

describe('an episode is made small enough to listen to', () => {
  /**
   * The end-to-end version of what `test/transcode.test.ts` checks directly:
   * that uploading a master actually leaves the archive serving something much
   * smaller, without the episode ever being unplayable in between.
   *
   * Its own harness with `transcode: true`, because every other test in this
   * file deliberately runs without it — an encode is a background job, and a
   * test that is about drafts should not be racing one.
   */
  it('serves the master first, then replaces it with the encode', async () => {
    const h = await startHarness({}, { transcode: true })
    try {
      const res = await upload(h)
      // If this build has no ffmpeg there is nothing to prove; the archive
      // still works, which is what `none` means.
      const created = (res.json() as { episode: Episode }).episode
      if (created.transcodeStatus === 'none') return

      // Playable the instant the upload answered, from the master. This is the
      // property that lets the encode be an errand rather than a step.
      expect(created.transcodeStatus).toBe('pending')
      expect(created.audioBytes).toBeGreaterThan(0)

      // Wait for the errand. Bounded, so a hung ffmpeg fails the test rather
      // than the suite.
      let episode = created
      for (let i = 0; i < 100 && episode.transcodeStatus === 'pending'; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        const again = await h.app.inject({
          method: 'GET',
          url: '/api/admin/episodes',
          headers: authHeaders,
        })
        episode = (again.json() as { episodes: Episode[] }).episodes[0] as Episode
      }

      expect(episode.transcodeStatus).toBe('ready')
      // ffmpeg measured the real length, replacing the zero the upload carried.
      expect(episode.durationMs).toBeGreaterThan(0)
      // And whatever is served now, it is served from a key that exists.
      const audio = await h.app.inject({ method: 'GET', url: episode.audioUrl })
      expect(audio.statusCode).toBe(200)
    } finally {
      await h.cleanup()
    }
  })
})

describe('the archive outlives the evening', () => {
  it('survives the end of a broadcast, which empties the library', async () => {
    /**
     * The assertion this whole file is here for.
     *
     * Ending a session deletes every track, its file, its artwork and its
     * lyrics: the station is an evening, not a back catalogue. The archive is
     * the deliberate exception, and the thing that makes it safe is that it
     * shares no table and no directory with any of that. This is what would
     * catch somebody later filing episodes under `tracks` because the columns
     * looked similar.
     */
    const episode = await publish(harness)

    // A track in the library alongside it, so the wipe has something to do and
    // this test would notice if it stopped doing it.
    await harness.app.inject({
      method: 'POST',
      url: '/api/upload',
      headers: { ...multipartHeaders(), ...authHeaders },
      payload: multipartBody([
        {
          name: 'file',
          filename: 'tagged.mp3',
          contentType: 'audio/mpeg',
          data: await fixture('tagged.mp3'),
        },
      ]),
    })
    expect(harness.db.prepare('SELECT * FROM tracks').all()).toHaveLength(1)

    harness.air.end()
    // The wipe is fire-and-forget from inside the air handler, so give the
    // microtask that unlinks the files a turn before looking.
    await new Promise((resolve) => setTimeout(resolve, 50))

    // The evening is gone...
    expect(harness.db.prepare('SELECT * FROM tracks').all()).toHaveLength(0)
    // ...and the archive is exactly where it was.
    expect(episodeRows(harness)).toHaveLength(1)
    const still = await harness.app.inject({ method: 'GET', url: '/api/episodes' })
    expect((still.json() as { episodes: Episode[] }).episodes).toHaveLength(1)
    const stillThere = await harness.app.inject({ method: 'GET', url: episode.audioUrl })
    expect(stillThere.statusCode).toBe(200)
  })
})
