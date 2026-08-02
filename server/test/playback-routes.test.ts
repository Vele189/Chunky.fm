import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PlaybackState } from '../src/playback.js'
import {
  ADMIN_PASSWORD,
  type Harness,
  fakeClock,
  fixture,
  multipartBody,
  multipartHeaders,
  startHarness,
} from './helpers.js'

let harness: Harness
let clock: ReturnType<typeof fakeClock>
let trackId: number

const auth = { authorization: `Bearer ${ADMIN_PASSWORD}` }

function command(body: Record<string, unknown>, headers: Record<string, string> = auth) {
  return harness.app.inject({ method: 'POST', url: '/api/playback', headers, payload: body })
}

beforeEach(async () => {
  clock = fakeClock()
  harness = await startHarness({}, { playback: new PlaybackState({ now: clock.now }) })

  const res = await harness.app.inject({
    method: 'POST',
    url: '/api/upload',
    headers: { ...multipartHeaders(), ...auth },
    payload: multipartBody([
      {
        name: 'file',
        filename: 'tagged.mp3',
        contentType: 'audio/mpeg',
        data: await fixture('tagged.mp3'),
      },
    ]),
  })
  trackId = res.json().track.id
})

afterEach(async () => {
  await harness.cleanup()
})

describe('POST /api/playback', () => {
  it('needs admin credentials', async () => {
    const res = await command({ action: 'play', trackId }, {})

    expect(res.statusCode).toBe(401)
    expect(harness.playback.snapshot().track).toBeNull()
  })

  it('puts a track on the decks', async () => {
    const res = await command({ action: 'play', trackId })

    expect(res.statusCode).toBe(200)
    expect(res.json().track.id).toBe(trackId)
    expect(res.json().startedAt).toBe(clock.now())
    expect(harness.playback.isPlaying).toBe(true)
  })

  it('can start a track partway in', async () => {
    // The fixture is only ~2s long, so stay inside it.
    const res = await command({ action: 'play', trackId, positionMs: 1_000 })

    expect(res.json().startedAt).toBe(clock.now() - 1_000)
  })

  it('clamps a position past the end of the track', async () => {
    const { durationMs } = (await harness.app.inject({ method: 'GET', url: '/api/tracks' })).json()
      .tracks[0]

    const res = await command({ action: 'play', trackId, positionMs: 60_000 })

    expect(res.json().startedAt).toBe(clock.now() - durationMs)
  })

  it('pauses, resumes and seeks', async () => {
    await command({ action: 'play', trackId })
    clock.advance(500)

    expect((await command({ action: 'pause' })).json().pausedAt).toBe(500)
    expect((await command({ action: 'resume' })).json().pausedAt).toBeNull()
    expect((await command({ action: 'seek', positionMs: 1_000 })).json().startedAt).toBe(
      clock.now() - 1_000,
    )
    expect((await command({ action: 'stop' })).json().track).toBeNull()
  })

  it('rejects an unknown track', async () => {
    const res = await command({ action: 'play', trackId: 9999 })

    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBe('unknown_track')
  })

  it('rejects play without a track and seek without a position', async () => {
    expect((await command({ action: 'play' })).statusCode).toBe(400)
    expect((await command({ action: 'seek' })).statusCode).toBe(400)
  })

  it('rejects an action it does not know', async () => {
    expect((await command({ action: 'scratch' })).statusCode).toBe(400)
    expect((await command({})).statusCode).toBe(400)
  })
})

describe('GET /api/playback', () => {
  it('reports the current state without credentials', async () => {
    await command({ action: 'play', trackId })

    const res = await harness.app.inject({ method: 'GET', url: '/api/playback' })

    expect(res.statusCode).toBe(200)
    expect(res.json().track.id).toBe(trackId)
  })
})
