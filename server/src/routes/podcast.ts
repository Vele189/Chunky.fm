import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import fastifyStatic from '@fastify/static'
import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import type { Config } from '../config.js'
import type { Db, EpisodeRow, EpisodeStatus } from '../db.js'
import { looksLikeAudioUpload } from '../lib/audio.js'
import { hasAdminCredentials, requireAdmin } from '../lib/auth.js'
import {
  type Episode,
  TRANSCRIPT_MAX_LENGTH,
  slugTaken,
  toAdminEpisode,
  toEpisode,
  toGuests,
  toNotes,
  toTitle,
  toTranscript,
  uniqueSlug,
} from '../lib/episode.js'
import { POSTER_MAX_BYTES, POSTER_TYPES, dimensions, sniff } from '../lib/poster.js'
import type { Publisher } from '../lib/publish.js'
import {
  type MediaStore,
  type UploadedPart,
  PART_SIZE,
  partCountFor,
  writeLocalPart,
} from '../lib/store.js'
import { discard, episodePosterFilePath } from '../lib/storage.js'

/**
 * The podcast archive: the one part of this station that is meant to outlive
 * the evening.
 *
 * Everything else here is about tonight. The library is emptied when a session
 * ends, the chat and the wish book go with it, and that is the whole design —
 * a station is an evening, not a back catalogue. This is the deliberate
 * exception, and it is kept at arm's length from all of it: its own table, its
 * own directories under the storage volume, and no `session_id` anywhere, so
 * there is no path by which ending a broadcast can reach it.
 *
 * **The read is open**, like the session poster and unlike the library. That is
 * the point of publishing an episode: it is for somebody who was not in the
 * room, who has no invite and no key to present, and who found the link in a
 * message from a friend. A private station still refuses the socket, the
 * library and the media — the things that *are* the station — and still hands a
 * stranger the archive.
 *
 * Everything that writes is admin-only, like every other write in this API.
 *
 * The one seam between public and private is `status`. A draft is invisible to
 * the open reads at every level — it is missing from the list, and its own
 * address answers 404 rather than 403, because a 403 on a slug confirms that
 * the slug is real and an unpublished episode's existence is not a stranger's
 * business. The console reads a different route to see them.
 */

/**
 * A poster is exactly 1080x1350: Instagram's portrait post, which is the shape
 * these are made in.
 *
 * Enforced rather than suggested, and this is the one place the station is
 * strict about an image. The reason is the grid: the cards on the podcast page
 * are a fixed 4:5, and a poster that is not that ratio is either letterboxed
 * against the card's background or cropped by the browser with no say from
 * whoever chose the framing. Both look like a bug on the one page whose whole
 * job is showing artwork. Refusing at the door, with the size that was actually
 * received in the message, is the version of this that somebody can fix in
 * thirty seconds.
 *
 * The session poster in `routes/schedule.ts` deliberately has no such rule: it
 * is whatever somebody made in a hurry an hour before the doors open, and
 * refusing it then would be the tool getting in the way of the night.
 */
const POSTER_WIDTH = 1080
const POSTER_HEIGHT = 1350

/** What a page of the archive holds. Generous: an archive is browsed, not paged. */
const PAGE_SIZE = 60

interface PodcastDeps {
  config: Config
  db: Db
  /** Where the audio lives. R2, or this station's own disk. See `lib/store.ts`. */
  store: MediaStore
  /** What makes an episode small enough to listen to. See `lib/publish.ts`. */
  publisher: Publisher
}

/** Everything about a refusal, so a handler can return one in a line. */
interface Refusal {
  status: number
  error: string
  message: string
}

/**
 * A file part read into memory with a ceiling, or a refusal.
 *
 * The audio is streamed to disk because it runs to 150 MB; a poster is eight,
 * and buffering one is both simpler and necessary — the size check needs the
 * header before anything is written, and a file that turns out to be 900x1200
 * should never have touched the disk at all.
 *
 * The cap is enforced here rather than through multipart's `fileSize`, because
 * that limit is shared by every part in the request and the audio needs it set
 * to something much larger. Without this, "poster" could name a 150 MB file and
 * this function would happily hold all of it.
 */
