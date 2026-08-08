import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import type { Config } from '../config.js'
import type { Db, TrackRow } from '../db.js'
import { requireAdmin } from '../lib/auth.js'
import { toTrack } from '../lib/track.js'
import type { Station } from '../station.js'

interface QueueDeps {
  config: Config
  db: Db
  station: Station
}

interface AddBody {
  trackId?: unknown
}

interface MoveBody {
  entryId?: unknown
  toIndex?: unknown
}

const ADD_SCHEMA = {
  type: 'object',
  required: ['trackId'],
  properties: { trackId: { type: 'integer', minimum: 1 } },
} as const

const MOVE_SCHEMA = {
  type: 'object',
  required: ['entryId', 'toIndex'],
  properties: {
    entryId: { type: 'integer', minimum: 1 },
    // Clamped server-side: an admin dragging to the end of a queue that just
    // advanced shouldn't get a 400 for being one row optimistic.
    toIndex: { type: 'integer', minimum: 0 },
  },
} as const

const ENTRY_PARAMS_SCHEMA = {
  type: 'object',
  required: ['entryId'],
  properties: { entryId: { type: 'integer', minimum: 1 } },
} as const

/**
 * The admin's view of what's coming up. Reads are open, since listeners get the same
 * queue over the websocket anyway, and every mutation is admin-only.
 *
 * Entries are addressed by entry id rather than position, because the queue
 * shifts by itself when a track ends: an index the admin's UI read a second ago
 * may already point at a different track.
 */
export function queueRoutes({ config, db, station }: QueueDeps): FastifyPluginAsync {
  const findTrack = (id: number) =>
    db.prepare('SELECT * FROM tracks WHERE id = ?').get(id) as TrackRow | undefined

  return async function routes(app: FastifyInstance) {
    const admin = { preHandler: requireAdmin(config) }
    const entries = () => ({ entries: station.queue.list() })

    app.get('/api/queue', async () => entries())

    app.post<{ Body: AddBody }>(
      '/api/queue',
      { ...admin, schema: { body: ADD_SCHEMA } },
      async (request, reply) => {
        const { trackId } = request.body
        const row = typeof trackId === 'number' ? findTrack(trackId) : undefined
        if (!row) {
          return reply.code(404).send({ error: 'unknown_track', message: `no track ${trackId}` })
        }

        // On an idle station this starts playing immediately (see
        // Station.enqueue), so the entry may already be off the queue by the
        // time we answer. That's why the entry is reported alongside it.
        const entry = station.enqueue(toTrack(row))
        return reply.code(201).send({ entry, ...entries() })
      },
    )

    app.post<{ Body: MoveBody }>(
      '/api/queue/move',
      { ...admin, schema: { body: MOVE_SCHEMA } },
      async (request, reply) => {
        const { entryId, toIndex } = request.body
        const moved =
          typeof entryId === 'number' && typeof toIndex === 'number'
            ? station.queue.move(entryId, toIndex)
            : null
        if (!moved) {
          return reply.code(404).send({ error: 'unknown_entry', message: `no entry ${entryId}` })
        }
        return reply.code(200).send({ entry: moved, ...entries() })
      },
    )

    app.delete<{ Params: { entryId: number } }>(
      '/api/queue/:entryId',
      { ...admin, schema: { params: ENTRY_PARAMS_SCHEMA } },
      async (request, reply) => {
        const removed = station.queue.remove(request.params.entryId)
        if (!removed) {
          return reply
            .code(404)
            .send({ error: 'unknown_entry', message: `no entry ${request.params.entryId}` })
        }
        return reply.code(200).send({ entry: removed, ...entries() })
      },
    )

    app.delete('/api/queue', admin, async () => {
      station.queue.clear()
      return entries()
    })
  }
}
