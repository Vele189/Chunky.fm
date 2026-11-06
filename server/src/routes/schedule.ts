import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import fastifyStatic from '@fastify/static'
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import type { Config } from '../config.js'
import type { SessionKind } from '../db.js'
import { requireAdmin } from '../lib/auth.js'
import { POSTER_MAX_BYTES, POSTER_TYPES, sniff } from '../lib/poster.js'
import { discard, posterFilePath } from '../lib/storage.js'
import type { Announcement, Schedule } from '../schedule.js'

/**
 * Announcing sessions, and the posters that go with them.
 *
 * The read is **open**, and deliberately: the whole point of a poster is to be
 * seen by somebody who is not in the room yet, and the page in front of the
 * station has no key to present. So this is the one thing about the station a
 * stranger can ask for. It carries a time and a picture and nothing else, which
 * is what makes that safe: no track, no nickname, no word anybody said.
 *
 * Writing it is admin-only, like every other write in this API.
 */

/**
 * What a poster may be, and how its first bytes are read.
 *
 * Both live in `lib/poster.ts` now, because the podcast archive takes a poster
 * too and two copies of a file-format check is how one of them ends up
 * accepting something the other refuses. The declared content type is a hint
 * from whoever is uploading, so it is checked against the file rather than
 * believed.
 *
 * What this route deliberately does *not* borrow from there is the size check.
 * An episode poster must be exactly 1080x1350; a session poster is whatever
 * somebody made in a hurry on a phone, and refusing it an hour before the doors
 * open would be the tool getting in the way of the night.
 */

/**
 * How long a title may be.
 *
 * A line on a poster rather than a description of the evening: it has to sit
 * under a time on the page in front of the station and inside the one line the
 * top bar has, and anything longer would be cut by a layout rather than by
 * something that could tell whoever typed it. Cut here instead, where the limit
 * is a rule somebody can read, and at a length that holds a theme ("Songs that
 * sound like forgiveness") or a name and what they do.
 */
const TITLE_MAX_LENGTH = 80

/**
 * A typed title as it goes into the database, or null for no title at all.
 *
 * Empty is null rather than an empty string: a field somebody cleared and a
 * field nobody filled in are the same announcement, and two spellings of it
 * would be two things every reader has to check for. Whitespace is collapsed
 * and control characters go with it, because this ends up in the markup of a
 * public page and inside an `alt`, and a newline in the middle of a poster
 * caption is somebody's paste of a whole paragraph arriving as a title.
 */
function toTitle(value: string): string | null {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
  const clean = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().replace(/\s+/g, ' ')
  return clean.length > 0 ? clean.slice(0, TITLE_MAX_LENGTH) : null
}

interface ScheduleDeps {
  config: Config
  schedule: Schedule
}

/**
 * What a multipart announcement said, or the refusal to send instead.
 *
 * Shared by adding and by editing, which take the same form. A poster that was
 * read is already on disk by the time this returns; every refusal after that
 * point unlinks it first, so the caller only has a file to think about when it
 * gets an announcement back.
 */
type Parsed =
  | {
      ok: true
      startsAt: number
      kind: SessionKind
      title: string | null
      /** The new poster's filename, or null when none was sent. */
      stored: string | null
      /** Whether a file part arrived that was not empty. */
      sawFile: boolean
    }
  | { ok: false; send: (reply: FastifyReply) => FastifyReply }

async function parseAnnouncement(config: Config, request: FastifyRequest): Promise<Parsed> {
  let startsAt: number | null = null
  let stored: string | null = null
  let sawFile = false
  let kind: SessionKind = 'set'
  let title: string | null = null

  try {
    for await (const part of request.parts({
      limits: { fileSize: POSTER_MAX_BYTES, files: 1 },
    })) {
      if (part.type === 'field' && part.fieldname === 'startsAt') {
        const parsed = Number(part.value)
        if (Number.isFinite(parsed)) startsAt = Math.round(parsed)
        continue
      }
      // Anything that is not one of the two known kinds is a set. A poster
      // announcing the wrong sort of evening is a worse failure than a 400
      // would be inconvenient, but there is no third thing this could honestly
      // mean, and the only sender is a form with two buttons.
      if (part.type === 'field' && part.fieldname === 'kind') {
        kind = part.value === 'talk' ? 'talk' : 'set'
        continue
      }
      if (part.type === 'field' && part.fieldname === 'title') {
        title = typeof part.value === 'string' ? toTitle(part.value) : null
        continue
      }
      if (part.type !== 'file') continue
      sawFile = true

      // An empty file part is how a browser sends "no new poster" when the
      // input was left alone, so it is a no-op rather than a refusal.
      const head = await part.file.read(16)
      if (head === null) {
        await part.file.resume()
        sawFile = false
        continue
      }

      const declared = POSTER_TYPES[part.mimetype.toLowerCase()]
      const actual = sniff(Buffer.from(head))
      if (!actual || (declared && declared !== actual)) {
        await part.file.resume()
        return {
          ok: false,
          send: (reply) =>
            reply.code(415).send({
              error: 'unsupported_poster',
              message: 'a poster has to be a JPEG, a PNG or a WebP',
            }),
        }
      }

      stored = `${randomUUID()}.${actual}`
      part.file.unshift(head)
      await pipeline(part.file, createWriteStream(posterFilePath(config, stored)))
      if (part.file.truncated) {
        await discard(posterFilePath(config, stored))
        return {
          ok: false,
          send: (reply) =>
            reply.code(413).send({
              error: 'poster_too_large',
              message: `a poster has to be under ${Math.round(POSTER_MAX_BYTES / 1024 / 1024)} MB`,
            }),
        }
      }
    }
  } catch (err) {
    if (stored) await discard(posterFilePath(config, stored))
    throw err
  }

  if (startsAt === null) {
    if (stored) await discard(posterFilePath(config, stored))
    return {
      ok: false,
      send: (reply) =>
        reply.code(400).send({ error: 'no_time', message: 'a session needs a time to be announced for' }),
    }
  }

  return { ok: true, startsAt, kind, title, stored, sawFile }
}

