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

export interface PongMessage {
  type: 'pong'
  t0: number
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

export const audioUrl = (track: Track) => `/api/audio/${track.filename}`
export const artworkUrl = (track: Track) =>
  track.artworkPath ? `/api/artwork/${track.artworkPath}` : null
