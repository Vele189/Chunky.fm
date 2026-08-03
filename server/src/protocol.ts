import { type ChatMessage, MESSAGE_MAX_LENGTH, normalizeMessageText } from './chat.js'
import type { Play } from './history.js'
import type { PlaybackSnapshot } from './playback.js'
import { type Listener, normalizeNickname } from './presence.js'
import type { QueueEntry } from './queue.js'
import type { SkipTally } from './skips.js'
import { type Wish, WISH_MAX_LENGTH, normalizeWishText } from './wishes.js'

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
 * "Your wish is written down", and only to the socket that made it.
 *
 * Not a broadcast, unlike everything else the server volunteers. A wish is
 * addressed to whoever runs the decks rather than to the room — PLAN.md puts
 * "see wishes" on the admin surface and keeps it off the social one — so the
 * only client told about a wish is the one that made it, and the only other way
 * to read the book is `GET /api/wishes`, behind the admin gate.
 *
 * It carries the whole wish rather than an "ok", so the listener sees what was
 * actually written down: normalised, timestamped by the server, and signed with
 * the name they are on the roster under.
 */
export interface WishedMessage {
  type: 'wished'
  wish: Wish
}

/**
 * What has been on, as a batch rather than one play per frame.
 *
 * The same shape as chat, and for the same reasons: a joiner is handed the
 * evening so far, a track starting is a batch of one, and because plays carry
 * ids a client that merges on id neither duplicates what a reconnect replays nor
 * leaves a hole where the outage was. Oldest first, as the chat is; the page
 * renders it newest first, which is a display decision rather than a wire one.
 */
export interface HistoryMessage {
  type: 'history'
  plays: Play[]
}

/**
 * How much of the room wants the next one — and where the socket being told
 * stands, which is the one field here that differs per listener.
 *
 * `voted` is why this frame is sent socket by socket rather than serialised once
 * like every other broadcast. A page has to show whether *this* listener's vote
 * is in, and it cannot work that out on its own: the station drops a vote when
 * the socket that cast it closes, so a client that remembered "I voted" across a
 * reconnect would show a vote the station no longer holds. The room is under
 * thirty people — a stringify each is cheaper than a lie.
 *
 * Sent on connect, on every vote, and whenever a track change clears the tally.
 */
