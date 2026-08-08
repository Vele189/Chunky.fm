/**
 * The made-up half of the headcount.
 *
 * Two things are worth holding on to here, and they are the two the rest of
 * this file is about. The first is that the padding never becomes a listener:
 * whatever number the decks type in, the roster still has one row per socket
 * with a person behind it, and everything gated on the roster (chat, wishes,
 * mutes) sees exactly what it saw before. The second is that it is about
 * tonight, like the queue and the mutes: ending the broadcast takes it with it,
 * so a station cannot go on quietly claiming a crowd that has gone home.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_PADDING, Padding } from '../src/padding.js'
import { type Harness, signIn, startHarness } from './helpers.js'
import { TestClient } from './ws-client.js'

describe('Padding', () => {
  it('starts at nobody added', () => {
    expect(new Padding().count).toBe(0)
  })

  it('holds where the count now stands, rather than stepping', () => {
    // The shape that makes the panel's plus button safe to lean on: two
    // identical requests leave one number, so a retry after a dropped response
    // cannot double the crowd.
    const padding = new Padding()
    expect(padding.set(30)).toBe(true)
    expect(padding.set(30)).toBe(false)
    expect(padding.count).toBe(30)
  })

  it('announces a change, and only a change', () => {
    const padding = new Padding()
    const heard = vi.fn()
    padding.on('change', heard)

    padding.set(3)
    padding.set(3)
    padding.set(4)

    expect(heard.mock.calls).toEqual([[3], [4]])
  })

  it('clamps rather than holding a number the page could not draw', () => {
    const padding = new Padding()
    padding.set(-10)
    expect(padding.count).toBe(0)
    padding.set(MAX_PADDING + 1_000)
    expect(padding.count).toBe(MAX_PADDING)
    padding.set(2.7)
    expect(padding.count).toBe(2)
  })

  it('ignores a number that is not one', () => {
    const padding = new Padding()
    padding.set(12)
    padding.set(Number.NaN)
    expect(padding.count).toBe(12)
  })

  it('empties on clear, which is what the end of a session does', () => {
    const padding = new Padding()
    padding.set(40)
    padding.clear()
    expect(padding.count).toBe(0)
  })
})

describe('/api/padding', () => {
  let harness: Harness
  beforeEach(async () => {
    harness = await startHarness()
  })
  afterEach(() => harness.cleanup())

  it('is admin-only in both directions', async () => {
    // The read as well as the write, like the mutes: the room is shown the
    // total, and publishing the split would tell every listener how much of
    // tonight's crowd is nobody.
    expect((await harness.app.inject({ method: 'GET', url: '/api/padding' })).statusCode).toBe(401)
    const posted = await harness.app.inject({
      method: 'POST',
      url: '/api/padding',
      payload: { padding: 30 },
    })
    expect(posted.statusCode).toBe(401)
    expect(harness.padding.count).toBe(0)
  })

  it('sets the count and answers with it', async () => {
    const cookie = await signIn(harness)
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/padding',
      payload: { padding: 28 },
      headers: { cookie },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ padding: 28 })
    expect(harness.padding.count).toBe(28)
  })

  it('reads back what was set', async () => {
    const cookie = await signIn(harness)
    harness.padding.set(12)
    const res = await harness.app.inject({ method: 'GET', url: '/api/padding', headers: { cookie } })
    expect(res.json()).toEqual({ padding: 12 })
  })

  it('is idempotent, so a repeated press cannot double the crowd', async () => {
    const cookie = await signIn(harness)
    for (let i = 0; i < 3; i++) {
      await harness.app.inject({
        method: 'POST',
        url: '/api/padding',
        payload: { padding: 5 },
        headers: { cookie },
      })
    }
    expect(harness.padding.count).toBe(5)
  })

  it('refuses a body it cannot act on', async () => {
    const cookie = await signIn(harness)
    const refused = [
      {},
      { padding: -1 },
      { padding: 2.5 },
      { padding: MAX_PADDING + 1 },
      { padding: 'lots' },
      // A string of digits is deliberately not here: Fastify coerces one to the
      // integer it spells, the same way it does everywhere else in this API,
      // and a route that fought that would be the only one that did.
    ]
    for (const payload of refused) {
      const res = await harness.app.inject({
        method: 'POST',
        url: '/api/padding',
        payload,
        headers: { cookie },
      })
      expect(res.statusCode, JSON.stringify(payload)).toBe(400)
    }
    expect(harness.padding.count).toBe(0)
  })
})

describe('the padding over the socket', () => {
  let harness: Harness
  beforeEach(async () => {
    harness = await startHarness({}, { listen: true })
  })
  afterEach(() => harness.cleanup())

  it('rides the roster frame a listener is handed on connect', async () => {
    harness.padding.set(28)
    const client = await TestClient.connect(harness.wsUrl)

    expect(await client.nextPresence()).toMatchObject({ listeners: [], padding: 28 })
    await client.close()
  })

  it('reaches everybody the moment it changes, without touching the roster', async () => {
    const client = await TestClient.connect(harness.wsUrl)
    await client.nextPresence()
    await client.nextChat()
    await client.join('sam')

    harness.padding.set(30)

    const roster = await client.nextPresence()
    expect(roster.padding).toBe(30)
    // The point of keeping the two apart: the room still holds one person, and
    // that person is the only name in it.
    expect(roster.listeners.map((listener) => listener.nickname)).toEqual(['sam'])
    await client.close()
  })

  it('says nothing when the count is set to what it already was', async () => {
    const client = await TestClient.connect(harness.wsUrl)
    await client.nextPresence()
    harness.padding.set(9)
    await client.nextPresence()

    harness.padding.set(9)
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(client.seen.filter((m) => m.type === 'presence')).toHaveLength(2)
    await client.close()
  })

  it('leaves the roster the gate it was: padding buys nobody a voice', async () => {
    // Nothing here can be talked to, so nothing here changes what the socket
    // will accept. A station padded to a hundred still refuses an unnamed
    // socket exactly as an empty one does.
    harness.padding.set(100)
    const client = await TestClient.connect(harness.wsUrl)

    client.send({ type: 'say', text: 'hello?' })
    expect(await client.waitFor((m) => m.type === 'error')).toMatchObject({ code: 'not_joined' })
    expect(harness.app.realtime.listeners()).toEqual([])
    await client.close()
  })

  it('goes when the session does, and tells the room so', async () => {
    harness.padding.set(40)
    const client = await TestClient.connect(harness.wsUrl)
    await client.nextPresence()

    harness.air.end()

    expect(await client.nextPresence()).toMatchObject({ listeners: [], padding: 0 })
    expect(harness.padding.count).toBe(0)
    await client.close()
  })
})
