import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import type { Config } from '../config.js'
import { requireAdmin } from '../lib/auth.js'
import { MAX_PADDING, type Padding } from '../padding.js'

interface PaddingDeps {
  config: Config
  padding: Padding
}

interface PaddingBody {
  padding?: unknown
}

const BODY_SCHEMA = {
  type: 'object',
  required: ['padding'],
  properties: {
    // Where the count now stands, rather than a step, the same shape a mute
    // and a re-join take: two of these in a row leave one number, so the
    // panel's plus button is safe to press again after a dropped response.
    // Bounded here as well as in `Padding.set`, so a number the page could not
    // draw is refused at the door rather than quietly clamped.
    padding: { type: 'integer', minimum: 0, maximum: MAX_PADDING },
  },
} as const

/**
 * The number the decks add to the headcount.
 *
 * Admin-only in both directions, including the read, for the reason the mute
 * list is: what the room sees is the total, and publishing the split would hand
 * every listener the exact size of the part nobody is behind. The count itself
 * is broadcast the moment it changes, on the roster frame; this route is only
 * how it gets set, and the panel is the only thing that reads it back.
 *
 * There is no clearing route. The padding goes when the session does, which is
 * the same button that clears the decks and the queue: see app.ts. Setting it
 * to zero is the way to take it off mid-broadcast.
 */
export function paddingRoutes({ config, padding }: PaddingDeps): FastifyPluginAsync {
  return async function routes(app: FastifyInstance) {
    const admin = { preHandler: requireAdmin(config) }

    app.get('/api/padding', admin, async () => ({ padding: padding.count }))

    app.post<{ Body: PaddingBody }>(
      '/api/padding',
      { ...admin, schema: { body: BODY_SCHEMA } },
      async (request, reply) => {
        padding.set(request.body.padding as number)
        // The count the station now holds, not the one that was asked for: the
        // panel renders what came back, so a clamp can never leave the button
        // showing a number the station does not have.
        return reply.code(200).send({ padding: padding.count })
      },
    )
  }
}
