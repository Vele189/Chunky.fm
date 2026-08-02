import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { openDb } from './db.js'

const config = loadConfig()
const db = openDb(config.dbPath)
const app = await buildApp({ config, db })

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down')
    void app.close().then(() => {
      db.close()
      process.exit(0)
    })
  })
}

try {
  await app.listen({ host: config.host, port: config.port })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
