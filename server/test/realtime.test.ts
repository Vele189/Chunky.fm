import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PlaybackState } from '../src/playback.js'
import type { PongMessage, ServerMessage } from '../src/protocol.js'
import { type Harness, fakeClock, makeTrack, startHarness } from './helpers.js'
import { TestClient, connectAll } from './ws-client.js'

let harness: Harness
let clock: ReturnType<typeof fakeClock>
const clients: TestClient[] = []

const track = makeTrack({ id: 1, title: 'Opening Number', durationMs: 200_000 })
const nextTrack = makeTrack({ id: 2, title: 'The Follow Up', durationMs: 180_000 })

async function connect(count = 1): Promise<TestClient[]> {
  const connected = await connectAll(harness.wsUrl, count)
  clients.push(...connected)
  return connected
}

beforeEach(async () => {
  clock = fakeClock()
  harness = await startHarness({}, { playback: new PlaybackState({ now: clock.now }), listen: true })
})

afterEach(async () => {
  await Promise.all(clients.map((client) => client.close()))
  clients.length = 0
  await harness.cleanup()
})

describe('websocket connect', () => {
  it('sends the current state to a client the moment it connects', async () => {
    harness.playback.play(track)

    const [client] = await connect()
    const state = await client!.nextState()

    expect(state.type).toBe('state')
    expect(state.track?.title).toBe('Opening Number')
    expect(state.pausedAt).toBeNull()
    expect(state.startedAt).toBe(clock.now())
  })

  it('tells a late joiner where the needle already is', async () => {
    harness.playback.play(track)
    clock.advance(134_000)

    const [client] = await connect()
    const state = await client!.nextState()

    // The client derives 2:14 from startedAt alone — no special mid-song path.
    expect(state.serverTime - state.startedAt).toBe(134_000)
  })

  it('sends an off-air state when nothing is loaded', async () => {
    const [client] = await connect()
    const state = await client!.nextState()

    expect(state.track).toBeNull()
    expect(state.pausedAt).toBeNull()
  })

  it('counts connected listeners', async () => {
    expect(harness.app.realtime.clientCount()).toBe(0)

    const [first] = await connect(3)
    await Promise.all(clients.map((client) => client.nextState()))
    expect(harness.app.realtime.clientCount()).toBe(3)

    await first!.close()
    await expect.poll(() => harness.app.realtime.clientCount()).toBe(2)
  })
})

describe('state broadcast', () => {
  it('reaches every connected client on a track change', async () => {
    const connected = await connect(3)
    await Promise.all(connected.map((client) => client.nextState()))

    harness.playback.play(track)

    const states = await Promise.all(connected.map((client) => client.nextState()))
    for (const state of states) {
      expect(state.track?.id).toBe(track.id)
      expect(state.startedAt).toBe(clock.now())
      expect(state.pausedAt).toBeNull()
    }
  })

  it('broadcasts pause, resume, seek and stop', async () => {
    const [a, b] = await connect(2)
    await Promise.all([a!.nextState(), b!.nextState()])

    harness.playback.play(track)
    clock.advance(20_000)
    harness.playback.pause()
    harness.playback.resume()
    harness.playback.seek(90_000)
    harness.playback.stop()

    for (const client of [a!, b!]) {
      expect((await client.nextState()).track?.id).toBe(track.id) // play
      expect((await client.nextState()).pausedAt).toBe(20_000) // pause
      expect((await client.nextState()).pausedAt).toBeNull() // resume
      expect((await client.nextState()).startedAt).toBe(clock.now() - 90_000) // seek
      expect((await client.nextState()).track).toBeNull() // stop
    }
  })

  it('broadcasts a switch between tracks', async () => {
    const [client] = await connect()
    await client!.nextState()

    harness.playback.play(track)
    expect((await client!.nextState()).track?.id).toBe(track.id)

    harness.playback.play(nextTrack)
    const state = await client!.nextState()
    expect(state.track?.id).toBe(nextTrack.id)
    expect(state.startedAt).toBe(clock.now())
  })

  it('does not broadcast when a command changes nothing', async () => {
    const [client] = await connect()
    await client!.nextState()

    harness.playback.pause() // nothing loaded
    harness.playback.resume()
    harness.playback.stop()

    await expect(client!.nextState(150)).rejects.toThrow(/timed out/)
  })

  it('stops sending to a client that has gone away', async () => {
    const [staying, leaving] = await connect(2)
    await Promise.all([staying!.nextState(), leaving!.nextState()])

    await leaving!.close()
    await expect.poll(() => harness.app.realtime.clientCount()).toBe(1)

    harness.playback.play(track)
    await staying!.nextState()

    expect(leaving!.seen.filter((m) => m.type === 'state')).toHaveLength(1)
  })
})

