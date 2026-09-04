import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import type { FastifyBaseLogger } from 'fastify'
import type { Config } from '../config.js'
import type { Db, EpisodeRow } from '../db.js'
import { remux } from './transcode.js'
import type { MediaStore } from './store.js'
import { HEAD_BYTES, head, streamable } from './video.js'

/**
 * Making an episode start quickly, after the fact.
 *
 * This runs *after* the upload has already answered, and that ordering is the
 * whole design. A console that held the request open for ffmpeg would look
 * broken, time out behind a proxy, and lose the work if the browser was closed.
 * So the master landing is the moment the episode exists, and this is an errand
 * that improves it afterwards.
 *
 * What the errand is has changed with the archive. It used to be an encode: an
 * hour of WAV down to forty megabytes of AAC, which was worth minutes of CPU
 * every time. Video is not that trade — see `lib/transcode.ts` — so what is
 * left is the file's index. An MP4 whose `moov` box sits after the video cannot
 * be played until it has been fetched to the end, and `+faststart` moves it to
 * the front by copying the streams rather than re-encoding them.
 *
 * **Most files never reach ffmpeg.** The first sixty-four kilobytes of the
 * master say where its index is (`lib/video.ts`), so a file exported for the
 * web — which is most of them — is recognised as already streamable and left
 * exactly as it is, with no gigabyte pulled back through this server to find
 * that out.
 *
 * Every state here is one the archive can sit in indefinitely without anything
 * being wrong:
 *
 *   pending  nobody has looked at it yet. Plays, and may start slowly.
 *   ready    what is served starts and seeks immediately.
 *   failed   ffmpeg refused this file. Still plays, from the master.
 *   none     no ffmpeg on this station. The master always was the copy.
 *
 * Note what is *not* in that list: an episode that cannot be played. The
 * serving key is set to the master at creation time, so there is never a moment
 * where an episode exists and has no video — and every later state is an
 * improvement on that or a note explaining why there wasn't one.
 */

/**
 * Room to leave on the volume beyond what the job itself needs.
 *
 * A gigabyte. The station writes to this disk while the rewrite runs — the
 * database, the library, tonight's artwork — and a check that left exactly
 * enough would be a check that passed and then filled the disk anyway.
 */
const HEADROOM_BYTES = 1024 * 1024 * 1024

/**
 * How many bytes are free where this path is, or null if it cannot be said.
 *
 * Null rather than a throw, and null means "go ahead": a platform whose
 * filesystem will not answer this question should not be a platform where the
 * archive stops working.
 */
async function freeSpace(at: string): Promise<number | null> {
  try {
    const stats = await fs.statfs(at)
    return stats.bavail * stats.bsize
  } catch {
    return null
  }
}

/**
 * How many remuxes run at once.
 *
 * One. This is a single small container that is also serving a live radio
 * station, and even a stream copy is a gigabyte read and written: two at a time
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

    /*
     * The cheap question first, and it is the one that usually settles it.
     *
     * Anything exported for the web already has its index at the front, and
     * pulling a gigabyte back through this server to discover that would cost
     * more than every other part of publishing an episode put together. The
     * first sixty-four kilobytes answer it; the stream is thrown away as soon
     * as they have arrived, which on R2 stops the transfer there.
     */
    if (streamable(await head(await store.getStream(row.master_key), HEAD_BYTES))) {
      log.info({ episodeId }, 'master is already streamable; serving it as it arrived')
      db.prepare(
        "UPDATE episodes SET transcode_status = 'ready', transcode_error = NULL WHERE id = ?",
      ).run(episodeId)
      return
    }

    /*
     * Is there room to do this at all?
     *
     * The rewrite needs the master on disk *and* the output beside it, so a
     * two-gigabyte episode wants four gigabytes of the storage volume for the
     * minute or two ffmpeg is working — on a volume that is also holding the
     * library, the artwork, the posters and the SQLite file this station writes
     * every play to. Filling it does not fail politely: it fails as a live
     * radio station that cannot write its own database in the middle of
     * somebody's set, which is the worst outcome available to this errand and
     * far worse than an episode that starts slowly.
     *
     * So the space is checked before anything is downloaded, with room to
     * spare, and the episode is left serving its master if there isn't any. It
     * still plays. `statfs` is Node 18.15's; on a platform that does not answer
     * it this comes back with nothing and the rewrite goes ahead as it always
     * did.
     */
    const wanted = row.master_bytes * 2 + HEADROOM_BYTES
    const free = await freeSpace(config.tmpDir)
    if (free !== null && free < wanted) {
      log.warn(
        { episodeId, wanted, free },
        'not enough room on the volume to rewrite this episode; serving the master',
      )
      this.#fail(
        episodeId,
        `not enough room to rewrite it: ${Math.round(wanted / 1e9)} GB wanted, ${Math.round(free / 1e9)} GB free`,
      )
      return
    }

    const workDir = path.join(config.tmpDir, `remux-${randomUUID()}`)
    await fs.mkdir(workDir, { recursive: true })
    const masterPath = path.join(workDir, 'master')

    try {
      // Down to disk first. ffmpeg has to seek — `+faststart` writes the file
      // and then rewrites it with the index moved — and a stream cannot be
      // rewound. On R2 this is the one time the master crosses this server, and
      // it is free: R2 charges nothing for egress.
      await pipeline(await store.getStream(row.master_key), createWriteStream(masterPath))

      const started = Date.now()
      const result = await remux(masterPath, workDir)

      if (!result.ok) {
        log.warn({ episodeId, reason: result.reason }, 'could not remux episode; serving master')
        this.#fail(episodeId, result.reason)
        return
      }

      /*
       * The master is kept, and this is where that costs something.
       *
       * A stream copy loses nothing, so the remuxed file is not a second
       * generation of anything and the master is not protecting quality here —
       * it is only protecting against ffmpeg having quietly dropped something
       * this station did not think to check for. That is worth an episode's
       * storage twice over on an archive of a few dozen; if it stops being
       * worth it, this is the one place to change, and the old key is right
       * there in the row.
       */
      /*
       * The master's copy on this disk is finished with. Let it go now, before
       * the upload rather than after it: the upload is the long part of this
       * job — minutes, against ffmpeg's seconds — and holding two copies of an
       * episode on the volume for the whole of it doubles the window in which
       * a second upload arriving would run the disk out. The master in the
       * bucket is untouched; this is only the working copy.
       */
      await fs.rm(masterPath, { force: true })

      const videoKey = `video/${row.content_hash}.${result.extension}`
      await store.put(
        videoKey,
        createReadStream(result.path),
        result.contentType,
        result.bytes,
      )

      // The row moves to the new copy only once the bytes are actually there.
      // The other order would leave a window in which the episode pointed at a
      // key that did not exist yet, which is a broken player for whoever
      // pressed play during it.
      db.prepare(`
        UPDATE episodes
        SET video_key = @video_key, video_bytes = @video_bytes, video_type = @video_type,
            duration_ms = @duration_ms, transcode_status = 'ready', transcode_error = NULL
        WHERE id = @id
      `).run({
        video_key: videoKey,
        video_bytes: result.bytes,
        video_type: result.contentType,
        // ffmpeg measured the output, which beats whatever the browser guessed
        // from the master at upload time. Zero means it would not say, and the
        // client's figure is kept rather than replaced with nothing.
        duration_ms: result.durationMs > 0 ? result.durationMs : row.duration_ms,
        id: episodeId,
      })

      log.info(
        { episodeId, bytes: result.bytes, tookMs: Date.now() - started },
        'episode remuxed with its index at the front',
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
