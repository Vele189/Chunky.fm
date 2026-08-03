import type { Server } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import { type ChatLog, RateLimit } from './chat.js'
import type { PlaybackSnapshot } from './playback.js'
import { type Listener, Presence } from './presence.js'
import {
  type ServerMessage,
  chatMessages,
  errorMessage,
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
  /** The session's chat. Omit and the socket refuses `say` frames. */
  chat?: ChatLog
  path?: string
  /** How often to probe sockets for liveness. */
  heartbeatIntervalMs?: number
  /** How long a shutdown waits for close handshakes before forcing sockets shut. */
  closeGraceMs?: number
  /** Messages a socket may send back to back before it has to wait. */
  chatBurst?: number
  /** How long one of those costs to earn back. */
  chatRefillMs?: number
  /** Roster-changing joins a socket may send back to back. */
  joinBurst?: number
  /** How long one of those costs to earn back. */
  joinRefillMs?: number
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
/** A few lines in a row is how people talk; a stream of them is not. */
const DEFAULT_CHAT_BURST = 5
const DEFAULT_CHAT_REFILL_MS = 2_000
/**
 * A socket names itself once, and again only if the listener changes their mind
 * — so this is generous for anything a person does, and the first thing a script
 * renaming itself in a loop runs into.
 */
const DEFAULT_JOIN_BURST = 5
const DEFAULT_JOIN_REFILL_MS = 5_000

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
  chat,
  path = '/ws',
  heartbeatIntervalMs = DEFAULT_HEARTBEAT_MS,
  closeGraceMs = DEFAULT_CLOSE_GRACE_MS,
  chatBurst = DEFAULT_CHAT_BURST,
  chatRefillMs = DEFAULT_CHAT_REFILL_MS,
  joinBurst = DEFAULT_JOIN_BURST,
  joinRefillMs = DEFAULT_JOIN_REFILL_MS,
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

  /**
   * Writes one message down and sends it to the room.
   *
   * The author is the nickname on the roster, looked up here rather than taken
   * from the frame, so a message can only ever be signed with the name its own
   * socket is listed under. That also makes the roster the gate: a socket that
   * has not said who it is has nothing to sign with, and is told to name itself
   * rather than being quietly ignored.
   */
  function say(socket: WebSocket, listenerId: number, limit: RateLimit, text: string): void {
    if (!chat) {
      send(socket, errorMessage('no_chat', 'this station has no chat'))
      return
    }
    const nickname = presence.nicknameOf(listenerId)
    if (nickname === null) {
      send(socket, errorMessage('not_joined', 'name yourself before saying anything'))
      return
    }
    if (!limit.take()) {
      send(socket, errorMessage('slow_down', 'slow down'))
      return
    }

    const message = chat.post(nickname, text)
    log?.info({ id: message.id, listeners: wss.clients.size }, 'broadcasting chat message')
    // A batch of one, in the same frame the history arrives in.
    broadcast(chatMessages([message]))
  }

  /**
   * Puts a socket on the roster under a name, and tells the room.
   *
   * Paced, because this is the one frame a listener can send that costs every
   * *other* listener something: a roster goes out to all of them each time one
   * changes. Unpaced, a single socket renaming itself in a loop is a broadcast
   * to the whole room per frame — the cheapest way in there is to make the
   * station shout at everyone, and it needs no nickname, no password and no
   * chat to do it.
   *
   * A join that names a socket what it is already called is free, because it
   * broadcasts nothing: only a change to the roster spends a token. That keeps a
   * client that re-sends its name — on a reconnect, or a render it didn't mean —
   * from being charged for saying nothing.
   */
  function join(socket: WebSocket, listenerId: number, limit: RateLimit, nickname: string): void {
    if (presence.nicknameOf(listenerId) === nickname) return
    if (!limit.take()) {
      send(socket, errorMessage('slow_down', 'slow down'))
      return
    }
    // Everyone, including the joiner: the roster they are now on is the same
    // frame the rest of the room gets, so there is one code path.
    if (presence.join(listenerId, nickname)) broadcastPresence()
  }

  wss.on('connection', (socket) => {
    responsive.add(socket)
    const listenerId = nextListenerId++
    // Per socket, not per listener: the thing being paced is a connection, and
    // a bucket that outlived one would have to be cleaned up after sockets that
    // never come back.
    const chatLimit = new RateLimit({ burst: chatBurst, refillMs: chatRefillMs })
    const joinLimit = new RateLimit({ burst: joinBurst, refillMs: joinRefillMs })

    // Drop straight into the moment: the snapshot alone is enough to align.
    send(socket, stateMessage(playback.snapshot()))
    send(socket, queueMessage(queue.list()))
    // Who is already here. This socket is not on that list yet — it has not
    // said who it is — and joins it the moment it does.
    send(socket, presenceMessage(presence.list()))
    // The conversation so far, so a joiner walks into a room mid-sentence
    // rather than an empty one. Also how a reconnecting client fills the gap.
    if (chat) send(socket, chatMessages(chat.recent()))

    socket.on('pong', () => responsive.add(socket))

    socket.on('message', (raw) => {
      const parsed = parseClientMessage(raw.toString())
      if (!parsed.ok) {
        send(socket, errorMessage(parsed.code, parsed.error))
        return
      }
      const { message } = parsed
      if (message.type === 'ping') {
        // Same clock that stamps startedAt — see PlaybackState.now().
        send(socket, { type: 'pong', t0: message.t0, t1: playback.now() })
      }
      if (message.type === 'join') join(socket, listenerId, joinLimit, message.nickname)
      if (message.type === 'say') say(socket, listenerId, chatLimit, message.text)
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
