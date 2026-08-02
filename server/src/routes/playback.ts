import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import type { Config } from '../config.js'
import type { Db, TrackRow } from '../db.js'
import { requireAdmin } from '../lib/auth.js'
import { toTrack } from '../lib/track.js'
import type { PlaybackState } from '../playback.js'

interface PlaybackDeps {
  config: Config
  db: Db
  playback: PlaybackState
}

interface CommandBody {
  action?: unknown
  trackId?: unknown
  positionMs?: unknown
}

const BODY_SCHEMA = {
  type: 'object',
  required: ['action'],
  properties: {
    action: { type: 'string', enum: ['play', 'pause', 'resume', 'seek', 'stop'] },
    trackId: { type: 'integer', minimum: 1 },
    positionMs: { type: 'integer', minimum: 0 },
  },
} as const

/**
 * The smallest admin surface that makes the sync spike testable: something has
 * to put a track on the decks before two browsers can be compared. The full
 * deck (queue, reorder, skip) is task #1451/#1454 — this is deliberately just
 * the verbs PlaybackState already has.
 */
export function playbackRoutes({ config, db, playback }: PlaybackDeps): FastifyPluginAsync {
  const findTrack = (id: number) =>
    db.prepare('SELECT * FROM tracks WHERE id = ?').get(id) as TrackRow | undefined

  return async function routes(app: FastifyInstance) {
    app.get('/api/playback', async () => playback.snapshot())

    app.post<{ Body: CommandBody }>(
      '/api/playback',
      { preHandler: requireAdmin(config), schema: { body: BODY_SCHEMA } },
      async (request, reply) => {
        const { action, trackId, positionMs } = request.body

        switch (action) {
          case 'play': {
            if (typeof trackId !== 'number') {
              return reply
                .code(400)
                .send({ error: 'missing_track', message: 'play requires a trackId' })
            }
            const row = findTrack(trackId)
            if (!row) {
              return reply.code(404).send({ error: 'unknown_track', message: `no track ${trackId}` })
            }
            playback.play(toTrack(row), typeof positionMs === 'number' ? positionMs : 0)
            break
          }
          case 'pause':
            playback.pause()
            break
          case 'resume':
            playback.resume()
            break
          case 'seek': {
            if (typeof positionMs !== 'number') {
              return reply
                .code(400)
                .send({ error: 'missing_position', message: 'seek requires a positionMs' })
            }
            playback.seek(positionMs)
            break
          }
          case 'stop':
            playback.stop()
            break
        }

        // The websocket broadcast has already gone out by here.
        return reply.code(200).send(playback.snapshot())
      },
    )
  }
}
