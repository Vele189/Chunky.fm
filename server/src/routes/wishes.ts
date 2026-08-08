import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import type { Config } from '../config.js'
import { requireAdmin } from '../lib/auth.js'
import { WISH_STATUSES, type WishBook, type WishStatus } from '../wishes.js'

interface WishesDeps {
  config: Config
  wishes: WishBook
}

interface StatusBody {
  status?: unknown
}

const WISH_PARAMS_SCHEMA = {
  type: 'object',
  required: ['wishId'],
  properties: { wishId: { type: 'integer', minimum: 1 } },
} as const

const STATUS_SCHEMA = {
  type: 'object',
  required: ['status'],
  properties: { status: { type: 'string', enum: [...WISH_STATUSES] } },
} as const

/**
 * The wish book, for whoever runs the decks.
 *
 * The one read in this API that is *not* open. Everything else a listener could
 * ask for over HTTP they are already sent over the socket (the queue, the
 * decks, the roster), so gating those would protect nothing. Wishes are the
 * exception because they were never broadcast: a wish goes to the admin and
 * back to the listener who made it, and a public list of them would turn asking
 * for a song into asking in front of the room.
 *
 * Making a wish is not here. That happens over the socket, where the roster is,
 * because the name on a wish has to be the name the socket is listed under
 * rather than one the request could choose for itself.
 */
export function wishesRoutes({ config, wishes }: WishesDeps): FastifyPluginAsync {
  return async function routes(app: FastifyInstance) {
    const admin = { preHandler: requireAdmin(config) }
    // Answered by both routes, so marking one handled leaves the panel holding
    // the book as it now stands rather than the book plus one edited row.
    const book = () => ({ wishes: wishes.list(), outstanding: wishes.outstanding() })

    app.get('/api/wishes', admin, async () => book())

    app.post<{ Params: { wishId: number }; Body: StatusBody }>(
      '/api/wishes/:wishId',
      { ...admin, schema: { params: WISH_PARAMS_SCHEMA, body: STATUS_SCHEMA } },
      async (request, reply) => {
        const { wishId } = request.params
        const wish = wishes.setStatus(wishId, request.body.status as WishStatus)
        if (!wish) {
          return reply.code(404).send({ error: 'unknown_wish', message: `no wish ${wishId}` })
        }
        return reply.code(200).send({ wish, ...book() })
      },
    )
  }
}
