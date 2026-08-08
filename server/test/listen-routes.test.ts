import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  LISTENER_COOKIE,
  issueListenerSession,
  mayListen,
  verifyListenerSession,
} from '../src/lib/auth.js'
import { type Harness, ADMIN_PASSWORD, startHarness } from './helpers.js'

const KEY = 'a-long-random-station-key'

describe('the station key, as a value', () => {
  it('signs an invite the same key verifies', () => {
    const session = issueListenerSession(KEY)

    expect(verifyListenerSession(KEY, session.token)).toBe(true)
  })

  it('refuses an invite minted under a key that has since been rotated', () => {
    const session = issueListenerSession(KEY)

    expect(verifyListenerSession('a-different-key', session.token)).toBe(false)
  })

  it('refuses an invite that has run out, however good the signature', () => {
    const session = issueListenerSession(KEY, Date.now(), -1)

    expect(verifyListenerSession(KEY, session.token)).toBe(false)
  })

  it('refuses anything that is not one of its own tokens', () => {
    for (const junk of ['', '.', 'not.a.token', 'a.b']) {
      expect(verifyListenerSession(KEY, junk)).toBe(false)
    }
  })
})

describe('who may listen', () => {
  const open = { stationKey: null } as never
  const shut = { stationKey: KEY, adminPassword: ADMIN_PASSWORD } as never

  it('admits everyone when no key is set: the station PLAN.md describes', () => {
    expect(mayListen(open, {})).toBe(true)
  })

  /**
   * The whole point of the falsy check in `mayListen`. A config assembled
   * without the field (an older deployment, a test helper, a partial object)
   * has always meant an open station, and adding a setting must not shut one
   * by being absent.
   */
  it('admits everyone when the field is missing entirely, not just null', () => {
    expect(mayListen({} as never, {})).toBe(true)
    expect(mayListen({ stationKey: '' } as never, {})).toBe(true)
  })

  it('refuses a browser with nothing to show once a key is set', () => {
    expect(mayListen(shut, {})).toBe(false)
  })

  it('admits a browser holding an invite signed by the current key', () => {
    const session = issueListenerSession(KEY)

    expect(mayListen(shut, { cookie: `${LISTENER_COOKIE}=${session.token}` })).toBe(true)
  })

  it('refuses an invite from before the key was rotated', () => {
    const stale = issueListenerSession('the-previous-key')

    expect(mayListen(shut, { cookie: `${LISTENER_COOKIE}=${stale.token}` })).toBe(false)
  })

  it('takes the key presented directly, for curl and the QA scripts', () => {
    expect(mayListen(shut, { 'x-station-key': KEY })).toBe(true)
    expect(mayListen(shut, { 'x-station-key': 'wrong' })).toBe(false)
  })

  /** Whoever runs the decks does not need an invite to their own station. */
  it('admits the admin without an invite', () => {
    expect(mayListen(shut, { authorization: `Bearer ${ADMIN_PASSWORD}` })).toBe(true)
  })
})

describe('a private station, over the routes', () => {
  let station: Harness

  beforeEach(async () => {
    station = await startHarness({ stationKey: KEY })
  })

  afterEach(async () => {
    await station.cleanup()
  })

  it('refuses the library to a stranger', async () => {
    const response = await station.app.inject({ method: 'GET', url: '/api/tracks' })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({ error: 'unauthorized' })
  })

  it('says whether this browser is admitted, without being asked to guess', async () => {
    const stranger = await station.app.inject({ method: 'GET', url: '/api/listen' })
    expect(stranger.statusCode).toBe(401)

    const invited = await station.app.inject({
      method: 'GET',
      url: '/api/listen',
      headers: { 'x-station-key': KEY },
    })
    expect(invited.statusCode).toBe(204)
  })

  it('exchanges the key for a cookie that then opens the library', async () => {
    const redeemed = await station.app.inject({
      method: 'POST',
      url: '/api/listen',
      payload: { key: KEY },
    })

    expect(redeemed.statusCode).toBe(204)
    const setCookie = String(redeemed.headers['set-cookie'])
    expect(setCookie).toContain(`${LISTENER_COOKIE}=`)
    expect(setCookie).toContain('HttpOnly')

    const cookie = setCookie.split(';')[0]!
    const tracks = await station.app.inject({
      method: 'GET',
      url: '/api/tracks',
      headers: { cookie },
    })
    expect(tracks.statusCode).toBe(200)
  })

  it('refuses a key that is not this station’s, and hands back no cookie to keep', async () => {
    const response = await station.app.inject({
      method: 'POST',
      url: '/api/listen',
      payload: { key: 'from-some-other-station' },
    })

    expect(response.statusCode).toBe(401)
    expect(String(response.headers['set-cookie'])).toContain(`${LISTENER_COOKIE}=;`)
  })

  it('still lets the admin in with the password alone', async () => {
    const response = await station.app.inject({
      method: 'GET',
      url: '/api/tracks',
      headers: { authorization: `Bearer ${ADMIN_PASSWORD}` },
    })

    expect(response.statusCode).toBe(200)
  })
})

describe('an open station, over the routes', () => {
  let station: Harness

  beforeEach(async () => {
    station = await startHarness()
  })

  afterEach(async () => {
    await station.cleanup()
  })

  it('serves the library to anyone, as it always has', async () => {
    const response = await station.app.inject({ method: 'GET', url: '/api/tracks' })

    expect(response.statusCode).toBe(200)
  })

  it('admits every browser that asks', async () => {
    const response = await station.app.inject({ method: 'GET', url: '/api/listen' })

    expect(response.statusCode).toBe(204)
  })
})

describe('the invite the console hands out', () => {
  let station: Harness

  afterEach(async () => {
    await station.cleanup()
  })

  it('gives the key to the admin, so the console can build a link', async () => {
    station = await startHarness({ stationKey: KEY })

    const response = await station.app.inject({
      method: 'GET',
      url: '/api/invite',
      headers: { authorization: `Bearer ${ADMIN_PASSWORD}` },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ key: KEY })
  })

  /**
   * The whole invitation policy in one check. A listener's browser cannot
   * rebuild an invite on its own, so this endpoint is the only way one could
   * leak, and an admitted listener is exactly who must not have it, or one
   * invite quietly invites everyone they know.
   */
  it('refuses it to a listener who is already admitted', async () => {
    station = await startHarness({ stationKey: KEY })
    const redeemed = await station.app.inject({
      method: 'POST',
      url: '/api/listen',
      payload: { key: KEY },
    })
    const cookie = String(redeemed.headers['set-cookie']).split(';')[0]!

    const response = await station.app.inject({
      method: 'GET',
      url: '/api/invite',
      headers: { cookie },
    })

    expect(response.statusCode).toBe(401)
  })

  it('refuses it to a stranger', async () => {
    station = await startHarness({ stationKey: KEY })

    const response = await station.app.inject({ method: 'GET', url: '/api/invite' })

    expect(response.statusCode).toBe(401)
  })

  it('says there is no key on an open station, rather than inventing one', async () => {
    station = await startHarness()

    const response = await station.app.inject({
      method: 'GET',
      url: '/api/invite',
      headers: { authorization: `Bearer ${ADMIN_PASSWORD}` },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ key: null })
  })
})
