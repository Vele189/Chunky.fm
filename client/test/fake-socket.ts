import type { ClientMessage, ServerMessage } from '../src/lib/protocol.js'

/** Enough of a WebSocket for StationConnection, with the wires exposed. */
export class FakeSocket {
  static readonly opened: FakeSocket[] = []

  readyState = 0 // CONNECTING
  readonly sent: ClientMessage[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null

  constructor(readonly url: string) {
    FakeSocket.opened.push(this)
  }

  static reset(): void {
    FakeSocket.opened.length = 0
  }

  static get last(): FakeSocket {
    const socket = FakeSocket.opened.at(-1)
    if (!socket) throw new Error('no socket was created')
    return socket
  }

  open(): void {
    this.readyState = 1 // OPEN
    this.onopen?.()
  }

  deliver(message: ServerMessage | string): void {
    this.onmessage?.({ data: typeof message === 'string' ? message : JSON.stringify(message) })
  }

  send(raw: string): void {
    this.sent.push(JSON.parse(raw) as ClientMessage)
  }

  /** The connection dropping underneath us, as a flaky network would do. */
  drop(): void {
    this.readyState = 3 // CLOSED
    this.onclose?.()
  }

  close(): void {
    this.drop()
  }
}

export const fakeSocketFactory = (url: string) => new FakeSocket(url) as unknown as WebSocket
