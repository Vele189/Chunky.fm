import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

/**
 * One error shape for the whole API.
 *
 * Every refusal written by hand in this codebase answers `{error, message}`,
 * where `error` is a machine-readable code the client switches on — see
 * `AdminError.code` on the other side. Fastify's own refusals do not: a schema
 * rejection or an unparseable body comes back as `{statusCode, error: "Bad
 * Request", message}`, where `error` is prose about the *status*, not a code
 * for the failure. A client cannot tell the two apart, so half the API's
 * errors were unusable programmatically.
 *
 * These handlers put the framework's failures into the same shape as ours.
 */

/** Status → code. Deliberately coarse: the detail belongs in `message`. */
const CODES: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  405: 'method_not_allowed',
  406: 'not_acceptable',
  409: 'conflict',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  429: 'too_many_requests',
}

export interface ErrorBody {
  error: string
  message: string
}

export function errorBody(statusCode: number, message: string): ErrorBody {
  const fallback = statusCode >= 500 ? 'internal_error' : 'request_failed'
  return { error: CODES[statusCode] ?? fallback, message }
}

export function registerErrorHandlers(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const status = err.statusCode ?? 500

    if (status >= 500) {
      // The only case where the message is not safe to repeat: it can carry a
      // server-side path, a SQL fragment, or a stack. Log it, answer plainly.
      request.log.error({ err }, 'unhandled error')
      return reply
        .code(status)
        .send(errorBody(status, 'the station could not complete that request'))
    }

    // A validation message ("body must have required property 'action'") is
    // written for whoever is holding the API wrong, and says nothing private.
    return reply.code(status).send(errorBody(status, err.message))
  })

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) =>
    reply.code(404).send(errorBody(404, `no route for ${request.method} ${request.url}`)),
  )
}
