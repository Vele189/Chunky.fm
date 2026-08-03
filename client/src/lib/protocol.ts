/** Wire types. Mirrors server/src/protocol.ts — keep the two in step. */

export interface Track {
  id: number
  title: string
  artist: string | null
  album: string | null
  durationMs: number
  filename: string
  artworkPath: string | null
  contentHash: string
  gainDb: number
  uploadedAt: number
}

export interface StateMessage {
  type: 'state'
  track: Track | null
  /** Server epoch ms at which the current track was at 0:00. */
  startedAt: number
  /** Position in ms while paused; null while playing. */
  pausedAt: number | null
  serverTime: number
}

/**
 * The same tuple as it comes back from `POST /api/playback` — the broadcast's
 * payload without the frame around it.
 */
export type PlaybackSnapshot = Omit<StateMessage, 'type'>

/** A track waiting its turn. The id is the entry's, not the track's. */
export interface QueueEntry {
  id: number
  track: Track
}

/** What's coming up. Sent on connect and whenever the queue changes. */
export interface QueueMessage {
  type: 'queue'
  entries: QueueEntry[]
}

/** One listener on the roster. The id is the socket's, not the nickname's. */
export interface Listener {
  id: number
  nickname: string
}

/** Who is listening. Sent on connect and whenever someone joins or leaves. */
export interface PresenceMessage {
  type: 'presence'
  listeners: Listener[]
}

/** Something someone said. `at` is server epoch ms. */
export interface ChatMessage {
  id: number
  nickname: string
  text: string
  at: number
}

/**
 * Chat, in batches: the tail of the conversation on connect, and a batch of one
 * for each new message. Merged on id, so a reconnect's replay neither
 * duplicates what is already shown nor leaves a hole where the outage was.
 */
export interface ChatMessagesMessage {
  type: 'chat'
  messages: ChatMessage[]
}

/** Where a wish stands with whoever runs the decks. */
export type WishStatus = 'new' | 'handled'

/** Something a listener asked for. `at` is server epoch ms. */
export interface Wish {
  id: number
  nickname: string
  text: string
  at: number
  status: WishStatus
}

/**
 * "Your wish is written down", to the socket that made it and to no other.
 *
 * The one thing the server sends that is not a broadcast: a wish goes to the
 * admin, who reads the book over HTTP, and back to whoever asked. So the only
 * wishes a listener is ever told about are their own, and this is the whole of
 * that — there is no history frame, and a reload starts the list empty even
 * though the wishes themselves are still in the book.
 */
export interface WishedMessage {
  type: 'wished'
  wish: Wish
}

/**
 * How much of the room wants the next one, and where this listener stands.
 *
 * Sent on connect, on every vote, and whenever a track change clears the tally.
 * `voted` is the station's answer rather than something the page remembers: a
 * vote is dropped when the socket that cast it closes, so a client that kept its
 * own flag would show a vote across a reconnect that the station no longer
 * holds. `trackId` is what the votes are about — a tally never outlives the
 * track it was cast against.
 */
export interface SkipsMessage {
  type: 'skips'
  trackId: number | null
  votes: number
  voted: boolean
}

export interface PongMessage {
  type: 'pong'
  t0: number
  t1: number
}

/**
 * Why the socket refused something. Mirrors `SocketErrorCode` on the server —
 * keep the two in step.
 *
 * A code rather than prose for the same reason `AdminError.code` is one: a
 * client that has to tell "you are going too fast" from "say who you are" should
 * switch on a value, not match on English.
 */
export type SocketErrorCode =
  | 'unrecognised_message'
  | 'nickname_required'
  | 'message_too_long'
  | 'empty_message'
  | 'command_over_http'
  | 'not_joined'
  | 'no_chat'
  | 'wish_too_long'
  | 'empty_wish'
  | 'no_wishes'
  | 'nothing_playing'
  | 'slow_down'

/**
 * Which frame a refusal is about, when it is about one.
 *
 * `slow_down` and `not_joined` can each come from more than one thing a
 * listener did — two composers and a vote button, all on one socket. Without
 * this, a wish refused for pace also puts "not sent" under the chat, telling
 * someone a message they never sent went nowhere.
 */
export type SocketErrorAbout = 'join' | 'say' | 'wish' | 'vote'

export interface ErrorMessage {
  type: 'error'
  code: SocketErrorCode
  message: string
  /** Absent when the frame was too malformed to say what it was trying to do. */
  about?: SocketErrorAbout
}

/** What a socket refused, and the sequence number that makes a repeat visible. */
export interface SocketRefusal {
  error: ErrorMessage
  seq: number
}

/**
 * The refusal, if the last one was about this composer — otherwise nothing.
 *
 * Null rather than a stale value on purpose: a composer that filtered on the
 * code alone would react to the other one's refusals, and one that held onto
 * the last refusal of its own would react again every time the *other* composer
 * was refused.
 */
export function refusalAbout(
  refusal: SocketRefusal | null,
  about: SocketErrorAbout,
): SocketRefusal | null {
  return refusal && refusal.error.about === about ? refusal : null
}

export type ServerMessage =
  | StateMessage
  | QueueMessage
  | PresenceMessage
  | ChatMessagesMessage
  | WishedMessage
  | SkipsMessage
  | PongMessage
  | ErrorMessage

export interface PingMessage {
  type: 'ping'
  t0: number
}

/** "Here is what to call me." Sent after tuning in, and again on every reconnect. */
export interface JoinMessage {
  type: 'join'
  nickname: string
}

/** "Say this to the room." The server decides who said it, and when. */
export interface SayMessage {
  type: 'say'
  text: string
}

/**
 * "I'd love to hear this." Free text and nothing else — listeners do not browse
 * the library, and the name on it is the one the roster already has.
 */
export interface WishMessage {
  type: 'wish'
  text: string
}

/**
 * "I'd rather hear something else."
 *
 * Not `skip` — that is the admin's command, over HTTP, and this is not it. The
 * frame carries where the listener now stands rather than "toggle", so sending
 * it twice leaves one vote: safe to retry, and safe to tap twice on a slow
 * connection. Which track it is about is the station's answer, not this page's.
 */
export interface VoteSkipMessage {
  type: 'vote_skip'
  voted: boolean
}

export type ClientMessage =
  | PingMessage
  | JoinMessage
  | SayMessage
  | WishMessage
  | VoteSkipMessage

export const audioUrl = (track: Track) => `/api/audio/${track.filename}`
export const artworkUrl = (track: Track) =>
  track.artworkPath ? `/api/artwork/${track.artworkPath}` : null
