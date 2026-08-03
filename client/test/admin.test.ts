import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminApi, AdminError, isAdminRoute } from '../src/lib/admin.js'

const PASSWORD = 'hunter2'

interface Call {
  url: string
  init: RequestInit
}

let calls: Call[]
let respond: (url: string, init: RequestInit) => Response

/** Stands in for the network. Every request is recorded, in order. */
const fetchStub = vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = String(input)
  calls.push({ url, init })
  return Promise.resolve(respond(url, init))
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const api = () => new AdminApi(PASSWORD, { fetch: fetchStub as unknown as typeof globalThis.fetch })

const headerOf = (call: Call, name: string) =>
  new Headers(call.init.headers as HeadersInit).get(name)

beforeEach(() => {
  calls = []
  respond = () => json({})
  fetchStub.mockClear()
})

describe('isAdminRoute', () => {
  it('opens on #admin or /admin, and nowhere else', () => {
    expect(isAdminRoute({ pathname: '/', hash: '#admin' })).toBe(true)
    expect(isAdminRoute({ pathname: '/admin', hash: '' })).toBe(true)

    expect(isAdminRoute({ pathname: '/', hash: '' })).toBe(false)
    expect(isAdminRoute({ pathname: '/', hash: '#administrator' })).toBe(false)
    expect(isAdminRoute({ pathname: '/admin-ish', hash: '' })).toBe(false)
  })
})

describe('AdminApi credentials', () => {
  it('presents the password on every request', async () => {
    respond = () => json({ tracks: [], entries: [], ok: true })

    await api().verify()
    await api().command({ action: 'pause' })
    await api().enqueue(7)
    await api().move(3, 0)
    await api().remove(3)
    await api().clearQueue()

    expect(calls).toHaveLength(6)
    for (const call of calls) {
      expect(headerOf(call, 'authorization')).toBe(`Bearer ${PASSWORD}`)
    }
  })

  it('reports a rejected password rather than throwing', async () => {
    respond = () => json({ error: 'unauthorized' }, 401)

    await expect(api().verify()).resolves.toBe(false)
  })

  it('accepts a password the server is happy with', async () => {
    respond = (url) => (url.endsWith('/api/admin/session') ? json({ ok: true }) : json({}, 500))

    await expect(api().verify()).resolves.toBe(true)
  })

  it('marks a mid-session 401 as unauthorized, so the UI can sign out', async () => {
    respond = () => json({ error: 'unauthorized' }, 401)

    const err = await api()
      .command({ action: 'skip' })
      .catch((e: unknown) => e)

    expect(err).toBeInstanceOf(AdminError)
    expect((err as AdminError).unauthorized).toBe(true)
    expect((err as AdminError).message).toBe('wrong password')
  })
})

describe('AdminApi playback commands', () => {
  it('posts the command as JSON', async () => {
    respond = () => json({ type: 'state', track: null })

    await api().command({ action: 'play', trackId: 4 })

    expect(calls[0]!.url).toBe('/api/playback')
    expect(calls[0]!.init.method).toBe('POST')
    expect(headerOf(calls[0]!, 'content-type')).toBe('application/json')
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ action: 'play', trackId: 4 })
  })

  it('surfaces what the server said when a command is refused', async () => {
    respond = () => json({ error: 'unknown_track', message: 'no track 99' }, 404)

    const err = await api()
      .command({ action: 'play', trackId: 99 })
      .catch((e: unknown) => e)

    expect((err as AdminError).status).toBe(404)
    expect((err as AdminError).code).toBe('unknown_track')
    expect((err as AdminError).message).toBe('no track 99')
  })

  it('still says something useful when the failure is not JSON', async () => {
    respond = () => new Response('<html>502 Bad Gateway</html>', { status: 502 })

    const err = await api().clearQueue().catch((e: unknown) => e)

    expect((err as AdminError).status).toBe(502)
    expect((err as AdminError).message).toBe('request failed (502)')
  })
})

describe('AdminApi queue', () => {
  it('addresses entries by id, and sends the target position', async () => {
    respond = () => json({ entries: [] })

    await api().move(12, 3)
    await api().remove(12)
    await api().clearQueue()

    expect(calls[0]!.url).toBe('/api/queue/move')
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ entryId: 12, toIndex: 3 })
    expect(calls[1]).toMatchObject({ url: '/api/queue/12' })
    expect(calls[1]!.init.method).toBe('DELETE')
    expect(calls[2]).toMatchObject({ url: '/api/queue' })
    expect(calls[2]!.init.method).toBe('DELETE')
  })

  it('queues a track by id', async () => {
    respond = () => json({ entry: { id: 1 }, entries: [{ id: 1 }] })

    const result = await api().enqueue(5)

    expect(calls[0]!.init.method).toBe('POST')
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ trackId: 5 })
    expect(result.entries).toHaveLength(1)
  })

  it('unwraps the library and the queue', async () => {
    respond = (url) =>
      url.endsWith('/api/tracks') ? json({ tracks: [{ id: 1 }] }) : json({ entries: [{ id: 9 }] })

    expect(await api().tracks()).toEqual([{ id: 1 }])
    expect(await api().queue()).toEqual([{ id: 9 }])
  })
})

describe('AdminApi upload', () => {
  const file = () => new File(['audio bytes'], 'track.mp3', { type: 'audio/mpeg' })

  it('sends the file as multipart, and lets fetch set the boundary', async () => {
    respond = () => json({ track: { id: 1, title: 'Track' } }, 201)

    const result = await api().upload(file())

    expect(calls[0]!.url).toBe('/api/upload')
    expect(calls[0]!.init.body).toBeInstanceOf(FormData)
    expect((calls[0]!.init.body as FormData).get('file')).toBeInstanceOf(File)
    // Setting content-type by hand here would omit the multipart boundary and
    // the server would reject the body as malformed.
    expect(headerOf(calls[0]!, 'content-type')).toBeNull()
    expect(result.duplicate).toBe(false)
  })

  it('treats a duplicate as a success — the track is in the library either way', async () => {
    respond = () =>
      json({ error: 'duplicate', message: 'already', track: { id: 3, title: 'Track' } }, 409)

    const result = await api().upload(file())

    expect(result.duplicate).toBe(true)
    expect(result.track.id).toBe(3)
  })

  it('reports what the server said about a file it would not take', async () => {
    respond = () => json({ error: 'unsupported_audio', message: 'not usable audio' }, 415)

    const err = await api().upload(file()).catch((e: unknown) => e)

    expect((err as AdminError).status).toBe(415)
    expect((err as AdminError).message).toBe('not usable audio')
  })
})
