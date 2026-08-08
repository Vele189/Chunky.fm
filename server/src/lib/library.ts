import type { Config } from '../config.js'
import type { Db } from '../db.js'
import { artworkFilePath, discard, trackFilePath } from './storage.js'

/**
 * Empty the library: every track row, its audio, its artwork and its lyrics.
 *
 * The station is an evening, not an archive — see where this is wired in
 * `app.ts`. The set that just played goes with the session it played in, so
 * the disk never quietly fills with everything that has ever been on.
 *
 * Rows first, files second: the rows are what the rest of the process can see,
 * and a library that claims a track whose file is gone would 404 mid-song,
 * where the reverse is only bytes waiting one tick longer to be freed. The
 * play log's rows stay — they name track ids on purpose rather than holding a
 * copy, and a row the history read cannot resolve is dropped, not an error.
 */
export async function emptyLibrary(db: Db, config: Config): Promise<void> {
  const rows = db
    .prepare('SELECT filename, artwork_path FROM tracks')
    .all() as Array<{ filename: string; artwork_path: string | null }>

  db.prepare('DELETE FROM lyrics').run()
  db.prepare('DELETE FROM tracks').run()

  await Promise.all(
    rows.flatMap((row) => [
      discard(trackFilePath(config, row.filename)),
      ...(row.artwork_path ? [discard(artworkFilePath(config, row.artwork_path))] : []),
    ]),
  )
}