export interface SkipsMessage extends SkipTally {
  type: 'skips'
  /** Whether the socket this frame was addressed to has voted. */
  voted: boolean
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

/**
 * Why the socket refused something.
 *
 * Snake_case, and the same idea as the `error` field on every HTTP refusal (see
 * `lib/errors.ts`): a code the client switches on, with `message` left as prose
 * for a human. The HTTP surface was made uniform first; a socket refusal that
 * carried only prose left the other half of the API unreadable by machine, so a
 * client wanting to tell "you are going too fast" from "say who you are" had to
 * match on English.
 */
export type SocketErrorCode =
  /** The frame was not JSON, or not a frame this station knows. */
  | 'unrecognised_message'
  /** A join whose nickname was empty once normalised. */
  | 'nickname_required'
  /** A message longer than the station stores. Refused, not truncated. */
  | 'message_too_long'
  /** A message that was nothing but whitespace. */
  | 'empty_message'
  /** A command-shaped frame. Those go over HTTP, where the admin gate is. */
  | 'command_over_http'
  /** Said something before saying who they are. */
  | 'not_joined'
  /** This station was built without a chat. */
  | 'no_chat'
  /** A wish longer than the station stores. Refused, not truncated. */
  | 'wish_too_long'
  /** A wish that was nothing but whitespace. */
  | 'empty_wish'
  /** This station was built without a wish book. */
  | 'no_wishes'
  /** A vote to skip a track, with nothing on the decks to skip. */
  | 'nothing_playing'
  /** Doing that faster than the station will take it. */
  | 'slow_down'

/**
 * Which frame a refusal is about, when it is about one.
 *
 * The code says what went wrong; this says what it went wrong *for*. Two of the
 * codes — `slow_down` and `not_joined` — are reachable from more than one thing
 * a listener can send, and a client showing "not sent" under the composer has
 * to know which composer. Without it, a wish refused for pace also lights up the
 * chat, telling someone a message they never sent was not sent.
 */
export type SocketErrorAbout = 'join' | 'say' | 'wish' | 'vote'

export interface ErrorMessage {
  type: 'error'
  code: SocketErrorCode
  message: string
  /** Absent when the frame was too malformed to say what it was trying to do. */
  about?: SocketErrorAbout
}

export function errorMessage(
  code: SocketErrorCode,
  message: string,
  about?: SocketErrorAbout,
): ErrorMessage {
  // `about` left undefined simply doesn't survive JSON.stringify, which is the
  // "absent" the type describes — there is nothing to strip by hand.
  return { type: 'error', code, message, about }
}

export type ServerMessage =
  | StateMessage
  | QueueMessage
  | PresenceMessage
  | ChatMessagesMessage
  | WishedMessage
  | HistoryMessage
  | SkipsMessage
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

/**
 * "I'd love to hear this."
 *
 * Free text and nothing else — no track id, because listeners do not browse the
 * library, and no author, for the reason `say` carries none. What comes back is
 * a `wished` frame to this socket alone; the room is not told, and neither is
 * the queue. Whether it gets played is a person's decision, made later.
 */
export interface WishMessage {
  type: 'wish'
  text: string
}

/**
 * "I'd rather hear something else."
 *
 * Not `skip` — that name is taken, by the admin command this frame deliberately
 * is not. A vote is an opinion the room can see and the decks can act on; it
 * advances nothing by itself, and no number of them adds up to a command.
 *
 * Carries where the listener now stands rather than "toggle", so the frame says
 * what it means: two of them in a row leave one vote, which is what a listener
 * who tapped twice on a slow connection expects, and what a retry after a
 * refusal has to be safe to do.
 */
export interface VoteSkipMessage {
  type: 'vote_skip'
  voted: boolean
}

export type ClientMessage = PingMessage | JoinMessage | SayMessage | WishMessage | VoteSkipMessage

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
  | { ok: false; code: SocketErrorCode; error: string; about?: SocketErrorAbout }

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

export function wishedMessage(wish: Wish): WishedMessage {
  return { type: 'wished', wish }
}

export function historyMessage(plays: Play[]): HistoryMessage {
  return { type: 'history', plays }
}

export function skipsMessage(tally: SkipTally, voted: boolean): SkipsMessage {
  return { type: 'skips', ...tally, voted }
}

export function parseClientMessage(raw: string): ParsedClientMessage {
  const unrecognised = {
    ok: false,
    code: 'unrecognised_message',
    error: 'unrecognised message',
  } as const

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
    if (nickname.length === 0) {
      return {
        ok: false,
        code: 'nickname_required',
        error: 'a nickname is required',
        about: 'join',
      }
    }
    return { ok: true, message: { type: 'join', nickname } }
  }
  if (message.type === 'say' && typeof message.text === 'string') {
    // Over-length is refused rather than truncated: the composer caps what can
    // be typed, so anything longer arrived from something hand-written, and
    // quietly publishing half of what it said would be worse than saying no.
    if ([...message.text].length > MESSAGE_MAX_LENGTH) {
      return {
        ok: false,
        code: 'message_too_long',
        error: `a message is at most ${MESSAGE_MAX_LENGTH} characters`,
        about: 'say',
      }
    }
    const text = normalizeMessageText(message.text)
    if (text.length === 0) {
      return {
        ok: false,
        code: 'empty_message',
        error: 'an empty message is not a message',
        about: 'say',
      }
    }
    return { ok: true, message: { type: 'say', text } }
  }
  if (message.type === 'wish' && typeof message.text === 'string') {
    // Refused rather than truncated, as an over-long message is: the composer
    // caps what can be typed, and half a request is worse than none — the admin
    // would read out an album title cut in the middle.
    if ([...message.text].length > WISH_MAX_LENGTH) {
      return {
        ok: false,
        code: 'wish_too_long',
        error: `a wish is at most ${WISH_MAX_LENGTH} characters`,
        about: 'wish',
      }
    }
    const text = normalizeWishText(message.text)
    if (text.length === 0) {
      return { ok: false, code: 'empty_wish', error: 'an empty wish is not a wish', about: 'wish' }
    }
    return { ok: true, message: { type: 'wish', text } }
  }
  if (message.type === 'vote_skip' && typeof message.voted === 'boolean') {
    // Nothing to normalise and nothing to cap: the whole frame is one boolean,
    // and which track it is about is the station's answer rather than the
    // client's — a vote that named its own track could be cast against the song
    // before this one, or the one after.
    return { ok: true, message: { type: 'vote_skip', voted: message.voted } }
  }
  if (typeof message.type === 'string' && COMMAND_TYPES.has(message.type)) {
    return {
      ok: false,
      code: 'command_over_http',
      error: 'admin commands go over HTTP, not the socket',
    }
  }
  return unrecognised
}
