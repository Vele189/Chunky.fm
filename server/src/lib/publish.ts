import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'
import type { FastifyBaseLogger } from 'fastify'
import type { Config } from '../config.js'
import type { Db, EpisodeRow } from '../db.js'
import { transcode } from './transcode.js'
import type { MediaStore } from './store.js'

/**
 * Making an episode small enough to listen to, after the fact.
 *
 * This runs *after* the upload has already answered, and that ordering is the
 * whole design. An hour of audio takes minutes to encode; a console that held
 * the request open for it would look broken, time out behind a proxy, and lose
 * the work if the browser was closed. So the master landing is the moment the
 * episode exists, and the encode is an errand that improves it afterwards.
 *
 * Which means every state here has to be a state the archive can sit in
 * indefinitely without anything being wrong:
 *
 *   pending  the master is the serving copy. Plays, and is large.
 *   ready    the small copy is the serving copy. The ordinary end state.
 *   failed   ffmpeg refused this file. Still plays, from the master.
 *   none     no ffmpeg on this station. The master always was the copy.
 *
 * Note what is *not* in that list: an episode that cannot be played. The
 * serving key is set to the master at creation time, so there is never a moment
 * where an episode exists and has no audio — and every later state is an
 * improvement on that or a note explaining why there wasn't one.
 */

/**
 * How many encodes run at once.
 *
 * One. This is a single small container that is also serving a live radio
 * station, and ffmpeg will use every core it is given: two encodes in parallel
 * is a station whose clock starts slipping in the middle of somebody's set,
 * which is the one thing this project cannot afford. Uploads queue behind each
 * other instead, and nobody is waiting on them.
 */
class Queue {
  #active: Promise<void> = Promise.resolve()
  readonly #waiting: (() => Promise<void>)[] = []
  #running = false

  add(job: () => Promise<void>): void {
    this.#waiting.push(job)
    if (!this.#running) this.#active = this.#drain()
  }

  /** Settle once nothing is queued and nothing is running. */
  async drain(): Promise<void> {
    await this.#active
  }

  async #drain(): Promise<void> {
    this.#running = true
    try {
      for (let job = this.#waiting.shift(); job; job = this.#waiting.shift()) {
        await job()
      }
    } finally {
      this.#running = false
    }
  }
}

export interface PublisherDeps {
  config: Config
  db: Db
  store: MediaStore
  log: FastifyBaseLogger
  /** False on a station with no ffmpeg; every episode is then `none`. */
  canTranscode: boolean
}

export class Publisher {
  readonly #deps: PublisherDeps
  readonly #queue = new Queue()
  #closed = false

  constructor(deps: PublisherDeps) {
    this.#deps = deps
  }

  /**
   * Stop taking work, and wait for whatever is mid-encode.
   *
   * Called from the app's `preClose`. Without it a shutdown leaves an ffmpeg
   * job running against a database that is about to be closed and a storage
   * directory that is about to be removed — which throws from inside a
   * background task, where nothing is listening, some seconds after the process
   * thought it had finished.
   *
   * Awaited rather than merely flagged: the encode holds a temp directory and a
   * write to the episode row, and both should land or not land, rather than
   * being interrupted halfway.
   */
  async close(): Promise<void> {
    this.#closed = true
    await this.#queue.drain()
  }

  /** Whether this station will encode at all. The console asks, to say so. */
  get enabled(): boolean {
    return this.#deps.canTranscode
  }

  /**
   * Encode this episode's master into a serving copy, eventually.
   *
   * Returns immediately. Failure is written to the row and logged, never
   * thrown: this is called from inside a request handler that has already
   * decided the upload succeeded, and an errand must not be able to fail the
   * thing it is an errand for. The same rule the lyrics fetch follows.
   */
  queue(episodeId: number): void {
    if (!this.#deps.canTranscode) return
    this.#queue.add(async () => {
      // Queued before the station started shutting down, reached after. There
      // is nothing to write to any more.
      if (this.#closed) return
      try {
        await this.#run(episodeId)
      } catch (err) {
        this.#deps.log.error({ err, episodeId }, 'transcode fell over')
        this.#fail(episodeId, String((err as Error).message ?? err).slice(0, 300))
      }
    })
  }

