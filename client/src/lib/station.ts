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
  /** How long to wait for a socket to open before giving up on it. */
  connectTimeoutMs?: number
}

const DEFAULT_BACKOFF_MS = [500, 1_000, 2_000, 5_000, 10_000]
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000
/** WebSocket.OPEN, spelled out so this file doesn't need the DOM global. */
const OPEN = 1

/**
 * A websocket that reconnects. Socket.IO does this for you, but at this scale
 * it is weight we don't need — PLAN.md budgets about thirty lines for it, and
 * this is those thirty lines.
 *
 * Timers are called as plain globals rather than stored on the instance:
 * holding a reference to `setTimeout` and invoking it as a method loses the
 * `window` receiver, and the browser throws "Illegal invocation". Node does
 * not care, so unit tests happily pass while reconnection is dead in every
 * real browser. Fake timers still work here because the global is resolved at
 * call time.
 */
export class StationConnection {
  readonly #url: string
  readonly #handlers: StationHandlers
  readonly #createSocket: (url: string) => WebSocket
  readonly #backoff: number[]
  readonly #connectTimeoutMs: number

  #socket: WebSocket | null = null
  #attempt = 0
  #retryTimer: ReturnType<typeof setTimeout> | null = null
  #connectTimer: ReturnType<typeof setTimeout> | null = null
  #stopped = false

  constructor({
    url,
    onMessage,
    onStatus,
    socketFactory = (target) => new WebSocket(target),
    reconnectDelaysMs = DEFAULT_BACKOFF_MS,
    connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
  }: StationOptions) {
    this.#url = url
    this.#handlers = { onMessage, onStatus }
    this.#createSocket = socketFactory
    this.#backoff = reconnectDelaysMs
    this.#connectTimeoutMs = connectTimeoutMs
  }

  connect(): void {
    if (this.#stopped) return
    this.#handlers.onStatus('connecting')

    const socket = this.#createSocket(this.#url)
    this.#socket = socket

    // A proxy in front of a dead backend can leave the upgrade hanging with
    // neither error nor close. Without this the retry loop stalls forever.
    this.#connectTimer = setTimeout(() => {
      if (this.#socket === socket && socket.readyState !== OPEN) {
        socket.close()
        this.#handleClose(socket)
      }
    }, this.#connectTimeoutMs)

    socket.onopen = () => {
      this.#clearConnectTimer()
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
    socket.onclose = () => this.#handleClose(socket)
  }

  #handleClose(socket: WebSocket): void {
    if (this.#socket !== socket) return // already superseded
    this.#clearConnectTimer()
    this.#socket = null
    socket.onclose = null
    if (this.#stopped) return
    this.#handlers.onStatus('offline')
    this.#scheduleReconnect()
  }

  #clearConnectTimer(): void {
    if (this.#connectTimer !== null) {
      clearTimeout(this.#connectTimer)
      this.#connectTimer = null
    }
  }

  #scheduleReconnect(): void {
    const delay = this.#backoff[Math.min(this.#attempt, this.#backoff.length - 1)]!
    this.#attempt += 1
    this.#retryTimer = setTimeout(() => this.connect(), delay)
  }

  send(message: ClientMessage): void {
    if (this.#socket?.readyState === OPEN) {
      this.#socket.send(JSON.stringify(message))
    }
  }

  close(): void {
    this.#stopped = true
    if (this.#retryTimer !== null) clearTimeout(this.#retryTimer)
    this.#clearConnectTimer()
    this.#socket?.close()
    this.#socket = null
  }
}
