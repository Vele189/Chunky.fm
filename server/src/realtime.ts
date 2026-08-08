import type { IncomingHttpHeaders, Server } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import type { AirSnapshot, OnAir } from './air.js'
import { type ChatLog, RateLimit } from './chat.js'
import type { PlayLog } from './history.js'
import type { PlaybackSnapshot } from './playback.js'
import type { Mutes } from './mutes.js'
import { type Listener, Presence } from './presence.js'
import {
  type ServerMessage,
  airMessage,
  scheduleMessage,
  chatMessages,
  errorMessage,
  historyMessage,
  parseClientMessage,
  presenceMessage,
  queueMessage,
  stateMessage,
  wishedMessage,
} from './protocol.js'
import type { QueueEntry } from './queue.js'
import type { Schedule, ScheduledSession } from './schedule.js'
import type { Station } from './station.js'
import type { WishBook } from './wishes.js'

export interface RealtimeLogger {
  info(obj: object, msg: string): void
  warn(obj: object, msg: string): void
}

export interface RealtimeOptions {
  server: Server
  station: Station
  /**
   * Whether the station is broadcasting. Omit and it is always on, which is
   * what the tests that are about something else want.
   */
  air?: OnAir
  /**
   * The next session, announced. Optional like `air`: a harness that is about
   * something else should not have to build one, and a socket with no schedule
   * behind it simply says there is nothing announced.
   */
  schedule?: Schedule
  /** Who has been asked to stop talking. Omit and nobody is muted. */
  mutes?: Mutes
  /** The session's chat. Omit and the socket refuses `say` frames. */
  chat?: ChatLog
  /** The session's wish book. Omit and the socket refuses `wish` frames. */
  wishes?: WishBook
  /** The session's history. Omit and the station keeps no record of what was on. */
  plays?: PlayLog
  path?: string
  /**
   * Decides whether an upgrade is allowed to become a socket at all.
   *
   * A predicate rather than the config, so realtime does not have to know what
   * a station key is, and so the tests can open sockets without one. Omit it
   * and every upgrade is admitted, which is the open station.
   */
  admit?(headers: IncomingHttpHeaders): boolean
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
  /** Wishes a socket may make back to back. */
  wishBurst?: number
  /** How long one of those costs to earn back. */
  wishRefillMs?: number
  log?: RealtimeLogger
}

export interface RealtimeHandle {
  clientCount(): number
  /** Who has named themselves: a subset of the sockets `clientCount` counts. */
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
 * A socket names itself once, and again only if the listener changes their mind,
 * so this is generous for anything a person does, and the first thing a script
 * renaming itself in a loop runs into.
 */
const DEFAULT_JOIN_BURST = 5
const DEFAULT_JOIN_REFILL_MS = 5_000
/**
 * Asking for three things at once is a person remembering a set they liked;
 * asking for a fourth in the same half-minute is not. Tighter than chat because
 * a wish is not conversation: every one of them is a row in a list somebody
 * has to read, and a book nobody can get through is the same as no book.
 */
const DEFAULT_WISH_BURST = 3
const DEFAULT_WISH_REFILL_MS = 30_000

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
}

/** What a station with no `air` of its own reports: always broadcasting. */
const ALWAYS_ON: AirSnapshot = { live: true, since: null }

