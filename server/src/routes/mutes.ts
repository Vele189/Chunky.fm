import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import type { Config } from '../config.js'
import { requireAdmin } from '../lib/auth.js'
import type { Mutes } from '../mutes.js'
import { NICKNAME_MAX_LENGTH } from '../presence.js'

interface MutesDeps {
  config: Config
  mutes: Mutes
}

interface MuteBody {
  nickname?: unknown
  muted?: unknown
}

const BODY_SCHEMA = {
  type: 'object',
  required: ['nickname', 'muted'],
  properties: {
    nickname: { type: 'string', minLength: 1, maxLength: NICKNAME_MAX_LENGTH },
    // Where the listener now stands, rather than "toggle" — the same shape a
    // skip vote takes, and for the same reason: two of them in a row leave one
    // mute, so a retry after a dropped response is safe.
    muted: { type: 'boolean' },
  },
} as const

/**
 * Muting a nickname — PLAN.md's last unbuilt admin control.
 *
 * Admin-only in both directions, including the read. Unlike `/api/session`,
 * which is open because whether there is a station tonight is the first thing a
 * listener needs, the list of who has been muted is nobody's business but the
 * person holding the password: publishing it would turn a quiet word into a
 * public naming, and hand every listener the roster of who to needle about it.
 */
export function mutesRoutes({ config, mutes }: MutesDeps): FastifyPluginAsync {
  return async function routes(app: FastifyInstance) {
    const admin = { preHandler: requireAdmin(config) }

    app.get('/api/mutes', admin, async () => ({ nicknames: mutes.list() }))

    app.post<{ Body: MuteBody }>(
      '/api/mutes',
      { ...admin, schema: { body: BODY_SCHEMA } },
      async (request, reply) => {
        mutes.set(request.body.nickname as string, request.body.muted as boolean)
        // The whole list, not just the row that changed: the panel renders the
        // set, and answering with it means the button responds to the click
        // rather than waiting for a refresh.
        return reply.code(200).send({ nicknames: mutes.list() })
      },
    )
  }
}
