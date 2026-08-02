import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

export type Db = Database.Database

export interface TrackRow {
  id: number
  title: string
  artist: string | null
  album: string | null
  duration_ms: number
  /** Basename inside `<storage>/audio`. Never a client-supplied name. */
  filename: string
  /** Basename inside `<storage>/artwork`, or null when the file had no embedded art. */
  artwork_path: string | null
  content_hash: string
  gain_db: number
  uploaded_at: number
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tracks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT    NOT NULL,
  artist        TEXT,
  album         TEXT,
  duration_ms   INTEGER NOT NULL,
  filename      TEXT    NOT NULL UNIQUE,
  artwork_path  TEXT,
  content_hash  TEXT    NOT NULL UNIQUE,
  gain_db       REAL    NOT NULL DEFAULT 0,
  uploaded_at   INTEGER NOT NULL
);
`

export function openDb(dbPath: string): Db {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  }
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  return db
}
