import type { PlaybackSnapshot, QueueEntry, Track } from './protocol.js'

/** Where the admin controls live. */
export const ADMIN_HASH = '#admin'

export function isAdminRoute(location: { pathname: string; hash: string }): boolean {
  return location.hash === ADMIN_HASH || location.pathname === '/admin'
}

export type PlaybackAction = 'play' | 'pause' | 'resume' | 'seek' | 'stop' | 'skip'

export interface PlaybackCommand {
  action: PlaybackAction
  trackId?: number
  positionMs?: number
}

export interface UploadResult {
  track: Track
  /** The file was already in the library — the same track, not a second copy. */
  duplicate: boolean
}

/** A request the server refused. `status` is what decides how the UI reacts. */
export class AdminError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'AdminError'
    this.status = status
    this.code = code
  }

  /** The session is over — sign in again, don't retry. */
  get unauthorized(): boolean {
    return this.status === 401
  }
}

/**
 * What the station said, when it is something worth repeating to the admin.
 *
 * Every 4xx message in this API is written for whoever is holding it wrong and
 * says nothing private — that is the contract `lib/errors.ts` keeps, and why
 * 5xx messages are replaced rather than repeated. So a refusal the station
 * wrote is shown as written, and anything else — a 500, a network failure, a
 * response that was not this API at all — is null for the caller to summarise.
 *
 * Without this, a throttled sign-in reads as "could not reach the station",
 * which sends the admin looking for a network problem that is not there.
 */
export function refusalMessage(err: unknown): string | null {
  if (!(err instanceof AdminError)) return null
  if (err.status < 400 || err.status >= 500) return null
  return err.message
}

export interface AdminApiOptions {
  /** Injected in tests; the browser supplies the real one. */
  fetch?: typeof globalThis.fetch
  /** Same origin by default — Vite proxies /api through to the server. */
  baseUrl?: string
}

interface ErrorBody {
  error?: unknown
  message?: unknown
}

/**
 * The admin's side of the HTTP API.
 *
 * The password is handed over once, at `signIn`, and exchanged for the signed
 * session cookie described in PLAN.md. Nothing here holds a secret afterwards:
 * the cookie is HttpOnly, so this code cannot read it even to send it — the
 * browser attaches it, and every method below is just a same-origin request.
 */
export class AdminApi {
  readonly #fetch: typeof globalThis.fetch
  readonly #baseUrl: string

  constructor({ fetch = globalThis.fetch, baseUrl = '' }: AdminApiOptions = {}) {
    // Bound: fetch called as a method of anything but window throws in browsers,
    // the same way calling a stored setTimeout does — see lib/station.ts.
    this.#fetch = fetch.bind(globalThis)
    this.#baseUrl = baseUrl
  }

  /**
   * Exchange the password for a session. `false` means the station said no,
   * which is the sign-in form's cue to stay up; a throw means it said nothing.
   */
  async signIn(password: string): Promise<boolean> {
    const response = await this.#request('POST', '/api/admin/session', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (response.status === 401) return false
    if (!response.ok) throw await this.#toError(response)
    return true
  }

  /** Is the session still good? What the panel asks before showing controls. */
  async verify(): Promise<boolean> {
    const response = await this.#request('GET', '/api/admin/session')
    if (response.status === 401) return false
    if (!response.ok) throw await this.#toError(response)
    return true
  }

  /**
   * End the session at the server, not just in this tab. Failure is ignored on
   * purpose: the admin asked to be signed out, and the UI obliges either way.
   */
  async signOut(): Promise<void> {
    try {
      await this.#request('DELETE', '/api/admin/session')
    } catch {
      // Unreachable station. The cookie lapses on its own soon enough.
    }
  }

  /** The library. Public, but only the admin has anything to do with it. */
  async tracks(): Promise<Track[]> {
    return (await this.#json<{ tracks: Track[] }>('GET', '/api/tracks')).tracks
  }

  async upload(file: File): Promise<UploadResult> {
    const body = new FormData()
    body.append('file', file, file.name)

    // No content-type by hand: fetch sets it, with the multipart boundary.
    const response = await this.#request('POST', '/api/upload', { body })

    // Not an error worth showing as one: the file is in the library, which is
    // what the admin wanted. Uploading by content hash makes this a no-op.
    if (response.status === 409) {
      const duplicate = (await response.json()) as { track: Track }
      return { track: duplicate.track, duplicate: true }
    }
    if (!response.ok) throw await this.#toError(response)

    const stored = (await response.json()) as { track: Track }
    return { track: stored.track, duplicate: false }
  }

  /** Answers with the state the command produced — a snapshot, not a frame. */
  command(command: PlaybackCommand): Promise<PlaybackSnapshot> {
    return this.#json<PlaybackSnapshot>('POST', '/api/playback', command)
  }

  async queue(): Promise<QueueEntry[]> {
    return (await this.#json<{ entries: QueueEntry[] }>('GET', '/api/queue')).entries
  }

  enqueue(trackId: number): Promise<{ entries: QueueEntry[] }> {
    return this.#json('POST', '/api/queue', { trackId })
  }

  /** Reorder. Positions are clamped server-side, so an edge is not an error. */
  move(entryId: number, toIndex: number): Promise<{ entries: QueueEntry[] }> {
    return this.#json('POST', '/api/queue/move', { entryId, toIndex })
  }

  remove(entryId: number): Promise<{ entries: QueueEntry[] }> {
    return this.#json('DELETE', `/api/queue/${entryId}`)
  }

  clearQueue(): Promise<{ entries: QueueEntry[] }> {
    return this.#json('DELETE', '/api/queue')
  }

  async #json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.#request(
      method,
      path,
      body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    )
    if (!response.ok) throw await this.#toError(response)
    return (await response.json()) as T
  }

  /**
   * Every request goes through here, so every request carries the cookie.
   * `same-origin` is fetch's default, but it is the whole authentication story
   * now — spelling it out keeps it from being dropped by accident.
   */
  #request(method: string, path: string, init: RequestInit = {}): Promise<Response> {
    return this.#fetch(`${this.#baseUrl}${path}`, { method, credentials: 'same-origin', ...init })
  }

  /** The server answers errors as `{error, message}`; anything else is a shrug. */
  async #toError(response: Response): Promise<AdminError> {
    let body: ErrorBody = {}
    try {
      body = (await response.json()) as ErrorBody
    } catch {
      // An HTML error page from something in front of the server, most likely.
    }
    const code = typeof body.error === 'string' ? body.error : 'request_failed'
    const message =
      typeof body.message === 'string' ? body.message : `request failed (${response.status})`
    // A 401 mid-session is the session ending, not a password being typed
    // wrong — the panel signs out rather than showing this, but say it plainly.
    return new AdminError(
      response.status,
      code,
      response.status === 401 ? 'session ended — sign in again' : message,
    )
  }
}
