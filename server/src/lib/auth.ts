import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Config } from '../config.js'

/** The signed session cookie the admin surface runs on. */
export const ADMIN_COOKIE = 'chunky_admin'

/** How long a sign-in lasts. A set runs for an evening, not for a week. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000

/**
 * Domain separation for the signing key. Without it the key would *be* the
 * password, and every signature an oracle for it.
 */
const KEY_LABEL = 'chunky.fm/admin-session/v1'

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/**
 * Derived from the password rather than from a second env var: changing
 * ADMIN_PASSWORD then invalidates every cookie already handed out, which is
 * what changing a password is supposed to do. It also leaves one secret to
 * configure, and no session key to lose across a restart.
 */
function sessionKey(config: Config): Buffer {
  return createHmac('sha256', config.adminPassword).update(KEY_LABEL).digest()
}

function sign(config: Config, payload: string): string {
  return createHmac('sha256', sessionKey(config)).update(payload).digest('base64url')
}

export interface AdminSession {
  /** The cookie value: `<expiresAt>.<nonce>.<signature>`. */
  token: string
  expiresAt: number
}

/**
 * Mint a session for someone who has just proved they know the password.
 *
 * The expiry lives inside the signed payload, so it is the server's word rather
 * than the browser's — a client that ignores `Max-Age` and keeps the cookie
 * still finds it refused. The nonce only makes two sessions minted in the same
 * millisecond distinct from each other.
 */
export function issueAdminSession(
  config: Config,
  now = Date.now(),
  ttlMs = SESSION_TTL_MS,
): AdminSession {
  const expiresAt = now + ttlMs
  const payload = `${expiresAt}.${randomBytes(12).toString('base64url')}`
  return { token: `${payload}.${sign(config, payload)}`, expiresAt }
}

export function verifyAdminSession(config: Config, token: string, now = Date.now()): boolean {
  const cut = token.lastIndexOf('.')
  if (cut <= 0) return false

  const payload = token.slice(0, cut)
  // Signature first: an expiry read off an unverified payload is just a number
  // the client chose.
  if (!constantTimeEquals(token.slice(cut + 1), sign(config, payload))) return false

  const expiresAt = Number(payload.slice(0, payload.indexOf('.')))
  return Number.isFinite(expiresAt) && expiresAt > now
}

/** `Set-Cookie` for a fresh session. */
export function sessionCookie(session: AdminSession, secure: boolean, now = Date.now()): string {
  return cookie(session.token, Math.max(0, Math.floor((session.expiresAt - now) / 1000)), secure)
}

/** `Set-Cookie` that drops the session — signing out, or shedding a stale one. */
export function clearedCookie(secure: boolean): string {
  return cookie('', 0, secure)
}

function cookie(value: string, maxAgeSeconds: number, secure: boolean): string {
  // HttpOnly so page script can't read the token, SameSite=Strict so nothing
  // the admin clicks on another site can drive the station on their behalf.
  const parts = [
    `${ADMIN_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`,
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

/**
 * `Secure` would make the cookie unusable over plain HTTP, which is exactly how
 * the station is developed, so it follows the scheme the request arrived on.
 * Railway terminates TLS in front of the app — hence the forwarded header.
 */
export function isSecureRequest(request: FastifyRequest): boolean {
  const forwarded = request.headers['x-forwarded-proto']
  const proto = Array.isArray(forwarded) ? forwarded[0] : forwarded
  if (typeof proto === 'string') return proto.split(',')[0]!.trim() === 'https'
  return request.protocol === 'https'
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=')
    if (eq === -1) continue
    if (pair.slice(0, eq).trim() === name) return pair.slice(eq + 1).trim()
  }
  return null
}

/**
 * The password presented directly. The browser exchanges it for a cookie at
 * `POST /api/admin/session` and never sends it again; a curl one-liner or a QA
 * script has nowhere to keep a cookie and shouldn't need one.
 */
function presentedPassword(headers: IncomingHttpHeaders): string | null {
  const auth = headers.authorization
  if (auth?.startsWith('Bearer ')) return auth.slice('Bearer '.length)
  const header = headers['x-admin-password']
  if (typeof header === 'string') return header
  return null
}

/**
 * Is this request the admin? Either credential is enough — a valid session
 * cookie, or the password itself.
 *
 * Takes raw headers rather than a `FastifyRequest` so the websocket upgrade,
 * which never becomes one, can ask the same question of the same code.
 */
export function hasAdminCredentials(
  config: Config,
  headers: IncomingHttpHeaders,
  now = Date.now(),
): boolean {
  const token = readCookie(headers.cookie, ADMIN_COOKIE)
  if (token !== null && verifyAdminSession(config, token, now)) return true

  const password = presentedPassword(headers)
  return password !== null && constantTimeEquals(password, config.adminPassword)
}

/** Does this candidate match the station password? The gate on sign-in. */
export function isValidPassword(config: Config, candidate: unknown): boolean {
  return typeof candidate === 'string' && constantTimeEquals(candidate, config.adminPassword)
}

/** The gate on every admin-only route. Refuses before the handler runs at all. */
export function requireAdmin(config: Config) {
  return async function adminGuard(request: FastifyRequest, reply: FastifyReply) {
    if (!hasAdminCredentials(config, request.headers)) {
      // Shed the cookie on the way out: a signature that no longer verifies —
      // usually a restart with a different password — would otherwise be sent
      // again on every request the browser makes for the rest of the session.
      return reply
        .header('set-cookie', clearedCookie(isSecureRequest(request)))
        .code(401)
        .send({ error: 'unauthorized', message: 'admin credentials required' })
    }
  }
}
