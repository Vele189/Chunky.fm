import type { IncomingHttpHeaders, Server } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import { type ChatLog, RateLimit } from './chat.js'
import type { PlayLog } from './history.js'
import type { PlaybackSnapshot } from './playback.js'
import { type Listener, Presence } from './presence.js'
import {
  type ServerMessage,
  chatMessages,
  errorMessage,
  historyMessage,
  parseClientMessage,
  presenceMessage,
  queueMessage,
  skipsMessage,
  stateMessage,
  wishedMessage,
} from './protocol.js'
import type { QueueEntry } from './queue.js'
import { type SkipTally, SkipVotes } from './skips.js'
import type { Station } from './station.js'
import type { WishBook } from './wishes.js'

export interface RealtimeLogger {
  info(obj: object, msg: string): void
  warn(obj: object, msg: string): void
}

export interface RealtimeOptions {
  server: Server
  station: Station
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
   * a station key is — and so the tests can open sockets without one. Omit it
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
  /** Tally-changing skip votes a socket may cast back to back. */
  voteBurst?: number
  /** How long one of those costs to earn back. */
  voteRefillMs?: number
  log?: RealtimeLogger
}

export interface RealtimeHandle {
  clientCount(): number
  /** Who has named themselves — a subset of the sockets `clientCount` counts. */
  listeners(): Listener[]
  /** How much of the room wants the next one, and what they want it off. */
  skips(): SkipTally
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
/**
 * Asking for three things at once is a person remembering a set they liked;
 * asking for a fourth in the same half-minute is not. Tighter than chat because
 * a wish is not conversation — every one of them is a row in a list somebody
 * has to read, and a book nobody can get through is the same as no book.
 */
const DEFAULT_WISH_BURST = 3
const DEFAULT_WISH_REFILL_MS = 30_000
/**
 * Paced like `join`, and for the same reason: a vote that lands is a frame to
 * every listener in the room. Changing your mind twice about one song is a
 * person; doing it forty times is a socket making the station shout.
 */
const DEFAULT_VOTE_BURST = 5
const DEFAULT_VOTE_REFILL_MS = 5_000

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
  voteBurst = DEFAULT_VOTE_BURST,
  voteRefillMs = DEFAULT_VOTE_REFILL_MS,
  log,
}: RealtimeOptions): RealtimeHandle {
  const { playback, queue } = station
  const wss = new WebSocketServer({
    server,
    path,
    maxPayload: MAX_PAYLOAD_BYTES,
    // Refused at the handshake, before a socket exists. Closing it a moment
    // later would work too, but the client cannot tell that apart from the
    // station dropping — and would sit there reconnecting into it forever,
    // telling the listener the station was down when it is only shut to them.
    // A 401 on the upgrade is unambiguous, and `ws` sends one for `false`.
    verifyClient: admit ? (info: { req: { headers: IncomingHttpHeaders } }) => admit(info.req.headers) : undefined,
  })
  // Sockets that have answered the most recent heartbeat.
  const responsive = new WeakSet<WebSocket>()
  const presence = new Presence()
  const skips = new SkipVotes()
  // Which listener a socket is, for the one frame that is addressed rather than
  // broadcast: the skip tally tells each client whether its own vote is in.
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
   * The tally, to everyone, with each socket told where *it* stands.
   *
   * The one thing here sent socket by socket instead of serialised once. It has
   * to be: `voted` is a different answer per listener, and the alternative — a
   * bare count, with each client remembering its own vote — is a client that
   * shows a vote the station threw away when the socket carrying it closed.
   * Under thirty listeners, that is thirty small writes on a button press.
   */
  function broadcastSkips(): void {
    // Nothing to tell a room that is on its way out — see `broadcastPresence`.
    if (draining) return
    const tally = skips.tally()
    log?.info({ ...tally, listeners: wss.clients.size }, 'broadcasting skip votes')
    for (const socket of wss.clients) {
      if (socket.readyState !== WebSocket.OPEN) continue
      const id = listenerIds.get(socket)
      send(socket, skipsMessage(tally, id !== undefined && skips.has(id)))
    }
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
    const nickname = presence.nicknameOf(listenerId)
    if (nickname === null) {
      send(socket, errorMessage('not_joined', 'name yourself before saying anything', 'say'))
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
   * sign with before naming yourself. What is different is where it goes — this
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
    const nickname = presence.nicknameOf(listenerId)
    if (nickname === null) {
      send(socket, errorMessage('not_joined', 'name yourself before asking for anything', 'wish'))
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
   * Records where a listener stands on what is playing, and tells the room.
   *
   * The roster is the gate, as it is for chat and wishes: a vote is one
   * listener's, and a socket that has not said who it is is not a listener. It
   * is also the only thing keeping the count meaningful — without it, a script
   * could open sockets and vote from each without ever appearing in the room the
   * tally is a fraction of.
   *
   * A vote that changes nothing — the same answer twice, a withdrawal from
   * somebody who never voted — broadcasts nothing and so costs nothing, exactly
   * as a re-join under an unchanged name does. That is what makes a client safe
   * to retry with, and what stops a double tap from spending a listener's pace.
   *
   * And it stops here. The tally is broadcast; nothing in this function reaches
   * for `station.advance()`, however many votes are in.
   */
  function voteSkip(
    socket: WebSocket,
    listenerId: number,
    limit: RateLimit,
    voted: boolean,
  ): void {
    if (presence.nicknameOf(listenerId) === null) {
      send(socket, errorMessage('not_joined', 'name yourself before voting', 'vote'))
      return
    }
    if (playback.track === null) {
      send(socket, errorMessage('nothing_playing', 'there is nothing on to skip', 'vote'))
      return
    }
    if (voted === skips.has(listenerId)) return
    if (!limit.take()) {
      send(socket, errorMessage('slow_down', 'slow down', 'vote'))
      return
    }

    if (skips.cast(listenerId, voted)) broadcastSkips()
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
    const voteLimit = new RateLimit({ burst: voteBurst, refillMs: voteRefillMs })

    // Drop straight into the moment: the snapshot alone is enough to align.
    send(socket, stateMessage(playback.snapshot()))
    send(socket, queueMessage(queue.list()))
    // Who is already here. This socket is not on that list yet — it has not
    // said who it is — and joins it the moment it does.
    send(socket, presenceMessage(presence.list()))
    // What the room already thinks of what is on. A fresh socket has voted for
    // nothing, which is also the truth after a reconnect: the vote this listener
    // cast went with the socket that cast it.
    send(socket, skipsMessage(skips.tally(), false))
    // What has been on, so a listener who arrives at 9pm can see what they
    // caught the end of. Written down, so this survives a reload — unlike the
    // roster and the tally, which are only true while a socket is open.
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
        // Same clock that stamps startedAt — see PlaybackState.now().
        send(socket, { type: 'pong', t0: message.t0, t1: playback.now() })
      }
      if (message.type === 'join') join(socket, listenerId, joinLimit, message.nickname)
      if (message.type === 'say') say(socket, listenerId, chatLimit, message.text)
      if (message.type === 'wish') wish(socket, listenerId, wishLimit, message.text)
      if (message.type === 'vote_skip') voteSkip(socket, listenerId, voteLimit, message.voted)
    })

    // Every way a socket can end arrives here — a tab closing, a network that
    // vanished and was terminated by the heartbeat, a shutdown — so this is the
    // only place a listener needs to be taken off the roster.
    socket.on('close', () => {
      if (presence.leave(listenerId)) broadcastPresence()
      // A vote leaves with the listener who cast it. Otherwise a tally counts
      // people who are not in the room any more, and can sit above the roster
      // it is a fraction of — "4 of 3 want the next one".
      if (skips.cast(listenerId, false)) broadcastSkips()
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
    // After the state, not before: the tally is about whatever is on now, and a
    // client that was told the votes were cleared before it knew the track had
    // changed would show an empty tally against the song that just ended.
    if (skips.retarget(snapshot.track?.id ?? null)) broadcastSkips()
    // A track going on is the one playback change worth writing down. `record`
    // is what decides that — most changes here are a pause, a seek or a resume,
    // and none of those is a new play. A batch of one, in the same frame the
    // history arrives in.
    const played = plays?.record(snapshot.track) ?? null
    if (played) {
      log?.info({ playId: played.id, trackId: played.track.id }, 'recording play')
      broadcast(historyMessage([played]))
    }
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
    skips: () => skips.tally(),
    broadcast,
    close() {
      closing ??= shutdown()
      return closing
    },
  }
}
