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
   * A *separate field* from the admin password, because the two guard different
   * things and are shared with different people: this one goes out in a link to
   * everybody invited, and rotating it locks all of them out at once.
   *
   * On an unconfigured station they nevertheless hold the same value — both
   * fall back to the house key — so out of the box one code opens both doors.
   * That is a choice about defaults and not about the model: set either
   * variable and they part company, and nothing downstream has to change,
   * because nothing downstream ever assumed they were equal.
   *
   * Null only when the station has been opened deliberately — see
   * `stationKeyFromEnv`. It is no longer what an unset `STATION_KEY` means.
   */
  stationKey: string | null
  maxUploadBytes: number
  /**
   * Where the station asks about lyrics. LRCLIB is public and keyless, so this
   * is an address rather than a credential; point it at a mirror if the public
   * one is ever unreachable from where the station runs.
   */
  lrclibBaseUrl: string
  /**
   * The built client, when this process is also the thing serving it.
   *
   * Null under compose and in development, where something else owns the front
   * door — nginx in the container, Vite's dev server locally — and this process
   * is only an API. Set to `client/dist` in the single-image deployment, where
   * there is no nginx and Fastify is the only thing listening.
   *
   * Null rather than a default path on purpose: a server that guessed at a
   * client directory and found nothing would answer the landing page with a
   * 404 instead of leaving `/` alone, and the compose stack would break in a
   * way that only shows up in a browser.
   */
  clientDir: string | null
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

/**
 * The house key: the door code a station comes with when nobody has set one.
 *
 * Written backwards and in base64, the way you would write a door code on the
 * back of a beer mat rather than on the door. That is the whole of the trick,
 * and it is worth being straight about what it buys: nothing at all against
 * anyone holding this repository, and everything against the only threat that
 * actually exists here, which is the code sitting in plain sight in a file
 * somebody screen-shares. It never leaves the server — a listener presents a
 * guess and is told yes or no — so the browser never has it to give away.
 *
 * To read it back without printing it into a commit:
 *
 *     node -e "console.log([...Buffer.from('MTAxeWtudWhj','base64').toString()].reverse().join(''))"
 *
 * Set `STATION_KEY` to replace it with something you chose, which is what any
 * station with people in it should do. `STATION_OPEN=true` removes the door.
 */
function houseKey(): string {
  return [...Buffer.from('MTAxeWtudWhj', 'base64').toString('utf8')].reverse().join('')
}

/**
 * What guards the station, from the environment.
 *
 * The default changed, and it changed in the direction that fails safe: an
 * unset `STATION_KEY` used to mean an open station, and now means the house key
 * above. A station that quietly became public because a variable went missing
 * during a deploy is a worse surprise than one that quietly asks for a password
 * somebody has to go and look up.
 *
 * Opening it is therefore something you now have to *say*, rather than
 * something that happens when you forget to speak.
 */
function stationKeyFromEnv(env: NodeJS.ProcessEnv): string | null {
  // An explicit key beats an explicit opening, in the one case where somebody
  // has set both. That is contradictory configuration and there is no reading
  // of it that is obviously right — so it resolves towards the shut door, which
  // is the mistake you find out about from a friend who cannot get in rather
  // than from a stranger who could.
  const chosen = env.STATION_KEY?.trim()
  if (chosen) return chosen
  if (env.STATION_OPEN?.trim() === 'true') return null
  return houseKey()
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
  // Falls back to the same house key the door does, so an unconfigured station
  // has *one* code that opens both. That is a deliberate collapse of two
  // secrets into one, and it costs exactly what it sounds like: anybody handed
  // the code to listen can also upload, drive the decks and end the broadcast.
  // Fine for a room of friends, which is what this is; set ADMIN_PASSWORD for
  // anything else, and the two come apart again with no other change.
  const adminPassword = env.ADMIN_PASSWORD?.trim() || houseKey()

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
    stationKey: stationKeyFromEnv(env),
    maxUploadBytes: intFromEnv(env.MAX_UPLOAD_BYTES, DEFAULT_MAX_UPLOAD_BYTES, 'MAX_UPLOAD_BYTES'),
    lrclibBaseUrl: env.LRCLIB_BASE_URL?.trim() || 'https://lrclib.net',
    // Unset means "something else is serving the client", which is true of both
    // the compose stack and `npm run dev`. Only the single-image deployment
    // sets it — see the root Dockerfile.
    clientDir: env.CLIENT_DIR?.trim() ? path.resolve(env.CLIENT_DIR.trim()) : null,
    trustProxy: trustProxyFromEnv(env.TRUST_PROXY),
  }
}
