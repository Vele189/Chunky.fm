import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import fastifyStatic from '@fastify/static'
import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import type { Config } from '../config.js'
import type { Db, EpisodeRow, EpisodeStatus } from '../db.js'
import { looksLikeVideoUpload } from '../lib/video.js'
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
 * An episode carries two pictures, and they are different shapes because they
 * are doing different jobs.
 *
 * **The poster** is the episode's card in the collection: 1080x1350, the
 * portrait post these are made as, exactly. Enforced to the pixel because the
 * grid is a wall of them and one card at a different ratio is either
 * letterboxed against the card or cropped by the browser, with no say from
 * whoever chose the framing — on the one page whose whole job is showing
 * artwork, that reads as a bug.
 *
 * **The thumbnail** is what the player shows before the first frame decodes:
 * 16:9, so it is the shape of the thing it stands in for. A *ratio* with a
 * floor rather than an exact size, because 1280x720, 1920x1080 and 2560x1440
 * are the same picture and refusing two of them would be fussiness about a
 * number rather than about the result.
 *
 * Neither is the other cropped. A 16:9 still cut to 4:5 loses more than half
 * its width — which on a two-shot is both faces — and a portrait poster
 * pillarboxed into the player is a black frame with a strip of picture in it.
 * Two images is the honest cost of wanting both, and it is one more drop target
 * in the console.
 *
 * The session poster in `routes/schedule.ts` deliberately has no rule at all:
 * it is whatever somebody made in a hurry an hour before the doors open, and
 * refusing it then would be the tool getting in the way of the night.
 */
const POSTER_WIDTH = 1080
const POSTER_HEIGHT = 1350

const THUMB_RATIO = 16 / 9
/**
 * How far off 16:9 still counts.
 *
 * A per cent, which sounds tight and is not: it is a pixel and a half of height
 * on a 1280-wide image. What it is for is the export that comes back
 * 1920x1081 because something rounded, rather than a 4:3 photograph.
 */
const THUMB_TOLERANCE = 0.01
const THUMB_MIN_WIDTH = 1280

/** What a page of the archive holds. Generous: an archive is browsed, not paged. */
const PAGE_SIZE = 60