async function readCapped(
  stream: AsyncIterable<Buffer>,
  max: number,
): Promise<{ buffer: Buffer } | { tooLarge: true }> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of stream) {
    total += chunk.length
    if (total > max) {
      // Drained by the caller's loop moving on; what matters is that nothing
      // further is kept.
      return { tooLarge: true }
    }
    chunks.push(chunk)
  }
  return { buffer: Buffer.concat(chunks) }
}

/**
 * A poster, checked as far as it can be before it is written down.
 *
 * Three questions in order, and the order is not arbitrary: what the bytes say
 * it is, whether that agrees with what the request claimed, and only then how
 * big it is. Asking about size first would mean reporting "not 1080x1350" about
 * a PDF.
 */
function checkPoster(buffer: Buffer, mimetype: string): { extension: string } | Refusal {
  const declared = POSTER_TYPES[mimetype.toLowerCase()]
  const actual = sniff(buffer)
  if (!actual || (declared && declared !== actual)) {
    return {
      status: 415,
      error: 'unsupported_poster',
      message: 'a poster has to be a JPEG, a PNG or a WebP',
    }
  }

  const size = dimensions(buffer)
  if (!size) {
    return {
      status: 415,
      error: 'unreadable_poster',
      message: 'that file says it is an image but its header could not be read',
    }
  }
  if (size.width !== POSTER_WIDTH || size.height !== POSTER_HEIGHT) {
    return {
      status: 422,
      error: 'poster_dimensions',
      // The size received, named. A refusal that only states the rule leaves
      // somebody guessing which of the two numbers they got wrong.
      message: `a poster has to be exactly ${POSTER_WIDTH}x${POSTER_HEIGHT}; that one is ${size.width}x${size.height}`,
    }
  }
  return { extension: actual }
}

/**
 * A transcript from a form field or a PATCH body, or a refusal.
 *
 * The length is checked on what arrived rather than on what the cleaner made of
 * it, so the number in the message is the number somebody can see in their own
 * file. Absent and blank are the same thing — null, no transcript — because the
 * console sends the field either way and an empty one means "there isn't one".
 */
function checkTranscript(value: unknown): { transcript: string | null } | Refusal {
  if (typeof value !== 'string') return { transcript: null }
  if (value.length > TRANSCRIPT_MAX_LENGTH) {
    return {
      status: 413,
      error: 'transcript_too_long',
      message: `a transcript has to be under ${TRANSCRIPT_MAX_LENGTH.toLocaleString('en')} characters; that one is ${value.length.toLocaleString('en')}`,
    }
  }
  return { transcript: toTranscript(value) }
}

/** An integer from a form field, or null for absent, blank or nonsense. */
function toInt(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed) : null
}

/** Only the two known values; anything else is a draft, which is the safe half. */
function toStatus(value: unknown): EpisodeStatus {
  return value === 'published' ? 'published' : 'draft'
}

