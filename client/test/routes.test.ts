import { describe, expect, it } from 'vitest'
import { isAdminRoute } from '../src/lib/admin.js'
import {
  DEFAULT_ROUTE,
  hashFor,
  isConsole,
  needsJoin,
  routeFrom,
  routeInHash,
  STATION_PATH,
  stationUrl,
} from '../src/lib/routes.js'

const at = (hash: string, pathname = '/') => ({ pathname, hash })

describe('routeFrom', () => {
  it('lands on the deck for a bare address', () => {
    expect(routeFrom(at(''))).toBe('on-air')
    expect(routeFrom(at('#'))).toBe('on-air')
  })

  it('reads each view off the fragment', () => {
    expect(routeFrom(at('#sync'))).toBe('sync')
    expect(routeFrom(at('#queue'))).toBe('queue')
    expect(routeFrom(at('#chat'))).toBe('chat')
    expect(routeFrom(at('#wishes'))).toBe('wishes')
    expect(routeFrom(at('#history'))).toBe('history')
    expect(routeFrom(at('#admin'))).toBe('admin')
  })

  it('honours /admin as a path, as it always has', () => {
    expect(routeFrom(at('', '/admin'))).toBe('admin')
    // The path wins outright — an admin bookmarked with a stale fragment on it
    // is still the admin.
    expect(routeFrom(at('#chat', '/admin'))).toBe('admin')
  })

  it('falls back rather than rendering nothing for an address nobody knows', () => {
    expect(routeFrom(at('#nonsense'))).toBe(DEFAULT_ROUTE)
    expect(routeFrom(at('#/queue'))).toBe(DEFAULT_ROUTE)
  })

  /**
   * The console's address is load-bearing outside this file — the QA scripts,
   * the README and whatever bookmark is in use all say `#admin`. This is the
   * check that stops a rename from quietly breaking all three.
   */
  it('agrees with isAdminRoute about what the console is', () => {
    for (const location of [at('#admin'), at('', '/admin'), at('#chat'), at(''), at('#sync')]) {
      expect(isConsole(routeFrom(location))).toBe(isAdminRoute(location))
    }
  })
})

describe('hashFor', () => {
  it('leaves the landing address bare', () => {
    expect(hashFor('on-air')).toBe('')
  })

  it('round-trips every route', () => {
    for (const route of ['sync', 'queue', 'chat', 'wishes', 'history', 'admin'] as const) {
      expect(routeFrom(at(hashFor(route)))).toBe(route)
    }
  })
})

/**
 * The station is served one name in from the root, and the root is the landing
 * page. Two things depend on that, and neither is inside the app: the links the
 * landing page draws, and the fragments it has to forward on behalf of every
 * `/#admin` bookmark that now arrives at it.
 */
describe('stationUrl', () => {
  it('is the station itself for where you land', () => {
    expect(stationUrl()).toBe(STATION_PATH)
    expect(stationUrl('on-air')).toBe(STATION_PATH)
  })

  it('never points at the page in front of the station', () => {
    for (const route of ['on-air', 'sync', 'queue', 'chat', 'wishes', 'history', 'admin'] as const) {
      expect(stationUrl(route)).not.toBe('/')
      expect(stationUrl(route).startsWith(STATION_PATH)).toBe(true)
    }
  })

  it('round-trips: what it builds is read back as the route it was built for', () => {
    for (const route of ['sync', 'queue', 'chat', 'wishes', 'history', 'admin'] as const) {
      const [pathname = '', hash = ''] = stationUrl(route).split(/(?=#)/)
      expect(routeFrom({ pathname, hash })).toBe(route)
    }
  })
})

describe('routeInHash', () => {
  it('names the route a fragment is for', () => {
    expect(routeInHash('#admin')).toBe('admin')
    expect(routeInHash('#chat')).toBe('chat')
  })

  /**
   * The landing page forwards a fragment only when this says it is the
   * station's. `#clockwork` is the landing page's own anchor, and bouncing
   * somebody off the page for scrolling down it would be absurd.
   */
  it('is null for a fragment that is not the station’s', () => {
    expect(routeInHash('#clockwork')).toBe(null)
    expect(routeInHash('')).toBe(null)
    expect(routeInHash('#')).toBe(null)
    expect(routeInHash('#nonsense')).toBe(null)
  })
})

describe('needsJoin', () => {
  it('is false for the two routes that stand on their own', () => {
    expect(needsJoin('on-air')).toBe(false)
    expect(needsJoin('admin')).toBe(false)
  })

  it('is true for every view of what the station has said', () => {
    for (const route of ['sync', 'queue', 'chat', 'wishes', 'history'] as const) {
      expect(needsJoin(route)).toBe(true)
    }
  })
})
