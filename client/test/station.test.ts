import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerMessage } from '../src/lib/protocol.js'
import { StationConnection, type StationStatus } from '../src/lib/station.js'
import { FakeSocket, fakeSocketFactory } from './fake-socket.js'

let messages: ServerMessage[]
let statuses: StationStatus[]
let station: StationConnection

function build(): StationConnection {
  return new StationConnection({
    url: 'ws://station/ws',
    socketFactory: fakeSocketFactory,
    reconnectDelaysMs: [100, 200, 400],
    onMessage: (message) => messages.push(message),
    onStatus: (status) => statuses.push(status),
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeSocket.reset()
  messages = []
  statuses = []
  station = build()
})

afterEach(() => {
  station.close()
  vi.useRealTimers()
})

describe('StationConnection', () => {
  it('reports connecting then connected', () => {
    station.connect()
    expect(statuses).toEqual(['connecting'])

    FakeSocket.last.open()
    expect(statuses).toEqual(['connecting', 'connected'])
  })

  it('passes server messages through', () => {
    station.connect()
    FakeSocket.last.open()
    FakeSocket.last.deliver({ type: 'pong', t0: 1, t1: 2 })

    expect(messages).toEqual([{ type: 'pong', t0: 1, t1: 2 }])
  })

  it('survives a frame it cannot parse', () => {
    station.connect()
    FakeSocket.last.open()

    expect(() => FakeSocket.last.deliver('not json')).not.toThrow()
    expect(messages).toEqual([])
  })

  it('reconnects after the connection drops', () => {
    station.connect()
    FakeSocket.last.open()
    expect(FakeSocket.opened).toHaveLength(1)

    FakeSocket.last.drop()
    expect(statuses.at(-1)).toBe('offline')

    vi.advanceTimersByTime(100)
    expect(FakeSocket.opened).toHaveLength(2)
    expect(statuses.at(-1)).toBe('connecting')
  })

  it('backs off further with each failed attempt', () => {
    station.connect()
    FakeSocket.last.drop()

    vi.advanceTimersByTime(100)
    expect(FakeSocket.opened).toHaveLength(2)

    FakeSocket.last.drop()
    vi.advanceTimersByTime(199)
    expect(FakeSocket.opened).toHaveLength(2) // 200ms delay, not yet
    vi.advanceTimersByTime(1)
    expect(FakeSocket.opened).toHaveLength(3)
  })

  it('holds at the longest delay rather than growing forever', () => {
    station.connect()
    for (let i = 0; i < 6; i++) {
      FakeSocket.last.drop()
      vi.advanceTimersByTime(400)
    }

    const before = FakeSocket.opened.length
    FakeSocket.last.drop()
    vi.advanceTimersByTime(400)
    expect(FakeSocket.opened).toHaveLength(before + 1)
  })

  it('resets the backoff once a connection succeeds', () => {
    station.connect()
    FakeSocket.last.drop()
    vi.advanceTimersByTime(100)
    FakeSocket.last.drop()
    vi.advanceTimersByTime(200)

    FakeSocket.last.open() // back on air

    const count = FakeSocket.opened.length
    FakeSocket.last.drop()
    vi.advanceTimersByTime(100) // first delay again, not the third
    expect(FakeSocket.opened).toHaveLength(count + 1)
  })

  it('stops reconnecting once closed', () => {
    station.connect()
    FakeSocket.last.open()
    station.close()

    vi.advanceTimersByTime(10_000)
    expect(FakeSocket.opened).toHaveLength(1)
  })

  it('gives up on a socket that never opens', () => {
    // A proxy in front of a dead backend can hold the upgrade open with
    // neither error nor close. Without a timeout the retry loop stalls here
    // and the listener never comes back.
    const timedOut = new StationConnection({
      url: 'ws://station/ws',
      socketFactory: fakeSocketFactory,
      reconnectDelaysMs: [100],
      connectTimeoutMs: 3_000,
      onMessage: (message) => messages.push(message),
      onStatus: (status) => statuses.push(status),
    })
    timedOut.connect()
    expect(FakeSocket.opened).toHaveLength(1)

    vi.advanceTimersByTime(3_000) // connect timeout fires
    expect(statuses.at(-1)).toBe('offline')

    vi.advanceTimersByTime(100) // backoff elapses
    expect(FakeSocket.opened).toHaveLength(2)

    timedOut.close()
  })

  it('does not double-handle a socket that closes after timing out', () => {
    const timedOut = new StationConnection({
      url: 'ws://station/ws',
      socketFactory: fakeSocketFactory,
      reconnectDelaysMs: [100],
      connectTimeoutMs: 3_000,
      onMessage: (message) => messages.push(message),
      onStatus: (status) => statuses.push(status),
    })
    timedOut.connect()
    const stale = FakeSocket.last

    vi.advanceTimersByTime(3_000) // connect timeout
    vi.advanceTimersByTime(100) // backoff, second socket opens
    const afterRetry = FakeSocket.opened.length
    expect(afterRetry).toBe(2)

    stale.drop() // the abandoned socket finally reports closed
    // Well inside the new socket's own connect timeout, so any additional
    // socket here could only have come from the superseded one.
    vi.advanceTimersByTime(200)

    expect(FakeSocket.opened).toHaveLength(afterRetry)
    timedOut.close()
  })

  it('only sends on an open socket', () => {
    station.connect()
    station.send({ type: 'ping', t0: 1 }) // still connecting
    expect(FakeSocket.last.sent).toEqual([])

    FakeSocket.last.open()
    station.send({ type: 'ping', t0: 2 })
    expect(FakeSocket.last.sent).toEqual([{ type: 'ping', t0: 2 }])
  })
})
