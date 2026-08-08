import fastifyStatic from '@fastify/static'
import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import type { Config } from '../config.js'
import type { Db, TrackRow } from '../db.js'
import { requireListener } from '../lib/auth.js'
import { toTrack } from '../lib/track.js'

interface MediaDeps {
  config: Config
  db: Db
}

/**
 * Serving the library.
 *
 * Range support is the load-bearing part: a listener joining at 2:14 has to
 * fetch that byte range before it can play, and without `Range` the browser
 * would pull the whole file from 0:00 first. @fastify/static handles it via
 * `send`; there is a test pinning the behaviour rather than trusting it.
 */
export function mediaRoutes({ config, db }: MediaDeps): FastifyPluginAsync {
  return async function routes(app: FastifyInstance) {
    const listTracks = db.prepare('SELECT * FROM tracks ORDER BY artist, album, title')

    // The whole of this plugin, not route by route: the library listing, the
    // audio and the artwork are the station, and on a private one none of the
    // three is public. An open station admits everyone here; see mayListen.
    app.addHook('onRequest', requireListener(config))

    app.get('/api/tracks', async () => ({
      tracks: (listTracks.all() as TrackRow[]).map(toTrack),
    }))

    await app.register(fastifyStatic, {
      root: config.audioDir,
      prefix: '/api/audio/',
      decorateReply: false,
      // Content is addressed by hash, so it can never change under a URL.
      cacheControl: true,
      maxAge: '365d',
      immutable: true,
      index: false,
      dotfiles: 'deny',
    })

    await app.register(fastifyStatic, {
      root: config.artworkDir,
      prefix: '/api/artwork/',
      decorateReply: false,
      cacheControl: true,
      maxAge: '365d',
      immutable: true,
      index: false,
      dotfiles: 'deny',
    })
  }
}
