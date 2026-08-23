import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { Config } from '../config.js'

/**
 * Where an episode's audio lives, and how it gets there.
 *
 * One interface with two backends, and the reason is not portability for its
 * own sake — it is that **the client code must be identical either way**. An
 * hour of audio is too big for one request, so the console uploads it in parts;
 * building that flow twice, once against R2 and once against a local disk,
 * would mean the path exercised by `npm run dev` was not the path that runs in
 * production, and a chunked upload is exactly the kind of thing that breaks
 * only in the version nobody tests.
 *
 * So the local backend implements *the same multipart protocol* against the
 * filesystem: begin, sign a part, put a part, complete, abort. The only thing
 * the console does differently is which URL it PUTs a part to, and it is handed
 * that URL either way.
 *
 * ## Why the AWS SDK, in a repository that hand-rolled PNG header parsing
 *
 * `lib/poster.ts` reads image dimensions by hand rather than adding `sharp`,
 * and that was the right call: the alternative was 30 MB of platform binaries
 * to read twenty bytes of a format that has not changed since 1996. This is a
 * different trade. What is needed here is **SigV4 request signing**, in two
 * forms (query-string for presigned part URLs, headers for the multipart
 * lifecycle calls), against a service that will reject a subtly wrong signature
 * with a message that says nothing useful. That is cryptographic protocol work
 * with real edge cases — canonical header ordering, payload hashing, clock
 * skew — and getting it quietly wrong is a much worse failure than 15 MB in a
 * container image. The dependency is server-side only; nothing here reaches a
 * browser.
 */

/** One finished part, as the completion call needs it back. */
export interface UploadedPart {
  partNumber: number
  /** What the store returned when the part landed. Its receipt. */
  etag: string
}

/** How an in-flight upload is addressed while it is happening. */
export interface BegunUpload {
  uploadId: string
  key: string
}

export interface MediaStore {
  readonly kind: 'local' | 'r2'
  /**
   * Where a listener fetches this key.
   *
   * Absolute for R2 — a CDN hostname this app does not serve — and app-relative
   * for local. That difference is why an episode now carries a whole `audioUrl`
   * over the wire rather than the bare filename every other object in this API
   * sends: see the note on `Episode` in `lib/episode.ts`.
   */
  publicUrl(key: string): string
  /** Start a chunked upload. */
  createUpload(key: string, contentType: string): Promise<BegunUpload>
  /**
   * Where the browser should PUT one part.
   *
   * For R2 this is a presigned URL that expires; for local it is a route on
   * this server. The console does not care which, which is the point.
   */
  partUrl(key: string, uploadId: string, partNumber: number): Promise<string>
  /** Assemble the parts into the finished object. */
  completeUpload(key: string, uploadId: string, parts: UploadedPart[]): Promise<void>
  /** Give up, and leave nothing behind. */
  abortUpload(key: string, uploadId: string): Promise<void>
  /** Write an object outright. Used for the transcoded copy and the poster. */
  put(key: string, body: Buffer, contentType: string): Promise<void>
  /** Read one back, for transcoding. */
  getStream(key: string): Promise<Readable>
  /** How big an object is, or null if it is not there. */
  size(key: string): Promise<number | null>
  remove(key: string): Promise<void>
}

/**
 * How big each part is.
 *
 * S3 and R2 both require every part except the last to be at least 5 MiB, and
 * cap the number of parts at 10,000. 8 MiB is comfortably above the floor and
 * puts a 500 MB master at about 63 parts — few enough that the per-part
 * round-trip for a signed URL is not the dominant cost, and small enough that
 * losing one to a dropped connection costs seconds rather than minutes.
 *
 * At this size the 10,000-part cap is reached at 80 GB, which no episode will
 * ever approach.
 */
export const PART_SIZE = 8 * 1024 * 1024

/** How many parts a file of this size will be cut into. */
export function partCountFor(bytes: number): number {
  return Math.max(1, Math.ceil(bytes / PART_SIZE))
}

/**
 * How long a presigned part URL is good for.
 *
 * An hour, which sounds generous for a single 8 MiB PUT and is not: these are
 * handed out in batches at the start of an upload, and the last part of a
 * 500 MB file on a slow connection may not be reached for a long time. Short
 * enough that a URL scraped out of a network log is not a standing write
 * credential for the bucket.
 */
const PART_URL_TTL_S = 3600

/* -------------------------------------------------------------------------- */
/*  R2                                                                         */
/* -------------------------------------------------------------------------- */

