import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AddressInfo } from 'node:net'
import type { FastifyInstance } from 'fastify'
import { vi } from 'vitest'
import { buildApp } from '../src/app.js'
import type { ChatLog } from '../src/chat.js'
import type { Config } from '../src/config.js'
import { type Db, openDb } from '../src/db.js'
import type { Track } from '../src/lib/track.js'
import { PlaybackState } from '../src/playback.js'
import type { Station } from '../src/station.js'
import type { WishBook } from '../src/wishes.js'

export const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')
export const ADMIN_PASSWORD = 'hunter2-for-tests'

export interface Harness {
  app: FastifyInstance
  db: Db
  config: Config
  playback: PlaybackState
  station: Station
  chat: ChatLog
  wishes: WishBook
  /** Only set when the harness was started with `listen: true`. */
  wsUrl: string
  cleanup(): Promise<void>
}

export interface HarnessOptions {
  playback?: PlaybackState
  heartbeatIntervalMs?: number
  backstopIntervalMs?: number
  chatHistoryLimit?: number
  chatBurst?: number
  chatRefillMs?: number
  joinBurst?: number
  joinRefillMs?: number
  wishBurst?: number
  wishRefillMs?: number
  voteBurst?: number
  voteRefillMs?: number
  signInBurst?: number
  signInRefillMs?: number
  /** Bind a real port — required for anything that opens a websocket. */
  listen?: boolean
}

export async function startHarness(
  overrides: Partial<Config> = {},
  {
    playback = new PlaybackState(),
    heartbeatIntervalMs,
    backstopIntervalMs,
    chatHistoryLimit,
    chatBurst,
    chatRefillMs,
    joinBurst,
    joinRefillMs,
    wishBurst,
    wishRefillMs,
    voteBurst,
    voteRefillMs,
    signInBurst,
    signInRefillMs,
    listen = false,
  }: HarnessOptions = {},
): Promise<Harness> {
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chunky-test-'))
  const config: Config = {
    host: '127.0.0.1',
    port: 0,
    storageDir,
    audioDir: path.join(storageDir, 'audio'),
    artworkDir: path.join(storageDir, 'artwork'),
    tmpDir: path.join(storageDir, 'tmp'),
    dbPath: ':memory:',
    adminPassword: ADMIN_PASSWORD,
    maxUploadBytes: 10 * 1024 * 1024,
    // As deployed: something is always in front of this, and anything keyed on
    // the caller's address is only correct if it reads through it.
    trustProxy: true,
    ...overrides,
  }

  const db = openDb(config.dbPath)
  const app = await buildApp({
    config,
    db,
    logger: false,
    playback,
    heartbeatIntervalMs,
    backstopIntervalMs,
    chatHistoryLimit,
    chatBurst,
    chatRefillMs,
    joinBurst,
    joinRefillMs,
    wishBurst,
    wishRefillMs,
    voteBurst,
    voteRefillMs,
    signInBurst,
    signInRefillMs,
  })

  let wsUrl = ''
  if (listen) {
    await app.listen({ host: config.host, port: 0 })
    const { port } = app.server.address() as AddressInfo
    wsUrl = `ws://${config.host}:${port}/ws`
  }

  return {
    app,
    db,
    config,
    playback,
    station: app.station,
    chat: app.chat,
    wishes: app.wishes,
    wsUrl,
    async cleanup() {
      await app.close()
      db.close()
      await fs.rm(storageDir, { recursive: true, force: true })
    },
  }
}

/**
 * Sign in the way the browser does, and hand back the `Cookie` header it would
 * send from then on — `chunky_admin=<token>`, without the attributes, which is
 * all a request carries back.
 */
export async function signIn(harness: Harness, password = ADMIN_PASSWORD): Promise<string> {
  const res = await harness.app.inject({
    method: 'POST',
    url: '/api/admin/session',
    payload: { password },
  })
  if (res.statusCode !== 200) throw new Error(`sign-in failed: ${res.statusCode} ${res.body}`)
  return String(res.headers['set-cookie']).split(';')[0]!
}

/** The signed token out of a `Set-Cookie`, for asserting on it directly. */
export function tokenFrom(res: { headers: Record<string, unknown> }): string {
  return String(res.headers['set-cookie']).split(';')[0]!.split('=').slice(1).join('=')
}

let nextTrackId = 1

export function makeTrack(overrides: Partial<Track> = {}): Track {
  const id = overrides.id ?? nextTrackId++
  return {
    id,
    title: `Track ${id}`,
    artist: 'Test Artist',
    album: 'Test Album',
    durationMs: 240_000,
    filename: `${'a'.repeat(64)}.mp3`,
    artworkPath: null,
    contentHash: 'a'.repeat(64),
    gainDb: 0,
    uploadedAt: 1_700_000_000_000,
    ...overrides,
  }
}

/** A clock the test drives by hand, so nothing depends on wall time. */
export function fakeClock(start = 1_700_000_000_000) {
  let current = start
  return {
    now: () => current,
    advance(ms: number) {
      current += ms
    },
    set(value: number) {
      current = value
    },
  }
}

export type FakeClock = ReturnType<typeof fakeClock>

/**
 * Move the station clock and the timer wheel together.
 *
 * The two are independent — PlaybackState reads an injected clock, timers live
 * on vitest's fake wheel — so stepping only one produces states that cannot
 * happen in production. Stepping in slices keeps them close enough that a timer
 * firing mid-window still sees a sane clock; anything that ends exactly on a
 * slice boundary lands on the exact millisecond.
 */
export async function advanceAll(clock: FakeClock, ms: number, stepMs = 1_000): Promise<void> {
  for (let left = ms; left > 0; ) {
    const slice = Math.min(stepMs, left)
    clock.advance(slice)
    await vi.advanceTimersByTimeAsync(slice)
    left -= slice
  }
}

export interface MultipartPart {
  name: string
  filename?: string
  contentType?: string
  data: Buffer | string
}

export const BOUNDARY = '----chunkyfmtestboundary'

export function multipartBody(parts: MultipartPart[], boundary = BOUNDARY): Buffer {
  const chunks: Buffer[] = []
  for (const part of parts) {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"`
    if (part.filename !== undefined) head += `; filename="${part.filename}"`
    head += '\r\n'
    if (part.contentType !== undefined) head += `Content-Type: ${part.contentType}\r\n`
    head += '\r\n'
    chunks.push(Buffer.from(head), Buffer.from(part.data), Buffer.from('\r\n'))
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return Buffer.concat(chunks)
}

export function multipartHeaders(boundary = BOUNDARY): Record<string, string> {
  return { 'content-type': `multipart/form-data; boundary=${boundary}` }
}

export function fixture(name: string): Promise<Buffer> {
  return fs.readFile(path.join(FIXTURES, name))
}

export async function listDir(dir: string): Promise<string[]> {
  return (await fs.readdir(dir)).sort()
}
