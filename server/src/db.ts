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

/** A stretch of the station being on air. See `openSession`. */
export interface SessionRow {
  id: number
  started_at: number
  /** Null while the session is the current one. */
  ended_at: number | null
}

export interface MessageRow {
  id: number
  session_id: number
  /** The nickname as it stood when the message was sent, not a live reference. */
  nick: string
  text: string
  created_at: number
}

export interface WishRow {
  id: number
  session_id: number
  /** The nickname as it stood when the wish was made. Same copy as a message's. */
  nick: string
  text: string
  created_at: number
  /**
   * Where the wish stands with whoever runs the decks. Named `WishStatus` in
   * `wishes.ts`, which is where the values mean anything; the column is here.
   */
  status: 'new' | 'handled'
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

CREATE TABLE IF NOT EXISTS sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER
);

CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL REFERENCES sessions(id),
  nick        TEXT    NOT NULL,
  text        TEXT    NOT NULL,
  created_at  INTEGER NOT NULL
);

-- Chat is only ever read as "the last N of one session", newest first.
CREATE INDEX IF NOT EXISTS messages_session_id ON messages (session_id, id);

CREATE TABLE IF NOT EXISTS wishes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL REFERENCES sessions(id),
  nick        TEXT    NOT NULL,
  text        TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  -- Constrained here as well as in the type: a status nothing can render is a
  -- row the admin panel would show as a blank, and the column outlives the
  -- process that wrote it.
  status      TEXT    NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'handled'))
);

-- Read as "this session's wishes, oldest first", which is the order they were
-- asked in and the order they are worked through.
CREATE INDEX IF NOT EXISTS wishes_session_id ON wishes (session_id, id);
`

/**
 * Starts a session, and returns its id.
 *
 * PLAN.md's availability story is session-based — you go live, you end it — and
 * the admin controls for that are a later task. What exists now is the part
 * chat needs: something for a message to belong to, so "the chat" means this
 * time on air rather than everything ever said. A run of the process is a
 * session; when the admin can start and end them by hand, messages will scope
 * themselves to those instead, and nothing here has to change to allow it.
 */
export function openSession(db: Db, now = Date.now()): number {
  const result = db.prepare('INSERT INTO sessions (started_at) VALUES (?)').run(now)
  return Number(result.lastInsertRowid)
}

/** Marks a session over. Idempotent: a session already ended keeps its time. */
export function closeSession(db: Db, sessionId: number, now = Date.now()): void {
  db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ? AND ended_at IS NULL').run(
    now,
    sessionId,
  )
}

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
