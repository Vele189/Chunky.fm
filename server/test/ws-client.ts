import { WebSocket } from 'ws'
import type { ClientMessage, QueueMessage, ServerMessage, StateMessage } from '../src/protocol.js'

const DEFAULT_TIMEOUT_MS = 2_000

interface Waiter {
  predicate: (message: ServerMessage) => boolean
  resolve: (message: ServerMessage) => void
}

/**
 * A listener, for test purposes. Messages are queued rather than sampled, so a
 * frame that arrives before the assertion asks for it is still seen — the usual
 * source of flake in socket tests.
 */
export class TestClient {
  readonly #socket: WebSocket
  readonly #queue: ServerMessage[] = []
  readonly #waiters: Waiter[] = []
  readonly seen: ServerMessage[] = []
  /** Resolves with the close code once the connection ends. */
  readonly closed: Promise<number>

  private constructor(socket: WebSocket) {
    this.#socket = socket
    socket.on('message', (raw) => this.#receive(JSON.parse(raw.toString()) as ServerMessage))
    this.closed = new Promise((resolve) => socket.once('close', (code) => resolve(code)))
  }

  static connect(url: string): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url)
      const client = new TestClient(socket)
      socket.once('open', () => resolve(client))
      socket.once('error', reject)
    })
  }

  #receive(message: ServerMessage): void {
    this.seen.push(message)
    const index = this.#waiters.findIndex((waiter) => waiter.predicate(message))
    if (index === -1) {
      this.#queue.push(message)
      return
    }
    const [waiter] = this.#waiters.splice(index, 1)
    waiter!.resolve(message)
  }

  /** Consumes and returns the first matching message, waiting if need be. */
  waitFor(
    predicate: (message: ServerMessage) => boolean,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<ServerMessage> {
    const queued = this.#queue.findIndex(predicate)
    if (queued !== -1) return Promise.resolve(this.#queue.splice(queued, 1)[0]!)

    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out after ${timeoutMs}ms waiting for a message`)),
        timeoutMs,
      )
      this.#waiters.push({
        predicate,
        resolve: (message) => {
          clearTimeout(timer)
          resolve(message)
        },
      })
    })
  }

  async nextState(timeoutMs?: number): Promise<StateMessage> {
    return (await this.waitFor((m) => m.type === 'state', timeoutMs)) as StateMessage
  }

  async nextQueue(timeoutMs?: number): Promise<QueueMessage> {
    return (await this.waitFor((m) => m.type === 'queue', timeoutMs)) as QueueMessage
  }

  send(message: ClientMessage | string): void {
    this.#socket.send(typeof message === 'string' ? message : JSON.stringify(message))
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.#socket.readyState === WebSocket.CLOSED) return resolve()
      this.#socket.once('close', () => resolve())
      this.#socket.close()
    })
  }
}

export async function connectAll(url: string, count: number): Promise<TestClient[]> {
  return Promise.all(Array.from({ length: count }, () => TestClient.connect(url)))
}
