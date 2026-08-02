import { timingSafeEqual } from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Config } from '../config.js'

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

function presentedPassword(request: FastifyRequest): string | null {
  const auth = request.headers.authorization
  if (auth?.startsWith('Bearer ')) return auth.slice('Bearer '.length)
  const header = request.headers['x-admin-password']
  if (typeof header === 'string') return header
  return null
}

/**
 * Shared-secret gate for the admin surface. The plan calls for a signed cookie
 * exchanged at /admin; until that exists, the raw password is accepted so the
 * upload endpoint is never reachable unauthenticated.
 */
export function requireAdmin(config: Config) {
  return async function adminGuard(request: FastifyRequest, reply: FastifyReply) {
    const presented = presentedPassword(request)
    if (presented === null || !constantTimeEquals(presented, config.adminPassword)) {
      return reply.code(401).send({ error: 'unauthorized' })
    }
  }
}
