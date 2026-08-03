import { useCallback, useEffect, useRef, useState } from 'react'
import { mergeMessages } from '../lib/chat.js'
import { mergePlays } from '../lib/history.js'
import type {
  ChatMessage,
  Listener,
  Play,
  PlaybackSnapshot,
  QueueEntry,
  ServerMessage,
  SocketRefusal,
  StateMessage,
  Wish,
} from '../lib/protocol.js'
import type { SkipTally } from '../lib/skips.js'
import { StationConnection, type StationStatus } from '../lib/station.js'
import { mergeWishes } from '../lib/wishes.js'

export function defaultStationUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${window.location.host}/ws`
}

export interface Station {
  status: StationStatus
  state: StateMessage | null
  /** What's coming up. Null until the first queue frame arrives. */
  queue: QueueEntry[] | null
  /** Who else is here. Null until the first roster arrives. */
  listeners: Listener[] | null
  /** The conversation, oldest first. Empty until the first chat frame arrives. */
  messages: ChatMessage[]
  /**
   * What *this* listener has asked for, oldest first.
   *
   * Only their own: a wish goes to whoever runs the decks, and the station
   * answers the socket that made it rather than the room. Nothing replays it,
   * so this survives a reconnect — the connection is remade under the same
   * hook — and starts empty on a reload, while the wishes themselves are still
   * in the book the admin reads.
   */
  myWishes: Wish[]
  /**
   * What has been on this session, oldest first. Empty until the first history
   * frame arrives.
   *
   * Written down by the station rather than held on the socket, so unlike the
   * roster and the tally this survives a reload: a listener who refreshes at 10
   * still sees the evening, and one who arrives then sees what they missed.
   */
  history: Play[]
  /**
   * How much of the room wants the next one, and whether this listener is part
   * of it. Null until the first tally arrives.
   *
   * `voted` is the station's answer rather than this page's memory of what it
   * sent: a vote lives on the socket that cast it, so a reconnect starts this
   * listener back at not-voted, and the frame that arrives on the new socket
   * says exactly that.
   */
  skips: SkipTally | null
  /**
   * The last thing the socket refused, and a sequence number that goes up on
   * every refusal.
   *
   * The counter is what makes two identical refusals in a row — "slow down",
   * then "slow down" again — distinguishable, so whatever is showing them can
   * react to the second one. Without it a repeat is the same value and nothing
   * downstream ever hears about it. Null until something is refused.
   */
  socketError: SocketRefusal | null
  clearSocketError(): void
  connection: StationConnection | null
  /**
   * Fold in state the server just handed back over HTTP.
   *
   * An admin command answers with the state it produced, which is the same
   * thing the broadcast is about to carry — so applying it here costs nothing
   * and means the panel doesn't sit unchanged for a round trip, or, if the
   * socket happens to be reconnecting, until it comes back. The broadcast still
   * arrives and overwrites it with the identical value.
   */
  applyState(snapshot: PlaybackSnapshot): void
  applyQueue(entries: QueueEntry[]): void
}

/** Holds the websocket open and tracks the station's broadcast state. */
export function useStation(
  url: string = defaultStationUrl(),
  onMessage?: (message: ServerMessage) => void,
): Station {
  const [status, setStatus] = useState<StationStatus>('connecting')
  const [state, setState] = useState<StateMessage | null>(null)
  const [queue, setQueue] = useState<QueueEntry[] | null>(null)
  const [listeners, setListeners] = useState<Listener[] | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [myWishes, setMyWishes] = useState<Wish[]>([])
  const [history, setHistory] = useState<Play[]>([])
  const [skips, setSkips] = useState<SkipTally | null>(null)
  const [socketError, setSocketError] = useState<SocketRefusal | null>(null)
  const [connection, setConnection] = useState<StationConnection | null>(null)

  // Kept in a ref so a changing handler doesn't tear down the socket.
  const messageHandler = useRef(onMessage)
  messageHandler.current = onMessage

  useEffect(() => {
    const station = new StationConnection({
      url,
      onStatus: setStatus,
      onMessage: (message) => {
        if (message.type === 'state') setState(message)
        if (message.type === 'queue') setQueue(message.entries)
        if (message.type === 'presence') setListeners(message.listeners)
        // Merged rather than replaced: a batch is either the history or one new
        // line, and both fold into what is already on screen the same way.
        if (message.type === 'chat') {
          setMessages((current) => mergeMessages(current, message.messages))
        }
        // The station's note back, and the only wish frame a listener ever
        // sees: their own, as it was written down.
        if (message.type === 'wished') {
          setMyWishes((current) => mergeWishes(current, [message.wish]))
        }
        // Merged rather than replaced, exactly as the chat is: a batch is
        // either the evening so far or the one track that just started.
        if (message.type === 'history') {
          setHistory((current) => mergePlays(current, message.plays))
        }
        // Replaced, not merged: the tally is the whole truth about now, and the
        // frame that carries it is addressed to this socket — `voted` in it is
        // this listener's own standing, not the room's.
        if (message.type === 'skips') {
          setSkips({ trackId: message.trackId, votes: message.votes, voted: message.voted })
        }
        // Kept rather than dropped. A refusal is the *only* thing the server
        // says about a frame that went nowhere — a rate-limited message would
        // otherwise leave the composer cleared and nothing on screen, which
        // reads exactly like having said something.
        if (message.type === 'error') {
          setSocketError((current) => ({ error: message, seq: (current?.seq ?? 0) + 1 }))
        }
        messageHandler.current?.(message)
      },
    })
    setConnection(station)
    station.connect()
    return () => {
      station.close()
      setConnection(null)
    }
  }, [url])

  const applyState = useCallback(
    (snapshot: PlaybackSnapshot) => setState({ type: 'state', ...snapshot }),
    [],
  )
  const applyQueue = useCallback((entries: QueueEntry[]) => setQueue(entries), [])
  const clearSocketError = useCallback(() => setSocketError(null), [])

  return {
    status,
    state,
    queue,
    listeners,
    messages,
    myWishes,
    history,
    skips,
    socketError,
    clearSocketError,
    connection,
    applyState,
    applyQueue,
  }
}
