/**
 * Wishes end to end: a listener asks over the socket, the admin reads the book
 * over HTTP and marks it off.
 *
 * The two halves are tested together because the interesting properties live
 * between them — that the name on a wish is the roster's answer rather than the
 * frame's, and that a wish reaches the admin without reaching the room.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ErrorMessage } from '../src/protocol.js'
import { ADMIN_PASSWORD, type Harness, startHarness } from './helpers.js'
import { TestClient } from './ws-client.js'

let harness: Harness
const clients: TestClient[] = []

const auth = { authorization: `Bearer ${ADMIN_PASSWORD}` }

beforeEach(async () => {
  harness = await startHarness({}, { listen: true })
})

afterEach(async () => {
  await Promise.all(clients.map((client) => client.close()))
  clients.length = 0
  await harness.cleanup()
})

/** A listener with a name, with the connect burst already consumed. */
async function listener(nickname: string): Promise<TestClient> {
  const client = await TestClient.connect(harness.wsUrl)
  clients.push(client)
  await client.nextState()
  await client.nextQueue()
  await client.nextPresence()
  await client.nextChat()
  await client.join(nickname)
  return client
}

const nextError = async (client: TestClient): Promise<ErrorMessage> =>
  (await client.waitFor((m) => m.type === 'error')) as ErrorMessage

const readBook = (headers: Record<string, string> = auth) =>
  harness.app.inject({ method: 'GET', url: '/api/wishes', headers })

const mark = (wishId: number, status: unknown, headers: Record<string, string> = auth) =>
  harness.app.inject({ method: 'POST', url: `/api/wishes/${wishId}`, headers, payload: { status } })

describe('making a wish', () => {
  it('answers the listener with what was written down', async () => {
    const sam = await listener('sam')

    const { wish } = await sam.wish('  anything   off Rumours ')

    expect(wish).toEqual({
      id: expect.any(Number),
      nickname: 'sam',
      text: 'anything off Rumours',
      at: expect.any(Number),
      status: 'new',
    })
  })

  it('signs it with the name on the roster, not one the frame chose', async () => {
    const sam = await listener('sam')

    sam.send({ type: 'wish', text: 'some Bowie', nickname: 'ana' } as never)
    const { wish } = (await sam.waitFor((m) => m.type === 'wished')) as { wish: { nickname: string } }

    expect(wish.nickname).toBe('sam')
  })

  it('needs a name first, and says so about the wish', async () => {
    const anonymous = await TestClient.connect(harness.wsUrl)
    clients.push(anonymous)

    anonymous.send({ type: 'wish', text: 'before naming myself' })
    const refusal = await nextError(anonymous)

    expect(refusal).toMatchObject({ code: 'not_joined', about: 'wish' })
    expect((await readBook()).json().wishes).toEqual([])
  })

  it('tells nobody else in the room', async () => {
    const sam = await listener('sam')
    const ana = await listener('ana')

    await sam.wish('something loud')
    // Long enough that a broadcast would have arrived by now.
    await new Promise((resolve) => setTimeout(resolve, 150))

    expect(ana.seen.filter((m) => m.type === 'wished')).toEqual([])
    // Nor down the chat, which is the other thing a listener types into.
    expect(ana.seen.flatMap((m) => (m.type === 'chat' ? m.messages : []))).toEqual([])
  })

  it('is paced, so one listener cannot fill the book', async () => {
    await harness.cleanup()
    harness = await startHarness({}, { listen: true, wishBurst: 2, wishRefillMs: 60_000 })
    const sam = await listener('sam')

    await sam.wish('one')
    await sam.wish('two')
    sam.send({ type: 'wish', text: 'three' })

    expect(await nextError(sam)).toMatchObject({ code: 'slow_down', about: 'wish' })
    expect((await readBook()).json().wishes).toHaveLength(2)
  })

  it('paces wishes separately from chat, so asking never costs a listener their voice', async () => {
    await harness.cleanup()
    harness = await startHarness({}, { listen: true, wishBurst: 1, wishRefillMs: 60_000 })
    const sam = await listener('sam')

    await sam.wish('the one I am allowed')
    sam.send({ type: 'wish', text: 'the one I am not' })
    expect(await nextError(sam)).toMatchObject({ code: 'slow_down', about: 'wish' })

    // The chat bucket is untouched — a refused wish is not a gag order.
    const said = await sam.say('can I still talk?')
    expect(said.messages[0]).toMatchObject({ nickname: 'sam', text: 'can I still talk?' })
  })
})

describe('GET /api/wishes', () => {
  it('needs admin credentials — this is the one read that is not open', async () => {
    const sam = await listener('sam')
    await sam.wish('something for the drive home')

    const res = await readBook({})

    expect(res.statusCode).toBe(401)
    expect(res.json()).toMatchObject({ error: 'unauthorized' })
  })

  it('is empty before anyone asks for anything', async () => {
    const res = await readBook()

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ wishes: [], outstanding: 0 })
  })

  it('hands over this session’s wishes, oldest first', async () => {
    const sam = await listener('sam')
    const ana = await listener('ana')
    await sam.wish('first')
    await ana.wish('second')

    const { wishes, outstanding } = (await readBook()).json()

    expect(wishes.map((wish: { nickname: string; text: string }) => `${wish.nickname}: ${wish.text}`))
      .toEqual(['sam: first', 'ana: second'])
    expect(outstanding).toBe(2)
  })
})

describe('POST /api/wishes/:wishId', () => {
  async function wished(text = 'play something loud'): Promise<number> {
    const sam = await listener('sam')
    return (await sam.wish(text)).wish.id
  }

  it('needs admin credentials', async () => {
    const wishId = await wished()

    const res = await mark(wishId, 'handled', {})

    expect(res.statusCode).toBe(401)
    expect(harness.wishes.outstanding()).toBe(1)
  })

  it('marks a wish handled and answers with the book as it now stands', async () => {
    const wishId = await wished()

    const res = await mark(wishId, 'handled')

    expect(res.statusCode).toBe(200)
    expect(res.json().wish).toMatchObject({ id: wishId, status: 'handled' })
    expect(res.json().outstanding).toBe(0)
    // Still in the book: handled is a note about a wish, not a way to lose it.
    expect(res.json().wishes).toHaveLength(1)
  })

  it('puts one back that was marked by mistake', async () => {
    const wishId = await wished()
    await mark(wishId, 'handled')

    const res = await mark(wishId, 'new')

    expect(res.json().wish).toMatchObject({ status: 'new' })
    expect(res.json().outstanding).toBe(1)
  })

  it('refuses a status the book has no meaning for', async () => {
    const res = await mark(await wished(), 'played-ish')

    expect(res.statusCode).toBe(400)
    expect(String(res.json().error)).toMatch(/^[a-z][a-z_]*$/)
  })

  it('is a 404 for a wish that is not there, addressable by code', async () => {
    const res = await mark(9999, 'handled')

    expect(res.statusCode).toBe(404)
    expect(res.json()).toMatchObject({ error: 'unknown_wish' })
  })
})
