import type { FastifyPluginAsync } from 'fastify'
import type { LiveVideo } from '../video.js'

/**
 * Open, like the schedule, because the page in front of the station has no key
 * to present and showing the set there is the point. It says only whether there
 * is a stream and where.
 */
export function videoRoutes({ video }: { video: LiveVideo }): FastifyPluginAsync {
  return async (app) => {
    app.get('/api/video', async (_request, reply) => {
      reply.header('cache-control', 'no-store')
      return video.snapshot()
    })
  }
}
