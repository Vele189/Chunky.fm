import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { videoRoutes } from '../src/routes/video.js'
import { LiveVideo } from '../src/video.js'

const URL = 'https://live.example/live/index.m3u8'

function answering(...answers: Array<number | Error>): typeof fetch {
  return (async () => {
    const answer = answers.shift() ?? 404
    if (answer instanceof Error) throw answer
    return new Response(null, { status: answer })
  }) as typeof fetch
}

describe('the camera', () => {
  it('is off until the video server has a stream', () => {
    const video = new LiveVideo({ url: URL, fetchFn: answering() })

    expect(video.snapshot()).toEqual({ live: false, url: null })
  })

  it('goes live when the playlist answers', async () => {
    const video = new LiveVideo({ url: URL, fetchFn: answering(200) })

    await video.check()

    expect(video.snapshot()).toEqual({ live: true, url: URL })
  })

  it('survives a dropped check in the middle of a set', async () => {
    const video = new LiveVideo({ url: URL, fetchFn: answering(200, new Error('blip'), 200) })

    await video.check()
    await video.check()
    expect(video.snapshot().live).toBe(true)
  })

  it('ends after enough failures in a row', async () => {
    const video = new LiveVideo({ url: URL, fetchFn: answering(200, 404, 404, 404) })

    for (let i = 0; i < 4; i += 1) await video.check()

    expect(video.snapshot()).toEqual({ live: false, url: null })
  })

  it('never asks anything on a station with no video server', async () => {
    let asked = false
    const fetchFn = (async () => {
      asked = true
      return new Response(null)
    }) as typeof fetch
    const video = new LiveVideo({ url: null, fetchFn })

    await video.check()

    expect(asked).toBe(false)
  })

  it('answers strangers, and is never cached', async () => {
    const app = Fastify()
    const video = new LiveVideo({ url: URL, fetchFn: answering(200) })
    await video.check()
    await app.register(videoRoutes({ video }))

    const res = await app.inject({ method: 'GET', url: '/api/video' })

    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.json()).toEqual({ live: true, url: URL })
    await app.close()
  })
})