/** An id from the address, or null for anything that is not a whole number. */
function toId(value: string): number | null {
  return /^\d+$/.test(value) ? Number(value) : null
}

const NOT_FOUND = { error: 'no_such_session', message: 'that session is not announced' }

export function scheduleRoutes({ config, schedule }: ScheduleDeps): FastifyPluginAsync {
  /**
   * The schedule as it goes over the wire, which is the same shape the socket
   * sends: the next session, and every announced one soonest first. Posters are
   * bare filenames, not URLs. Tracks carry `filename` and `artworkPath` the same
   * way and the client turns both into addresses, so a poster that arrived
   * pre-addressed would be the one thing in this API that did it the other way
   * round.
   */
  const body = () => ({ schedule: schedule.get(), upcoming: schedule.list() })

  /** Unlink the posters of nights that have passed. A missing file is fine. */
  const sweep = async () => {
    for (const poster of schedule.prune()) await discard(posterFilePath(config, poster))
  }

  return async function routes(app: FastifyInstance) {
    // Open, and so is the poster below it. See the note at the top.
    app.get('/api/schedule', async () => body())

    await app.register(fastifyStatic, {
      root: config.posterDir,
      prefix: '/api/poster/',
      decorateReply: false,
      // Named by a fresh id every time one is set, so a URL never changes
      // under a page that has already drawn it.
      cacheControl: true,
      maxAge: '365d',
      immutable: true,
      index: false,
      dotfiles: 'deny',
    })

    /**
     * Announce another session.
     *
     * Multipart because a poster comes with it, and one request rather than two
     * because a time with no picture and a picture with no time are both
     * half-announcements: an admin who uploaded and then failed to set the time
     * would have published a poster for nothing.
     *
     * The poster is optional on purpose. A time on its own is a real
     * announcement, and it is the one somebody can make from a phone at short
     * notice.
     */
    app.post('/api/schedule', { preHandler: requireAdmin(config) }, async (request, reply) => {
      const parsed = await parseAnnouncement(config, request)
      if (!parsed.ok) return parsed.send(reply)

      await sweep()
      const next: Announcement = {
        startsAt: parsed.startsAt,
        poster: parsed.stored,
        kind: parsed.kind,
        title: parsed.title,
      }
      schedule.add(next)
      return body()
    })

    /**
     * Change one announced session.
     *
     * Sending no file *keeps* whatever poster that night already has, so
     * changing the time by an hour does not mean finding the image again.
     *
     * `kind` and `title` are optional in the other direction: absent means a set
     * with no title, not "leave what is there". Only the poster is kept across
     * an edit, because only the poster costs something to send again. Two text
     * fields a form fills in every time do not, and a rule that quietly kept
     * them would make "clear the title" impossible to express.
     */
    app.put<{ Params: { id: string } }>(
      '/api/schedule/:id',
      { preHandler: requireAdmin(config) },
      async (request, reply) => {
        const id = toId(request.params.id)
        const existing = id === null ? null : schedule.find(id)
        // Read the body before answering either way, so a poster that came with
        // a request for a night that is not there is not left on the disk.
        const parsed = await parseAnnouncement(config, request)
        if (!parsed.ok) return parsed.send(reply)
        if (id === null || !existing) {
          if (parsed.stored) await discard(posterFilePath(config, parsed.stored))
          return reply.code(404).send(NOT_FOUND)
        }

        // A poster that was not re-sent is the one already up. `sawFile` tells
        // a request that left the file input alone apart from one that could
        // not be read, and only the first of those keeps what is there.
        const keeping = parsed.stored ?? (parsed.sawFile ? null : existing.poster)
        const displaced = schedule.update(id, {
          startsAt: parsed.startsAt,
          poster: keeping,
          kind: parsed.kind,
          title: parsed.title,
        })
        if (displaced?.poster) await discard(posterFilePath(config, displaced.poster))
        return body()
      },
    )

    /** Take one down. Its poster goes with it: it was only ever for that night. */
    app.delete<{ Params: { id: string } }>(
      '/api/schedule/:id',
      { preHandler: requireAdmin(config) },
      async (request, reply) => {
        const id = toId(request.params.id)
        const displaced = id === null ? null : schedule.remove(id)
        if (!displaced) return reply.code(404).send(NOT_FOUND)
        if (displaced.poster) await discard(posterFilePath(config, displaced.poster))
        return body()
      },
    )
  }
}
