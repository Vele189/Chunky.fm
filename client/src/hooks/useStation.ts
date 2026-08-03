import { useCallback, useEffect, useRef, useState } from 'react'
import { mergeMessages } from '../lib/chat.js'
import type {
  ChatMessage,
  Listener,
  PlaybackSnapshot,
  QueueEntry,
  ServerMessage,
  SocketRefusal,
  StateMessage,
  Wish,
} from '../lib/protocol.js'
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
    socketError,
    clearSocketError,
    connection,
    applyState,
    applyQueue,
  }
}
