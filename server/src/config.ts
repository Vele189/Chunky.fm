import path from 'node:path'

export interface Config {
  host: string
  port: number
  /** Railway volume mount. Audio, artwork and the SQLite file all live here. */
  storageDir: string
  audioDir: string
  artworkDir: string
  /** Uploads land here first and are only moved once they parse as audio. */
  tmpDir: string
  dbPath: string
  adminPassword: string
  /**
   * What a listener has to present to reach the station at all, or null for a
   * station anyone with the address can hear.
   *
   * Separate from the admin password because it guards a different thing and is
   * shared with different people: this one goes out in a link to everybody
   * invited, and rotating it locks all of them out at once, which is the point.
   */
  stationKey: string | null
  maxUploadBytes: number
  /**
   * Who is allowed to tell the station where a request really came from.
   *
   * This is never reached directly in either supported deployment: nginx sits
   * in front of it in compose, and Railway's edge does in production. So the
   * socket's peer address is the proxy's, and `request.ip` is that same address
   * for every caller alive — which is fine for logging and *not* fine for
   * anything keyed on it. The sign-in throttle is keyed on it, and one shared
   * bucket there is not brute-force protection, it is a way for a stranger to
   * lock the admin out of their own station.
   *
   * True by default for that reason, which means trusting `X-Forwarded-For`.
   * Anyone who can reach the origin directly can therefore claim to be any
   * address they like — so don't publish the origin port. Set `TRUST_PROXY` to
   * `false` when nothing is in front, or to a hop count or a list of proxy
   * addresses to trust something narrower.
   */
  trustProxy: boolean | string | string[] | number
}

/**
 * `false`/`true` as written, a bare integer as a hop count, anything else as a
 * comma-separated list of addresses or CIDR ranges — the shapes Fastify already
 * takes, chosen from the string an env var has to be.
 */
function trustProxyFromEnv(value: string | undefined): Config['trustProxy'] {
  if (value === undefined || value === '') return true
  if (value === 'true') return true
  if (value === 'false') return false
  if (/^\d+$/.test(value)) return Number(value)
  const addresses = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  if (addresses.length === 0) {
    throw new Error(`TRUST_PROXY must be true, false, a hop count or a list of addresses`)
  }
  return addresses
}

const DEFAULT_MAX_UPLOAD_BYTES = 150 * 1024 * 1024

function intFromEnv(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got ${JSON.stringify(value)}`)
  }
  return parsed
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const adminPassword = env.ADMIN_PASSWORD
  if (!adminPassword) {
    throw new Error('ADMIN_PASSWORD is not set — refusing to start with an unguarded admin surface')
  }

  const storageDir = path.resolve(env.AUDIO_STORAGE_DIR ?? 'audio_storage')

  return {
    host: env.HOST ?? '0.0.0.0',
    port: intFromEnv(env.PORT, 3000, 'PORT'),
    storageDir,
    audioDir: path.join(storageDir, 'audio'),
    artworkDir: path.join(storageDir, 'artwork'),
    tmpDir: path.join(storageDir, 'tmp'),
    dbPath: env.DB_PATH ? path.resolve(env.DB_PATH) : path.join(storageDir, 'chunky.sqlite'),
    adminPassword,
    // Optional on purpose. Unset means the station is open to anyone with the
    // address, which is what it has always been and what PLAN.md's "one
    // permanent link" describes. Set it and the address stops being enough.
    stationKey: env.STATION_KEY?.trim() || null,
    maxUploadBytes: intFromEnv(env.MAX_UPLOAD_BYTES, DEFAULT_MAX_UPLOAD_BYTES, 'MAX_UPLOAD_BYTES'),
    trustProxy: trustProxyFromEnv(env.TRUST_PROXY),
  }
}
