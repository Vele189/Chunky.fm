import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AddressInfo } from 'node:net'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import type { Config } from '../src/config.js'
import { type Db, openDb } from '../src/db.js'
import type { Track } from '../src/lib/track.js'
import { PlaybackState } from '../src/playback.js'

export const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')
export const ADMIN_PASSWORD = 'hunter2-for-tests'

export interface Harness {
  app: FastifyInstance
  db: Db
  config: Config
  playback: PlaybackState
  /** Only set when the harness was started with `listen: true`. */
  wsUrl: string
  cleanup(): Promise<void>
}

export interface HarnessOptions {
  playback?: PlaybackState
  heartbeatIntervalMs?: number
  /** Bind a real port — required for anything that opens a websocket. */
  listen?: boolean
}

export async function startHarness(
  overrides: Partial<Config> = {},
  { playback = new PlaybackState(), heartbeatIntervalMs, listen = false }: HarnessOptions = {},
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
    ...overrides,
  }

  const db = openDb(config.dbPath)
  const app = await buildApp({ config, db, logger: false, playback, heartbeatIntervalMs })

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
    wsUrl,
    async cleanup() {
      await app.close()
      db.close()
      await fs.rm(storageDir, { recursive: true, force: true })
    },
  }
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
