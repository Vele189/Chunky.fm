/**
 * The client's half of presence, at the wire.
 *
 * `usePresence` is three lines around `connection.send`, and what can actually
 * go wrong lives underneath it: the shape of the frame, and the fact that a
 * send on a socket that has not finished opening is thrown away in silence,
 * which is a listener nobody else can see, with nothing to retry it. That is
 * why the hook waits for `connected` rather than for a connection, and this is
 * what makes the trap visible.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PresenceMessage, ServerMessage } from '../src/lib/protocol.js'
import { StationConnection } from '../src/lib/station.js'
import { FakeSocket, fakeSocketFactory } from './fake-socket.js'

let messages: ServerMessage[]
let station: StationConnection

const roster = (...nicknames: string[]): PresenceMessage => ({
  type: 'presence',
  listeners: nicknames.map((nickname, index) => ({ id: index + 1, nickname })),
  // Unpadded, which is the station nobody has added heads to. The padding is
  // the admin panel's business; what matters here is the frame's shape.
  padding: 0,
})

beforeEach(() => {
  vi.useFakeTimers()
  FakeSocket.reset()
  messages = []
  station = new StationConnection({
    url: 'ws://station/ws',
    socketFactory: fakeSocketFactory,
    reconnectDelaysMs: [100],
    onMessage: (message) => messages.push(message),
    onStatus: () => undefined,
  })
})

afterEach(() => {
  station.close()
  vi.useRealTimers()
})

describe('presence over the socket', () => {
  it('sends the nickname as a join frame', () => {
    station.connect()
    FakeSocket.last.open()

    station.send({ type: 'join', nickname: 'sam' })

    expect(FakeSocket.last.sent).toEqual([{ type: 'join', nickname: 'sam' }])
  })

  it('drops a join sent before the socket is open', () => {
    station.connect()

    station.send({ type: 'join', nickname: 'too early' })

    // Silently, which is exactly why usePresence gates on `connected`.
    expect(FakeSocket.last.sent).toEqual([])
  })

  it('has a fresh socket to rejoin on after a reconnect', () => {
    station.connect()
    FakeSocket.last.open()
    station.send({ type: 'join', nickname: 'sam' })

    FakeSocket.last.drop()
    vi.advanceTimersByTime(100)
    FakeSocket.last.open()

    // The new socket carries none of the old one's state: the server knows
    // nothing about this listener until the hook says the name again.
    expect(FakeSocket.last.sent).toEqual([])
    station.send({ type: 'join', nickname: 'sam' })
    expect(FakeSocket.last.sent).toEqual([{ type: 'join', nickname: 'sam' }])
  })

  it('passes the roster through as it arrives', () => {
    station.connect()
    FakeSocket.last.open()

    FakeSocket.last.deliver(roster())
    FakeSocket.last.deliver(roster('sam'))
    FakeSocket.last.deliver(roster('sam', 'ana'))

    expect(messages).toEqual([roster(), roster('sam'), roster('sam', 'ana')])
    // Whole rosters, not joins and leaves; nothing here has to reconcile.
    expect((messages.at(-1) as PresenceMessage).listeners.map((l) => l.nickname)).toEqual([
      'sam',
      'ana',
    ])
  })
})
