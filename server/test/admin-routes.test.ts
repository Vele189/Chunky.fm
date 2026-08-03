import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ADMIN_COOKIE,
  SESSION_TTL_MS,
  issueAdminSession,
  verifyAdminSession,
} from '../src/lib/auth.js'
import { ADMIN_PASSWORD, type Harness, signIn, startHarness, tokenFrom } from './helpers.js'

let harness: Harness

const session = (headers: Record<string, string>) =>
  harness.app.inject({ method: 'GET', url: '/api/admin/session', headers })

const attempt = (password: unknown) =>
  harness.app.inject({ method: 'POST', url: '/api/admin/session', payload: { password } })

const attributes = (setCookie: string) =>
  setCookie
    .split(';')
    .slice(1)
    .map((part) => part.trim())

beforeEach(async () => {
  harness = await startHarness()
})

afterEach(async () => {
  await harness.cleanup()
})

describe('POST /api/admin/session', () => {
  it('exchanges the password for a signed cookie', async () => {
    const res = await attempt(ADMIN_PASSWORD)

    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
    // Near enough the full TTL — the panel is told when the session lapses.
    expect(res.json().expiresAt).toBeGreaterThan(Date.now() + SESSION_TTL_MS - 5_000)

    expect(String(res.headers['set-cookie']).startsWith(`${ADMIN_COOKIE}=`)).toBe(true)
    expect(verifyAdminSession(harness.config, tokenFrom(res))).toBe(true)
  })

  it('ships the cookie the way the browser needs it: unreadable, and not cross-site', async () => {
    const set = attributes(String((await attempt(ADMIN_PASSWORD)).headers['set-cookie']))

    expect(set).toContain('HttpOnly')
    expect(set).toContain('SameSite=Strict')
    expect(set).toContain('Path=/')
    // Development is plain HTTP, and a Secure cookie would never come back.
    expect(set).not.toContain('Secure')
  })

  it('marks the cookie Secure when the request arrived over TLS', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/admin/session',
      headers: { 'x-forwarded-proto': 'https' },
      payload: { password: ADMIN_PASSWORD },
    })

    expect(attributes(String(res.headers['set-cookie']))).toContain('Secure')
  })

  it('refuses a wrong password, and hands back no session', async () => {
    const res = await attempt('not-the-password')

    expect(res.statusCode).toBe(401)
    expect(res.json().error).toBe('unauthorized')
    expect(String(res.headers['set-cookie'])).toContain(`${ADMIN_COOKIE}=;`)
  })

  it('refuses a body that could not be a password at all', async () => {
    expect((await attempt(undefined)).statusCode).toBe(400)
    expect((await attempt('')).statusCode).toBe(400)
    expect((await attempt('x'.repeat(513))).statusCode).toBe(400)
    // Fastify coerces a JSON number to its digits, so this is simply wrong
    // rather than malformed — and either way it never reaches the station.
    expect((await attempt(12345)).statusCode).toBe(401)
  })
})

describe('GET /api/admin/session', () => {
  it('accepts the cookie the exchange issued', async () => {
    const cookie = await signIn(harness)

    const res = await session({ cookie })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it('still takes the password directly, for curl and the QA scripts', async () => {
    expect((await session({ authorization: `Bearer ${ADMIN_PASSWORD}` })).statusCode).toBe(200)
    expect((await session({ 'x-admin-password': ADMIN_PASSWORD })).statusCode).toBe(200)
  })

  it('refuses anything else, which is how the UI knows to keep the form up', async () => {
    expect((await session({ authorization: 'Bearer nope' })).statusCode).toBe(401)
    expect((await session({})).statusCode).toBe(401)
  })

  it('refuses a session that has lapsed', async () => {
    const stale = issueAdminSession(harness.config, Date.now() - SESSION_TTL_MS - 1_000)

    expect((await session({ cookie: `${ADMIN_COOKIE}=${stale.token}` })).statusCode).toBe(401)
  })

  it('refuses a cookie edited to last longer than it was issued for', async () => {
    const [, nonce, signature] = issueAdminSession(harness.config).token.split('.')
    const forged = `${Date.now() + 10 * SESSION_TTL_MS}.${nonce}.${signature}`

    expect((await session({ cookie: `${ADMIN_COOKIE}=${forged}` })).statusCode).toBe(401)
  })

  it('refuses a cookie signed for a different password', async () => {
    const elsewhere = issueAdminSession({ ...harness.config, adminPassword: 'some-other-station' })

    expect((await session({ cookie: `${ADMIN_COOKIE}=${elsewhere.token}` })).statusCode).toBe(401)
  })

  it('sheds a cookie it refuses, so the browser stops sending it', async () => {
    const res = await session({ cookie: `${ADMIN_COOKIE}=rubbish` })

    expect(res.statusCode).toBe(401)
    expect(String(res.headers['set-cookie'])).toContain(`${ADMIN_COOKIE}=;`)
  })

  it('picks its cookie out of the ones the page keeps beside it', async () => {
    const cookie = await signIn(harness)

    expect((await session({ cookie: `nick=dj; ${cookie}; theme=dark` })).statusCode).toBe(200)
  })
})

describe('DELETE /api/admin/session', () => {
  it('drops the cookie, and the session with it', async () => {
    const cookie = await signIn(harness)
    expect((await session({ cookie })).statusCode).toBe(200)

    const out = await harness.app.inject({
      method: 'DELETE',
      url: '/api/admin/session',
      headers: { cookie },
    })

    expect(out.statusCode).toBe(200)
    // What the browser is told to keep is an empty cookie that expires at once.
    const cleared = String(out.headers['set-cookie'])
    expect(cleared).toContain(`${ADMIN_COOKIE}=;`)
    expect(cleared).toContain('Max-Age=0')
  })

  it('works for someone who was never signed in', async () => {
    const out = await harness.app.inject({ method: 'DELETE', url: '/api/admin/session' })

    expect(out.statusCode).toBe(200)
  })
})
