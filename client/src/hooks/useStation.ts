import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  Listener,
  PlaybackSnapshot,
  QueueEntry,
  ServerMessage,
  StateMessage,
} from '../lib/protocol.js'
import { StationConnection, type StationStatus } from '../lib/station.js'

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

  return { status, state, queue, listeners, connection, applyState, applyQueue }
}
