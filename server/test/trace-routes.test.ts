import { afterEach, describe, expect, it } from 'vitest'
import { type Harness, startHarness } from './helpers.js'

let harness: Harness

afterEach(async () => {
  await harness.cleanup()
})

const batch = (events: unknown[] = [{ at: 1, kind: 'waiting', deck: 'a', pos: 12.5 }]) => ({
  session: 'abc123',
  nickname: 'sam',
  ua: 'Safari',
  events,
})

const post = (payload: unknown) =>
  harness.app.inject({ method: 'POST', url: '/api/trace', payload: payload as object })

describe('POST /api/trace', () => {
  it('accepts a batch of audio events', async () => {
    harness = await startHarness()
    const res = await post(batch())
    expect(res.statusCode).toBe(204)
  })

  it('refuses an event without a kind', async () => {
    harness = await startHarness()
    const res = await post(batch([{ at: 1 }]))
    expect(res.statusCode).toBe(400)
  })

  it('refuses an oversized batch', async () => {
    harness = await startHarness()
    const many = Array.from({ length: 61 }, (_, i) => ({ at: i, kind: 'beat' }))
    expect((await post(batch(many))).statusCode).toBe(400)
  })

  it('throttles one address that keeps sending', async () => {
    harness = await startHarness()
    const codes: number[] = []
    for (let i = 0; i < 12; i++) codes.push((await post(batch())).statusCode)
    expect(codes.slice(0, 10).every((code) => code === 204)).toBe(true)
    expect(codes.at(-1)).toBe(429)
  })

  it('is shut on a private station to anyone without the key', async () => {
    harness = await startHarness({ stationKey: 'door-key-for-tests' })
    expect((await post(batch())).statusCode).toBe(401)
  })
})