/**
 * Attaches the station's websocket surface to an existing HTTP server.
 *
 * Connections are read-only, and that *is* the socket's half of the admin gate:
 * there is no privileged frame here to authenticate, because every mutation
 * lives behind `requireAdmin` on an HTTP route. A socket that carries a valid
 * admin cookie gets no more than one that carries nothing. Command-shaped
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
  air,
  schedule,
  mutes,
  chat,
  wishes,
  plays,
  path = '/ws',
  admit,
  heartbeatIntervalMs = DEFAULT_HEARTBEAT_MS,
  closeGraceMs = DEFAULT_CLOSE_GRACE_MS,
  chatBurst = DEFAULT_CHAT_BURST,
  chatRefillMs = DEFAULT_CHAT_REFILL_MS,
  joinBurst = DEFAULT_JOIN_BURST,
  joinRefillMs = DEFAULT_JOIN_REFILL_MS,
  wishBurst = DEFAULT_WISH_BURST,
  wishRefillMs = DEFAULT_WISH_REFILL_MS,
  log,
}: RealtimeOptions): RealtimeHandle {
  const { playback, queue } = station
  // Omitting `air` means a station that is always on. Tests that are about the
  // chat should not each have to open a session first, and a socket layer that
  // refused everything without one would make them.
  const onAir = (): boolean => air?.live ?? true
  const airSnapshot = (): AirSnapshot => air?.snapshot() ?? ALWAYS_ON
  const wss = new WebSocketServer({
    server,
    path,
    maxPayload: MAX_PAYLOAD_BYTES,
    // Refused at the handshake, before a socket exists. Closing it a moment
    // later would work too, but the client cannot tell that apart from the
    // station dropping, and would sit there reconnecting into it forever,
    // telling the listener the station was down when it is only shut to them.
    // A 401 on the upgrade is unambiguous, and `ws` sends one for `false`.
    verifyClient: admit ? (info: { req: { headers: IncomingHttpHeaders } }) => admit(info.req.headers) : undefined,
  })
  // Sockets that have answered the most recent heartbeat.
  const responsive = new WeakSet<WebSocket>()
  const presence = new Presence()
  // Which listener a socket is.
  const listenerIds = new WeakMap<WebSocket, number>()
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
      send(socket, errorMessage('no_chat', 'this station has no chat', 'say'))
      return
    }
    if (!onAir()) {
      // Before the roster check and before the pace check: being off air is the
      // truest thing about the refusal, and telling somebody to name themselves
      // first would send them round a loop that ends here anyway.
      send(socket, errorMessage('off_air', 'the station is not on air', 'say'))
      return
    }
    const nickname = presence.nicknameOf(listenerId)
    if (nickname === null) {
      send(socket, errorMessage('not_joined', 'name yourself before saying anything', 'say'))
      return
    }
    // After the name is known, because a mute is about a name, and before the
    // pace check, so being muted does not also cost a token.
    if (mutes?.has(nickname)) {
      send(socket, errorMessage('muted', 'the decks have muted you', 'say'))
      return
    }
    if (!limit.take()) {
      send(socket, errorMessage('slow_down', 'slow down', 'say'))
      return
    }

    const message = chat.post(nickname, text)
    log?.info({ id: message.id, listeners: wss.clients.size }, 'broadcasting chat message')
    // A batch of one, in the same frame the history arrives in.
    broadcast(chatMessages([message]))
  }

  /**
   * Writes a wish down and tells the listener who made it. Nobody else.
   *
   * The gate is the roster, as it is for chat and for the same reason: a wish is
   * signed with the name its own socket is listed under, so there is nothing to
   * sign with before naming yourself. What is different is where it goes: this
   * is the one thing a listener can send that is *not* broadcast, because a wish
   * is addressed to whoever runs the decks rather than to the room. The room
   * would learn nothing from it, and the person who asked would have made a
   * request in public that may never be played.
   */
  function wish(socket: WebSocket, listenerId: number, limit: RateLimit, text: string): void {
    if (!wishes) {
      send(socket, errorMessage('no_wishes', 'this station takes no wishes', 'wish'))
      return
    }
    if (!onAir()) {
      send(socket, errorMessage('off_air', 'the station is not on air', 'wish'))
      return
    }
    const nickname = presence.nicknameOf(listenerId)
    if (nickname === null) {
      send(socket, errorMessage('not_joined', 'name yourself before asking for anything', 'wish'))
      return
    }
    // Muted covers wishes as well as chat. Both are text signed with a
    // nickname, and a mute that left the wish book open would just move where
    // somebody was shouting.
    if (mutes?.has(nickname)) {
      send(socket, errorMessage('muted', 'the decks have muted you', 'wish'))
      return
    }
    if (!limit.take()) {
      send(socket, errorMessage('slow_down', 'slow down', 'wish'))
      return
    }

    const made = wishes.make(nickname, text)
    log?.info({ id: made.id }, 'wish written down')
    // Straight back to the one socket that asked, so the listener sees what was
    // written down rather than being left to assume.
    send(socket, wishedMessage(made))
  }

  /**
   * Puts a socket on the roster under a name, and tells the room.
   *
   * Paced, because this is the one frame a listener can send that costs every
   * *other* listener something: a roster goes out to all of them each time one
   * changes. Unpaced, a single socket renaming itself in a loop is a broadcast
   * to the whole room per frame. The cheapest way in there is to make the
   * station shout at everyone, and it needs no nickname, no password and no
   * chat to do it.
   *
   * A join that names a socket what it is already called is free, because it
   * broadcasts nothing: only a change to the roster spends a token. That keeps a
   * client that re-sends its name (on a reconnect, or a render it didn't mean)
   * from being charged for saying nothing.
   */
  function join(socket: WebSocket, listenerId: number, limit: RateLimit, nickname: string): void {
    if (presence.nicknameOf(listenerId) === nickname) return
    if (!limit.take()) {
      send(socket, errorMessage('slow_down', 'slow down', 'join'))
      return
    }
    // Everyone, including the joiner: the roster they are now on is the same
    // frame the rest of the room gets, so there is one code path.
    if (presence.join(listenerId, nickname)) broadcastPresence()
  }

  wss.on('connection', (socket) => {
    responsive.add(socket)
    const listenerId = nextListenerId++
    listenerIds.set(socket, listenerId)
    // Per socket, not per listener: the thing being paced is a connection, and
    // a bucket that outlived one would have to be cleaned up after sockets that
    // never come back.
    const chatLimit = new RateLimit({ burst: chatBurst, refillMs: chatRefillMs })
    const joinLimit = new RateLimit({ burst: joinBurst, refillMs: joinRefillMs })
    const wishLimit = new RateLimit({ burst: wishBurst, refillMs: wishRefillMs })

    // Whether there is a broadcast at all comes before what is on it: a page
    // told the decks are empty without being told the station is off air would
    // show a gap between songs that never ends.
    send(socket, airMessage(airSnapshot()))
    // And, straight after it, when the station is next on. The two are one
    // sentence on the off-air screen, and a page that got the first without the
    // second would draw "off the air" and then replace it a frame later.
    send(socket, scheduleMessage(schedule?.get() ?? null))
    // Drop straight into the moment: the snapshot alone is enough to align.
    send(socket, stateMessage(playback.snapshot()))
    send(socket, queueMessage(queue.list()))
    // Who is already here. This socket is not on that list yet, because it has
    // not said who it is, and joins it the moment it does.
    send(socket, presenceMessage(presence.list()))
    // What has been on, so a listener who arrives at 9pm can see what they
    // caught the end of. Written down, so this survives a reload, unlike the
    // roster, which is only true while a socket is open.
    if (plays) send(socket, historyMessage(plays.recent()))
    // The conversation so far, so a joiner walks into a room mid-sentence
    // rather than an empty one. Also how a reconnecting client fills the gap.
    if (chat) send(socket, chatMessages(chat.recent()))

    socket.on('pong', () => responsive.add(socket))

    socket.on('message', (raw) => {
      const parsed = parseClientMessage(raw.toString())
      if (!parsed.ok) {
        send(socket, errorMessage(parsed.code, parsed.error, parsed.about))
        return
      }
      const { message } = parsed
      if (message.type === 'ping') {
        // Same clock that stamps startedAt. See PlaybackState.now().
        send(socket, { type: 'pong', t0: message.t0, t1: playback.now() })
      }
      if (message.type === 'join') join(socket, listenerId, joinLimit, message.nickname)
      if (message.type === 'say') say(socket, listenerId, chatLimit, message.text)
      if (message.type === 'wish') wish(socket, listenerId, wishLimit, message.text)
    })

    // Every way a socket can end arrives here: a tab closing, a network that
    // vanished and was terminated by the heartbeat, a shutdown. So this is the
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
    // A track going on is the one playback change worth writing down. `record`
    // is what decides that: most changes here are a pause, a seek or a resume,
    // and none of those is a new play. A batch of one, in the same frame the
    // history arrives in.
    const played = plays?.record(snapshot.track) ?? null
    if (played) {
      log?.info({ playId: played.id, trackId: played.track.id }, 'recording play')
      broadcast(historyMessage([played]))
    }
  }
  playback.on('change', onChange)

  const onAirChange = (snapshot: AirSnapshot) => {
    log?.info({ live: snapshot.live, listeners: wss.clients.size }, 'broadcasting air state')
    broadcast(airMessage(snapshot))
    // A session ending takes the chat and the history with it, since they are
    // scoped to it, so every client is told to start again rather than being
    // left showing a conversation that no longer exists anywhere.
    if (!snapshot.live) {
      broadcast(chatMessages([]))
      broadcast(historyMessage([]))
    }
  }
  const onScheduleChange = (next: ScheduledSession | null) => {
    log?.info({ announced: next !== null, listeners: wss.clients.size }, 'broadcasting schedule')
    broadcast(scheduleMessage(next))
  }

  air?.on('change', onAirChange)
  schedule?.on('change', onScheduleChange)

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

  // Shutting down twice is normal (a manual close followed by the app's
  // onClose hook), and ws throws if its server is closed a second time.
  let closing: Promise<void> | null = null

  async function shutdown(): Promise<void> {
    draining = true
    clearInterval(heartbeat)
    playback.off('change', onChange)
    queue.off('change', onQueueChange)
    air?.off('change', onAirChange)
    schedule?.off('change', onScheduleChange)

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
