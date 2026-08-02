import path from 'node:path'

export interface Config {
  host: string
  port: number
  /** Railway volume mount. Audio, artwork and the SQLite file all live here. */
  storageDir: string
  audioDir: string
  artworkDir: string
  /** Uploads land here first and are only moved once they parse as audio. */
  tmpDir: string
  dbPath: string
  adminPassword: string
  maxUploadBytes: number
}

const DEFAULT_MAX_UPLOAD_BYTES = 150 * 1024 * 1024

function intFromEnv(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got ${JSON.stringify(value)}`)
  }
  return parsed
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const adminPassword = env.ADMIN_PASSWORD
  if (!adminPassword) {
    throw new Error('ADMIN_PASSWORD is not set — refusing to start with an unguarded admin surface')
  }

  const storageDir = path.resolve(env.AUDIO_STORAGE_DIR ?? 'audio_storage')

  return {
    host: env.HOST ?? '0.0.0.0',
    port: intFromEnv(env.PORT, 3000, 'PORT'),
    storageDir,
    audioDir: path.join(storageDir, 'audio'),
    artworkDir: path.join(storageDir, 'artwork'),
    tmpDir: path.join(storageDir, 'tmp'),
    dbPath: env.DB_PATH ? path.resolve(env.DB_PATH) : path.join(storageDir, 'chunky.sqlite'),
    adminPassword,
    maxUploadBytes: intFromEnv(env.MAX_UPLOAD_BYTES, DEFAULT_MAX_UPLOAD_BYTES, 'MAX_UPLOAD_BYTES'),
  }
}
