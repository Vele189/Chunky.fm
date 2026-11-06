import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import type { Config } from '../config.js'
import { requireListener } from '../lib/auth.js'
import { KeyedRateLimit } from '../lib/rate-limit.js'

interface TraceDeps {
  config: Config
  /** Batches per IP before the throttle bites. */
  burst?: number
  /** One batch back per this many ms. */
  refillMs?: number
}

export interface TraceEvent {
  /** Client clock, epoch ms. */
  at: number
  /** The client's best guess at the station clock, epoch ms. Null before sync. */
  server: number | null
  kind: string
  deck?: 'a' | 'b'
  /** Filename the element holds, which identifies the record. */
  src?: string | null
  /** The track the station says is on. */
  track?: number | null
  /** Element position, seconds. */
  pos?: number | null
  /** Where the station says this element should be, seconds. */
  expected?: number | null
  /** pos - expected, seconds. Negative means behind. */
  diff?: number | null
  ready?: number
  net?: number
  /** Seconds buffered ahead of the needle. */
  ahead?: number | null
  rate?: number
  detail?: string
}

interface TraceBody {
  session: string
  nickname?: string | null
  ua?: string
  dropped?: number
  events: TraceEvent[]
}

const MAX_EVENTS = 60

const nullableNumber = { type: ['number', 'null'] } as const

const BODY_SCHEMA = {
  type: 'object',
  required: ['session', 'events'],
  additionalProperties: false,
  properties: {
    session: { type: 'string', minLength: 1, maxLength: 40 },
    nickname: { type: ['string', 'null'], maxLength: 40 },
    ua: { type: 'string', maxLength: 300 },
    dropped: { type: 'integer', minimum: 0 },
    events: {
      type: 'array',
      maxItems: MAX_EVENTS,
      items: {
        type: 'object',
        required: ['at', 'kind'],
        additionalProperties: false,
        properties: {
          at: { type: 'number' },
          server: nullableNumber,
          kind: { type: 'string', minLength: 1, maxLength: 32 },
          deck: { type: 'string', enum: ['a', 'b'] },
          src: { type: ['string', 'null'], maxLength: 120 },
          track: { type: ['integer', 'null'] },
          pos: nullableNumber,
          expected: nullableNumber,
          diff: nullableNumber,
          ready: { type: 'integer' },
          net: { type: 'integer' },
          ahead: nullableNumber,
          rate: { type: 'number' },
          detail: { type: 'string', maxLength: 200 },
        },
      },
    },
  },
} as const

/**
 * Where listeners' audio elements report what happened to them.
 *
 * The sync readout shows one browser, the one you are holding. The chop people
 * hear happens on somebody else's phone, on their network, in their browser,
 * and nothing about it reaches the server: the audio is plain range requests
 * and the server never learns that an element stalled, seeked or was paused by
 * the OS. This is the one-way channel that tells it, so the story of a chopped
 * record can be read out of the same logs as the broadcast that caused it.
 *
 * Nothing is stored. Each event becomes one log line, `audio <kind>`, with the
 * page's session id on it so one listener's evening can be filtered out of the
 * room's. Listener-gated like the audio, and throttled per address, because a
 * route that writes logs is a route somebody could fill a disk with.
 */
export function traceRoutes({ config, burst = 10, refillMs = 2_000 }: TraceDeps): FastifyPluginAsync {
  const throttle = new KeyedRateLimit({ burst, refillMs })

  return async function routes(app: FastifyInstance) {
    app.post<{ Body: TraceBody }>(
      '/api/trace',
      {
        preHandler: requireListener(config),
        bodyLimit: 64 * 1024,
        schema: { body: BODY_SCHEMA },
      },
      async (request, reply) => {
        if (!throttle.take(request.ip)) return reply.code(429).send({ error: 'slow_down' })

        const { session, nickname = null, ua, dropped = 0, events } = request.body
        const log = request.log.child({ trace: session, nickname })
        if (ua) log.info({ ua }, 'audio client')
        if (dropped > 0) log.warn({ dropped }, 'audio trace dropped events')
        for (const event of events) log.info({ audio: event }, `audio ${event.kind}`)
        return reply.code(204).send()
      },
    )
  }
}
