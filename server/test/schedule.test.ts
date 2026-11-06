/**
 * Announcing sessions.
 *
 * The one thing the station holds that is not about tonight, and the one read
 * in this API that a stranger is allowed. Both of those are the point rather
 * than an oversight, so both are pinned here.
 */
import fs from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { openDb } from '../src/db.js'
import { STALE_MS, Schedule } from '../src/schedule.js'
import { type Harness, multipartBody, multipartHeaders, signIn, startHarness } from './helpers.js'
import { TestClient } from './ws-client.js'

/** The smallest thing that sniffs as a PNG. */
const PNG = Buffer.concat([
  Buffer.from('89504e470d0a1a0a', 'hex'),
  Buffer.from('the rest is never read'),
])

/**
 * A body carrying a time and, optionally, a poster. The schedule takes both in
 * one request, so this is `multipartBody` with a field alongside the file.
 */
function posterBody(
  startsAt: number | null,
  file: Buffer | null,
  said: { kind?: string; title?: string } = {},
) {
  const parts = []
  if (startsAt !== null) parts.push({ name: 'startsAt', data: Buffer.from(String(startsAt)) })
  if (said.kind !== undefined) parts.push({ name: 'kind', data: Buffer.from(said.kind) })
  if (said.title !== undefined) parts.push({ name: 'title', data: Buffer.from(said.title) })
  if (file !== null) {
    parts.push({ name: 'poster', filename: 'poster.png', contentType: 'image/png', data: file })
  }
  return multipartBody(parts)
}

/**
 * A week from whenever the suite runs. The harness's schedule reads the real
 * station clock, and a fixed date would one day be in the past and stale.
 */
const SATURDAY = Date.now() + 7 * 86_400_000
const HOUR = 3600_000

/** What an announcement that says nothing about itself comes out as. */
const PLAIN = { kind: 'set', title: null } as const

describe('Schedule', () => {
  it('holds several announcements, soonest first, and the soonest is the next one', () => {
    const db = openDb(':memory:')
    const schedule = new Schedule({ db, now: () => 0 })

    expect(schedule.get()).toBeNull()
    expect(schedule.list()).toEqual([])

    const later = schedule.add({ startsAt: SATURDAY + HOUR, poster: null, ...PLAIN })
    const sooner = schedule.add({ startsAt: SATURDAY, poster: 'a.png', ...PLAIN })

    expect(schedule.list()).toEqual([sooner, later])
    expect(schedule.get()).toEqual({ id: sooner.id, startsAt: SATURDAY, poster: 'a.png', ...PLAIN })
    db.close()
  })

  it('edits one night without touching the others, and hands back a displaced poster', () => {
    const db = openDb(':memory:')
    const schedule = new Schedule({ db, now: () => 0 })
    const one = schedule.add({ startsAt: SATURDAY, poster: 'a.png', ...PLAIN })
    const two = schedule.add({ startsAt: SATURDAY + HOUR, poster: 'b.png', ...PLAIN })

    // A new picture displaces the old one, which the caller then unlinks.
    expect(schedule.update(one.id, { startsAt: SATURDAY, poster: 'c.png', ...PLAIN })).toEqual({
      poster: 'a.png',
    })
    // The same picture over a new time does not: changing the hour is the
    // ordinary edit, and unlinking there would blank the page.
    expect(
      schedule.update(one.id, { startsAt: SATURDAY + 2 * HOUR, poster: 'c.png', ...PLAIN }),
    ).toEqual({ poster: null })

    expect(schedule.find(two.id)).toEqual(two)
    // Moved past the other one, so it is not first any more.
    expect(schedule.list().map((s) => s.id)).toEqual([two.id, one.id])
    expect(schedule.update(9999, { startsAt: SATURDAY, poster: null, ...PLAIN })).toBeNull()
    db.close()
  })

  it('remembers which kind of night is being promised, and what it is called', () => {
    const db = openDb(':memory:')
    const schedule = new Schedule({ db, now: () => 0 })

    const talk = schedule.add({
      startsAt: SATURDAY,
      poster: null,
      kind: 'talk',
      title: 'A conversation with Sipho',
    })
    expect(schedule.get()).toMatchObject({ kind: 'talk', title: 'A conversation with Sipho' })

    // And an announcement that goes back to being a set says so, rather than
    // keeping the kind it had.
    schedule.update(talk.id, { startsAt: SATURDAY, poster: null, ...PLAIN })
    expect(schedule.get()).toMatchObject(PLAIN)
    db.close()
  })

  it('leaves out a night that has gone stale, and prune hands back its poster', () => {
    const db = openDb(':memory:')
    let now = 0
    const schedule = new Schedule({ db, now: () => now })
    schedule.add({ startsAt: SATURDAY, poster: 'old.png', ...PLAIN })
    const next = schedule.add({ startsAt: SATURDAY + 2 * STALE_MS, poster: null, ...PLAIN })

    // Running late is the ordinary case: still listed an hour after its time.
    now = SATURDAY + HOUR
    expect(schedule.list()).toHaveLength(2)

    now = SATURDAY + STALE_MS
    expect(schedule.list()).toEqual([next])
    expect(schedule.prune()).toEqual(['old.png'])
    expect(db.prepare('SELECT COUNT(*) AS n FROM schedule').get()).toEqual({ n: 1 })
    db.close()
  })

  it('says so when it changes, which is what the socket broadcasts on', () => {
    const db = openDb(':memory:')
    const schedule = new Schedule({ db, now: () => 0 })
    let changes = 0
    schedule.on('change', () => changes++)

    const one = schedule.add({ startsAt: SATURDAY, poster: null, ...PLAIN })
    schedule.update(one.id, { startsAt: SATURDAY + 1, poster: null, ...PLAIN })
    schedule.remove(one.id)
    expect(changes).toBe(3)
    db.close()
  })

  it('removing nothing is not a change', () => {
    const db = openDb(':memory:')
    const schedule = new Schedule({ db })
    let changes = 0
    schedule.on('change', () => changes++)
    expect(schedule.remove(1)).toBeNull()
    expect(changes).toBe(0)
    db.close()
  })
})

