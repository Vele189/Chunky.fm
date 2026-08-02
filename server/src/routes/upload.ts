import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import type { Config } from '../config.js'
import type { Db, TrackRow } from '../db.js'
import { UnsupportedAudioError, extractMetadata, looksLikeAudioUpload } from '../lib/audio.js'
import { requireAdmin } from '../lib/auth.js'
import { artworkFilePath, discard, trackFilePath } from '../lib/storage.js'

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

const TOO_LARGE_CODES = new Set(['FST_REQ_FILE_TOO_LARGE', 'FST_FILE_TOO_LARGE'])
const BAD_MULTIPART_CODES = new Set([
  'FST_INVALID_MULTIPART_CONTENT_TYPE',
  'FST_FILES_LIMIT',
  'FST_PARTS_LIMIT',
  'FST_FIELDS_LIMIT',
  'FST_PROTO_VIOLATION',
])

function errorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : undefined
}

interface UploadDeps {
  config: Config
  db: Db
}

interface Outcome {
  status: number
  body: unknown
}

function duplicateBody(existing: TrackRow) {
  return {
    error: 'duplicate',
    message: 'this file is already in the library',
    track: toTrack(existing),
  }
}

export function uploadRoutes({ config, db }: UploadDeps): FastifyPluginAsync {
  const findByHash = (hash: string) =>
    db.prepare('SELECT * FROM tracks WHERE content_hash = ?').get(hash) as TrackRow | undefined

  const insertTrack = db.prepare(`
    INSERT INTO tracks (title, artist, album, duration_ms, filename, artwork_path, content_hash, uploaded_at)
    VALUES (@title, @artist, @album, @duration_ms, @filename, @artwork_path, @content_hash, @uploaded_at)
  `)

  return async function routes(app: FastifyInstance) {
    app.post('/api/upload', { preHandler: requireAdmin(config) }, async (request, reply) => {
      let part
      try {
        part = await request.file({ limits: { fileSize: config.maxUploadBytes, files: 1 } })
      } catch (err) {
        if (BAD_MULTIPART_CODES.has(errorCode(err) ?? '')) {
          return reply.code(400).send({ error: 'bad_multipart', message: (err as Error).message })
        }
        throw err
      }

      if (!part) {
        return reply
          .code(400)
          .send({ error: 'no_file', message: 'expected a multipart request with one file part' })
      }

      if (!looksLikeAudioUpload(part.filename, part.mimetype)) {
        part.file.resume() // drain, or the client sits waiting on a half-read body
        return reply
          .code(415)
          .send({ error: 'unsupported_type', message: `${part.mimetype} is not an audio file` })
      }

      // Land it in tmp first: we can't trust the file is audio until it has
      // parsed, and we don't want half-written junk in the served directory.
      const tmpPath = path.join(config.tmpDir, `${randomUUID()}.part`)
      const hash = createHash('sha256')
      let bytesWritten = 0
      const tap = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          hash.update(chunk)
          bytesWritten += chunk.length
          callback(null, chunk)
        },
      })

      const ingest = async (): Promise<Outcome> => {
        await pipeline(part.file, tap, createWriteStream(tmpPath))

        if (part.file.truncated) {
          throw Object.assign(new Error('file exceeds upload limit'), {
            code: 'FST_REQ_FILE_TOO_LARGE',
          })
        }
        if (bytesWritten === 0) {
          return {
            status: 400,
            body: { error: 'empty_file', message: 'uploaded file is empty' },
          }
        }

        const metadata = await extractMetadata(tmpPath, part.filename)
        const contentHash = hash.digest('hex')

        const duplicate = findByHash(contentHash)
        if (duplicate) {
          return { status: 409, body: duplicateBody(duplicate) }
        }

        const filename = `${contentHash}.${metadata.extension}`
        // tmp lives on the same volume as audio/, so this is a cheap atomic move.
        await fs.rename(tmpPath, trackFilePath(config, filename))

        let artworkName: string | null = null
        if (metadata.artwork) {
          artworkName = `${contentHash}.${metadata.artwork.extension}`
          await fs.writeFile(artworkFilePath(config, artworkName), metadata.artwork.data)
        }

        try {
          const result = insertTrack.run({
            title: metadata.title,
            artist: metadata.artist,
            album: metadata.album,
            duration_ms: metadata.durationMs,
            filename,
            artwork_path: artworkName,
            content_hash: contentHash,
            uploaded_at: Date.now(),
          })
          const row = db
            .prepare('SELECT * FROM tracks WHERE id = ?')
            .get(result.lastInsertRowid) as TrackRow

          request.log.info({ trackId: row.id, filename, bytes: bytesWritten }, 'track uploaded')
          return { status: 201, body: { track: toTrack(row) } }
        } catch (err) {
          // Two identical files racing each other. The bytes on disk are the
          // same either way, so keep them and hand back the winner.
          const existing =
            errorCode(err) === 'SQLITE_CONSTRAINT_UNIQUE' ? findByHash(contentHash) : undefined
          if (existing) {
            return { status: 409, body: duplicateBody(existing) }
          }
          await discard(trackFilePath(config, filename))
          if (artworkName) await discard(artworkFilePath(config, artworkName))
          throw err
        }
      }

      // The reply is deliberately sent only after cleanup: an admin retrying
      // straight away should never see leftovers from the attempt before.
      let outcome: Outcome
      try {
        outcome = await ingest()
      } catch (err) {
        if (TOO_LARGE_CODES.has(errorCode(err) ?? '')) {
          outcome = {
            status: 413,
            body: {
              error: 'file_too_large',
              message: `file exceeds the ${config.maxUploadBytes} byte upload limit`,
            },
          }
        } else if (err instanceof UnsupportedAudioError) {
          request.log.info({ err, filename: part.filename }, 'rejected upload: not usable audio')
          outcome = { status: 415, body: { error: 'unsupported_audio', message: err.message } }
        } else {
          await discard(tmpPath)
          throw err
        }
      }
      await discard(tmpPath)

      return reply.code(outcome.status).send(outcome.body)
    })
  }
}