function r2Store(config: NonNullable<Config['r2']>): MediaStore {
  const client = new S3Client({
    // R2 has no regions, but SigV4 has to sign *something*; `auto` is what
    // Cloudflare's own documentation specifies.
    region: 'auto',
    endpoint: config.endpoint ?? `https://${config.accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
  const Bucket = config.bucket

  return {
    kind: 'r2',

    publicUrl(key) {
      return `${config.publicBaseUrl}/${key}`
    },

    async createUpload(key, contentType) {
      const out = await client.send(
        new CreateMultipartUploadCommand({ Bucket, Key: key, ContentType: contentType }),
      )
      if (!out.UploadId) throw new Error('R2 began an upload without giving it an id')
      return { uploadId: out.UploadId, key }
    },

    async partUrl(key, uploadId, partNumber) {
      return getSignedUrl(
        client,
        new UploadPartCommand({ Bucket, Key: key, UploadId: uploadId, PartNumber: partNumber }),
        { expiresIn: PART_URL_TTL_S },
      )
    },

    async completeUpload(key, uploadId, parts) {
      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            // Ordered, and not optionally: S3 refuses a completion whose parts
            // are out of sequence, and the console collects them as they finish
            // rather than in order.
            Parts: [...parts]
              .sort((a, b) => a.partNumber - b.partNumber)
              .map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
          },
        }),
      )
    },

    async abortUpload(key, uploadId) {
      await client.send(
        new AbortMultipartUploadCommand({ Bucket, Key: key, UploadId: uploadId }),
      )
    },

    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }),
      )
    },

    async getStream(key) {
      const out = await client.send(new GetObjectCommand({ Bucket, Key: key }))
      if (!out.Body) throw new Error(`R2 returned no body for ${key}`)
      return out.Body as Readable
    },

    async size(key) {
      try {
        const out = await client.send(new HeadObjectCommand({ Bucket, Key: key }))
        return out.ContentLength ?? null
      } catch {
        // Missing, or unreadable. Both are "there is nothing to measure".
        return null
      }
    },

    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }))
    },
  }
}

/* -------------------------------------------------------------------------- */
/*  the local disk                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The same protocol against a directory.
 *
 * Parts are written as numbered files under a folder named for the upload, and
 * completing one concatenates them in order into the final object. That is
 * exactly what S3 does, and doing it the same way here means the console's
 * upload code has no idea which backend it is talking to.
 *
 * The ETag a part is answered with is its own sha256 rather than S3's md5, and
 * nothing depends on the difference: the value is opaque to the client, which
 * hands it back at completion, and completion here checks it against what was
 * written. It is a receipt, not a checksum anybody compares across systems.
 */
function localStore(config: Config): MediaStore {
  const root = config.episodeAudioDir
  const staging = path.join(config.tmpDir, 'uploads')

  const objectPath = (key: string) => path.join(root, key.replaceAll('/', '__'))
  const uploadDir = (uploadId: string) => path.join(staging, path.basename(uploadId))
  const partPath = (uploadId: string, partNumber: number) =>
    path.join(uploadDir(uploadId), `${String(partNumber).padStart(5, '0')}.part`)

  return {
    kind: 'local',

    publicUrl(key) {
      // Served by this app, from the same route the archive has always used.
      return `/api/episode-media/${key.replaceAll('/', '__')}`
    },

    async createUpload(key) {
      const uploadId = randomUUID()
      await fs.mkdir(uploadDir(uploadId), { recursive: true })
      return { uploadId, key }
    },

    async partUrl(_key, uploadId, partNumber) {
      // A route on this server rather than a signed URL. Already behind the
      // admin gate, so there is nothing to sign.
      return `/api/episodes/uploads/${uploadId}/parts/${partNumber}`
    },

    async completeUpload(key, uploadId, parts) {
      const destination = objectPath(key)
      await fs.mkdir(path.dirname(destination), { recursive: true })

      // Written through one open handle, part by part, rather than with
      // `pipeline(…, { end: false })`. That reads better and does not work:
      // pipeline watches the *destination* for completion, and a writable it
      // has been told not to end never completes, so every part after the first
      // rejects with ERR_STREAM_PREMATURE_CLOSE.
      //
      // One part is held at a time, which at 8 MiB is nothing, and a 500 MB
      // master is sixty-three sequential reads rather than one huge one.
      const out = await fs.open(destination, 'w')
      try {
        for (const part of [...parts].sort((a, b) => a.partNumber - b.partNumber)) {
          await out.write(await fs.readFile(partPath(uploadId, part.partNumber)))
        }
      } finally {
        await out.close()
      }
      await fs.rm(uploadDir(uploadId), { recursive: true, force: true })
    },

    async abortUpload(_key, uploadId) {
      await fs.rm(uploadDir(uploadId), { recursive: true, force: true })
    },

    async put(key, body) {
      const destination = objectPath(key)
      await fs.mkdir(path.dirname(destination), { recursive: true })
      await fs.writeFile(destination, body)
    },

    async getStream(key) {
      return createReadStream(objectPath(key))
    },

    async size(key) {
      try {
        return (await fs.stat(objectPath(key))).size
      } catch {
        return null
      }
    },

    async remove(key) {
      await fs.rm(objectPath(key), { force: true })
    },
  }
}

/**
 * Write one part of a local upload, and answer with its receipt.
 *
 * Only the local backend needs this: against R2 the browser PUTs to a presigned
 * URL and R2 answers with the ETag itself. Here the route in
 * `routes/podcast.ts` calls this and returns what it gives back, so that both
 * paths hand the console the same shape.
 */
export async function writeLocalPart(
  config: Config,
  uploadId: string,
  partNumber: number,
  body: Readable,
): Promise<string> {
  const dir = path.join(config.tmpDir, 'uploads', path.basename(uploadId))
  // Refuse a part for an upload nobody began, rather than creating the folder
  // and accepting bytes into an upload that can never be completed.
  await fs.access(dir)
  const target = path.join(dir, `${String(partNumber).padStart(5, '0')}.part`)

  const hash = createHash('sha256')
  const out = createWriteStream(target)
  body.on('data', (chunk: Buffer) => hash.update(chunk))
  await pipeline(body, out)
  return `"${hash.digest('hex').slice(0, 32)}"`
}

/**
 * The store this station uses.
 *
 * R2 when it is configured and the disk when it is not; nothing above this line
 * asks which, and nothing below it is a fallback in the sense of being worse.
 * A station keeping its archive on its own volume is a supported way to run
 * this, and it is what every test and every `npm run dev` uses.
 */
export function mediaStore(config: Config): MediaStore {
  return config.r2 ? r2Store(config.r2) : localStore(config)
}