type Listed = { id: number; startsAt: number; poster: string | null; kind: string; title: string | null }
type Answer = { schedule: Listed | null; upcoming: Listed[] }

describe('the schedule over HTTP', () => {
  let harness: Harness
  afterEach(() => harness.cleanup())

  async function announce(payload: Buffer) {
    const cookie = await signIn(harness)
    return harness.app.inject({
      method: 'POST',
      url: '/api/schedule',
      headers: { ...multipartHeaders(), cookie },
      payload,
    })
  }

  async function edit(id: number | string, payload: Buffer) {
    const cookie = await signIn(harness)
    return harness.app.inject({
      method: 'PUT',
      url: `/api/schedule/${id}`,
      headers: { ...multipartHeaders(), cookie },
      payload,
    })
  }

  async function takeDown(id: number | string) {
    const cookie = await signIn(harness)
    return harness.app.inject({ method: 'DELETE', url: `/api/schedule/${id}`, headers: { cookie } })
  }

  it('is readable by a stranger, on a station with a door on it', async () => {
    harness = await startHarness({ stationKey: 'sesame' })
    const one = harness.schedule.add({ startsAt: SATURDAY, poster: null, ...PLAIN })

    // Everything else on this private station refuses an unkeyed caller. A
    // poster is an advertisement: it is for the people who are not in yet.
    expect((await harness.app.inject({ url: '/api/tracks' })).statusCode).toBe(401)
    const res = await harness.app.inject({ url: '/api/schedule' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ schedule: one, upcoming: [one] })
  })

  it('answers null and an empty list when nothing is announced, rather than 404', async () => {
    harness = await startHarness()
    const res = await harness.app.inject({ url: '/api/schedule' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ schedule: null, upcoming: [] })
  })

  it('takes a time and a poster together, and serves the poster back', async () => {
    harness = await startHarness()
    const res = await announce(posterBody(SATURDAY, PNG))
    expect(res.statusCode).toBe(200)

    const { schedule } = res.json() as Answer
    expect(schedule?.startsAt).toBe(SATURDAY)
    // A bare name, as a track's filename is: the client builds the address.
    expect(schedule?.poster).toMatch(/^[0-9a-f-]+\.png$/)
    expect(await fs.readdir(harness.config.posterDir)).toEqual([schedule?.poster])

    // And it is served open, like the read.
    const fetched = await harness.app.inject({ url: `/api/poster/${schedule?.poster}` })
    expect(fetched.statusCode).toBe(200)
  })

  it('adds a second night alongside the first, rather than replacing it', async () => {
    harness = await startHarness()
    await announce(posterBody(SATURDAY + HOUR, PNG))
    const res = await announce(posterBody(SATURDAY, null, { kind: 'talk', title: 'Sipho' }))

    const { schedule, upcoming } = res.json() as Answer
    expect(upcoming.map((s) => s.startsAt)).toEqual([SATURDAY, SATURDAY + HOUR])
    // The soonest is the next one, whichever was announced first.
    expect(schedule).toEqual(upcoming[0])
    expect(await fs.readdir(harness.config.posterDir)).toHaveLength(1)
  })

  it('keeps the poster already up when an edit sends no new file', async () => {
    harness = await startHarness()
    const first = (await announce(posterBody(SATURDAY, PNG))).json() as Answer
    const id = first.upcoming[0]?.id as number

    const moved = await edit(id, posterBody(SATURDAY + HOUR, null))
    expect(moved.statusCode).toBe(200)
    // Changing the hour should not mean finding the image again.
    expect((moved.json() as Answer).schedule?.poster).toBe(first.schedule?.poster)
    expect(await fs.readdir(harness.config.posterDir)).toHaveLength(1)
  })

  it('unlinks the poster an edit replaces, so the disk holds one per night', async () => {
    harness = await startHarness()
    const first = (await announce(posterBody(SATURDAY, PNG))).json() as Answer
    await edit(first.upcoming[0]?.id as number, posterBody(SATURDAY, PNG))
    expect(await fs.readdir(harness.config.posterDir)).toHaveLength(1)
  })

  it('answers 404 for a night that is not announced, and keeps no poster for it', async () => {
    harness = await startHarness()
    expect((await edit(42, posterBody(SATURDAY, PNG))).statusCode).toBe(404)
    expect((await edit('nope', posterBody(SATURDAY, null))).statusCode).toBe(404)
    expect((await takeDown(42)).statusCode).toBe(404)
    expect(await fs.readdir(harness.config.posterDir)).toEqual([])
  })

  it('refuses a file that is not an image, whatever it says it is', async () => {
    harness = await startHarness()
    const res = await announce(posterBody(SATURDAY, Buffer.from('MZ not a picture')))
    expect(res.statusCode).toBe(415)
    expect(res.json()).toMatchObject({ error: 'unsupported_poster' })
    // And nothing is left behind on the way out.
    expect(await fs.readdir(harness.config.posterDir)).toEqual([])
  })

  it('refuses an announcement with no time on it', async () => {
    harness = await startHarness()
    const res = await announce(posterBody(null, PNG))
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ error: 'no_time' })
    expect(await fs.readdir(harness.config.posterDir)).toEqual([])
  })

  it('is admin-only to add, to edit and to take down', async () => {
    harness = await startHarness()
    const one = harness.schedule.add({ startsAt: SATURDAY, poster: null, ...PLAIN })
    for (const [method, url] of [
      ['POST', '/api/schedule'],
      ['PUT', `/api/schedule/${one.id}`],
    ] as const) {
      const res = await harness.app.inject({
        method,
        url,
        headers: multipartHeaders(),
        payload: posterBody(SATURDAY, null),
      })
      expect(res.statusCode).toBe(401)
    }
    const removed = await harness.app.inject({ method: 'DELETE', url: `/api/schedule/${one.id}` })
    expect(removed.statusCode).toBe(401)
    expect(harness.schedule.list()).toEqual([one])
  })

  it('takes one night down with its poster, and leaves the others', async () => {
    harness = await startHarness()
    const first = (await announce(posterBody(SATURDAY, PNG))).json() as Answer
    await announce(posterBody(SATURDAY + HOUR, null))

    const res = await takeDown(first.upcoming[0]?.id as number)
    expect(res.statusCode).toBe(200)
    const { schedule, upcoming } = res.json() as Answer
    expect(upcoming).toHaveLength(1)
    expect(schedule?.startsAt).toBe(SATURDAY + HOUR)
    // It was only ever for that night.
    expect(await fs.readdir(harness.config.posterDir)).toEqual([])
  })

  it('survives a session, because it is about the nights to come', async () => {
    harness = await startHarness(undefined, { live: true })
    const one = harness.schedule.add({ startsAt: SATURDAY, poster: null, ...PLAIN })

    harness.air.end()

    // The chat, the queue and the library all go here. This is the one thing
    // that is about a night which has not happened yet.
    expect(harness.schedule.list()).toEqual([one])
  })

  it('takes the kind and the title alongside the time', async () => {
    harness = await startHarness()
    const res = await announce(
      posterBody(SATURDAY, null, { kind: 'talk', title: '  A conversation with  Sipho ' }),
    )

    expect(res.statusCode).toBe(200)
    expect((res.json() as Answer).schedule).toMatchObject({
      startsAt: SATURDAY,
      poster: null,
      kind: 'talk',
      // Collapsed and trimmed on the way in: this ends up on a public page.
      title: 'A conversation with Sipho',
    })
  })

  it('is a set with no title when the fields are not sent at all', async () => {
    harness = await startHarness()
    const res = await announce(posterBody(SATURDAY, null))
    expect((res.json() as Answer).schedule).toMatchObject({ startsAt: SATURDAY, poster: null, ...PLAIN })
  })

  it('does not carry a title over an edit that clears it', async () => {
    harness = await startHarness()
    const first = (await announce(posterBody(SATURDAY, null, { kind: 'talk', title: 'Sipho' }))).json() as Answer

    const cleared = await edit(
      first.upcoming[0]?.id as number,
      posterBody(SATURDAY, null, { kind: 'talk', title: '' }),
    )
    // Only the poster is kept across an edit, and only because a file costs
    // something to send again. A title somebody emptied is emptied.
    expect((cleared.json() as Answer).schedule).toMatchObject({ kind: 'talk', title: null })
  })

  it('caps a title at the length a poster line can hold', async () => {
    harness = await startHarness()
    const res = await announce(posterBody(SATURDAY, null, { title: 'x'.repeat(200) }))
    expect((res.json() as Answer).schedule?.title).toHaveLength(80)
  })

  it('reads an unknown kind as a set rather than storing it', async () => {
    harness = await startHarness()
    const res = await announce(posterBody(SATURDAY, null, { kind: 'karaoke' }))
    // There is no third kind of night, and a column the listener page cannot
    // switch on would reach it as a session that renders as neither.
    expect((res.json() as Answer).schedule?.kind).toBe('set')
  })
})

