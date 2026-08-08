import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import type { Config } from '../config.js'
import {
  clearedListenerCookie,
  isSecureRequest,
  isValidStationKey,
  issueListenerSession,
  listenerCookie,
  mayListen,
  requireAdmin,
} from '../lib/auth.js'
import { KeyedRateLimit } from '../lib/rate-limit.js'

interface ListenDeps {
  config: Config
  /** Wrong keys allowed from one address back to back. */
  redeemBurst?: number
  /** How long one of those costs to earn back. */
  redeemRefillMs?: number
}

/**
 * Looser than the admin sign-in throttle, and deliberately.
 *
 * A wrong key here is usually a stale link or a typo rather than somebody
 * guessing — a friend who kept the invite from before it was rotated, whose
 * browser will retry on its own, or one typing the door code in by hand and
 * missing. Ten in a minute is generous for both and still puts a ceiling on
 * anyone working through the alphabet, which matters more now that the code can
 * be short enough to say out loud.
 */
const DEFAULT_REDEEM_BURST = 10
const DEFAULT_REDEEM_REFILL_MS = 60_000

interface RedeemBody {
  key?: unknown
}

const REDEEM_SCHEMA = {
  type: 'object',
  required: ['key'],
  properties: { key: { type: 'string', minLength: 1, maxLength: 512 } },
} as const

/**
 * Who is allowed to hear the station.
 *
 * The mirror of the admin sign-in, one rung down: a listener presents the
 * station key once — out of the `?k=` on the link they were sent — and gets
 * back a signed HttpOnly cookie the browser presents from then on. The key
 * itself never sits in the page after that, and the link can be shared without
 * the receiving browser having to keep the secret anywhere script can read.
 *
 * The key can arrive two ways, and they are the same key: out of the `?k=` on a
 * link somebody was sent, or typed into the door on the refused screen. PLAN.md
 * describes the first — "one permanent link" — and the second is what makes the
 * station something you can tell a friend over the phone.
 *
 * Only a station opened deliberately (`STATION_OPEN=true`) admits everyone. An
 * unset `STATION_KEY` no longer does: it falls back to the house key in
 * `config.ts`, so a variable lost during a deploy leaves the door shut rather
 * than open.
 */
export function listenRoutes({
  config,
  redeemBurst = DEFAULT_REDEEM_BURST,
  redeemRefillMs = DEFAULT_REDEEM_REFILL_MS,
}: ListenDeps): FastifyPluginAsync {
  const throttle = new KeyedRateLimit({ burst: redeemBurst, refillMs: redeemRefillMs })

  return async function routes(app: FastifyInstance) {
    /**
     * Is this browser admitted? Asked once on load, before anything opens a
     * socket — a page that connected first would spend its life reconnecting
     * into a refusal, and the listener would be told the station was down when
     * it is only shut to them.
     */
    app.get('/api/listen', async (request, reply) => {
      if (!mayListen(config, request.headers)) {
        return reply
          .code(401)
          .send({ error: 'unauthorized', message: 'this station is private' })
      }
      return reply.code(204).send()
    })

    app.post<{ Body: RedeemBody }>(
      '/api/listen',
      { schema: { body: REDEEM_SCHEMA } },
      async (request, reply) => {
        const secure = isSecureRequest(request)

        // An open station has no key to present, so redeeming one is a request
        // that cannot mean anything. Answered as success rather than as a
        // refusal: the browser is admitted, which is the only thing it asked.
        if (!config.stationKey) return reply.code(204).send()

        if (!throttle.take(request.ip)) {
          request.log.warn({ ip: request.ip }, 'station key redemption throttled')
          return reply
            .header('set-cookie', clearedListenerCookie(secure))
            .code(429)
            .send({ error: 'slow_down', message: 'too many tries — wait a minute and try again' })
        }

        if (!isValidStationKey(config, request.body.key)) {
          return reply
            .header('set-cookie', clearedListenerCookie(secure))
            .code(401)
            .send({ error: 'unauthorized', message: 'that link is not for this station' })
        }

        const session = issueListenerSession(config.stationKey)
        return reply.header('set-cookie', listenerCookie(session, secure)).code(204).send()
      },
    )

    /**
     * The key, for whoever runs the decks, so the console can build a link to
     * hand out.
     *
     * Admin-only, and that is the whole invitation policy: a listener's browser
     * cannot reconstruct an invite — the cookie is HttpOnly and the key was
     * taken out of the address bar on arrival — so the only way to be invited
     * is for the person with the password to send you one. An endpoint that
     * gave the key to anyone already admitted would let one invite quietly
     * invite the rest of the internet.
     *
     * The link itself is assembled in the browser rather than here: the station
     * does not reliably know what address it is being reached on, and the admin's
     * own address bar does.
     */
    app.get('/api/invite', { preHandler: requireAdmin(config) }, async () => ({
      // Null for an open station — there is no key, and the bare address is
      // already a working invite.
      key: config.stationKey ?? null,
    }))
  }
}
