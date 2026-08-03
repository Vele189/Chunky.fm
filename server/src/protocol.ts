import type { PlaybackSnapshot } from './playback.js'
import type { QueueEntry } from './queue.js'

/** Full playback state. Sent on connect and on every change. */
export type StateMessage = PlaybackSnapshot & { type: 'state' }

/**
 * What's coming up. Kept out of `state` on purpose: playback changes several
 * times a track and the queue rarely does, so folding them together would ship
 * the whole queue on every seek.
 */
export interface QueueMessage {
  type: 'queue'
  entries: QueueEntry[]
}

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

export type ServerMessage = StateMessage | QueueMessage | PongMessage | ErrorMessage

export interface PingMessage {
  type: 'ping'
  t0: number
}

export type ClientMessage = PingMessage

/**
 * Frames that read as an attempt to drive the station.
 *
 * The socket has no mutating surface at all — commands go over HTTP, where the
 * admin gate is — so these are refused like anything else. They are named only
 * so a client that tries gets told why instead of a shrug, and so the refusal
 * is a line of code with a test behind it rather than an accident of `ping`
 * being the one type the parser happens to know.
 */
const COMMAND_TYPES = new Set([
  'play',
  'pause',
  'resume',
  'seek',
  'stop',
  'skip',
  'queue',
  'enqueue',
  'move',
  'remove',
  'clear',
  'upload',
  'admin',
])

/** Either a message the socket will act on, or why it won't. */
export type ParsedClientMessage =
  | { ok: true; message: ClientMessage }
  | { ok: false; error: string }

export function stateMessage(snapshot: PlaybackSnapshot): StateMessage {
  return { type: 'state', ...snapshot }
}

export function queueMessage(entries: QueueEntry[]): QueueMessage {
  return { type: 'queue', entries }
}

export function parseClientMessage(raw: string): ParsedClientMessage {
  const unrecognised = { ok: false, error: 'unrecognised message' } as const

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return unrecognised
  }
  if (typeof parsed !== 'object' || parsed === null) return unrecognised

  const message = parsed as Record<string, unknown>
  if (message.type === 'ping' && typeof message.t0 === 'number' && Number.isFinite(message.t0)) {
    return { ok: true, message: { type: 'ping', t0: message.t0 } }
  }
  if (typeof message.type === 'string' && COMMAND_TYPES.has(message.type)) {
    return { ok: false, error: 'admin commands go over HTTP, not the socket' }
  }
  return unrecognised
}
