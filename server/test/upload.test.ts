import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TrackRow } from '../src/db.js'
import { ADMIN_COOKIE } from '../src/lib/auth.js'
import {
  ADMIN_PASSWORD,
  type Harness,
  fixture,
  listDir,
  multipartBody,
  multipartHeaders,
  signIn,
  startHarness,
} from './helpers.js'

let harness: Harness

const authHeaders = { authorization: `Bearer ${ADMIN_PASSWORD}` }

async function upload(
  h: Harness,
  file: { filename: string; contentType: string; data: Buffer | string },
  headers: Record<string, string> = authHeaders,
) {
  return h.app.inject({
    method: 'POST',
    url: '/api/upload',
    headers: { ...multipartHeaders(), ...headers },
    payload: multipartBody([{ name: 'file', ...file }]),
  })
}

function trackRows(h: Harness): TrackRow[] {
  return h.db.prepare('SELECT * FROM tracks ORDER BY id').all() as TrackRow[]
}

beforeEach(async () => {
  harness = await startHarness()
})

afterEach(async () => {
  await harness.cleanup()
})

describe('POST /api/upload — auth', () => {
  it('rejects a request with no credentials', async () => {
    const res = await upload(
      harness,
      { filename: 'tagged.mp3', contentType: 'audio/mpeg', data: await fixture('tagged.mp3') },
      {},
    )

    expect(res.statusCode).toBe(401)
    expect(trackRows(harness)).toHaveLength(0)
  })

  it('rejects a request with the wrong password', async () => {
    const res = await upload(
      harness,
      { filename: 'tagged.mp3', contentType: 'audio/mpeg', data: await fixture('tagged.mp3') },
      { authorization: 'Bearer not-the-password' },
    )

    expect(res.statusCode).toBe(401)
  })

  it('accepts the x-admin-password header', async () => {
    const res = await upload(
      harness,
      { filename: 'tagged.mp3', contentType: 'audio/mpeg', data: await fixture('tagged.mp3') },
      { 'x-admin-password': ADMIN_PASSWORD },
    )

    expect(res.statusCode).toBe(201)
  })

  it('accepts the session cookie, which is what the browser actually sends', async () => {
    const res = await upload(
      harness,
      { filename: 'tagged.mp3', contentType: 'audio/mpeg', data: await fixture('tagged.mp3') },
      { cookie: await signIn(harness) },
    )

    expect(res.statusCode).toBe(201)
  })

  it('rejects a cookie it did not sign', async () => {
    const res = await upload(
      harness,
      { filename: 'tagged.mp3', contentType: 'audio/mpeg', data: await fixture('tagged.mp3') },
      { cookie: `${ADMIN_COOKIE}=9999999999999.abc.forged` },
    )

    expect(res.statusCode).toBe(401)
    expect(trackRows(harness)).toHaveLength(0)
  })
})

describe('POST /api/upload — valid files', () => {
  it('stores a tagged mp3, its artwork and its metadata', async () => {
    const data = await fixture('tagged.mp3')
    const res = await upload(harness, {
      filename: 'tagged.mp3',
      contentType: 'audio/mpeg',
      data,
    })

    expect(res.statusCode).toBe(201)
    const { track } = res.json()

    expect(track).toMatchObject({
      title: 'Chunky Test Tone',
      artist: 'Test Artist',
      album: 'Test Album',
      gainDb: 0,
    })
    expect(track.durationMs).toBeGreaterThan(1900)
    expect(track.durationMs).toBeLessThan(2200)
    expect(track.filename).toBe(`${track.contentHash}.mp3`)
    expect(track.artworkPath).toBe(`${track.contentHash}.png`)

    const stored = await fs.readFile(path.join(harness.config.audioDir, track.filename))
    expect(stored.equals(data)).toBe(true)

    const artwork = await fs.readFile(path.join(harness.config.artworkDir, track.artworkPath))
    expect(artwork.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))

    expect(trackRows(harness)).toHaveLength(1)
    expect(await listDir(harness.config.tmpDir)).toEqual([])
  })

  it('falls back to the filename when the file carries no title tag', async () => {
    const res = await upload(harness, {
      filename: 'Some Untagged Take.flac',
      contentType: 'audio/flac',
      data: await fixture('untagged.flac'),
    })

    expect(res.statusCode).toBe(201)
    const { track } = res.json()
    expect(track.title).toBe('Some Untagged Take')
    expect(track.artist).toBeNull()
    expect(track.album).toBeNull()
    expect(track.artworkPath).toBeNull()
    expect(track.filename.endsWith('.flac')).toBe(true)
    expect(await listDir(harness.config.artworkDir)).toEqual([])
  })

  it('accepts application/octet-stream when the extension looks like audio', async () => {
    const res = await upload(harness, {
      filename: 'tagged.mp3',
      contentType: 'application/octet-stream',
      data: await fixture('tagged.mp3'),
    })

    expect(res.statusCode).toBe(201)
  })

  it('names the stored file after its content hash, not the upload name', async () => {
    const res = await upload(harness, {
      filename: '../../etc/passwd.mp3',
      contentType: 'audio/mpeg',
      data: await fixture('tagged.mp3'),
    })

    expect(res.statusCode).toBe(201)
    const { track } = res.json()
    expect(track.filename).toMatch(/^[0-9a-f]{64}\.mp3$/)
    expect(await listDir(harness.config.audioDir)).toEqual([track.filename])
  })
})

