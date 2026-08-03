import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PlaybackState } from '../src/playback.js'
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

let harness: Harness
let clock: FakeClock
let trackIds: number[]

const auth = { authorization: `Bearer ${ADMIN_PASSWORD}` }

function add(trackId: unknown, headers: Record<string, string> = auth) {
  return harness.app.inject({ method: 'POST', url: '/api/queue', headers, payload: { trackId } })
}

function list() {
  return harness.app.inject({ method: 'GET', url: '/api/queue' })
}

/** Two tracks, so there is something to reorder. */
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

beforeEach(async () => {
  clock = fakeClock()
  harness = await startHarness({}, { playback: new PlaybackState({ now: clock.now }) })
  trackIds = [await upload('tagged.mp3'), await upload('untagged.flac')]
})

afterEach(async () => {
  await harness.cleanup()
})

describe('POST /api/queue', () => {
  it('needs admin credentials', async () => {
    const res = await add(trackIds[0], {})

    expect(res.statusCode).toBe(401)
    expect(harness.station.queue.size).toBe(0)
  })

  it('starts an idle station rather than queueing behind silence', async () => {
    const res = await add(trackIds[0])

    expect(res.statusCode).toBe(201)
    expect(res.json().entries).toEqual([])
    expect(harness.playback.snapshot().track?.id).toBe(trackIds[0])
  })

  it('queues behind whatever is playing', async () => {
    await add(trackIds[0])
    const res = await add(trackIds[1])

    expect(res.json().entries.map((e: { track: { id: number } }) => e.track.id)).toEqual([
      trackIds[1],
    ])
    expect(res.json().entry.track.id).toBe(trackIds[1])
  })

  it('takes the same track twice, as separate entries', async () => {
    await add(trackIds[0])
    const first = (await add(trackIds[0])).json().entry
    const second = (await add(trackIds[0])).json().entry

    expect(first.id).not.toBe(second.id)
    expect((await list()).json().entries).toHaveLength(2)
  })

  it('rejects an unknown track', async () => {
    const res = await add(9999)

    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBe('unknown_track')
  })

  it('rejects a body it cannot use', async () => {
    expect((await add(undefined)).statusCode).toBe(400)
    expect((await add('one')).statusCode).toBe(400)
  })
})

describe('GET /api/queue', () => {
  it('is readable without credentials', async () => {
    await add(trackIds[0])
    await add(trackIds[1])

    const res = await list()

    expect(res.statusCode).toBe(200)
    expect(res.json().entries.map((e: { track: { id: number } }) => e.track.id)).toEqual([
      trackIds[1],
    ])
  })
})

describe('POST /api/queue/move', () => {
  function move(body: Record<string, unknown>, headers: Record<string, string> = auth) {
    return harness.app.inject({ method: 'POST', url: '/api/queue/move', headers, payload: body })
  }

  const ids = () =>
    list()
      .then((res) => res.json().entries)
      .then((entries: { id: number }[]) => entries.map((entry) => entry.id))

  beforeEach(async () => {
    await add(trackIds[0]) // straight onto the decks
    for (const id of [trackIds[0], trackIds[1], trackIds[0]]) await add(id)
  })

  it('needs admin credentials', async () => {
    const before = await ids()

    expect((await move({ entryId: before[2], toIndex: 0 }, {})).statusCode).toBe(401)
    expect(await ids()).toEqual(before)
  })

  it('reorders the queue', async () => {
    const [first, second, third] = await ids()

    const res = await move({ entryId: third!, toIndex: 0 })

    expect(res.statusCode).toBe(200)
    expect(await ids()).toEqual([third, first, second])
  })

  it('clamps a position past the end', async () => {
    const [first, second, third] = await ids()

    await move({ entryId: first!, toIndex: 99 })

    expect(await ids()).toEqual([second, third, first])
  })

  it('rejects an entry that is not in the queue', async () => {
    const res = await move({ entryId: 9999, toIndex: 0 })

    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBe('unknown_entry')
  })

  it('rejects a body it cannot use', async () => {
    expect((await move({ entryId: 1 })).statusCode).toBe(400)
    expect((await move({ toIndex: 0 })).statusCode).toBe(400)
    expect((await move({ entryId: 1, toIndex: -1 })).statusCode).toBe(400)
  })
})

describe('DELETE /api/queue', () => {
  function remove(entryId: number | string, headers: Record<string, string> = auth) {
    return harness.app.inject({ method: 'DELETE', url: `/api/queue/${entryId}`, headers })
  }

  it('drops a single entry', async () => {
    await add(trackIds[0])
    const kept = (await add(trackIds[1])).json().entry
    const doomed = (await add(trackIds[0])).json().entry

    const res = await remove(doomed.id)

    expect(res.statusCode).toBe(200)
    expect(res.json().entries.map((e: { id: number }) => e.id)).toEqual([kept.id])
  })

  it('needs admin credentials, and reports an unknown entry', async () => {
    await add(trackIds[0])
    const entry = (await add(trackIds[1])).json().entry

    expect((await remove(entry.id, {})).statusCode).toBe(401)
    expect((await remove(9999)).statusCode).toBe(404)
    expect(harness.station.queue.size).toBe(1)
  })

  it('empties the whole queue without touching what is playing', async () => {
    await add(trackIds[0])
    await add(trackIds[1])

    const res = await harness.app.inject({ method: 'DELETE', url: '/api/queue', headers: auth })

    expect(res.statusCode).toBe(200)
    expect(res.json().entries).toEqual([])
    expect(harness.playback.snapshot().track?.id).toBe(trackIds[0])
  })
})

describe('POST /api/playback skip', () => {
  function command(body: Record<string, unknown>) {
    return harness.app.inject({ method: 'POST', url: '/api/playback', headers: auth, payload: body })
  }

  it('pulls the next track off the queue', async () => {
    await add(trackIds[0])
    await add(trackIds[1])

    const res = await command({ action: 'skip' })

    expect(res.statusCode).toBe(200)
    expect(res.json().track.id).toBe(trackIds[1])
    expect(res.json().startedAt).toBe(clock.now())
    expect((await list()).json().entries).toEqual([])
  })

  it('goes off air when there is nothing queued', async () => {
    await add(trackIds[0])

    const res = await command({ action: 'skip' })

    expect(res.json().track).toBeNull()
  })

  it('needs admin credentials', async () => {
    await add(trackIds[0])

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/playback',
      payload: { action: 'skip' },
    })

    expect(res.statusCode).toBe(401)
    expect(harness.playback.snapshot().track?.id).toBe(trackIds[0])
  })
})
