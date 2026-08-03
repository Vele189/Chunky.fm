import type { Server } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import type { PlaybackSnapshot } from './playback.js'
import { type Listener, Presence } from './presence.js'
import {
  type ServerMessage,
  parseClientMessage,
  presenceMessage,
  queueMessage,
  stateMessage,
} from './protocol.js'
import type { QueueEntry } from './queue.js'
import type { Station } from './station.js'

export interface RealtimeLogger {
  info(obj: object, msg: string): void
  warn(obj: object, msg: string): void
}

export interface RealtimeOptions {
  server: Server
  station: Station
  path?: string
  /** How often to probe sockets for liveness. */
  heartbeatIntervalMs?: number
  /** How long a shutdown waits for close handshakes before forcing sockets shut. */
  closeGraceMs?: number
  log?: RealtimeLogger
}

export interface RealtimeHandle {
  clientCount(): number
  /** Who has named themselves — a subset of the sockets `clientCount` counts. */
  listeners(): Listener[]
  broadcast(message: ServerMessage): void
  close(): Promise<void>
}

/** Listeners only ever send tiny clock probes; anything larger is abuse. */
const MAX_PAYLOAD_BYTES = 4 * 1024
const DEFAULT_HEARTBEAT_MS = 30_000
const DEFAULT_CLOSE_GRACE_MS = 1_000

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
}

/**
 * Attaches the station's websocket surface to an existing HTTP server.
 *
 * Connections are read-only, and that *is* the socket's half of the admin gate:
 * there is no privileged frame here to authenticate, because every mutation
 * lives behind `requireAdmin` on an HTTP route. A socket that carries a valid
 * admin cookie gets no more than one that carries nothing — command-shaped
 * frames are refused by name (see `parseClientMessage`), so the only way to
 * drive the station is a request that went through the gate.
 *
 * A socket may name itself, and that is the whole of identity here: a nickname
 * held in memory for as long as the socket lasts, which buys a row in the
 * roster and no say over anything.
 */
export function attachRealtime({
  server,
  station,
  path = '/ws',
  heartbeatIntervalMs = DEFAULT_HEARTBEAT_MS,
  closeGraceMs = DEFAULT_CLOSE_GRACE_MS,
  log,
}: RealtimeOptions): RealtimeHandle {
  const { playback, queue } = station
  const wss = new WebSocketServer({ server, path, maxPayload: MAX_PAYLOAD_BYTES })
  // Sockets that have answered the most recent heartbeat.
  const responsive = new WeakSet<WebSocket>()
  const presence = new Presence()
  // Identifies a socket in the roster for as long as it lasts. Not reused: a
  // listener who reconnects is a new row, which is what "left and came back"
  // should look like.
  let nextListenerId = 1
  // Set once shutdown starts, and read by the roster broadcast below.
  let draining = false

  function broadcast(message: ServerMessage): void {
    // Serialise once, not once per listener.
    const payload = JSON.stringify(message)
    for (const socket of wss.clients) {
      if (socket.readyState === WebSocket.OPEN) socket.send(payload)
    }
  }

  function broadcastPresence(): void {
    // Nothing to tell anyone during a shutdown: every socket left on the roster
    // is on its way out, and announcing each departure to the others would be a
    // roster broadcast per listener as the room empties.
    if (draining) return
    log?.info({ present: presence.size, listeners: wss.clients.size }, 'broadcasting presence')
    broadcast(presenceMessage(presence.list()))
  }

  wss.on('connection', (socket) => {
    responsive.add(socket)
    const listenerId = nextListenerId++

    // Drop straight into the moment: the snapshot alone is enough to align.
    send(socket, stateMessage(playback.snapshot()))
    send(socket, queueMessage(queue.list()))
    // Who is already here. This socket is not on that list yet — it has not
    // said who it is — and joins it the moment it does.
    send(socket, presenceMessage(presence.list()))

    socket.on('pong', () => responsive.add(socket))

    socket.on('message', (raw) => {
      const parsed = parseClientMessage(raw.toString())
      if (!parsed.ok) {
        send(socket, { type: 'error', message: parsed.error })
        return
      }
      const { message } = parsed
      if (message.type === 'ping') {
        // Same clock that stamps startedAt — see PlaybackState.now().
        send(socket, { type: 'pong', t0: message.t0, t1: playback.now() })
      }
      if (message.type === 'join' && presence.join(listenerId, message.nickname)) {
        // Everyone, including the joiner: the roster they are now on is the
        // same frame the rest of the room gets, so there is one code path.
        broadcastPresence()
      }
    })

    // Every way a socket can end arrives here — a tab closing, a network that
    // vanished and was terminated by the heartbeat, a shutdown — so this is the
    // only place a listener needs to be taken off the roster.
    socket.on('close', () => {
      if (presence.leave(listenerId)) broadcastPresence()
    })

    socket.on('error', (err) => {
      log?.warn({ err }, 'websocket error')
      socket.terminate()
    })
  })

  const onChange = (snapshot: PlaybackSnapshot) => {
    log?.info(
      { trackId: snapshot.track?.id ?? null, listeners: wss.clients.size },
      'broadcasting playback state',
    )
    broadcast(stateMessage(snapshot))
  }
  playback.on('change', onChange)

  const onQueueChange = (entries: QueueEntry[]) => {
    log?.info({ queued: entries.length, listeners: wss.clients.size }, 'broadcasting queue')
    broadcast(queueMessage(entries))
  }
  queue.on('change', onQueueChange)

  // A listener whose network vanished leaves a socket that looks open forever.
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!responsive.has(socket)) {
        socket.terminate()
        continue
      }
      responsive.delete(socket)
      socket.ping()
    }
  }, heartbeatIntervalMs)
  heartbeat.unref()

  // Shutting down twice is normal — a manual close followed by the app's
  // onClose hook — and ws throws if its server is closed a second time.
  let closing: Promise<void> | null = null

  async function shutdown(): Promise<void> {
    draining = true
    clearInterval(heartbeat)
    playback.off('change', onChange)
    queue.off('change', onQueueChange)

    const sockets = [...wss.clients]
    const allClosed = Promise.all(
      sockets.map(
        (socket) =>
          new Promise<void>((resolve) => {
            if (socket.readyState === WebSocket.CLOSED) resolve()
            else socket.once('close', () => resolve())
          }),
      ),
    )

    for (const socket of sockets) socket.close(1001, 'server shutting down')

    // An upgraded socket keeps the HTTP server open, so a listener that never
    // answers the close handshake would stall shutdown past the platform's
    // SIGTERM grace period. Ask politely, then insist.
    const forceClose = setTimeout(() => {
      for (const socket of sockets) socket.terminate()
    }, closeGraceMs)
    forceClose.unref()

    await allClosed
    clearTimeout(forceClose)

    await new Promise<void>((resolve, reject) => {
      wss.close((err) => (err ? reject(err) : resolve()))
    })
  }

  return {
    clientCount: () => wss.clients.size,
    listeners: () => presence.list(),
    broadcast,
    close() {
      closing ??= shutdown()
      return closing
    },
  }
}
