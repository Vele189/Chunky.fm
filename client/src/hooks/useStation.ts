import { useEffect, useRef, useState } from 'react'
import type { QueueEntry, ServerMessage, StateMessage } from '../lib/protocol.js'
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
  connection: StationConnection | null
}

/** Holds the websocket open and tracks the station's broadcast state. */
export function useStation(
  url: string = defaultStationUrl(),
  onMessage?: (message: ServerMessage) => void,
): Station {
  const [status, setStatus] = useState<StationStatus>('connecting')
  const [state, setState] = useState<StateMessage | null>(null)
  const [queue, setQueue] = useState<QueueEntry[] | null>(null)
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

  return { status, state, queue, connection }
}
