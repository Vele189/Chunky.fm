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

export interface PongMessage {
  type: 'pong'
  t0: number
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

export type ClientMessage = PingMessage | JoinMessage

export const audioUrl = (track: Track) => `/api/audio/${track.filename}`
export const artworkUrl = (track: Track) =>
  track.artworkPath ? `/api/artwork/${track.artworkPath}` : null
