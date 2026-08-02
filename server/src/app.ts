import multipart from '@fastify/multipart'
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify'
import type { Config } from './config.js'
import type { Db } from './db.js'
import { ensureStorageDirs } from './lib/storage.js'
import { uploadRoutes } from './routes/upload.js'

export interface BuildAppOptions {
  config: Config
  db: Db
  logger?: FastifyServerOptions['logger']
}

export async function buildApp({ config, db, logger }: BuildAppOptions): Promise<FastifyInstance> {
  await ensureStorageDirs(config)

  const app = Fastify({ logger: logger ?? true, bodyLimit: 1024 * 1024 })

  await app.register(multipart, {
    limits: {
      fileSize: config.maxUploadBytes,
      files: 1,
      fields: 8,
    },
  })

  app.get('/health', async () => ({ ok: true }))

  await app.register(uploadRoutes({ config, db }))

  return app
}