  async #run(episodeId: number): Promise<void> {
    const { config, db, store, log } = this.#deps
    const row = db.prepare('SELECT * FROM episodes WHERE id = ?').get(episodeId) as
      | EpisodeRow
      | undefined
    // Deleted while it sat in the queue, which is a perfectly ordinary thing
    // for somebody to do to an upload they got wrong.
    if (!row) return

    const workDir = path.join(config.tmpDir, `encode-${randomUUID()}`)
    await fs.mkdir(workDir, { recursive: true })
    const masterPath = path.join(workDir, 'master')

    try {
      // Down to disk first. ffmpeg has to seek — `faststart` rewrites the file
      // to move its index to the front — and a stream cannot be rewound. On R2
      // this is the one time the master crosses this server, and it is free:
      // R2 charges nothing for egress.
      await pipeline(await store.getStream(row.master_key), createWriteStream(masterPath))

      const started = Date.now()
      const result = await transcode(masterPath, workDir)

      if (!result.ok) {
        log.warn({ episodeId, reason: result.reason }, 'could not encode episode; serving master')
        this.#fail(episodeId, result.reason)
        return
      }

      // Only worth keeping if it is actually smaller. An already-compressed
      // upload — somebody who exported a 96k mp3 themselves — can come out of a
      // re-encode *larger*, and shipping that would mean this feature made the
      // episode worse while claiming to have improved it. Serving the master is
      // the honest answer, and it is already what the row says.
      if (result.data.length >= row.master_bytes && row.master_bytes > 0) {
        log.info(
          { episodeId, master: row.master_bytes, encoded: result.data.length },
          'encode was no smaller than the master; keeping the master',
        )
        db.prepare(
          "UPDATE episodes SET transcode_status = 'ready', transcode_error = NULL, duration_ms = ? WHERE id = ?",
        ).run(result.durationMs > 0 ? result.durationMs : row.duration_ms, episodeId)
        return
      }

      const audioKey = `audio/${row.content_hash}.${result.extension}`
      await store.put(audioKey, result.data, result.contentType)

      // The row moves to the new copy only once the bytes are actually there.
      // The other order would leave a window in which the episode pointed at a
      // key that did not exist yet, which is a broken player for whoever
      // pressed play during it.
      db.prepare(`
        UPDATE episodes
        SET audio_key = @audio_key, audio_bytes = @audio_bytes, audio_type = @audio_type,
            duration_ms = @duration_ms, transcode_status = 'ready', transcode_error = NULL
        WHERE id = @id
      `).run({
        audio_key: audioKey,
        audio_bytes: result.data.length,
        audio_type: result.contentType,
        // ffmpeg measured the output, which beats whatever the browser guessed
        // from the master at upload time. Zero means it would not say, and the
        // client's figure is kept rather than replaced with nothing.
        duration_ms: result.durationMs > 0 ? result.durationMs : row.duration_ms,
        id: episodeId,
      })

      log.info(
        {
          episodeId,
          master: row.master_bytes,
          encoded: result.data.length,
          saved: `${Math.round((1 - result.data.length / Math.max(1, row.master_bytes)) * 100)}%`,
          tookMs: Date.now() - started,
        },
        'episode encoded',
      )
    } finally {
      await fs.rm(workDir, { recursive: true, force: true })
    }
  }

  #fail(episodeId: number, reason: string): void {
    try {
      this.#deps.db
        .prepare("UPDATE episodes SET transcode_status = 'failed', transcode_error = ? WHERE id = ?")
        .run(reason, episodeId)
    } catch (err) {
      // The row went while we were writing to it. Nothing to recover.
      this.#deps.log.error({ err, episodeId }, 'could not record a transcode failure')
    }
  }
}
