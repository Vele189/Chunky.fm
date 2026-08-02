import multipart from '@fastify/multipart'
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify'
import type { Config } from './config.js'
import type { Db } from './db.js'
import { ensureStorageDirs } from './lib/storage.js'
import { PlaybackState } from './playback.js'
import { type RealtimeHandle, attachRealtime } from './realtime.js'
import { mediaRoutes } from './routes/media.js'
import { uploadRoutes } from './routes/upload.js'

declare module 'fastify' {
  interface FastifyInstance {
    playback: PlaybackState
    realtime: RealtimeHandle
  }
}

export interface BuildAppOptions {
  config: Config
  db: Db
  logger?: FastifyServerOptions['logger']
  /** Supply your own state (and clock) in tests; production builds its own. */
  playback?: PlaybackState
  heartbeatIntervalMs?: number
  closeGraceMs?: number
}

export async function buildApp({
  config,
  db,
  logger,
  playback = new PlaybackState(),
  heartbeatIntervalMs,
  closeGraceMs,
}: BuildAppOptions): Promise<FastifyInstance> {
  await ensureStorageDirs(config)

  const app = Fastify({ logger: logger ?? true, bodyLimit: 1024 * 1024 })

  await app.register(multipart, {
    limits: {
      fileSize: config.maxUploadBytes,
      files: 1,
      fields: 8,
    },
  })

  app.get('/health', async () => ({ ok: true }))

  await app.register(uploadRoutes({ config, db }))
  await app.register(mediaRoutes({ config, db }))

  const realtime = attachRealtime({
    server: app.server,
    playback,
    heartbeatIntervalMs,
    closeGraceMs,
    log: app.log,
  })

  app.decorate('playback', playback)
  app.decorate('realtime', realtime)

  // preClose, not onClose: an upgraded websocket keeps the HTTP server open, so
  // the sockets have to be drained *before* Fastify tries to close it. Using
  // onClose here deadlocks shutdown for as long as anyone is listening.
  app.addHook('preClose', async () => {
    await realtime.close()
  })

  return app
}
