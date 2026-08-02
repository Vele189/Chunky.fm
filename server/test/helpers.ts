import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import type { Config } from '../src/config.js'
import { type Db, openDb } from '../src/db.js'

export const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')
export const ADMIN_PASSWORD = 'hunter2-for-tests'

export interface Harness {
  app: FastifyInstance
  db: Db
  config: Config
  cleanup(): Promise<void>
}

export async function startHarness(overrides: Partial<Config> = {}): Promise<Harness> {
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
  const app = await buildApp({ config, db, logger: false })

  return {
    app,
    db,
    config,
    async cleanup() {
      await app.close()
      db.close()
      await fs.rm(storageDir, { recursive: true, force: true })
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
