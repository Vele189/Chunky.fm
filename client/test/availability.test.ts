import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type Availability,
  INITIALLY,
  canTuneIn,
  nextAvailability,
  outage,
  staleNotice,
  statusLabel,
} from '../src/lib/availability.js'
import { StationConnection, type StationStatus } from '../src/lib/station.js'
import { FakeSocket, fakeSocketFactory } from './fake-socket.js'

const ALL: Availability[] = ['live', 'reaching', 'unreachable', 'dropped']

/** What the page would be saying after this run of statuses. */
const after = (...statuses: StationStatus[]): Availability =>
  statuses.reduce(nextAvailability, INITIALLY)

describe('reading whether there is a station there', () => {
  it('starts out reaching, before anything has been tried', () => {
    expect(INITIALLY).toBe('reaching')
    expect(after('connecting')).toBe('reaching')
  })

  it('is live while the socket is open', () => {
    expect(after('connecting', 'connected')).toBe('live')
  })

  it('is unreachable once the first attempt fails', () => {
    expect(after('connecting', 'offline')).toBe('unreachable')
  })

  it('stays unreachable across the retries, rather than flickering', () => {
    // The whole reason this is a fold. A page loaded against a dead server
    // cycles connecting → offline → connecting forever as the backoff runs, and
    // reading each status on its own would alternate between "no signal" and
    // "tuning in…" once per retry while the truth — nothing has ever answered —
    // never changed.
    expect(after('connecting', 'offline', 'connecting')).toBe('unreachable')
    expect(after('connecting', 'offline', 'connecting', 'offline', 'connecting')).toBe(
      'unreachable',
    )
  })

  it('is dropped, not unreachable, once a socket has ever been open', () => {
    expect(after('connecting', 'connected', 'offline')).toBe('dropped')
  })

  it('stays dropped across the retries too', () => {
    expect(after('connecting', 'connected', 'offline', 'connecting', 'offline')).toBe('dropped')
  })

  it('comes back to live, and remembers it afterwards', () => {
    expect(after('connecting', 'connected', 'offline', 'connecting', 'connected')).toBe('live')
    // The outage after the recovery is still an outage of a station this page
    // has had, so it never reads as one it could not find.
    expect(
      after('connecting', 'connected', 'offline', 'connecting', 'connected', 'offline'),
    ).toBe('dropped')
  })

  it('treats a reconnect that skips straight to connecting as a drop', () => {
    // The connection reports `offline` before it retries, so this ordering does
    // not arise today. It costs one line to not depend on that.
    expect(after('connecting', 'connected', 'connecting')).toBe('dropped')
  })
})

describe('what the page says about it', () => {
  it('labels every state', () => {
    expect(ALL.map(statusLabel)).toEqual(['on air', 'tuning in…', 'no signal', 'reconnecting…'])
  })

  it('shows a screen only when there is something wrong', () => {
    expect(outage('live')).toBeNull()
    expect(outage('reaching')).toBeNull()
    expect(outage('unreachable')).not.toBeNull()
    expect(outage('dropped')).not.toBeNull()
  })

  it('distinguishes never having found it from having lost it', () => {
    expect(outage('unreachable')?.headline).not.toBe(outage('dropped')?.headline)
  })

  it('promises the page keeps trying, because it does', () => {
    // Nothing here offers a Retry button: the backoff is already running, and
    // saying so is what stops a room full of people reloading.
    for (const state of ['unreachable', 'dropped'] as const) {
      expect(outage(state)?.detail).toMatch(/keeps trying/)
    }
  })

  it('runs a stale line over a page that still has something on it', () => {
    expect(staleNotice('live')).toBeNull()
    expect(staleNotice('reaching')).toBeNull()
    expect(staleNotice('dropped')).toMatch(/before/)
    expect(staleNotice('unreachable')).not.toBeNull()
  })
})

describe('when tuning in is worth offering', () => {
  it('offers it while the station is there, or still being reached', () => {
    expect(canTuneIn('live')).toBe(true)
    // A first attempt is usually already succeeding, and a button that greys
    // out on every page load would be worse than the rare early click.
    expect(canTuneIn('reaching')).toBe(true)
  })

  it('holds it back when there is no station to hand it to', () => {
    // Not only because the join frame would go on the floor: browsers start
    // audio from inside a gesture and nowhere else, so a listener who spends
    // their click on an absent station gets silence when it comes back.
    expect(canTuneIn('unreachable')).toBe(false)
    expect(canTuneIn('dropped')).toBe(false)
  })
})

/* The same thing again, against the connection that actually produces these
 * statuses — so a change to the backoff cannot quietly stop matching what the
 * screen assumes about it. */
describe('against a real connection', () => {
  let reach: Availability
  let station: StationConnection

  const now = (): Availability => reach

  beforeEach(() => {
    vi.useFakeTimers()
    FakeSocket.reset()
    reach = INITIALLY
    station = new StationConnection({
      url: 'ws://station/ws',
      socketFactory: fakeSocketFactory,
      reconnectDelaysMs: [100, 200],
      onMessage: () => undefined,
      onStatus: (status) => {
        reach = nextAvailability(reach, status)
      },
    })
  })

  afterEach(() => {
    station.close()
    vi.useRealTimers()
  })

  it('says no signal for a page that never reaches the station', () => {
    station.connect()
    expect(now()).toBe('reaching')

    FakeSocket.last.drop()
    expect(now()).toBe('unreachable')

    // Two more failed attempts: the screen must not change under the listener
    // just because the backoff opened another socket.
    vi.advanceTimersByTime(100)
    expect(now()).toBe('unreachable')
    FakeSocket.last.drop()
    vi.advanceTimersByTime(200)
    expect(now()).toBe('unreachable')
  })

  it('says reconnecting for a page that had the station and lost it', () => {
    station.connect()
    FakeSocket.last.open()
    expect(now()).toBe('live')

    FakeSocket.last.drop()
    expect(now()).toBe('dropped')

    vi.advanceTimersByTime(100) // retrying, still the same story
    expect(now()).toBe('dropped')

    FakeSocket.last.open()
    expect(now()).toBe('live')
  })

  it('never goes back to no signal after an outage', () => {
    station.connect()
    FakeSocket.last.open()
    FakeSocket.last.drop()

    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(200)
      expect(now()).toBe('dropped')
      FakeSocket.last.drop()
    }
  })
})
