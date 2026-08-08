import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import type { Config } from '../config.js'
import {
  clearedCookie,
  isSecureRequest,
  isValidPassword,
  issueAdminSession,
  requireAdmin,
  sessionCookie,
} from '../lib/auth.js'
import { errorBody } from '../lib/errors.js'
import { KeyedRateLimit } from '../lib/rate-limit.js'

interface AdminDeps {
  config: Config
  /** Wrong passwords allowed from one address back to back. */
  signInBurst?: number
  /** How long one of those costs to earn back. */
  signInRefillMs?: number
}

/**
 * Enough for someone who genuinely cannot remember which password it was, and
 * nowhere near enough to search a passphrase. A station password guards every
 * upload, every deck control and the queue; the password itself is the whole
 * gate, so the rate a stranger can test it at is part of how strong it is.
 */
const DEFAULT_SIGN_IN_BURST = 5
const DEFAULT_SIGN_IN_REFILL_MS = 60_000

interface SignInBody {
  password?: unknown
}

const SIGN_IN_SCHEMA = {
  type: 'object',
  required: ['password'],
  // Bounded, so a body that could never be the password is refused before any
  // comparison happens: the password is a passphrase, not a file.
  properties: { password: { type: 'string', minLength: 1, maxLength: 512 } },
} as const

/**
 * The admin session: PLAN.md's password-for-a-signed-cookie exchange.
 *
 * The password crosses the wire once, at sign-in, and what comes back is an
 * HMAC-signed token in an HttpOnly cookie the browser presents from then on. So
 * the page holds no secret it could leak, the cookie is not something page
 * script can read, and a session lapses on its own after `SESSION_TTL_MS` even
 * if nobody signs out.
 *
 * There is no session store behind it: the token carries its own expiry and is
 * signed with a key derived from the password, so a restart keeps sessions
 * alive and a password change ends all of them at once. Revoking one session in
 * particular is not something a single-admin station has any use for.
 */
export function adminRoutes({
  config,
  signInBurst = DEFAULT_SIGN_IN_BURST,
  signInRefillMs = DEFAULT_SIGN_IN_REFILL_MS,
}: AdminDeps): FastifyPluginAsync {
  // Keyed on the caller's address, and only ever charged for a *wrong*
  // password: an admin signing in from a second tab is not an attack, and a
  // limiter that counted successes would lock out the one person it exists to
  // protect.
  const attempts = new KeyedRateLimit({ burst: signInBurst, refillMs: signInRefillMs })

  return async function routes(app: FastifyInstance) {
    app.post<{ Body: SignInBody }>(
      '/api/admin/session',
      { schema: { body: SIGN_IN_SCHEMA } },
      async (request, reply) => {
        const secure = isSecureRequest(request)

        // Before the comparison, not after: the point is to make guessing slow,
        // and a refusal that still checked the password would be a refusal that
        // still let the guessing happen.
        if (!attempts.take(request.ip)) {
          const retryAfterMs = attempts.retryAfterMs(request.ip)
          request.log.warn({ ip: request.ip }, 'admin sign-in throttled')
          return reply
            .header('retry-after', String(Math.ceil(retryAfterMs / 1000)))
            .header('set-cookie', clearedCookie(secure))
            .code(429)
            .send(errorBody(429, 'too many sign-in attempts. Wait a moment and try again'))
        }

        if (!isValidPassword(config, request.body.password)) {
          request.log.warn({ ip: request.ip }, 'admin sign-in refused')
          return reply
            .header('set-cookie', clearedCookie(secure))
            .code(401)
            .send({ error: 'unauthorized', message: 'wrong password' })
        }

        // Getting it right clears the history: whoever this is, they are the
        // admin, and the fumbled attempts before it were theirs too.
        attempts.reset(request.ip)

        const session = issueAdminSession(config)
        return reply
          .header('set-cookie', sessionCookie(session, secure))
          .code(200)
          .send({ ok: true, expiresAt: session.expiresAt })
      },
    )

    /**
     * Is the caller still the admin? Every other admin route *does* something,
     * so there is no harmless one to probe with, and the panel has to ask
     * before it shows a single control: on load, and after every reload.
     */
    app.get('/api/admin/session', { preHandler: requireAdmin(config) }, async () => ({ ok: true }))

    // Signing out needs no credentials: dropping a cookie the caller already
    // holds cannot be an attack, and refusing to end a session someone can't
    // prove they have is the wrong way round.
    app.delete('/api/admin/session', async (request, reply) =>
      reply
        .header('set-cookie', clearedCookie(isSecureRequest(request)))
        .code(200)
        .send({ ok: true }),
    )
  }
}