describe('clock handshake', () => {
  it('answers a ping with the server clock and the echoed probe', async () => {
    const [client] = await connect()
    await client!.nextState()

    clock.set(1_700_000_500_000)
    client!.send({ type: 'ping', t0: 42 })

    const pong = (await client!.waitFor((m) => m.type === 'pong')) as PongMessage
    expect(pong.t0).toBe(42)
    expect(pong.t1).toBe(1_700_000_500_000)
  })

  it('answers pings from the same clock that stamps startedAt', async () => {
    const [client] = await connect()
    await client!.nextState()

    harness.playback.play(track)
    const state = await client!.nextState()

    client!.send({ type: 'ping', t0: 1 })
    const pong = (await client!.waitFor((m) => m.type === 'pong')) as PongMessage

    // If these drifted apart, the offset a client measures would apply to a
    // different timebase than the one startedAt is expressed in.
    expect(pong.t1).toBe(state.serverTime)
  })

  it('keeps probes independent so the lowest-RTT sample is identifiable', async () => {
    const [client] = await connect()
    await client!.nextState()

    for (const t0 of [1, 2, 3]) client!.send({ type: 'ping', t0 })

    const pongs: ServerMessage[] = []
    for (let i = 0; i < 3; i++) pongs.push(await client!.waitFor((m) => m.type === 'pong'))

    expect((pongs as PongMessage[]).map((p) => p.t0).sort()).toEqual([1, 2, 3])
  })
})

describe('shutdown', () => {
  it('closes cleanly while listeners are still connected', async () => {
    const connected = await connect(3)
    await Promise.all(connected.map((client) => client.nextState()))

    // An upgraded socket keeps the HTTP server open — if this regresses, the
    // process only dies when the platform loses patience and kills it.
    await harness.app.close()

    const codes = await Promise.all(connected.map((client) => client.closed))
    expect(codes).toEqual([1001, 1001, 1001])
  })

  it('tolerates being closed twice', async () => {
    const [client] = await connect()
    await client!.nextState()

    await harness.app.realtime.close()
    await expect(harness.app.realtime.close()).resolves.toBeUndefined()
  })
})

describe('malformed input', () => {
  it('rejects junk without dropping the connection', async () => {
    const [client] = await connect()
    await client!.nextState()

    client!.send('this is not json')
    expect((await client!.waitFor((m) => m.type === 'error')).type).toBe('error')

    client!.send(JSON.stringify({ type: 'ping', t0: 'not a number' }))
    expect((await client!.waitFor((m) => m.type === 'error')).type).toBe('error')

    // Still live: a broadcast reaches it.
    harness.playback.play(track)
    expect((await client!.nextState()).track?.id).toBe(track.id)
  })

  it('ignores messages a listener has no business sending', async () => {
    const [client] = await connect()
    await client!.nextState()

    client!.send(JSON.stringify({ type: 'play', trackId: 99 }))

    expect((await client!.waitFor((m) => m.type === 'error')).type).toBe('error')
    expect(harness.playback.snapshot().track).toBeNull()
  })
})