export function podcastRoutes({ config, db, store, publisher }: PodcastDeps): FastifyPluginAsync {
  const findByHash = (hash: string) =>
    db.prepare('SELECT * FROM episodes WHERE content_hash = ?').get(hash) as EpisodeRow | undefined

  const findById = (id: number) =>
    db.prepare('SELECT * FROM episodes WHERE id = ?').get(id) as EpisodeRow | undefined

  const findBySlug = (slug: string) =>
    db.prepare('SELECT * FROM episodes WHERE slug = ?').get(slug) as EpisodeRow | undefined

  const insertEpisode = db.prepare(`
    INSERT INTO episodes (
      slug, title, notes, guests, episode_number, published_at, status,
      duration_ms, master_key, master_bytes, audio_key, audio_bytes, audio_type,
      transcode_status, poster, transcript, content_hash, uploaded_at
    ) VALUES (
      @slug, @title, @notes, @guests, @episode_number, @published_at, @status,
      @duration_ms, @master_key, @master_bytes, @audio_key, @audio_bytes, @audio_type,
      @transcode_status, @poster, @transcript, @content_hash, @uploaded_at
    )
  `)

  /**
   * The archive, newest first.
   *
   * Ordered on `published_at` rather than on the episode number, because the
   * number is optional and an archive being back-filled has them arriving out
   * of order. The id breaks a tie, so two episodes dated the same day have a
   * stable order rather than whichever one SQLite felt like today.
   */
  const listPublished = db.prepare(`
    SELECT * FROM episodes WHERE status = 'published'
    ORDER BY published_at DESC, id DESC LIMIT ?
  `)

  const listAll = db.prepare(`
    SELECT * FROM episodes ORDER BY published_at DESC, id DESC LIMIT ?
  `)

  /**
   * Delete everything an episode owned: both audio objects and the poster.
   *
   * Both, and that is easy to get wrong — an episode that has been encoded owns
   * *two* objects in the store, the master and the serving copy, and they are
   * the same key only when there was no encode. Deleting `audio_key` alone
   * would leave a 500 MB master in the bucket forever with nothing referencing
   * it, which is the kind of leak nobody notices until the bill arrives.
   */
  const forgetFiles = async (row: EpisodeRow): Promise<void> => {
    const keys = new Set([row.master_key, row.audio_key])
    for (const key of keys) {
      await store.remove(key).catch(() => undefined)
    }
    if (row.poster) await discard(episodePosterFilePath(config, row.poster))
  }

  return async function routes(app: FastifyInstance) {
    /**
     * Let a raw part body through untouched.
     *
     * Fastify parses a request body by content type and refuses one it has no
     * parser for with a 415 — which is what an 8 MiB slice of audio is, since
     * nothing here declares a parser for binary. This hands the stream straight
     * to the handler instead of buffering it, so a part is written to disk as
     * it arrives rather than assembled in memory first.
     *
     * Scoped to this plugin, which is why it does not disturb the multipart
     * parser the poster upload two routes down depends on: content type parsers
     * live in the encapsulation context that registered them.
     *
     * Reached only on a station keeping its archive on disk. With R2 the part
     * goes to Cloudflare and this server never sees it.
     */
    app.addContentTypeParser(
      'application/octet-stream',
      (_request, payload, done) => done(null, payload),
    )

    /**
     * The audio and the posters, served flat.
     *
     * Range support is what makes the player work at all: an episode is an hour
     * long, and somebody resuming at 34:10 has to fetch that byte range rather
     * than pulling the whole file from zero first. @fastify/static gets this
     * from `send`; there is a test pinning it rather than trusting it, the same
     * way `media.ts` does for the library.
     *
     * On R2 none of this is reached: Cloudflare's edge answers the Range and
     * this server never sees a byte of audio. The route exists for the disk
     * backend, and the test covers it there — which is the same code path a
     * station without R2 actually runs.
     *
     * Cached hard and immutable, because both are named by content: an episode's
     * audio is its hash and a poster is a fresh id every time one is set, so
     * neither can ever change under a URL a page has already drawn.
     */
    await app.register(fastifyStatic, {
      root: config.episodeAudioDir,
      // Only reached on a station keeping its archive on disk. With R2
      // configured, `publicUrl` returns a Cloudflare address and nothing ever
      // asks this app for audio at all — which is the entire point of R2.
      prefix: '/api/episode-media/',
      decorateReply: false,
      cacheControl: true,
      maxAge: '365d',
      immutable: true,
      index: false,
      dotfiles: 'deny',
    })

    await app.register(fastifyStatic, {
      root: config.episodePosterDir,
      prefix: '/api/episode-poster/',
      decorateReply: false,
      cacheControl: true,
      maxAge: '365d',
      immutable: true,
      index: false,
      dotfiles: 'deny',
    })

    /**
     * The archive. Open, and published only.
     *
     * No pagination beyond a ceiling, deliberately. This is one person's
     * podcast rather than a directory of everybody's: a hundred episodes is
     * years of work, and a cursor API for a list that fits in one response
     * would be machinery in front of a page that wants to draw a grid.
     */
    app.get('/api/episodes', async () => ({
      episodes: (listPublished.all(PAGE_SIZE) as EpisodeRow[]).map((row) => toEpisode(row, store)),
    }))

    /**
     * One episode, by the address the card links to.
     *
     * A draft answers 404 rather than 403, and the difference matters: 403 on a
     * slug is a confirmation that the slug is real, and whether an unpublished
     * episode exists is not a stranger's business. The console reaches drafts
     * through the admin list below, which is behind the password.
     *
     * An admin asking directly gets the draft, so that "view" from the console
     * lands on the real page rather than on a 404 for something they can see in
     * the list right beside the button.
     */
    app.get('/api/episodes/:slug', async (request, reply) => {
      const { slug } = request.params as { slug: string }
      const row = findBySlug(slug)
      const visible = row && (row.status === 'published' || hasAdminCredentials(config, request.headers))
      if (!row || !visible) {
        return reply.code(404).send({ error: 'no_episode', message: 'no episode at that address' })
      }
      return { episode: toEpisode(row, store) }
    })

    /**
     * What was said, for the episode at that address.
     *
     * Its own route rather than a field on the episode, and the reason is size:
     * an hour of talk is a hundred kilobytes of text and the archive hands back
     * sixty episodes at once. See `Episode.hasTranscript`, which is what tells
     * the page there is anything here to ask for.
     *
     * The same visibility rule as the episode itself, spelled out again rather
     * than shared, because getting it wrong in either direction is bad: a draft
     * answers 404 to a stranger — a 403 would confirm the slug is real — and an
     * admin gets it, so "view" from the console shows the whole page.
     *
     * A 404 for an episode that exists and has no transcript, which is the same
     * answer the station's lyrics route gives for a song nobody has written the
     * words to, and for the same reason: it is not an error, it is the
     * considered answer, and the page draws nothing rather than a broken panel.
     *
     * JSON rather than `text/plain`, so a refusal here reads like a refusal
     * anywhere else in this API and the console's one error path can report it.
     */
    app.get('/api/episodes/:slug/transcript', async (request, reply) => {
      const { slug } = request.params as { slug: string }
      const row = findBySlug(slug)
      const visible =
        row && (row.status === 'published' || hasAdminCredentials(config, request.headers))
      if (!row || !visible) {
        return reply.code(404).send({ error: 'no_episode', message: 'no episode at that address' })
      }
      if (!row.transcript) {
        return reply
          .code(404)
          .send({ error: 'no_transcript', message: 'nobody has written down what was said here' })
      }
      return { transcript: row.transcript }
    })

    /** The whole archive including drafts. The console's list. */
    app.get('/api/admin/episodes', { preHandler: requireAdmin(config) }, async () => ({
      episodes: (listAll.all(PAGE_SIZE) as EpisodeRow[]).map((row) => toAdminEpisode(row, store)),
    }))

    /* --- the upload lifecycle -------------------------------------------
     *
     * An hour of audio does not fit in a request. It is 500 MB of master, it
     * takes minutes on a domestic connection, and a single POST carrying it
     * has three ways to go wrong that a chunked upload does not: a proxy body
     * limit, a request timeout, and a dropped connection at 90% that loses all
     * of it.
     *
     * So the console does what every large-file uploader does, in four steps:
     *
     *   POST   /api/episodes/uploads              begin; get part URLs
     *   PUT    <each part url>                    the bytes, 8 MiB at a time
     *   POST   /api/episodes                      finish: parts + poster + fields
     *   DELETE /api/episodes/uploads/:id          give up, cleanly
     *
     * **The bytes never touch this server** when R2 is configured: the part
     * URLs are presigned and the browser PUTs straight to Cloudflare. On a
     * station without R2 the part URLs point back here and the disk backend
     * assembles them, which is the same protocol against a different store —
     * see `lib/store.ts`, and the note there about why there is only one client
     * for both.
     */

    /**
     * Begin an upload, and hand back somewhere to put every part.
     *
     * All the URLs at once rather than one at a time, because the alternative
     * is a round-trip per 8 MiB — sixty-three of them for a 500 MB file, each
     * one a chance for a flaky connection to stall an upload that is otherwise
     * fine. They expire together an hour out; see `PART_URL_TTL_S`.
     */
    app.post('/api/episodes/uploads', { preHandler: requireAdmin(config) }, async (request, reply) => {
      const body = (request.body ?? {}) as Record<string, unknown>
      const bytes = Number(body.bytes)
      const filename = typeof body.filename === 'string' ? body.filename : ''
      const contentType = typeof body.contentType === 'string' ? body.contentType : ''

      if (!Number.isFinite(bytes) || bytes <= 0) {
        return reply
          .code(400)
          .send({ error: 'no_size', message: 'an upload has to say how many bytes it is' })
      }
      if (bytes > config.maxEpisodeBytes) {
        return reply.code(413).send({
          error: 'file_too_large',
          message: `an episode has to be under ${Math.round(config.maxEpisodeBytes / 1024 / 1024)} MB`,
        })
      }
      if (!looksLikeAudioUpload(filename, contentType)) {
        return reply
          .code(415)
          .send({ error: 'unsupported_type', message: `${contentType || filename} is not audio` })
      }

      // Named by a fresh id rather than by content hash, because the hash is
      // not known until the bytes have been read and nothing here reads them.
      // The hash still exists — the console computes it while it uploads — and
      // it is what the finished episode is keyed on; this is only where the
      // master sits.
      const key = `masters/${randomUUID()}${path.extname(filename).toLowerCase()}`
      const count = partCountFor(bytes)

      let begun: Awaited<ReturnType<typeof store.createUpload>>
      const urls: string[] = []
      try {
        begun = await store.createUpload(key, contentType || 'application/octet-stream')
        for (let n = 1; n <= count; n++) {
          urls.push(await store.partUrl(begun.key, begun.uploadId, n))
        }
      } catch (err) {
        /**
         * The store would not take it.
         *
         * Answered as a refusal rather than left to become a 500, because this
         * is the *first* request of every upload and therefore the first thing
         * a misconfigured station hits — a bucket name with a typo in it, a key
         * without write permission, an endpoint that resolves to nothing. A
         * generic "the station could not complete that request" sends somebody
         * looking at their audio file, which is the one thing that is fine.
         *
         * The store's own message is repeated: it is Cloudflare's or MinIO's
         * wording rather than ours, it names the actual problem
         * ("The specified bucket does not exist"), and this route is behind the
         * admin password so there is nobody to leak it to.
         */
        request.log.error({ err, key, store: store.kind }, 'the store refused an upload')
        return reply.code(502).send({
          error: 'store_unavailable',
          message: `the archive's storage would not accept an upload: ${
            (err as Error).message ?? 'no reason given'
          }`,
        })
      }

      request.log.info({ key, bytes, parts: count, store: store.kind }, 'episode upload begun')
      return reply.code(201).send({
        uploadId: begun.uploadId,
        key: begun.key,
        partSize: PART_SIZE,
        partCount: count,
        urls,
        // So the console knows whether to PUT cross-origin or to this server.
        direct: store.kind === 'r2',
      })
    })

    /**
     * One part, when the store is this server's own disk.
     *
     * Never reached on a station with R2, where the browser PUTs to Cloudflare
     * and this route is simply never named. It exists so that the *console* has
     * one code path: it PUTs a part to whatever URL it was handed.
     *
     * Raw body, not multipart: the console sends the slice as-is, which is what
     * it would send to R2.
     */
    app.put(
      '/api/episodes/uploads/:uploadId/parts/:part',
      {
        preHandler: requireAdmin(config),
        // Fastify would otherwise try to parse this as JSON and reject 8 MiB of
        // audio as a malformed body.
        bodyLimit: PART_SIZE * 2,
      },
      async (request, reply) => {
        const { uploadId, part } = request.params as { uploadId: string; part: string }
        const partNumber = Number(part)
        if (!Number.isInteger(partNumber) || partNumber < 1) {
          return reply.code(400).send({ error: 'bad_part', message: 'part numbers start at 1' })
        }
        try {
          const etag = await writeLocalPart(config, uploadId, partNumber, request.raw)
          // The same header R2 answers a part with, so the console reads the
          // receipt the same way against either store.
          return reply.header('etag', etag).send({ etag })
        } catch {
          return reply
            .code(404)
            .send({ error: 'no_upload', message: 'no upload is open with that id' })
        }
      },
    )

    /** Give up on an upload, and leave nothing behind in the store. */
    app.delete(
      '/api/episodes/uploads/:uploadId',
      { preHandler: requireAdmin(config) },
      async (request, reply) => {
        const { uploadId } = request.params as { uploadId: string }
        const key = typeof (request.query as { key?: string }).key === 'string'
          ? (request.query as { key: string }).key
          : ''
        try {
          await store.abortUpload(key, uploadId)
        } catch (err) {
          // An upload that was never begun, or already finished. Nothing to
          // clean up and nothing worth failing over.
          request.log.info({ err, uploadId }, 'nothing to abort')
        }
        return reply.send({ aborted: uploadId })
      },
    )

    /**
     * Finish: turn a completed upload into an episode.
     *
     * Multipart, and it carries the *poster* rather than the audio — the audio
     * is already in the store and is named by `uploadId` and `key`. The poster
     * is eight megabytes at most, so the request that was wrong for an hour of
     * audio is exactly right for it, and all the validation in `checkPoster`
     * stays where it was.
     *
     * The episode is created pointing at the **master**, so it is playable the
     * instant this answers. The encode that replaces it with something a tenth
     * the size is an errand queued afterwards; see `lib/publish.ts`.
     */
    app.post('/api/episodes', { preHandler: requireAdmin(config) }, async (request, reply) => {
      let posterName: string | null = null
      let posterBuffer: Buffer | null = null
      let posterMime = ''
      const fields = new Map<string, string>()

      /**
       * Everything this request would otherwise leave behind.
       *
       * The staged parts included, and that is the half worth stating: by the
       * time this handler runs, several hundred megabytes are already sitting
       * in the store waiting to be assembled. A refusal here — a poster of the
       * wrong size, a missing title — that cleaned up only the poster would
       * strand all of it, once per rejected attempt, with nothing referencing
       * it and nothing that ever looks for orphans.
       */
      const cleanup = async () => {
        if (posterName) await discard(episodePosterFilePath(config, posterName))
        const uploadId = fields.get('uploadId')
        const key = fields.get('key')
        if (uploadId && key) await store.abortUpload(key, uploadId).catch(() => undefined)
      }

      const refuse = async (refusal: Refusal) => {
        await cleanup()
        return reply.code(refusal.status).send({ error: refusal.error, message: refusal.message })
      }

      try {
        for await (const part of request.parts({
          limits: { fileSize: POSTER_MAX_BYTES, files: 1 },
        })) {
          if (part.type === 'field') {
            if (typeof part.value === 'string') fields.set(part.fieldname, part.value)
            continue
          }
          if (part.fieldname !== 'poster') {
            part.file.resume()
            continue
          }
          const read = await readCapped(part.file, POSTER_MAX_BYTES)
          if ('tooLarge' in read) {
            return await refuse({
              status: 413,
              error: 'poster_too_large',
              message: `a poster has to be under ${Math.round(POSTER_MAX_BYTES / 1024 / 1024)} MB`,
            })
          }
          if (read.buffer.length > 0) {
            posterBuffer = read.buffer
            posterMime = part.mimetype
          }
        }
      } catch (err) {
        await cleanup()
        throw err
      }

      // --- what the upload left in the store ------------------------------

      const uploadId = fields.get('uploadId') ?? ''
      const key = fields.get('key') ?? ''
      const contentHash = (fields.get('contentHash') ?? '').toLowerCase()
      let parts: UploadedPart[]
      try {
        parts = JSON.parse(fields.get('parts') ?? '[]') as UploadedPart[]
      } catch {
        parts = []
      }

      if (!uploadId || !key || parts.length === 0) {
        return refuse({
          status: 400,
          error: 'no_audio',
          message: 'finish an upload first: POST /api/episodes/uploads',
        })
      }
      if (!/^[0-9a-f]{64}$/.test(contentHash)) {
        return refuse({
          status: 400,
          error: 'no_hash',
          message: 'an episode needs the sha256 of its audio, computed while uploading',
        })
      }

      const title = toTitle(fields.get('title') ?? '')
      if (title === '') {
        return refuse({ status: 400, error: 'no_title', message: 'an episode needs a title' })
      }
      const transcript = checkTranscript(fields.get('transcript'))
      if ('status' in transcript) return refuse(transcript)
      if (posterBuffer === null) {
        return refuse({
          status: 400,
          error: 'no_poster',
          message: `an episode needs a poster, sent as the \`poster\` part, at ${POSTER_WIDTH}x${POSTER_HEIGHT}`,
        })
      }
      const poster = checkPoster(posterBuffer, posterMime)
      if ('status' in poster) return refuse(poster)

      // Checked *before* the parts are assembled, so a duplicate costs nothing
      // but the upload that already happened.
      const duplicate = findByHash(contentHash)
      if (duplicate) {
        // `cleanup` aborts the upload: the bytes just sent are a second copy of
        // something the archive already has, and keeping them would mean paying
        // to store the same episode twice.
        await cleanup()
        return reply.code(409).send({
          error: 'duplicate',
          message: 'that audio is already an episode',
          episode: toEpisode(duplicate, store),
        })
      }

      try {
        await store.completeUpload(key, uploadId, parts)
      } catch (err) {
        request.log.error({ err, key, uploadId }, 'could not assemble an upload')
        return refuse({
          status: 502,
          error: 'upload_incomplete',
          message: 'the store would not assemble that upload; try sending it again',
        })
      }

      const bytes = (await store.size(key)) ?? 0
      const now = Date.now()
      posterName = `${randomUUID()}.${poster.extension}`

      try {
        await fs.writeFile(episodePosterFilePath(config, posterName), posterBuffer)

        const result = insertEpisode.run({
          slug: uniqueSlug(title, (candidate) => slugTaken(db, candidate), now),
          title,
          notes: toNotes(fields.get('notes') ?? ''),
          guests: toGuests(fields.get('guests') ?? ''),
          episode_number: toInt(fields.get('episodeNumber')),
          published_at: toInt(fields.get('publishedAt')) ?? now,
          status: toStatus(fields.get('status')),
          // What the browser's own decoder made of the master. Provisional:
          // ffmpeg measures it properly during the encode and overwrites this.
          duration_ms: Math.max(0, toInt(fields.get('durationMs')) ?? 0),
          master_key: key,
          master_bytes: bytes,
          // The master *is* the serving copy until an encode replaces it, which
          // is what makes an episode playable the moment this answers and what
          // makes a station with no ffmpeg work with no special case anywhere.
          audio_key: key,
          audio_bytes: bytes,
          audio_type: fields.get('contentType') || 'audio/mpeg',
          transcode_status: publisher.enabled ? 'pending' : 'none',
          poster: posterName,
          // Optional, and absent for most episodes: a transcript is made after
          // the fact, so the ordinary way one arrives is the PATCH below rather
          // than this. Accepted here as well because an episode that already has
          // one at upload time should not need a second request to say so.
          transcript: transcript.transcript,
          content_hash: contentHash,
          uploaded_at: now,
        })

        const row = findById(Number(result.lastInsertRowid)) as EpisodeRow
        request.log.info(
          { episodeId: row.id, slug: row.slug, bytes, store: store.kind },
          'episode uploaded',
        )

        // An errand, not a step. The episode is already an episode; this only
        // makes it smaller. See `lib/publish.ts`.
        publisher.queue(row.id)

        return reply.code(201).send({ episode: toAdminEpisode(row, store) })
      } catch (err) {
        await cleanup()
        await store.remove(key).catch(() => undefined)
        throw err
      }
    })

    /**
     * Edit an episode, or publish it.
     *
     * Every field is optional and absent means "leave it alone", which is the
     * opposite of what the schedule's PUT does with its two text fields — and
     * the difference is what the request is. Announcing a session is a form
     * filled in from scratch each time; this is a console with a row per
     * episode and a publish button on it, and a PATCH that cleared the notes
     * because the caller only wanted to flip the status would be a trap.
     *
     * An explicit null clears a nullable field, which is how the console empties
     * the guest line without emptying everything else.
     */
    app.patch('/api/episodes/:id', { preHandler: requireAdmin(config) }, async (request, reply) => {
      const id = Number((request.params as { id: string }).id)
      const row = Number.isInteger(id) ? findById(id) : undefined
      if (!row) {
        return reply.code(404).send({ error: 'no_episode', message: 'no episode with that id' })
      }

      const body = (request.body ?? {}) as Record<string, unknown>
      const has = (key: string) => Object.hasOwn(body, key)

      const next = {
        title: row.title,
        notes: row.notes,
        guests: row.guests,
        episode_number: row.episode_number,
        published_at: row.published_at,
        status: row.status,
        slug: row.slug,
        transcript: row.transcript,
      }

      if (has('title') && typeof body.title === 'string') {
        const title = toTitle(body.title)
        if (title === '') {
          return reply
            .code(400)
            .send({ error: 'no_title', message: 'an episode needs a title' })
        }
        next.title = title
        /**
         * The address follows the title only while the episode is a draft.
         *
         * A slug is a promise the moment anything links to it, and a published
         * episode has been sent to people: re-slugging it on a typo fix would
         * break every link already in a message thread, which is a far worse
         * outcome than an address that reads slightly wrong. A draft has no
         * such history — nothing outside the console can have seen it — so
         * correcting a title before publishing corrects the address too, which
         * is the moment somebody actually wants that.
         */
        if (row.status === 'draft') {
          next.slug = uniqueSlug(title, (candidate) => slugTaken(db, candidate, row.id))
        }
      }
      if (has('notes')) {
        next.notes = typeof body.notes === 'string' ? toNotes(body.notes) : null
      }
      if (has('guests')) {
        next.guests = typeof body.guests === 'string' ? toGuests(body.guests) : null
      }
      if (has('episodeNumber')) {
        next.episode_number = toInt(
          typeof body.episodeNumber === 'number' ? String(body.episodeNumber) : body.episodeNumber,
        )
      }
      if (has('publishedAt')) {
        const at = toInt(
          typeof body.publishedAt === 'number' ? String(body.publishedAt) : body.publishedAt,
        )
        // Null would be a row with no date, which the column refuses and the
        // grid could not order. Absent means unchanged; nonsense means unchanged.
        if (at !== null) next.published_at = at
      }
      if (has('status')) next.status = toStatus(body.status)
      /**
       * The usual way a transcript arrives.
       *
       * An episode is uploaded on the night it is finished and transcribed
       * afterwards — a machine transcription takes as long as the conversation
       * did, and then somebody reads it — so the common case is an episode that
       * has been on the page for a week gaining its words. Which is why this is
       * here as well as on the upload, and why an explicit null clears it: a
       * transcript uploaded against the wrong episode has to be removable.
       *
       * `bodyLimit` is a megabyte for the whole app (see app.ts) and a
       * transcript at the ceiling is comfortably inside it.
       */
      if (has('transcript')) {
        const transcript = checkTranscript(body.transcript)
        if ('status' in transcript) {
          return reply
            .code(transcript.status)
            .send({ error: transcript.error, message: transcript.message })
        }
        next.transcript = transcript.transcript
      }

      db.prepare(`
        UPDATE episodes SET
          slug = @slug, title = @title, notes = @notes, guests = @guests,
          episode_number = @episode_number, published_at = @published_at, status = @status,
          transcript = @transcript
        WHERE id = @id
      `).run({ ...next, id: row.id })

      return { episode: toAdminEpisode(findById(row.id) as EpisodeRow, store) }
    })

    /**
     * Take an episode down, and its files with it.
     *
     * The row goes first and the files after, which is the order that fails
     * safely: a delete interrupted between the two leaves bytes on a volume
     * that nothing references, which costs disk. The other order leaves a row
     * pointing at a file that is not there, which costs a broken page.
     */
    app.delete('/api/episodes/:id', { preHandler: requireAdmin(config) }, async (request, reply) => {
      const id = Number((request.params as { id: string }).id)
      const row = Number.isInteger(id) ? findById(id) : undefined
      if (!row) {
        return reply.code(404).send({ error: 'no_episode', message: 'no episode with that id' })
      }

      db.prepare('DELETE FROM episodes WHERE id = ?').run(row.id)
      await forgetFiles(row)
      request.log.info({ episodeId: row.id, slug: row.slug }, 'episode deleted')

      return { deleted: row.id }
    })
  }
}

/** Re-exported so the tests and the console can name the shape. */
export type { Episode }
