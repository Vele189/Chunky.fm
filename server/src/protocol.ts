import type { PlaybackSnapshot } from './playback.js'

/** Full playback state. Sent on connect and on every change. */
export type StateMessage = PlaybackSnapshot & { type: 'state' }

/**
 * Reply to a clock probe. The client computes
 * `rtt = t2 - t0` and `offset = t1 - (t0 + rtt / 2)`, keeping the sample with
 * the lowest RTT — the fastest round trip is the least contaminated by
 * queueing delay.
 */
export interface PongMessage {
  type: 'pong'
  /** Echoed back untouched so the client can match probe to reply. */
  t0: number
  /** Server clock when the probe was answered. */
  t1: number
}

export interface ErrorMessage {
  type: 'error'
  message: string
}

export type ServerMessage = StateMessage | PongMessage | ErrorMessage

export interface PingMessage {
  type: 'ping'
  t0: number
}

export type ClientMessage = PingMessage

export function stateMessage(snapshot: PlaybackSnapshot): StateMessage {
  return { type: 'state', ...snapshot }
}

export function parseClientMessage(raw: string): ClientMessage | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null

  const message = parsed as Record<string, unknown>
  if (message.type === 'ping' && typeof message.t0 === 'number' && Number.isFinite(message.t0)) {
    return { type: 'ping', t0: message.t0 }
  }
  return null
}
