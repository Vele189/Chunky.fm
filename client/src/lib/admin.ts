import type { QueueEntry, StateMessage, Track } from './protocol.js'

/** Where the admin controls live. PLAN.md's /admin arrives with #1452. */
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

  /** The password is wrong or no longer accepted — sign out, don't retry. */
  get unauthorized(): boolean {
    return this.status === 401
  }
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
 * Auth is the shared secret from PLAN.md's env var, presented on every request
 * rather than exchanged for a session — so the password lives in the client for
 * as long as the admin is signed in. That is the arrangement task #1452
 * replaces with a signed cookie; nothing above this class knows the difference.
 */
export class AdminApi {
  readonly #password: string
  readonly #fetch: typeof globalThis.fetch
  readonly #baseUrl: string

  constructor(password: string, { fetch = globalThis.fetch, baseUrl = '' }: AdminApiOptions = {}) {
    this.#password = password
    // Bound: fetch called as a method of anything but window throws in browsers,
    // the same way calling a stored setTimeout does — see lib/station.ts.
    this.#fetch = fetch.bind(globalThis)
    this.#baseUrl = baseUrl
  }

  /** Is this password accepted? The gate the sign-in form waits on. */
  async verify(): Promise<boolean> {
    const response = await this.#fetch(`${this.#baseUrl}/api/admin/session`, {
      headers: { authorization: `Bearer ${this.#password}` },
    })
    if (response.status === 401) return false
    if (!response.ok) throw await this.#toError(response)
    return true
  }

  /** The library. Public, but only the admin has anything to do with it. */
  async tracks(): Promise<Track[]> {
    return (await this.#json<{ tracks: Track[] }>('GET', '/api/tracks')).tracks
  }

  async upload(file: File): Promise<UploadResult> {
    const body = new FormData()
    body.append('file', file, file.name)

    const response = await this.#fetch(`${this.#baseUrl}/api/upload`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.#password}` },
      body,
    })

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

  command(command: PlaybackCommand): Promise<StateMessage> {
    return this.#json<StateMessage>('POST', '/api/playback', command)
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
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.#password}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response.ok) throw await this.#toError(response)
    return (await response.json()) as T
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
    return new AdminError(response.status, code, response.status === 401 ? 'wrong password' : message)
  }
}