interface PodcastDeps {
  config: Config
  db: Db
  /** Where the video lives. R2, or this station's own disk. See `lib/store.ts`. */
  store: MediaStore
  /** What makes an episode start quickly. See `lib/publish.ts`. */
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
 * The video never comes through here at all; a poster is eight megabytes,
 * and buffering one is both simpler and necessary — the size check needs the
 * header before anything is written, and a file that turns out to be 900x1200
 * should never have touched the disk at all.
 *
 * The cap is enforced here rather than through multipart's `fileSize`, because
 * that limit is shared by every part in the request and the other fields need
 * it set to something much larger. Without this, "poster" could name a 150 MB
 * file and this function would happily hold all of it.
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
 * A picture, checked as far as it can be before it is written down.
 *
 * Three questions in order, and the order is not arbitrary: what the bytes say
 * it is, whether that agrees with what the request claimed, and only then
 * whether it is the right shape. Asking about shape first would mean reporting
 * "not 1080x1350" about a PDF.
 *
 * `shape` is what makes this serve both pictures: the poster wants an exact
 * size and the thumbnail wants a ratio, and everything before that question is
 * identical for the two of them.
 */
function checkImage(
  buffer: Buffer,
  mimetype: string,
  what: 'poster' | 'thumbnail',
  shape: (size: { width: number; height: number }) => string | null,
): { extension: string } | Refusal {
  const declared = POSTER_TYPES[mimetype.toLowerCase()]
  const actual = sniff(buffer)
  if (!actual || (declared && declared !== actual)) {
    return {
      status: 415,
      error: 'unsupported_poster',
      message: `a ${what} has to be a JPEG, a PNG or a WebP`,
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
  const wrong = shape(size)
  if (wrong) {
    return {
      status: 422,
      error: 'poster_dimensions',
      // The size received, named. A refusal that only states the rule leaves
      // somebody guessing which part of theirs was wrong.
      message: `a ${what} ${wrong}; that one is ${size.width}x${size.height}`,
    }
  }
  return { extension: actual }
}

/** The poster's shape: exactly the portrait post these are made as. */
const posterShape = (size: { width: number; height: number }): string | null =>
  size.width === POSTER_WIDTH && size.height === POSTER_HEIGHT
    ? null
    : `has to be exactly ${POSTER_WIDTH}x${POSTER_HEIGHT}`

/** The thumbnail's: the video's own shape, big enough not to look soft. */
const thumbShape = (size: { width: number; height: number }): string | null => {
  if (Math.abs(size.width / size.height - THUMB_RATIO) > THUMB_RATIO * THUMB_TOLERANCE) {
    return 'has to be 16:9'
  }
  if (size.width < THUMB_MIN_WIDTH) return `has to be at least ${THUMB_MIN_WIDTH} wide`
  return null
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
      duration_ms, master_key, master_bytes, video_key, video_bytes, video_type,
      transcode_status, poster, thumbnail, transcript, content_hash, uploaded_at
    ) VALUES (
      @slug, @title, @notes, @guests, @episode_number, @published_at, @status,
      @duration_ms, @master_key, @master_bytes, @video_key, @video_bytes, @video_type,
      @transcode_status, @poster, @thumbnail, @transcript, @content_hash, @uploaded_at
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
   * Delete everything an episode owned: both video objects and the poster.
   *
   * Both, and that is easy to get wrong — an episode that had to be rewritten
   * owns *two* objects in the store, the master and the serving copy, and they
   * are the same key only when the file arrived ready to stream. Deleting
   * `video_key` alone would leave a gigabyte of master in the bucket forever
   * with nothing referencing it, which is the kind of leak nobody notices until
   * the bill arrives.
   */
  const forgetFiles = async (row: EpisodeRow): Promise<void> => {
    const keys = new Set([row.master_key, row.video_key])
    for (const key of keys) {
      await store.remove(key).catch(() => undefined)
    }
    // Both pictures. An episode owns a poster and a thumbnail, and deleting one
    // of them would leave the other on the volume forever with nothing pointing
    // at it — the same leak `forgetFiles` exists to prevent in the bucket.
    for (const picture of [row.poster, row.thumbnail]) {
      if (picture) await discard(episodePosterFilePath(config, picture))
    }
  }

  return async function routes(app: FastifyInstance) {
    /**
     * Let a raw part body through untouched.
     *
     * Fastify parses a request body by content type and refuses one it has no
     * parser for with a 415 — which is what an 8 MiB slice of video is, since
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
     * The video and the posters, served flat.
     *
     * Range support is what makes the player work at all: an episode is an hour
     * long, and somebody resuming at 34:10 has to fetch that byte range rather
     * than pulling the whole file from zero first. @fastify/static gets this
     * from `send`; there is a test pinning it rather than trusting it, the same
     * way `media.ts` does for the library.
     *
     * On R2 none of this is reached: Cloudflare's edge answers the Range and
     * this server never sees a byte of video. The route exists for the disk
     * backend, and the test covers it there — which is the same code path a
     * station without R2 actually runs.
     *
     * Cached hard and immutable, because both are named by content: an episode's
     * video is its hash and a poster is a fresh id every time one is set, so
     * neither can ever change under a URL a page has already drawn.
     */
    await app.register(fastifyStatic, {
      root: config.episodeVideoDir,
      // Only reached on a station keeping its archive on disk. With R2
      // configured, `publicUrl` returns a Cloudflare address and nothing ever
      // asks this app for video at all — which is the entire point of R2.
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
     * An hour of video does not fit in a request. It is a gigabyte of master, it
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
      if (!looksLikeVideoUpload(filename, contentType)) {
        return reply
          .code(415)
          .send({ error: 'unsupported_type', message: `${contentType || filename} is not video` })
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
         * looking at their video file, which is the one thing that is fine.
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
     * One part's URL, again.
     *
     * The upload is begun with every part's URL minted at once, which is the
     * right shape — the alternative is a round trip per 8 MiB, and an hour of
     * video is hundreds of those. What it cannot be is the *only* way to get
     * one: those URLs expire together (see `PART_URL_TTL_S`), and an upload
     * long enough to outlive them is exactly the upload this archive is for.
     *
     * So the console asks here before it retries a part, and a part that failed
     * because its credential had gone stale succeeds on the second attempt with
     * a fresh one. A part that failed for any other reason — a dropped
     * connection, a moment of packet loss — is retried with a fresh URL too,
     * which costs one signature and removes a whole class of failure from the
     * console's error handling: it never has to work out *why* a part failed.
     *
     * Nothing here touches the upload's state. Signing is arithmetic against
     * the key, the id and the clock, so this is safe to call at any point, in
     * any order, as many times as an upload needs it.
     */
    app.get(
      '/api/episodes/uploads/:uploadId/parts/:part/url',
      { preHandler: requireAdmin(config) },
      async (request, reply) => {
        const { uploadId, part } = request.params as { uploadId: string; part: string }
        const key = (request.query as { key?: string }).key
        const partNumber = Number(part)

        if (typeof key !== 'string' || key === '') {
          return reply.code(400).send({ error: 'no_key', message: 'which object is this a part of?' })
        }
        if (!Number.isInteger(partNumber) || partNumber < 1) {
          return reply.code(400).send({ error: 'bad_part', message: 'part numbers start at 1' })
        }

        try {
          return { url: await store.partUrl(key, uploadId, partNumber) }
        } catch (err) {
          request.log.error({ err, key, uploadId, partNumber }, 'could not sign a part url')
          return reply.code(502).send({
            error: 'store_unavailable',
            message: `the archive's storage would not sign that part: ${
              (err as Error).message ?? 'no reason given'
            }`,
          })
        }
      },
    )

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
        // video as a malformed body.
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
     * Multipart, and it carries the *poster* rather than the video — the video
     * is already in the store and is named by `uploadId` and `key`. The poster
     * is eight megabytes at most, so the request that was wrong for an hour of
     * video is exactly right for it, and all the validation in `checkPoster`
     * stays where it was.
     *
     * The episode is created pointing at the **master**, so it is playable the
     * instant this answers. The encode that replaces it with something a tenth
     * the size is an errand queued afterwards; see `lib/publish.ts`.
     */
    app.post('/api/episodes', { preHandler: requireAdmin(config) }, async (request, reply) => {
      const images: Record<'poster' | 'thumbnail', { buffer: Buffer; mimetype: string } | null> = {
        poster: null,
        thumbnail: null,
      }
      /** What each was written as, once it has been. Both are cleaned up. */
      const written: string[] = []
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
        for (const name of written) await discard(episodePosterFilePath(config, name))
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
          limits: { fileSize: POSTER_MAX_BYTES, files: 2 },
        })) {
          if (part.type === 'field') {
            if (typeof part.value === 'string') fields.set(part.fieldname, part.value)
            continue
          }
          // Two named parts and nothing else. Anything else arriving as a file
          // is drained rather than refused: the request is already carrying the
          // receipt for an upload that has happened, and failing it over a
          // stray part would cost that upload.
          if (part.fieldname !== 'poster' && part.fieldname !== 'thumbnail') {
            part.file.resume()
            continue
          }
          const what = part.fieldname
          const read = await readCapped(part.file, POSTER_MAX_BYTES)
          if ('tooLarge' in read) {
            return await refuse({
              status: 413,
              error: 'poster_too_large',
              message: `a ${what} has to be under ${Math.round(POSTER_MAX_BYTES / 1024 / 1024)} MB`,
            })
          }
          if (read.buffer.length > 0) {
            images[what] = { buffer: read.buffer, mimetype: part.mimetype }
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
          error: 'no_video',
          message: 'finish an upload first: POST /api/episodes/uploads',
        })
      }
      if (!/^[0-9a-f]{64}$/.test(contentHash)) {
        return refuse({
          status: 400,
          error: 'no_hash',
          message: 'an episode needs the sha256 of its video, computed while uploading',
        })
      }

      const title = toTitle(fields.get('title') ?? '')
      if (title === '') {
        return refuse({ status: 400, error: 'no_title', message: 'an episode needs a title' })
      }
      const transcript = checkTranscript(fields.get('transcript'))
      if ('status' in transcript) return refuse(transcript)
      if (images.poster === null) {
        return refuse({
          status: 400,
          error: 'no_poster',
          message: `an episode needs a poster, sent as the \`poster\` part, at ${POSTER_WIDTH}x${POSTER_HEIGHT}`,
        })
      }
      if (images.thumbnail === null) {
        return refuse({
          status: 400,
          error: 'no_thumbnail',
          message: `an episode needs a thumbnail, sent as the \`thumbnail\` part, 16:9 and at least ${THUMB_MIN_WIDTH} wide`,
        })
      }
      const poster = checkImage(images.poster.buffer, images.poster.mimetype, 'poster', posterShape)
      if ('status' in poster) return refuse(poster)
      const thumbnail = checkImage(
        images.thumbnail.buffer,
        images.thumbnail.mimetype,
        'thumbnail',
        thumbShape,
      )
      if ('status' in thumbnail) return refuse(thumbnail)

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
          message: 'that video is already an episode',
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
      const posterName = `${randomUUID()}.${poster.extension}`
      const thumbName = `${randomUUID()}.${thumbnail.extension}`

      try {
        await fs.writeFile(episodePosterFilePath(config, posterName), images.poster.buffer)
        written.push(posterName)
        await fs.writeFile(episodePosterFilePath(config, thumbName), images.thumbnail.buffer)
        written.push(thumbName)

        const result = insertEpisode.run({
          slug: uniqueSlug(title, (candidate) => slugTaken(db, candidate), now),
          title,
          notes: toNotes(fields.get('notes') ?? ''),
          guests: toGuests(fields.get('guests') ?? ''),
          episode_number: toInt(fields.get('episodeNumber')),
          published_at: toInt(fields.get('publishedAt')) ?? now,
          status: toStatus(fields.get('status')),
          // What the browser's own decoder made of the master. Right often
          // enough to put on a card, and replaced by ffmpeg's figure on the
          // episodes that turn out to need rewriting.
          duration_ms: Math.max(0, toInt(fields.get('durationMs')) ?? 0),
          master_key: key,
          master_bytes: bytes,
          // The master *is* the serving copy unless the file turns out to
          // need its index moving, which is what makes an episode playable the
          // moment this answers and what makes a station with no ffmpeg — and
          // the ordinary file, which needs nothing — work with no special case
          // anywhere.
          video_key: key,
          video_bytes: bytes,
          video_type: fields.get('contentType') || 'video/mp4',
          transcode_status: publisher.enabled ? 'pending' : 'none',
          poster: posterName,
          thumbnail: thumbName,
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
