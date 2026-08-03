import { type ChatMessage, MESSAGE_MAX_LENGTH, normalizeMessageText } from './chat.js'
import type { PlaybackSnapshot } from './playback.js'
import { type Listener, normalizeNickname } from './presence.js'
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
 * Who is listening. Sent on connect and whenever the roster changes, and kept
 * out of `state` for the same reason the queue is: presence turns over on its
 * own schedule, and nobody needs the whole roster again because of a seek.
 */
export interface PresenceMessage {
  type: 'presence'
  listeners: Listener[]
}

/**
 * Chat, as a batch rather than one message per frame.
 *
 * A joiner is handed the tail of the conversation, and a new message is a batch
 * of one — same frame, same handling on the other side. Because messages carry
 * ids, a client that merges on id gets two things for free: a reconnect replays
 * history without duplicating anything, and whatever was said while it was away
 * arrives in that replay instead of being a hole in the conversation.
 */
export interface ChatMessagesMessage {
  type: 'chat'
  messages: ChatMessage[]
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

export type ServerMessage =
  | StateMessage
  | QueueMessage
  | PresenceMessage
  | ChatMessagesMessage
  | PongMessage
  | ErrorMessage

export interface PingMessage {
  type: 'ping'
  t0: number
}

/**
 * "Here is what to call me."
 *
 * The one frame a listener sends that the server keeps, and it still drives
 * nothing: a nickname buys a row in the roster and no say over the decks. It is
 * separate from connecting because a socket opens when the page loads, which is
 * before anyone has typed a name — and because a reconnect has to say it again.
 */
export interface JoinMessage {
  type: 'join'
  nickname: string
}

/**
 * "Say this to the room."
 *
 * Carries the text and nothing else — no author, no timestamp, no id. Those are
 * the server's to decide: a frame that named its own sender would let a client
 * sign someone else's name to a message, and the nickname on the roster is
 * already the answer to who this socket is.
 */
export interface SayMessage {
  type: 'say'
  text: string
}

export type ClientMessage = PingMessage | JoinMessage | SayMessage

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

export function presenceMessage(listeners: Listener[]): PresenceMessage {
  return { type: 'presence', listeners }
}

export function chatMessages(messages: ChatMessage[]): ChatMessagesMessage {
  return { type: 'chat', messages }
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
  if (message.type === 'join' && typeof message.nickname === 'string') {
    // Normalised here rather than taken as sent. The client caps and cleans a
    // nickname before it stores one, but nothing about a socket obliges it to,
    // and the roster goes out to every listener — so the rules are enforced on
    // the side that owns the roster.
    const nickname = normalizeNickname(message.nickname)
    if (nickname.length === 0) return { ok: false, error: 'a nickname is required' }
    return { ok: true, message: { type: 'join', nickname } }
  }
  if (message.type === 'say' && typeof message.text === 'string') {
    // Over-length is refused rather than truncated: the composer caps what can
    // be typed, so anything longer arrived from something hand-written, and
    // quietly publishing half of what it said would be worse than saying no.
    if ([...message.text].length > MESSAGE_MAX_LENGTH) {
      return { ok: false, error: `a message is at most ${MESSAGE_MAX_LENGTH} characters` }
    }
    const text = normalizeMessageText(message.text)
    if (text.length === 0) return { ok: false, error: 'an empty message is not a message' }
    return { ok: true, message: { type: 'say', text } }
  }
  if (typeof message.type === 'string' && COMMAND_TYPES.has(message.type)) {
    return { ok: false, error: 'admin commands go over HTTP, not the socket' }
  }
  return unrecognised
}
