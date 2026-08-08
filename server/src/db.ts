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

/** A track's lyrics as LRCLIB handed them over. See the schema note. */
export interface LyricsRow {
  track_id: number
  /** LRC text, `[mm:ss.xx] line` per line, or null when only plain was found. */
  synced: string | null
  plain: string | null
  fetched_at: number
}

/** A stretch of the station being on air. See `openSession`. */
export interface SessionRow {
  id: number
  started_at: number
  /** Null while the session is the current one. */
  ended_at: number | null
}

/** The next session, as announced. One row at most. See the schema note. */
export interface ScheduleRow {
  id: 1
  starts_at: number
  poster: string | null
  set_at: number
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

/**
 * A track going on air. PLAN.md's now-playing history, one row per time a track
 * started, so a track played twice in an evening is two rows, not one.
 */
export interface PlayRow {
  id: number
  session_id: number
  track_id: number
  /** Server epoch ms at which the track went on. */
  played_at: number
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

-- What LRCLIB knows about a track, written down once so the station asks the
-- internet about each song one time rather than once per listener. One row per
-- track that has been looked up and found; a track nobody could find keeps no
-- row, so a restart gets to ask again.
--
-- Not a foreign key, for the reason a play isn't: the row is written from a
-- background errand after the upload has already answered, and a note about a
-- track must never be able to break the track it is a note about. The wipe
-- that deletes a track deletes its lyrics row alongside.
CREATE TABLE IF NOT EXISTS lyrics (
  track_id    INTEGER PRIMARY KEY,
  -- LRC text: "[mm:ss.xx] line" per line. Null when only plain text was found.
  synced      TEXT,
  plain       TEXT,
  fetched_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER
);

-- The next session, announced before it happens. One row, ever: the id = 1
-- check is what makes that a rule the database keeps rather than a convention
-- the code remembers. A station is an evening rather than a calendar, so what
-- is being scheduled is the next one, and setting another replaces it.
--
-- Nothing here starts anything. The time is a promise to whoever is reading it;
-- going on air is still a person pressing a button. See the Schedule class.
CREATE TABLE IF NOT EXISTS schedule (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  starts_at   INTEGER NOT NULL,
  -- The poster's filename under the config's posterDir, or null for a time
  -- with no picture behind it.
  poster      TEXT,
  set_at      INTEGER NOT NULL
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

CREATE TABLE IF NOT EXISTS plays (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL REFERENCES sessions(id),
  -- A reference rather than a copy of the title, unlike a message's nickname:
  -- nothing deletes a track, and a retagged one should read correctly in the
  -- history as well as in the library.
  --
  -- Deliberately *not* a foreign key, though, which is the one place this table
  -- differs from the others. A play is written from inside playback's change
  -- event, so a constraint that could refuse the insert would throw into
  -- whatever put the track on: an admin command answering 500 after the track
  -- already changed, or the end-of-track timer dying mid-set. A note about what
  -- happened must never be able to break the thing it is a note about, and the
  -- read below drops a row it cannot name rather than failing.
  track_id    INTEGER NOT NULL,
  played_at   INTEGER NOT NULL
);

-- Read as "the last N of this session", newest first, the same shape the chat
-- is read in, and for the same reason.
CREATE INDEX IF NOT EXISTS plays_session_id ON plays (session_id, id);
`

/**
 * Which session the things written down during one belong to.
 *
 * An object rather than a number because the answer changes while the process
 * runs: the admin goes live, and the chat, the wish book and the history all
 * have to start writing to the session that just opened. Handing each of them a
 * number at construction time would pin them to whichever session happened to
 * be open at boot, which is what they used to do back when a session *was* a
 * run of the process.
 *
 * Null while the station is off air. There is no session then, so there is
 * nothing to write to and nothing to read. See the three logs, which all treat
 * it as an empty room rather than reaching for the last one.
 */
export interface SessionRef {
  readonly current: number | null
}

/**
 * Starts a session, and returns its id.
 *
 * PLAN.md's availability story is session-based (you go live, you end it), and
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
