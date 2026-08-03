import type { TrackRow } from '../db.js'

/** A track as it goes over the wire — camelCase, no storage internals implied. */
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

export function toTrack(row: TrackRow): Track {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    album: row.album,
    durationMs: row.duration_ms,
    filename: row.filename,
    artworkPath: row.artwork_path,
    contentHash: row.content_hash,
    gainDb: row.gain_db,
    uploadedAt: row.uploaded_at,
  }
}
