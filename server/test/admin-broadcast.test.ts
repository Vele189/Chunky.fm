import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PlaybackState } from '../src/playback.js'
import type { QueueMessage, StateMessage } from '../src/protocol.js'
import {
  ADMIN_PASSWORD,
  type FakeClock,
  type Harness,
  fakeClock,
  fixture,
  multipartBody,
  multipartHeaders,
  startHarness,
} from './helpers.js'
import { type TestClient, connectAll } from './ws-client.js'

/**
 * The admin surface and the broadcast, end to end: a command arrives over HTTP,
 * and every listener already connected hears about it.
 *
 * The pieces are unit-tested elsewhere; what this covers is the seam, and the
 * thing the seam is for: several clients agreeing on the same station.
 */
let harness: Harness
let clock: FakeClock
let listeners: TestClient[] = []
let trackIds: number[]

const auth = { authorization: `Bearer ${ADMIN_PASSWORD}` }

const playback = (body: Record<string, unknown>) =>
  harness.app.inject({ method: 'POST', url: '/api/playback', headers: auth, payload: body })

const enqueue = (trackId: number) =>
  harness.app.inject({ method: 'POST', url: '/api/queue', headers: auth, payload: { trackId } })

async function upload(name: string): Promise<number> {
  const res = await harness.app.inject({
    method: 'POST',
    url: '/api/upload',
    headers: { ...multipartHeaders(), ...auth },
    payload: multipartBody([
      { name: 'file', filename: name, contentType: 'audio/mpeg', data: await fixture(name) },
    ]),
  })
  return res.json().track.id
}

/** What each listener saw next, in parallel. */
const everyState = () => Promise.all(listeners.map((client) => client.nextState()))
const everyQueue = () => Promise.all(listeners.map((client) => client.nextQueue()))

const titles = (message: QueueMessage) => message.entries.map((entry) => entry.track.title)

beforeEach(async () => {
  clock = fakeClock()
  // A clock the test owns: nothing advances on its own mid-assertion.
  harness = await startHarness({}, { playback: new PlaybackState({ now: clock.now }), listen: true })
  trackIds = [await upload('tagged.mp3'), await upload('untagged.flac')]

  listeners = await connectAll(harness.wsUrl, 3)
  // Drain what every client is handed on connect.
  await everyState()
  await everyQueue()
})

afterEach(async () => {
  await Promise.all(listeners.map((client) => client.close()))
  listeners = []
  await harness.cleanup()
})

describe('an admin command over HTTP', () => {
  it('reaches every listener, saying the same thing to each', async () => {
    await playback({ action: 'play', trackId: trackIds[0] })

    const states = await everyState()
    for (const state of states) {
      expect(state.track?.id).toBe(trackIds[0])
      expect(state.startedAt).toBe(clock.now())
      expect(state.pausedAt).toBeNull()
    }
    // Not merely "each got something": each got the identical instant.
    expect(new Set(states.map((state) => JSON.stringify(state))).size).toBe(1)
  })

  it('carries pause and resume to everyone', async () => {
    await playback({ action: 'play', trackId: trackIds[0] })
    await everyState()

    clock.advance(500)
    await playback({ action: 'pause' })
    for (const state of await everyState()) expect(state.pausedAt).toBe(500)

    await playback({ action: 'resume' })
    for (const state of await everyState()) expect(state.pausedAt).toBeNull()
  })

  it('tells every listener what is queued', async () => {
    // Something on the decks first. Queueing onto an *idle* station sends two
    // queue frames (added, then taken for the decks), and this is about the
    // broadcast, not that.
    await playback({ action: 'play', trackId: trackIds[0] })
    await everyState()

    await enqueue(trackIds[1]!)

    const queues = await everyQueue()
    for (const queue of queues) expect(titles(queue)).toEqual(['untagged'])
    expect(new Set(queues.map((queue) => JSON.stringify(queue.entries))).size).toBe(1)
  })

  it('sends both halves of a skip: the new track and the shorter queue', async () => {
    await playback({ action: 'play', trackId: trackIds[0] })
    await everyState()
    await enqueue(trackIds[1]!)
    await everyQueue()

    await playback({ action: 'skip' })

    for (const state of await everyState()) expect(state.track?.title).toBe('untagged')
    for (const queue of await everyQueue()) expect(queue.entries).toEqual([])
  })

  it('broadcasts a reorder to listeners who are not doing the reordering', async () => {
    await playback({ action: 'play', trackId: trackIds[0] })
    await everyState()
    for (const id of [trackIds[1], trackIds[0]]) {
      await enqueue(id!)
      await everyQueue()
    }

    const [first] = (await harness.app.inject({ method: 'GET', url: '/api/queue' })).json().entries
    await harness.app.inject({
      method: 'POST',
      url: '/api/queue/move',
      headers: auth,
      payload: { entryId: first.id, toIndex: 1 },
    })

    for (const queue of await everyQueue()) {
      expect(titles(queue)).toEqual(['Chunky Test Tone', 'untagged'])
    }
  })

  it('says nothing at all when a command is refused', async () => {
    await harness.app.inject({
      method: 'POST',
      url: '/api/playback',
      payload: { action: 'play', trackId: trackIds[0] }, // no credentials
    })
    await playback({ action: 'play', trackId: 9999 }) // no such track

    await expect(listeners[0]!.nextState(200)).rejects.toThrow(/timed out/)
  })
})

describe('a listener joining late', () => {
  it('is handed the station as it stands, without anyone doing anything', async () => {
    await playback({ action: 'play', trackId: trackIds[0] })
    await enqueue(trackIds[1]!)
    await everyState()
    await everyQueue()

    clock.advance(134_000)
    const [latecomer] = await connectAll(harness.wsUrl, 1)
    listeners.push(latecomer!)

    const state = await latecomer!.nextState()
    const queue = await latecomer!.nextQueue()

    // The same mid-song arithmetic every other listener is doing.
    expect(state.serverTime - state.startedAt).toBe(134_000)
    expect(state.track?.id).toBe(trackIds[0])
    expect(titles(queue)).toEqual(['untagged'])
  })

  it('does not miss what happens next', async () => {
    const [latecomer] = await connectAll(harness.wsUrl, 1)
    listeners.push(latecomer!)
    await latecomer!.nextState()
    await latecomer!.nextQueue()

    await playback({ action: 'play', trackId: trackIds[1] })

    const states: StateMessage[] = await everyState()
    expect(states).toHaveLength(4)
    for (const state of states) expect(state.track?.id).toBe(trackIds[1])
  })
})
