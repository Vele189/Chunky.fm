import multipart from '@fastify/multipart'
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify'
import { ChatLog } from './chat.js'
import type { Config } from './config.js'
import { type Db, closeSession, openSession } from './db.js'
import { registerErrorHandlers } from './lib/errors.js'
import { ensureStorageDirs } from './lib/storage.js'
import { PlaybackState } from './playback.js'
import { type RealtimeHandle, attachRealtime } from './realtime.js'
import { adminRoutes } from './routes/admin.js'
import { mediaRoutes } from './routes/media.js'
import { playbackRoutes } from './routes/playback.js'
import { queueRoutes } from './routes/queue.js'
import { uploadRoutes } from './routes/upload.js'
import { Station } from './station.js'

declare module 'fastify' {
  interface FastifyInstance {
    station: Station
    playback: PlaybackState
    realtime: RealtimeHandle
    chat: ChatLog
    /** The session everything this run writes down belongs to. */
    sessionId: number
  }
}

export interface BuildAppOptions {
  config: Config
  db: Db
  logger?: FastifyServerOptions['logger']
  /** Supply your own state (and clock) in tests; production builds its own. */
  playback?: PlaybackState
  heartbeatIntervalMs?: number
  backstopIntervalMs?: number
  closeGraceMs?: number
  chatHistoryLimit?: number
  chatBurst?: number
  chatRefillMs?: number
}

export async function buildApp({
  config,
  db,
  logger,
  playback = new PlaybackState(),
  heartbeatIntervalMs,
  backstopIntervalMs,
  closeGraceMs,
  chatHistoryLimit,
  chatBurst,
  chatRefillMs,
}: BuildAppOptions): Promise<FastifyInstance> {
  await ensureStorageDirs(config)

  const app = Fastify({ logger: logger ?? true, bodyLimit: 1024 * 1024 })

  // Before the routes: everything registered after this inherits the handlers,
  // so a schema rejection on /api/playback answers in the same shape the
  // handler's own refusals do.
  registerErrorHandlers(app)

  await app.register(multipart, {
    limits: {
      fileSize: config.maxUploadBytes,
      files: 1,
      fields: 8,
    },
  })

  app.get('/health', async () => ({ ok: true }))

  const station = new Station({ playback, backstopIntervalMs })

  // A run of the process is a session, and the chat belongs to it. When the
  // admin can start and end sessions by hand, this is the line that changes.
  const sessionId = openSession(db)
  const chat = new ChatLog({ db, sessionId, historyLimit: chatHistoryLimit })

  await app.register(adminRoutes({ config }))
  await app.register(uploadRoutes({ config, db }))
  await app.register(mediaRoutes({ config, db }))
  await app.register(playbackRoutes({ config, db, station }))
  await app.register(queueRoutes({ config, db, station }))

  const realtime = attachRealtime({
    server: app.server,
    station,
    chat,
    heartbeatIntervalMs,
    closeGraceMs,
    chatBurst,
    chatRefillMs,
    log: app.log,
  })

  app.decorate('station', station)
  app.decorate('playback', playback)
  app.decorate('realtime', realtime)
  app.decorate('chat', chat)
  app.decorate('sessionId', sessionId)

  // preClose, not onClose: an upgraded websocket keeps the HTTP server open, so
  // the sockets have to be drained *before* Fastify tries to close it. Using
  // onClose here deadlocks shutdown for as long as anyone is listening.
  app.addHook('preClose', async () => {
    station.close()
    await realtime.close()
    // The session is over the moment the process stops serving it — that is
    // what made it a session. Ending it here means a restarted station reads
    // as a new time on air rather than the same one resuming.
    closeSession(db, sessionId)
  })

  return app
}
