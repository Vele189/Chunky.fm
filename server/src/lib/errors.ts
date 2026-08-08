import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { type ClientBundle, sendDocument } from '../routes/client.js'
import { isServerPath } from './doorway.js'

/**
 * One error shape for the whole API.
 *
 * Every refusal written by hand in this codebase answers `{error, message}`,
 * where `error` is a machine-readable code the client switches on; see
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

/**
 * @param appShell The built station document, when this process is also serving
 *   the client. Given one, an unknown path is answered with it rather than with
 *   a 404. The station is a single document that decides what to show from the
 *   fragment, so `/listen`, `/listen#chat` and anything else a listener types
 *   all have to arrive at the same place. Null under compose and in
 *   development, where nginx's `try_files` and Vite's SPA fallback do this.
 */
export function registerErrorHandlers(
  app: FastifyInstance,
  appShell: ClientBundle | null = null,
): void {
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

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    // An unknown path is the station, but only when there is a station
    // document to answer with, and only for the kind of request a browser
    // makes for a page. A mistyped API route (`/api/wishez`) must still be
    // told there is no such route, in the shape every other refusal uses:
    // handing it a page of HTML with a 200 on it would make a typo look like
    // a working endpoint returning nonsense.
    if (appShell !== null && (request.method === 'GET' || request.method === 'HEAD')) {
      const cut = request.url.indexOf('?')
      const path = cut === -1 ? request.url : request.url.slice(0, cut)
      if (!isServerPath(path)) {
        return sendDocument(reply, appShell.index)
      }
    }
    return reply.code(404).send(errorBody(404, `no route for ${request.method} ${request.url}`))
  })
}