describe('the schedule over the socket', () => {
  let harness: Harness
  afterEach(() => harness.cleanup())

  it('is sent on connect and broadcast when it changes', async () => {
    harness = await startHarness({}, { listen: true })
    const one = harness.schedule.add({ startsAt: SATURDAY, poster: 'a.png', ...PLAIN })

    const client = await TestClient.connect(harness.wsUrl)
    expect(await client.nextSchedule()).toEqual({ type: 'schedule', schedule: one, upcoming: [one] })

    // A page left open on the off-air screen picks up an announcement made
    // after it loaded, which is the whole reason this is on the socket.
    const sooner = harness.schedule.add({
      startsAt: SATURDAY - HOUR,
      poster: null,
      kind: 'talk',
      title: 'Sipho',
    })
    // Whole, rather than a hand-written subset: the socket used to spell out
    // the two fields it knew about, which is how it would come to say less
    // than the same announcement read over HTTP.
    expect(await client.nextSchedule()).toEqual({
      type: 'schedule',
      schedule: sooner,
      upcoming: [sooner, one],
    })

    harness.schedule.remove(sooner.id)
    harness.schedule.remove(one.id)
    await client.nextSchedule()
    expect(await client.nextSchedule()).toEqual({ type: 'schedule', schedule: null, upcoming: [] })
    await client.close()
  })
})
