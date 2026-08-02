import type { ClientMessage, ServerMessage } from './protocol.js'

export type StationStatus = 'connecting' | 'connected' | 'offline'

export interface StationHandlers {
  onMessage(message: ServerMessage): void
  onStatus(status: StationStatus): void
}

export interface StationOptions extends StationHandlers {
  url: string
  /** Injected in tests; the browser supplies the real one. */
  socketFactory?: (url: string) => WebSocket
  reconnectDelaysMs?: number[]
  setTimeoutFn?: typeof setTimeout
  clearTimeoutFn?: typeof clearTimeout
}

const DEFAULT_BACKOFF_MS = [500, 1_000, 2_000, 5_000, 10_000]
/** WebSocket.OPEN, spelled out so this file doesn't need the DOM global. */
const OPEN = 1

/**
 * A websocket that reconnects. Socket.IO does this for you, but at this scale
 * it is weight we don't need — PLAN.md budgets about thirty lines for it, and
 * this is those thirty lines.
 */
export class StationConnection {
  readonly #url: string
  readonly #handlers: StationHandlers
  readonly #createSocket: (url: string) => WebSocket
  readonly #backoff: number[]
  readonly #setTimeout: typeof setTimeout
  readonly #clearTimeout: typeof clearTimeout

  #socket: WebSocket | null = null
  #attempt = 0
  #retryTimer: ReturnType<typeof setTimeout> | null = null
  #stopped = false

  constructor({
    url,
    onMessage,
    onStatus,
    socketFactory = (target) => new WebSocket(target),
    reconnectDelaysMs = DEFAULT_BACKOFF_MS,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  }: StationOptions) {
    this.#url = url
    this.#handlers = { onMessage, onStatus }
    this.#createSocket = socketFactory
    this.#backoff = reconnectDelaysMs
    this.#setTimeout = setTimeoutFn
    this.#clearTimeout = clearTimeoutFn
  }

  connect(): void {
    if (this.#stopped) return
    this.#handlers.onStatus('connecting')

    const socket = this.#createSocket(this.#url)
    this.#socket = socket

    socket.onopen = () => {
      this.#attempt = 0
      this.#handlers.onStatus('connected')
    }
    socket.onmessage = (event: MessageEvent) => {
      try {
        this.#handlers.onMessage(JSON.parse(String(event.data)) as ServerMessage)
      } catch {
        // A frame we can't parse is the server's problem, not a reason to drop.
      }
    }
    socket.onerror = () => socket.close()
    socket.onclose = () => {
      this.#socket = null
      if (this.#stopped) return
      this.#handlers.onStatus('offline')
      this.#scheduleReconnect()
    }
  }

  #scheduleReconnect(): void {
    const delay = this.#backoff[Math.min(this.#attempt, this.#backoff.length - 1)]!
    this.#attempt += 1
    this.#retryTimer = this.#setTimeout(() => this.connect(), delay)
  }

  send(message: ClientMessage): void {
    if (this.#socket?.readyState === OPEN) {
      this.#socket.send(JSON.stringify(message))
    }
  }

  close(): void {
    this.#stopped = true
    if (this.#retryTimer !== null) this.#clearTimeout(this.#retryTimer)
    this.#socket?.close()
    this.#socket = null
  }
}
