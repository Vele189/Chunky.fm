import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ADMIN_PASSWORD, type Harness, startHarness } from './helpers.js'

let harness: Harness

const session = (headers: Record<string, string>) =>
  harness.app.inject({ method: 'GET', url: '/api/admin/session', headers })

beforeEach(async () => {
  harness = await startHarness()
})

afterEach(async () => {
  await harness.cleanup()
})

describe('GET /api/admin/session', () => {
  it('confirms a password the station accepts', async () => {
    const res = await session({ authorization: `Bearer ${ADMIN_PASSWORD}` })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it('takes the password the admin header carries too', async () => {
    expect((await session({ 'x-admin-password': ADMIN_PASSWORD })).statusCode).toBe(200)
  })

  it('refuses a wrong password, which is how the UI knows to keep the form up', async () => {
    expect((await session({ authorization: 'Bearer nope' })).statusCode).toBe(401)
    expect((await session({})).statusCode).toBe(401)
  })
})
