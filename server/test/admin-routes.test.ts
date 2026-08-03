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

/**
 * The password is the entire admin gate — it guards every upload, the queue and
 * the decks — so the rate at which a stranger can test guesses is part of how
 * strong it is. Without pacing, a passphrase that would take centuries offline
 * is a few hours of HTTP requests, and nothing in the logs looks different from
 * one wrong attempt.
 */
describe('sign-in throttling', () => {
  const wrong = () => attempt('definitely-not-it')

  /**
   * These need their own limits, and `beforeEach` has already built a station
   * with the defaults — so that one is closed rather than abandoned. A harness
   * dropped on the floor keeps a Fastify instance, a database and a temp
   * directory alive for the rest of the run.
   */
  const rebuild = async (options: Parameters<typeof startHarness>[1]) => {
    await harness.cleanup()
    harness = await startHarness({}, options)
  }

  it('refuses to keep answering guesses from one caller', async () => {
    await rebuild({ signInBurst: 3, signInRefillMs: 60_000 })

    const allowed = await Promise.all([wrong(), wrong(), wrong()])
    for (const res of allowed) expect(res.statusCode).toBe(401)

    const throttled = await wrong()
    expect(throttled.statusCode).toBe(429)
    // The same shape as every other refusal in the API — see contract.test.ts.
    expect(throttled.json()).toMatchObject({ error: 'too_many_requests' })
    expect(typeof throttled.json().message).toBe('string')
    // Something to wait for, rather than a closed door with no hint.
    expect(Number(throttled.headers['retry-after'])).toBeGreaterThan(0)
  })

  it('refuses the right password too, once the guessing has been throttled', async () => {
    await rebuild({ signInBurst: 1, signInRefillMs: 60_000 })
    expect((await wrong()).statusCode).toBe(401)

    // The check happens before the comparison on purpose: a throttle that still
    // compared the password would still be letting the guessing happen, which
    // is the only thing it exists to stop.
    const res = await attempt(ADMIN_PASSWORD)
    expect(res.statusCode).toBe(429)
  })

  it('lets the admin back in once the bucket has refilled', async () => {
    await rebuild({ signInBurst: 1, signInRefillMs: 20 })
    expect((await wrong()).statusCode).toBe(401)
    expect((await wrong()).statusCode).toBe(429)

    await new Promise((resolve) => setTimeout(resolve, 40))
    expect((await attempt(ADMIN_PASSWORD)).statusCode).toBe(200)
  })

  it('forgets the fumbled attempts of whoever turns out to be the admin', async () => {
    await rebuild({ signInBurst: 3, signInRefillMs: 60_000 })

    // Two wrong, then right: an admin who could not remember which password it
    // was is not an attacker, and should not spend the rest of the evening one
    // typo away from being locked out of their own station.
    expect((await wrong()).statusCode).toBe(401)
    expect((await wrong()).statusCode).toBe(401)
    expect((await attempt(ADMIN_PASSWORD)).statusCode).toBe(200)

    for (let i = 0; i < 3; i++) expect((await wrong()).statusCode).toBe(401)
  })

  it('paces each caller behind the proxy, not the proxy itself', async () => {
    await rebuild({ signInBurst: 2, signInRefillMs: 60_000 })
    const from = (ip: string) =>
      harness.app.inject({
        method: 'POST',
        url: '/api/admin/session',
        headers: { 'x-forwarded-for': ip },
        payload: { password: 'definitely-not-it' },
      })

    // Nothing reaches this station directly — nginx is in front of it in
    // compose, the platform edge is in production — so without reading through
    // the proxy every caller alive shares one bucket. That is not a limit on
    // guessing, it is a stranger locking the admin out of their own station
    // with five wrong passwords a minute, and the correct password refused
    // along with them because the gate is checked before the comparison.
    expect((await from('203.0.113.7')).statusCode).toBe(401)
    expect((await from('203.0.113.7')).statusCode).toBe(401)
    expect((await from('203.0.113.7')).statusCode).toBe(429)

    // A different caller, same proxy, untouched by any of that.
    expect((await from('198.51.100.4')).statusCode).toBe(401)

    // And the admin, who is also behind that proxy, can still get in.
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/admin/session',
      headers: { 'x-forwarded-for': '198.51.100.4' },
      payload: { password: ADMIN_PASSWORD },
    })
    expect(res.statusCode).toBe(200)
  })

  it('does not throttle the gate on every other admin route', async () => {
    await rebuild({ signInBurst: 1, signInRefillMs: 60_000 })
    const cookie = await signIn(harness)
    expect((await wrong()).statusCode).toBe(401)
    expect((await wrong()).statusCode).toBe(429)

    // Only sign-in is paced. A session already issued is a credential the
    // caller has proved, and rate-limiting the panel's own polling would break
    // the admin surface to protect a password nobody is guessing.
    for (let i = 0; i < 10; i++) expect((await session({ cookie })).statusCode).toBe(200)
  })
})
