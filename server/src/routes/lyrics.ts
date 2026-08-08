import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import type { Config } from '../config.js'
import type { Db, TrackRow } from '../db.js'
import { requireListener } from '../lib/auth.js'
import type { LyricsService } from '../lyrics.js'
import { toTrack } from '../lib/track.js'

interface LyricsDeps {
  config: Config
  db: Db
  lyrics: LyricsService
}

const PARAMS_SCHEMA = {
  type: 'object',
  required: ['trackId'],
  properties: { trackId: { type: 'integer', minimum: 1 } },
} as const

/**
 * The words to a track, for whoever is listening to it.
 *
 * Listener-gated like the audio is, and for the same reason: on a private
 * station the songs of the evening are the station, words included.
 *
 * Read-through rather than read: the upload's background errand usually got
 * here first, but if it lost its race with the track going on air — or lost
 * the network altogether — the first listener to ask sends the station back to
 * the archive rather than going without. The service memoises hard enough that
 * a full room asking at once still costs one outbound request.
 */
export function lyricsRoutes({ config, db, lyrics }: LyricsDeps): FastifyPluginAsync {
  return async function routes(app: FastifyInstance) {
    app.get<{ Params: { trackId: number } }>(
      '/api/lyrics/:trackId',
      { preHandler: requireListener(config), schema: { params: PARAMS_SCHEMA } },
      async (request, reply) => {
        const row = db
          .prepare('SELECT * FROM tracks WHERE id = ?')
          .get(request.params.trackId) as TrackRow | undefined
        if (!row) {
          return reply
            .code(404)
            .send({ error: 'unknown_track', message: `no track ${request.params.trackId}` })
        }
        const found = await lyrics.fetchFor(toTrack(row))
        if (!found) {
          return reply
            .code(404)
            .send({ error: 'no_lyrics', message: 'nobody has written down the words to this one' })
        }
        return { lyrics: found }
      },
    )
  }
}
