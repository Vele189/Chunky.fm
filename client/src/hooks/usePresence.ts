import { useEffect } from 'react'
import type { StationConnection } from '../lib/station.js'

export interface PresenceOptions {
  /**
   * Whether the socket is actually open. `send` on a connecting socket is a
   * silent no-op, the same trap the clock handshake fell into, and a join
   * dropped there is a listener nobody else can see, with nothing to retry it.
   */
  connected: boolean
  /** The name to be known by, or null before this listener has tuned in. */
  nickname: string | null
}

/**
 * Tells the station what to call this listener.
 *
 * One line of state on the server, and one frame here, but the frame has to be
 * sent again on every reconnect, because presence lives with the socket and a
 * reconnect is a new socket. Hanging it off `connected` is what makes that
 * automatic: the effect re-runs each time the connection comes back, so a
 * listener who drops off the roster during an outage is put back on it by the
 * same code that put them there the first time.
 *
 * There is no leave frame. The socket closing is the departure, and it is the
 * only signal that also covers a tab closed, a laptop shut, and a network that
 * simply stopped, none of which get to send anything.
 */
export function usePresence(
  connection: StationConnection | null,
  { connected, nickname }: PresenceOptions,
): void {
  useEffect(() => {
    if (!connection || !connected || !nickname) return
    connection.send({ type: 'join', nickname })
  }, [connection, connected, nickname])
}
