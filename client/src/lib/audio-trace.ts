/**
 * A flight recorder for the audio elements.
 *
 * The sync readout shows the browser you are holding. A chopped record happens
 * on somebody else's phone, and nothing about it ever reaches the server: the
 * audio is plain range requests, so the station never learns that an element
 * stalled, seeked, or was paused by the OS. This records those moments with
 * enough context to explain them (where the needle was, where the station
 * said it should be, how much was buffered) and posts them to `/api/trace`,
 * where each one becomes a log line.
 *
 * Batched, capped and throttled on both ends, so a listener on a bad link
 * costs a handful of small requests a minute, not one per event.
 */

/** Must match the server's schema in `routes/trace.ts`. */
export interface TraceEvent {
  at: number
  server: number | null
  kind: string
  deck?: 'a' | 'b'
  src?: string | null
  track?: number | null
  pos?: number | null
  expected?: number | null
  diff?: number | null
  ready?: number
  net?: number
  ahead?: number | null
  rate?: number
  detail?: string
}

export interface TraceBatch {
  session: string
  nickname: string | null
  ua?: string
  dropped?: number
  events: TraceEvent[]
}

export interface AudioTraceOptions {
  send: (batch: TraceBatch, leaving: boolean) => void
  now?: () => number
  serverNow?: () => number | null
  nickname?: () => string | null
  ua?: string
  /** Mirror every event to the console, for testing on your own device. */
  echo?: boolean
  /** Flush once this many events are waiting. Server refuses more than 60. */
  batchSize?: number
  /** Most events held while sends are failing or throttled. */
  maxBuffered?: number
}

/** The element events worth a line. `timeupdate`, `progress` and `suspend` are noise. */
export const ELEMENT_EVENTS = [
  'loadstart',
  'loadedmetadata',
  'canplay',
  'playing',
  'waiting',
  'stalled',
  'seeking',
  'seeked',
  'pause',
  'ended',
  'emptied',
  'abort',
  'error',
] as const

const round = (value: number, places = 3) => {
  const scale = 10 ** places
  return Math.round(value * scale) / scale
}

/** Seconds buffered ahead of the needle, or null when the needle is outside every range. */
export function bufferedAhead(audio: Pick<HTMLMediaElement, 'buffered' | 'currentTime'>): number | null {
  const { buffered, currentTime } = audio
  for (let i = 0; i < buffered.length; i++) {
    if (buffered.start(i) <= currentTime + 0.01 && currentTime <= buffered.end(i)) {
      return round(buffered.end(i) - currentTime)
    }
  }
  return null
}

/** The filename, which is the content hash: enough to tell two records apart. */
export function srcName(audio: Pick<HTMLMediaElement, 'getAttribute'>): string | null {
  const src = audio.getAttribute('src')
  if (!src) return null
  return src.slice(src.lastIndexOf('/') + 1).slice(0, 120)
}

/** What the page knows about an element that the element does not. */
export interface ElementContext {
  track: number | null
  /** Where the station says this element's record should be, seconds. Null if unknown. */
  expected: number | null
}

export class AudioTrace {
  readonly session = Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
  readonly #send: AudioTraceOptions['send']
  readonly #now: () => number
  readonly #serverNow: () => number | null
  readonly #nickname: () => string | null
  readonly #echo: boolean
  readonly #batchSize: number
  readonly #maxBuffered: number
  #ua: string | undefined
  #buffer: TraceEvent[] = []
  #dropped = 0

  constructor({
    send,
    now = Date.now,
    serverNow = () => null,
    nickname = () => null,
    ua,
    echo = false,
    batchSize = 40,
    maxBuffered = 300,
  }: AudioTraceOptions) {
    this.#send = send
    this.#now = now
    this.#serverNow = serverNow
    this.#nickname = nickname
    this.#ua = ua
    this.#echo = echo
    this.#batchSize = batchSize
    this.#maxBuffered = maxBuffered
  }

  get pending(): number {
    return this.#buffer.length
  }

  record(kind: string, fields: Omit<TraceEvent, 'at' | 'server' | 'kind'> = {}): void {
    const server = this.#serverNow()
    const event: TraceEvent = {
      at: this.#now(),
      server: server === null ? null : Math.round(server),
      kind,
      ...fields,
    }
    if (this.#echo) console.debug('[audio]', kind, event)
    this.#buffer.push(event)
    if (this.#buffer.length > this.#maxBuffered) {
      this.#buffer.shift()
      this.#dropped++
    }
    if (this.#buffer.length >= this.#batchSize) this.flush()
  }

  /** A snapshot of an element plus what the page expects of it. */
  recordElement(kind: string, deck: 'a' | 'b', audio: HTMLMediaElement, context: ElementContext, detail?: string): void {
    const pos = Number.isFinite(audio.currentTime) ? round(audio.currentTime) : null
    const expected = context.expected === null ? null : round(context.expected)
    this.record(kind, {
      deck,
      src: srcName(audio),
      track: context.track,
      pos,
      expected,
      diff: pos !== null && expected !== null ? round(pos - expected) : null,
      ready: audio.readyState,
      net: audio.networkState,
      ahead: bufferedAhead(audio),
      rate: round(audio.playbackRate),
      ...(detail ? { detail: detail.slice(0, 200) } : {}),
    })
  }

  /** Listen to one element. Returns the unsubscribe. */
  watch(audio: HTMLMediaElement, deck: 'a' | 'b', context: () => ElementContext): () => void {
    const handlers = ELEMENT_EVENTS.map((name) => {
      const handler = () => {
        const detail =
          name === 'error' && audio.error ? `code ${audio.error.code} ${audio.error.message}` : undefined
        this.recordElement(name, deck, audio, context(), detail)
      }
      audio.addEventListener(name, handler)
      return [name, handler] as const
    })
    return () => {
      for (const [name, handler] of handlers) audio.removeEventListener(name, handler)
    }
  }

  flush(leaving = false): void {
    if (this.#buffer.length === 0 && this.#dropped === 0) return
    const events = this.#buffer.splice(0, this.#batchSize)
    const batch: TraceBatch = { session: this.session, nickname: this.#nickname(), events }
    if (this.#ua) {
      batch.ua = this.#ua
      // Once per page, not once per batch.
      this.#ua = undefined
    }
    if (this.#dropped > 0) {
      batch.dropped = this.#dropped
      this.#dropped = 0
    }
    this.#send(batch, leaving)
    // A page closing gets one beacon; anything past one batch is lost anyway.
    if (!leaving && this.#buffer.length >= this.#batchSize) this.flush()
  }
}

/** The real transport: fetch normally, a beacon when the page is going away. */
export function postTrace(batch: TraceBatch, leaving: boolean): void {
  const body = JSON.stringify(batch)
  if (leaving && typeof navigator.sendBeacon === 'function') {
    navigator.sendBeacon('/api/trace', new Blob([body], { type: 'application/json' }))
    return
  }
  void fetch('/api/trace', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    credentials: 'same-origin',
    keepalive: true,
  }).catch(() => undefined)
}

/** `?trace` in the URL, or `localStorage['chunky:trace'] = '1'`, mirrors events to the console. */
export function traceEchoRequested(): boolean {
  try {
    if (new URLSearchParams(window.location.search).has('trace')) return true
    return window.localStorage.getItem('chunky:trace') === '1'
  } catch {
    return false
  }
}
