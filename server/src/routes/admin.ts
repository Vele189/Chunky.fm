import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import type { Config } from '../config.js'
import { requireAdmin } from '../lib/auth.js'

interface AdminDeps {
  config: Config
}

/**
 * Somewhere for the admin UI to check a password before it shows any controls.
 *
 * Every other admin route does something — there is no harmless one to probe
 * with — so a login flow needs a route whose only job is to answer "is this
 * password right?". PLAN.md's signed cookie exchanged at /admin replaces this
 * (task #1452); until then the client holds the shared secret and presents it
 * on every request, and this is where it finds out whether it is worth doing.
 */
export function adminRoutes({ config }: AdminDeps): FastifyPluginAsync {
  return async function routes(app: FastifyInstance) {
    app.get('/api/admin/session', { preHandler: requireAdmin(config) }, async () => ({ ok: true }))
  }
}
