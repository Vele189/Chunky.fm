import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Track } from '../src/lib/track.js'
import {
  ADMIN_PASSWORD,
  type Harness,
  fixture,
  multipartBody,
  multipartHeaders,
  startHarness,
} from './helpers.js'

let harness: Harness
let track: Track
let audioBytes: Buffer

beforeEach(async () => {
  harness = await startHarness()
  audioBytes = await fixture('tagged.mp3')

  const res = await harness.app.inject({
    method: 'POST',
    url: '/api/upload',
    headers: { ...multipartHeaders(), authorization: `Bearer ${ADMIN_PASSWORD}` },
    payload: multipartBody([
      { name: 'file', filename: 'tagged.mp3', contentType: 'audio/mpeg', data: audioBytes },
    ]),
  })
  expect(res.statusCode).toBe(201)
  track = res.json().track
})

afterEach(async () => {
  await harness.cleanup()
})

describe('GET /api/tracks', () => {
  it('lists the library', async () => {
    const res = await harness.app.inject({ method: 'GET', url: '/api/tracks' })

    expect(res.statusCode).toBe(200)
    expect(res.json().tracks).toHaveLength(1)
    expect(res.json().tracks[0]).toMatchObject({ id: track.id, title: 'Chunky Test Tone' })
  })

  it('is readable without admin credentials', async () => {
    // Listeners never browse the library, but the player needs to resolve a
    // track id to a filename, and none of this is secret.
    const res = await harness.app.inject({ method: 'GET', url: '/api/tracks' })
    expect(res.statusCode).toBe(200)
  })
})

describe('GET /api/audio/:filename', () => {
  it('serves the whole file when no range is asked for', async () => {
    const res = await harness.app.inject({ method: 'GET', url: `/api/audio/${track.filename}` })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('audio/mpeg')
    expect(Number(res.headers['content-length'])).toBe(audioBytes.length)
    expect(res.rawPayload.equals(audioBytes)).toBe(true)
  })

  it('advertises range support', async () => {
    const res = await harness.app.inject({ method: 'GET', url: `/api/audio/${track.filename}` })

    // Without this a listener seeking to 2:14 would pull the file from 0:00.
    expect(res.headers['accept-ranges']).toBe('bytes')
  })

  it('serves a byte range with 206 and the right slice', async () => {
    const res = await harness.app.inject({
      method: 'GET',
      url: `/api/audio/${track.filename}`,
      headers: { range: 'bytes=100-199' },
    })

    expect(res.statusCode).toBe(206)
    expect(res.headers['content-range']).toBe(`bytes 100-199/${audioBytes.length}`)
    expect(Number(res.headers['content-length'])).toBe(100)
    expect(res.rawPayload.equals(audioBytes.subarray(100, 200))).toBe(true)
  })

  it('serves an open-ended range to the end of the file', async () => {
    const from = audioBytes.length - 500
    const res = await harness.app.inject({
      method: 'GET',
      url: `/api/audio/${track.filename}`,
      headers: { range: `bytes=${from}-` },
    })

    expect(res.statusCode).toBe(206)
    expect(res.rawPayload.equals(audioBytes.subarray(from))).toBe(true)
  })

  it('rejects a range past the end of the file', async () => {
    const res = await harness.app.inject({
      method: 'GET',
      url: `/api/audio/${track.filename}`,
      headers: { range: `bytes=${audioBytes.length + 10}-${audioBytes.length + 100}` },
    })

    expect(res.statusCode).toBe(416)
  })

  it('marks content immutable — the URL is a content hash', async () => {
    const res = await harness.app.inject({ method: 'GET', url: `/api/audio/${track.filename}` })

    expect(res.headers['cache-control']).toContain('immutable')
  })

  it('404s an unknown file', async () => {
    const res = await harness.app.inject({ method: 'GET', url: '/api/audio/nope.mp3' })
    expect(res.statusCode).toBe(404)
  })

  it('refuses to walk out of the audio directory', async () => {
    for (const attempt of [
      '/api/audio/../chunky.sqlite',
      '/api/audio/..%2f..%2fetc%2fpasswd',
      '/api/audio/%2e%2e/chunky.sqlite',
    ]) {
      const res = await harness.app.inject({ method: 'GET', url: attempt })
      expect(res.statusCode, attempt).not.toBe(200)
    }
  })
})

describe('GET /api/artwork/:filename', () => {
  it('serves extracted artwork', async () => {
    const res = await harness.app.inject({
      method: 'GET',
      url: `/api/artwork/${track.artworkPath}`,
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('image/png')
    expect(res.rawPayload.subarray(1, 4).toString()).toBe('PNG')
  })

  it('404s artwork that was never extracted', async () => {
    const res = await harness.app.inject({ method: 'GET', url: '/api/artwork/missing.jpg' })
    expect(res.statusCode).toBe(404)
  })
})