describe('POST /api/upload — rejections', () => {
  it('rejects a request with no file part', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/upload',
      headers: { ...multipartHeaders(), ...authHeaders },
      payload: multipartBody([{ name: 'notes', data: 'no file here' }]),
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('no_file')
  })

  it('rejects a body that is not multipart at all', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/upload',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      payload: { hello: 'world' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('bad_multipart')
  })

  it('rejects a plainly non-audio file on its content type', async () => {
    const res = await upload(harness, {
      filename: 'notes.txt',
      contentType: 'text/plain',
      data: 'not audio',
    })

    expect(res.statusCode).toBe(415)
    expect(res.json().error).toBe('unsupported_type')
    expect(await listDir(harness.config.audioDir)).toEqual([])
  })

  it('rejects a non-audio file disguised with an audio name and type', async () => {
    const res = await upload(harness, {
      filename: 'trojan.mp3',
      contentType: 'audio/mpeg',
      data: await fixture('not-audio.txt'),
    })

    expect(res.statusCode).toBe(415)
    expect(res.json().error).toBe('unsupported_audio')
    // Never hand the client a server-side path.
    expect(res.json().message).not.toContain(harness.config.tmpDir)
    expect(trackRows(harness)).toHaveLength(0)
    expect(await listDir(harness.config.audioDir)).toEqual([])
    expect(await listDir(harness.config.tmpDir)).toEqual([])
  })

  it('rejects an empty file', async () => {
    const res = await upload(harness, {
      filename: 'silence.mp3',
      contentType: 'audio/mpeg',
      data: Buffer.alloc(0),
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('empty_file')
    expect(await listDir(harness.config.tmpDir)).toEqual([])
  })

  it('rejects a file over the size limit', async () => {
    await harness.cleanup()
    harness = await startHarness({ maxUploadBytes: 4096 })

    const res = await upload(harness, {
      filename: 'tagged.mp3',
      contentType: 'audio/mpeg',
      data: await fixture('tagged.mp3'),
    })

    expect(res.statusCode).toBe(413)
    expect(res.json().error).toBe('file_too_large')
    expect(trackRows(harness)).toHaveLength(0)
    expect(await listDir(harness.config.audioDir)).toEqual([])
    expect(await listDir(harness.config.tmpDir)).toEqual([])
  })
})

describe('POST /api/upload — duplicates', () => {
  it('refuses to store the same audio twice', async () => {
    const data = await fixture('tagged.mp3')
    const first = await upload(harness, { filename: 'a.mp3', contentType: 'audio/mpeg', data })
    expect(first.statusCode).toBe(201)

    const second = await upload(harness, {
      filename: 'a-copy.mp3',
      contentType: 'audio/mpeg',
      data,
    })

    expect(second.statusCode).toBe(409)
    expect(second.json().error).toBe('duplicate')
    expect(second.json().track.id).toBe(first.json().track.id)
    expect(trackRows(harness)).toHaveLength(1)
    expect(await listDir(harness.config.audioDir)).toHaveLength(1)
    expect(await listDir(harness.config.tmpDir)).toEqual([])
  })
})
