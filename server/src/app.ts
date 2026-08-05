import multipart from '@fastify/multipart'
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify'
import { ChatLog } from './chat.js'
import type { Config } from './config.js'
import { type Db, closeSession, openSession } from './db.js'
import { PlayLog } from './history.js'
import { registerErrorHandlers } from './lib/errors.js'
import { ensureStorageDirs } from './lib/storage.js'
import { PlaybackState } from './playback.js'
import { type RealtimeHandle, attachRealtime } from './realtime.js'
import { mayListen } from './lib/auth.js'
import { adminRoutes } from './routes/admin.js'
import { listenRoutes } from './routes/listen.js'
import { mediaRoutes } from './routes/media.js'
import { playbackRoutes } from './routes/playback.js'
import { queueRoutes } from './routes/queue.js'
import { uploadRoutes } from './routes/upload.js'
import { wishesRoutes } from './routes/wishes.js'
import { Station } from './station.js'
import { WishBook } from './wishes.js'

declare module 'fastify' {
  interface FastifyInstance {
    station: Station
    playback: PlaybackState
    realtime: RealtimeHandle
    chat: ChatLog
    wishes: WishBook
    plays: PlayLog
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
  playHistoryLimit?: number
  chatBurst?: number
  chatRefillMs?: number
  joinBurst?: number
  joinRefillMs?: number
  wishBurst?: number
  wishRefillMs?: number
  voteBurst?: number
  voteRefillMs?: number
  signInBurst?: number
  signInRefillMs?: number
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
  playHistoryLimit,
  chatBurst,
  chatRefillMs,
  joinBurst,
  joinRefillMs,
  wishBurst,
  wishRefillMs,
  voteBurst,
  voteRefillMs,
  signInBurst,
  signInRefillMs,
}: BuildAppOptions): Promise<FastifyInstance> {
  await ensureStorageDirs(config)

  // trustProxy so `request.ip` is the caller rather than whatever proxy is in
  // front — see Config.trustProxy. The sign-in throttle is keyed on it, and one
  // bucket shared by everyone behind the proxy would be a lockout, not a limit.
  const app = Fastify({
    logger: logger ?? true,
    bodyLimit: 1024 * 1024,
    trustProxy: config.trustProxy,
  })

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
  // Same session, same reason: a wish is about this time on air, and a station
  // that came back up is not still being asked for what it missed.
  const wishes = new WishBook({ db, sessionId })
  // And the same session again: the history is what has been on *this* time on
  // air, so a station that came back up starts its list rather than resuming
  // one from before the restart.
  // Stamped from the station clock rather than `Date.now`, so a play's time and
  // the `startedAt` of the same track are the same instant expressed in the same
  // timebase — everything time-shaped the server says reads from there.
  const plays = new PlayLog({
    db,
    sessionId,
    limit: playHistoryLimit,
    now: () => playback.now(),
  })

  await app.register(adminRoutes({ config, signInBurst, signInRefillMs }))
  await app.register(listenRoutes({ config }))
  await app.register(uploadRoutes({ config, db }))
  await app.register(mediaRoutes({ config, db }))
  await app.register(playbackRoutes({ config, db, station }))
  await app.register(queueRoutes({ config, db, station }))
  await app.register(wishesRoutes({ config, wishes }))

  const realtime = attachRealtime({
    server: app.server,
    station,
    // The socket is the station: refusing it is what makes a private station
    // private, since everything a listener sees arrives on it.
    admit: (headers) => mayListen(config, headers),
    chat,
    wishes,
    plays,
    heartbeatIntervalMs,
    closeGraceMs,
    chatBurst,
    chatRefillMs,
    joinBurst,
    joinRefillMs,
    wishBurst,
    wishRefillMs,
    voteBurst,
    voteRefillMs,
    log: app.log,
  })

  app.decorate('station', station)
  app.decorate('playback', playback)
  app.decorate('realtime', realtime)
  app.decorate('chat', chat)
  app.decorate('wishes', wishes)
  app.decorate('plays', plays)
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
