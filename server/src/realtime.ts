import type { Server } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import type { PlaybackSnapshot, PlaybackState } from './playback.js'
import { type ServerMessage, parseClientMessage, stateMessage } from './protocol.js'

export interface RealtimeLogger {
  info(obj: object, msg: string): void
  warn(obj: object, msg: string): void
}

export interface RealtimeOptions {
  server: Server
  playback: PlaybackState
  path?: string
  /** How often to probe sockets for liveness. */
  heartbeatIntervalMs?: number
  /** How long a shutdown waits for close handshakes before forcing sockets shut. */
  closeGraceMs?: number
  log?: RealtimeLogger
}

export interface RealtimeHandle {
  clientCount(): number
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
 * Connections are anonymous — listeners are pure consumers of the clock, and
 * nothing they can send mutates playback. Admin control will need to be gated
 * on the socket itself once it exists.
 */
export function attachRealtime({
  server,
  playback,
  path = '/ws',
  heartbeatIntervalMs = DEFAULT_HEARTBEAT_MS,
  closeGraceMs = DEFAULT_CLOSE_GRACE_MS,
  log,
}: RealtimeOptions): RealtimeHandle {
  const wss = new WebSocketServer({ server, path, maxPayload: MAX_PAYLOAD_BYTES })
  // Sockets that have answered the most recent heartbeat.
  const responsive = new WeakSet<WebSocket>()

  function broadcast(message: ServerMessage): void {
    // Serialise once, not once per listener.
    const payload = JSON.stringify(message)
    for (const socket of wss.clients) {
      if (socket.readyState === WebSocket.OPEN) socket.send(payload)
    }
  }

  wss.on('connection', (socket) => {
    responsive.add(socket)

    // Drop straight into the moment: the snapshot alone is enough to align.
    send(socket, stateMessage(playback.snapshot()))

    socket.on('pong', () => responsive.add(socket))

    socket.on('message', (raw) => {
      const message = parseClientMessage(raw.toString())
      if (!message) {
        send(socket, { type: 'error', message: 'unrecognised message' })
        return
      }
      if (message.type === 'ping') {
        // Same clock that stamps startedAt — see PlaybackState.now().
        send(socket, { type: 'pong', t0: message.t0, t1: playback.now() })
      }
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
    clearInterval(heartbeat)
    playback.off('change', onChange)

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
    broadcast,
    close() {
      closing ??= shutdown()
      return closing
    },
  }
}
