import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MESSAGE_MAX_LENGTH } from '../src/chat.js'
import { PlaybackState } from '../src/playback.js'
import type { ErrorMessage, PongMessage, ServerMessage } from '../src/protocol.js'
import { type Harness, fakeClock, makeTrack, signIn, startHarness } from './helpers.js'
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

/** A socket that carries what a browser would on the upgrade — cookies. */
async function connectWith(headers: Record<string, string>): Promise<TestClient> {
  const client = await TestClient.connect(harness.wsUrl, headers)
  clients.push(client)
  return client
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

describe('queue broadcast', () => {
  it('sends the queue on connect', async () => {
    harness.station.enqueue(track) // idle station — starts playing, nothing queued
    harness.station.enqueue(nextTrack)

    const [client] = await connect()

    expect((await client!.nextQueue()).entries.map((e) => e.track.id)).toEqual([nextTrack.id])
  })

  it('reaches every client when the queue changes', async () => {
    const connected = await connect(2)
    await Promise.all(connected.map((client) => client.nextQueue()))

    const entry = harness.station.queue.add(nextTrack)

    for (const client of connected) {
      expect((await client.nextQueue()).entries.map((e) => e.track.id)).toEqual([nextTrack.id])
    }

    harness.station.queue.remove(entry.id)

    for (const client of connected) {
      expect((await client.nextQueue()).entries).toEqual([])
    }
  })

  it('tells listeners the queue shrank when a track is pulled off it', async () => {
    harness.station.enqueue(track)
    harness.station.enqueue(nextTrack)

    const [client] = await connect()
    await Promise.all([client!.nextState(), client!.nextQueue()])

    harness.station.advance()

    expect((await client!.nextState()).track?.id).toBe(nextTrack.id)
    expect((await client!.nextQueue()).entries).toEqual([])
  })
})

/**
 * The acceptance test for presence, at the socket: several listeners come and
 * go, and everyone still connected is told who is in the room each time.
 */
describe('presence', () => {
  /** A listener at the point where it has read everything sent on connect. */
  async function arrive(): Promise<TestClient> {
    const [client] = await connect()
    await Promise.all([client!.nextState(), client!.nextQueue(), client!.nextPresence()])
    return client!
  }

  it('sends the roster on connect, before anyone has named themselves', async () => {
    const [client] = await connect()

    expect((await client!.nextPresence()).listeners).toEqual([])
    expect(harness.app.realtime.listeners()).toEqual([])
  })

  it('puts a listener on the roster when they say who they are', async () => {
    const client = await arrive()

    const roster = await client.join('sam')

    expect(roster.listeners.map((l) => l.nickname)).toEqual(['sam'])
    expect(harness.app.realtime.listeners().map((l) => l.nickname)).toEqual(['sam'])
  })

  it('tells everyone already listening about a listener who joins', async () => {
    const first = await arrive()
    await first.join('first')

    const [second] = await connect()
    // What the newcomer is handed on connect already has the room in it.
    expect((await second!.nextPresence()).listeners.map((l) => l.nickname)).toEqual(['first'])

    second!.send({ type: 'join', nickname: 'second' })

    for (const client of [first, second!]) {
      expect((await client.nextPresence()).listeners.map((l) => l.nickname)).toEqual([
        'first',
        'second',
      ])
    }
  })

  it('tells everyone still listening about one who leaves', async () => {
    const staying = await arrive()
    const leaving = await arrive()
    await staying.join('staying')
    await leaving.nextPresence()
    await leaving.join('leaving')
    await staying.nextPresence()

    await leaving.close()

    expect((await staying.nextPresence()).listeners.map((l) => l.nickname)).toEqual(['staying'])
    await expect.poll(() => harness.app.realtime.listeners()).toHaveLength(1)
  })

  it('keeps the roster right through several arrivals and departures', async () => {
    const [a, b, c] = await Promise.all([arrive(), arrive(), arrive()])
    const names = async (client: TestClient) =>
      (await client.nextPresence()).listeners.map((l) => l.nickname)

    // One at a time, so what each listener sees is the roster as it was after
    // that join and not a race between three sockets.
    for (const [client, nickname, expected] of [
      [a!, 'ana', ['ana']],
      [b!, 'ben', ['ana', 'ben']],
      [c!, 'cleo', ['ana', 'ben', 'cleo']],
    ] as const) {
      client.send({ type: 'join', nickname })
      for (const watcher of [a!, b!, c!]) expect(await names(watcher)).toEqual(expected)
    }

    await b!.close()
    expect(await names(a!)).toEqual(['ana', 'cleo'])
    expect(await names(c!)).toEqual(['ana', 'cleo'])

    await a!.close()
    expect(await names(c!)).toEqual(['cleo'])
    await expect.poll(() => harness.app.realtime.listeners().map((l) => l.nickname)).toEqual([
      'cleo',
    ])
  })

  it('keeps two listeners of the same name apart', async () => {
    const first = await arrive()
    const second = await arrive()

    first.send({ type: 'join', nickname: 'sam' })
    await second.nextPresence()
    second.send({ type: 'join', nickname: 'sam' })

    const roster = await second.nextPresence()
    expect(roster.listeners.map((l) => l.nickname)).toEqual(['sam', 'sam'])
    // Distinct ids, so a list keyed on them shows two rows and drops neither.
    expect(new Set(roster.listeners.map((l) => l.id)).size).toBe(2)
  })

  it('lets a listener rename themselves without leaving and coming back', async () => {
    const client = await arrive()
    const joined = await client.join('sam')
    const id = joined.listeners[0]!.id

    const renamed = await client.join('samantha')

    // Same row, new name — not a departure followed by an arrival.
    expect(renamed.listeners).toEqual([{ id, nickname: 'samantha' }])
  })

  it('says nothing when a listener re-sends the name they already have', async () => {
    const client = await arrive()
    await client.join('sam')

    client.send({ type: 'join', nickname: 'sam' })

    await expect(client.nextPresence(150)).rejects.toThrow(/timed out/)
  })

  it('refuses a nickname that is not one, and leaves the roster alone', async () => {
    const client = await arrive()
    await client.join('sam')

    client.send({ type: 'join', nickname: '   ' })

    expect((await client.waitFor((m) => m.type === 'error')).type).toBe('error')
    expect(harness.app.realtime.listeners().map((l) => l.nickname)).toEqual(['sam'])
  })

  it('does not count a connected socket that never named itself', async () => {
    const lurker = await arrive()
    const listener = await arrive()
    await listener.join('sam')

    expect(harness.app.realtime.clientCount()).toBe(2)
    expect(harness.app.realtime.listeners()).toHaveLength(1)

    // And a socket that leaves without ever joining is not an event.
    await lurker.close()
    await expect.poll(() => harness.app.realtime.clientCount()).toBe(1)
    await expect(listener.nextPresence(150)).rejects.toThrow(/timed out/)
  })

  it('drops a listener whose network vanished, once the heartbeat notices', async () => {
    const gone = await arrive()
    await gone.join('gone')

    // The heartbeat terminates a socket that stops answering; the roster is
    // cleaned up from `close`, which a terminate raises like any other end.
    gone.terminate()

    await expect.poll(() => harness.app.realtime.listeners()).toEqual([])
  })
})

/**
 * Chat at the socket: several listeners talking, and everything that has to
 * hold while they do — that a message reaches everyone, that it is written
 * down, and that nobody can sign it with a name that isn't theirs.
 */
describe('chat', () => {
  /** A listener who has connected, read its opening frames, and named itself. */
  async function tuneIn(nickname: string): Promise<TestClient> {
    const [client] = await connect()
    await Promise.all([
      client!.nextState(),
      client!.nextQueue(),
      client!.nextPresence(),
      client!.nextChat(),
    ])
    await client!.join(nickname)
    return client!
  }

  it('sends an empty history to the first listener of the session', async () => {
    const [client] = await connect()

    expect((await client!.nextChat()).messages).toEqual([])
  })

  it('reaches every listener, with the sender named', async () => {
    const sam = await tuneIn('sam')
    const ana = await tuneIn('ana')
    await sam.nextPresence() // ana's arrival

    sam.send({ type: 'say', text: 'evening all' })

    for (const client of [sam, ana]) {
      const { messages } = await client.nextChat()
      expect(messages).toHaveLength(1)
      expect(messages[0]).toMatchObject({ nickname: 'sam', text: 'evening all' })
      expect(messages[0]!.id).toEqual(expect.any(Number))
      expect(messages[0]!.at).toEqual(expect.any(Number))
    }
  })

  it('comes back to the sender too, so there is one code path for display', async () => {
    const sam = await tuneIn('sam')

    expect((await sam.say('talking to myself')).messages[0]).toMatchObject({
      nickname: 'sam',
      text: 'talking to myself',
    })
  })

  it('hands a joiner the conversation so far', async () => {
    const sam = await tuneIn('sam')
    await sam.say('first')
    await sam.say('second')

    const [late] = await connect()

    expect((await late!.nextChat()).messages.map((m) => `${m.nickname}: ${m.text}`)).toEqual([
      'sam: first',
      'sam: second',
    ])
  })

  it('writes messages down, so a reconnect gets back what it missed', async () => {
    const sam = await tuneIn('sam')
    const ana = await tuneIn('ana')
    await sam.nextPresence()

    await ana.say('before the drop')
    await sam.nextChat()

    // Sam's connection dies; ana keeps talking to an emptier room.
    await sam.close()
    await expect.poll(() => harness.app.realtime.clientCount()).toBe(1)
    await ana.say('while sam was away')

    // The same listener comes back on a new socket, as the client does.
    const [back] = await connect()
    expect((await back!.nextChat()).messages.map((m) => m.text)).toEqual([
      'before the drop',
      'while sam was away',
    ])
  })

  it('signs a message with the roster’s name, not the frame’s', async () => {
    const sam = await tuneIn('sam')

    sam.send(JSON.stringify({ type: 'say', text: 'not me', nickname: 'ana' }))

    expect((await sam.nextChat()).messages[0]).toMatchObject({ nickname: 'sam', text: 'not me' })
  })

  it('follows a rename: what is said next carries the new name', async () => {
    const sam = await tuneIn('sam')
    await sam.say('as sam')
    await sam.join('samantha')

    expect((await sam.say('as samantha')).messages[0]).toMatchObject({ nickname: 'samantha' })
    // And what was already said keeps the name it was said under.
    expect(harness.chat.recent().map((m) => m.nickname)).toEqual(['sam', 'samantha'])
  })

  it('refuses a listener who has not named themselves', async () => {
    const [lurker] = await connect()
    await lurker!.nextChat()

    lurker!.send({ type: 'say', text: 'hello?' })

    const refusal = (await lurker!.waitFor((m) => m.type === 'error')) as ErrorMessage
    expect(refusal.message).toMatch(/name yourself/)
    expect(harness.chat.count()).toBe(0)
  })

  it('refuses an empty message, and one that is too long', async () => {
    const sam = await tuneIn('sam')

    for (const text of ['   ', 'x'.repeat(MESSAGE_MAX_LENGTH + 1)]) {
      sam.send({ type: 'say', text })
      expect((await sam.waitFor((m) => m.type === 'error')).type).toBe('error')
    }

    expect(harness.chat.count()).toBe(0)
    // Still live: a real message goes through afterwards.
    expect((await sam.say('still here')).messages[0]).toMatchObject({ text: 'still here' })
  })

  it('stops a listener sending faster than a person talks', async () => {
    // A burst of two, and nothing earned back within the test's lifetime.
    await harness.cleanup()
    harness = await startHarness({}, { listen: true, chatBurst: 2, chatRefillMs: 60_000 })
    const sam = await tuneIn('sam')

    await sam.say('one')
    await sam.say('two')
    sam.send({ type: 'say', text: 'three' })

    const refusal = (await sam.waitFor((m) => m.type === 'error')) as ErrorMessage
    expect(refusal.message).toMatch(/slow down/)
    // Refused before it was written, not after.
    expect(harness.chat.recent().map((m) => m.text)).toEqual(['one', 'two'])
  })

  it('paces each socket on its own, not the room', async () => {
    await harness.cleanup()
    harness = await startHarness({}, { listen: true, chatBurst: 1, chatRefillMs: 60_000 })
    const sam = await tuneIn('sam')
    const ana = await tuneIn('ana')

    await sam.say('mine')
    await ana.nextChat() // ana hears it too; that is not her spending anything

    // Sam has used his whole bucket up. Ana has said nothing, so hers is full.
    expect((await ana.say('and mine')).messages[0]).toMatchObject({ nickname: 'ana' })
  })
})

/**
 * The acceptance test for now-playing history, at the socket: what has been on
 * reaches everyone as it happens, and is still there for whoever turns up next.
 *
 * The tracks are put in the library first, because the history joins onto it —
 * the rest of this file plays tracks the station has never seen, which is fine
 * for a broadcast and is not a play anybody could name.
 */
describe('now-playing history', () => {
  beforeEach(() => {
    for (const row of [track, nextTrack]) {
      harness.db
        .prepare(
          `INSERT INTO tracks (id, title, artist, album, duration_ms, filename, artwork_path,
                               content_hash, gain_db, uploaded_at)
           VALUES (@id, @title, @artist, @album, @durationMs, @filename, @artworkPath,
                   @contentHash, @gainDb, @uploadedAt)`,
        )
        .run({ ...row, filename: `${row.id}.mp3`, contentHash: `hash-${row.id}` })
    }
  })

  it('sends an empty history to the first listener of a quiet session', async () => {
    const [client] = await connect()

    expect((await client!.nextHistory()).plays).toEqual([])
  })

  it('writes a track down when it goes on, and tells the room', async () => {
    const connected = await connect(2)
    await Promise.all(connected.map((client) => client.nextHistory()))

    harness.playback.play(track)

    for (const client of connected) {
      const { plays } = await client.nextHistory()
      expect(plays).toHaveLength(1)
      expect(plays[0]).toMatchObject({ at: clock.now() })
      expect(plays[0]!.track.title).toBe('Opening Number')
    }
    expect(harness.plays.count()).toBe(1)
  })

  it('adds the next track as it starts, in the order they were on', async () => {
    const [client] = await connect()
    await client!.nextHistory()

    harness.playback.play(track)
    await client!.nextHistory()
    clock.advance(200_000)
    harness.playback.play(nextTrack)

    expect((await client!.nextHistory()).plays[0]).toMatchObject({ at: clock.now() })
    expect(harness.plays.recent().map((play) => play.track.title)).toEqual([
      'Opening Number',
      'The Follow Up',
    ])
  })

  /**
   * The failure mode this is here to catch: the history is driven by the same
   * `change` event the state broadcast is, and most of those changes are not a
   * track starting. Unfiltered, an evening of one song would be forty rows.
   */
  it('says nothing when a track is paused, sought or resumed', async () => {
    const [client] = await connect()
    await client!.nextHistory()
    harness.playback.play(track)
    await client!.nextHistory()

    harness.playback.pause()
    harness.playback.seek(30_000)
    harness.playback.resume()
    for (let i = 0; i < 3; i++) await client!.nextState()

    await expect(client!.nextHistory(150)).rejects.toThrow(/timed out/)
    expect(harness.plays.count()).toBe(1)
  })

  it('records a track that ended and one that started by itself', async () => {
    harness.station.enqueue(track)
    harness.station.enqueue(nextTrack)
    const [client] = await connect()
    await client!.nextHistory()

    harness.station.advance()

    expect((await client!.nextHistory()).plays[0]!.track.title).toBe('The Follow Up')
    expect(harness.plays.recent().map((play) => play.track.title)).toEqual([
      'Opening Number',
      'The Follow Up',
    ])
  })

  it('records nothing for going off air', async () => {
    const [client] = await connect()
    await client!.nextHistory()
    harness.playback.play(track)
    await client!.nextHistory()

    harness.playback.stop()

    expect((await client!.nextState()).track).toBeNull()
    await expect(client!.nextHistory(150)).rejects.toThrow(/timed out/)
    expect(harness.plays.count()).toBe(1)
  })

  it('hands the evening so far to whoever turns up next', async () => {
    const [early] = await connect()
    await early!.nextHistory()
    harness.playback.play(track)
    harness.playback.play(nextTrack)
    await early!.nextHistory()

    const [late] = await connect()

    expect((await late!.nextHistory()).plays.map((play) => play.track.title)).toEqual([
      'Opening Number',
      'The Follow Up',
    ])
  })

  /**
   * The persistence half of the acceptance: unlike the roster and the skip
   * tally, this is written down, so it outlives the socket that watched it
   * happen. A reload starts a new socket and gets the whole evening back.
   */
  it('is still there for a listener who reloads, missing nothing', async () => {
    const [before] = await connect()
    await before!.nextHistory()
    harness.playback.play(track)
    await before!.nextHistory()

    await before!.close()
    await expect.poll(() => harness.app.realtime.clientCount()).toBe(0)
    // Played while nobody at all was listening, which is still a play.
    harness.playback.play(nextTrack)

    const [back] = await connect()
    expect((await back!.nextHistory()).plays.map((play) => play.track.title)).toEqual([
      'Opening Number',
      'The Follow Up',
    ])
  })

  it('carries plays with their own ids, so a client can merge on them', async () => {
    const [client] = await connect()
    await client!.nextHistory()

    harness.playback.play(track)
    const first = (await client!.nextHistory()).plays[0]!
    harness.playback.play(nextTrack)
    const second = (await client!.nextHistory()).plays[0]!
    harness.playback.play(track)
    const third = (await client!.nextHistory()).plays[0]!

    // The same track twice is two plays, and the ids are the plays' own.
    expect(third.track.id).toBe(first.track.id)
    expect(new Set([first.id, second.id, third.id]).size).toBe(3)
  })
})

/**
 * The acceptance test for skip voting, at the socket: several listeners vote on
 * what is on, everyone sees the tally, and the next track starts from nothing.
 */
describe('skip votes', () => {
  /** A listener who has connected, read its opening frames, and named itself. */
  async function tuneIn(nickname: string): Promise<TestClient> {
    const [client] = await connect()
    await Promise.all([
      client!.nextState(),
      client!.nextQueue(),
      client!.nextPresence(),
      client!.nextSkips(),
      client!.nextChat(),
    ])
    await client!.join(nickname)
    return client!
  }

  it('sends the tally on connect, before anyone has voted', async () => {
    harness.playback.play(track)
    const [client] = await connect()

    expect(await client!.nextSkips()).toMatchObject({ trackId: track.id, votes: 0, voted: false })
    expect(harness.app.realtime.skips()).toEqual({ trackId: track.id, votes: 0 })
  })

  it('counts a vote and tells the whole room', async () => {
    harness.playback.play(track)
    const sam = await tuneIn('sam')
    const ana = await tuneIn('ana')
    await sam.nextPresence() // ana's arrival

    sam.send({ type: 'vote_skip', voted: true })

    // Everyone sees the same count, and each of them is told where they stand.
    expect(await sam.nextSkips()).toMatchObject({ trackId: track.id, votes: 1, voted: true })
    expect(await ana.nextSkips()).toMatchObject({ trackId: track.id, votes: 1, voted: false })
  })

  it('adds up across the room, and comes back down', async () => {
    harness.playback.play(track)
    const sam = await tuneIn('sam')
    const ana = await tuneIn('ana')
    await sam.nextPresence()

    await sam.voteSkip()
    await ana.nextSkips()
    expect((await ana.voteSkip()).votes).toBe(2)
    await sam.nextSkips() // ana's vote, as sam was told about it

    // Changing your mind takes the vote back off — the tally is what the room
    // thinks now, not what it once thought.
    expect((await sam.voteSkip(false)).votes).toBe(1)
    expect(harness.app.realtime.skips()).toEqual({ trackId: track.id, votes: 1 })
  })

  it('counts one listener once, however many times they press it', async () => {
    harness.playback.play(track)
    const sam = await tuneIn('sam')

    expect((await sam.voteSkip()).votes).toBe(1)

    // A vote that changes nothing is not a broadcast — the client that tapped
    // twice is already showing the truth.
    sam.send({ type: 'vote_skip', voted: true })
    await expect(sam.nextSkips(150)).rejects.toThrow(/timed out/)
    expect(harness.app.realtime.skips().votes).toBe(1)
  })

  it('clears the votes when the next track goes on, and says so', async () => {
    harness.playback.play(track)
    const sam = await tuneIn('sam')
    await sam.voteSkip()

    harness.playback.play(nextTrack)

    // The state first, then the tally — a client told the votes were cleared
    // before it knew the track had changed would blank the count against the
    // song that just ended.
    expect((await sam.nextState()).track?.id).toBe(nextTrack.id)
    expect(await sam.nextSkips()).toMatchObject({ trackId: nextTrack.id, votes: 0, voted: false })
    expect(harness.app.realtime.skips()).toEqual({ trackId: nextTrack.id, votes: 0 })
  })

  it('clears them when a track ends on its own, too', async () => {
    harness.station.enqueue(track)
    harness.station.enqueue(nextTrack)
    const sam = await tuneIn('sam')
    await sam.voteSkip()

    harness.station.advance()

    expect((await sam.nextState()).track?.id).toBe(nextTrack.id)
    expect((await sam.nextSkips()).votes).toBe(0)
  })

  it('clears them when the station goes off air', async () => {
    harness.playback.play(track)
    const sam = await tuneIn('sam')
    await sam.voteSkip()

    harness.playback.stop()

    expect((await sam.nextState()).track).toBeNull()
    expect(await sam.nextSkips()).toMatchObject({ trackId: null, votes: 0 })
  })

  /**
   * The tally has to survive the admin working the decks. A pause, a seek and a
   * resume all leave the same song on — and if any of them wiped the count, the
   * person the room is voting at could clear it by nudging the needle.
   */
  it('keeps the tally through a pause, a seek and a resume', async () => {
    harness.playback.play(track)
    const sam = await tuneIn('sam')
    await sam.voteSkip()

    harness.playback.pause()
    harness.playback.seek(30_000)
    harness.playback.resume()
    for (let i = 0; i < 3; i++) await sam.nextState()

    await expect(sam.nextSkips(150)).rejects.toThrow(/timed out/)
    expect(harness.app.realtime.skips()).toEqual({ trackId: track.id, votes: 1 })
  })

  it('takes a listener’s vote with them when they leave', async () => {
    harness.playback.play(track)
    const staying = await tuneIn('staying')
    const leaving = await tuneIn('leaving')
    await staying.nextPresence()
    await leaving.voteSkip()
    await staying.nextSkips()

    await leaving.close()

    // Otherwise the tally counts people who are not in the room, and can sit
    // above the roster it is a fraction of.
    expect((await staying.nextSkips()).votes).toBe(0)
    await expect.poll(() => harness.app.realtime.skips().votes).toBe(0)
  })

  it('refuses a vote from a socket that has not said who it is', async () => {
    harness.playback.play(track)
    const [lurker] = await connect()
    await lurker!.nextSkips()

    lurker!.send({ type: 'vote_skip', voted: true })

    const refusal = (await lurker!.waitFor((m) => m.type === 'error')) as ErrorMessage
    expect(refusal).toMatchObject({ code: 'not_joined', about: 'vote' })
    expect(harness.app.realtime.skips().votes).toBe(0)
  })

  it('refuses a vote when there is nothing on to skip', async () => {
    const sam = await tuneIn('sam')

    sam.send({ type: 'vote_skip', voted: true })

    expect(await sam.waitFor((m) => m.type === 'error')).toMatchObject({
      code: 'nothing_playing',
      about: 'vote',
    })
    expect(harness.app.realtime.skips().votes).toBe(0)
  })

  it('changes nothing on the decks, however many listeners want it gone', async () => {
    harness.playback.play(track)
    const room = await Promise.all([tuneIn('a'), tuneIn('b'), tuneIn('c')])

    for (const listener of room) listener.send({ type: 'vote_skip', voted: true })
    await room[0]!.waitFor((m) => m.type === 'skips' && m.votes === 3)

    // A unanimous room is still a room, not a command. Whoever runs the decks
    // reads the number and decides — see `POST /api/playback`.
    expect(harness.playback.snapshot().track?.id).toBe(track.id)
    expect(harness.playback.snapshot().pausedAt).toBeNull()
  })

  it('paces a socket changing its mind in a loop, without dropping it', async () => {
    await harness.cleanup()
    harness = await startHarness({}, { listen: true, voteBurst: 2, voteRefillMs: 60_000 })
    harness.playback.play(track)
    const sam = await tuneIn('sam')

    await sam.voteSkip(true)
    await sam.voteSkip(false)
    sam.send({ type: 'vote_skip', voted: true })

    expect(await sam.waitFor((m) => m.type === 'error')).toMatchObject({
      code: 'slow_down',
      about: 'vote',
    })
    // Refused before it was counted, not after.
    expect(harness.app.realtime.skips().votes).toBe(0)
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

/**
 * The socket's half of the admin gate. There is nothing privileged to
 * authenticate here — every mutation lives behind `requireAdmin` on an HTTP
 * route — so what has to hold is that the socket grants no control to anyone,
 * signed in or not.
 */
describe('admin actions over the socket', () => {
  const command = (client: TestClient, body: unknown) =>
    client.send(typeof body === 'string' ? body : JSON.stringify(body))

  it('refuses command frames by name, so a client is told why', async () => {
    const [client] = await connect()
    await client!.nextState()

    harness.playback.play(track)
    await client!.nextState()

    for (const frame of [
      { type: 'pause' },
      { type: 'skip' },
      { type: 'seek', positionMs: 120_000 },
      { type: 'enqueue', trackId: 2 },
      { type: 'admin', password: 'hunter2-for-tests' },
    ]) {
      command(client!, frame)
      const refusal = (await client!.waitFor((m) => m.type === 'error')) as ErrorMessage
      expect(refusal.message).toMatch(/over HTTP/)
    }

    // Untouched by every one of them.
    expect(harness.playback.snapshot().pausedAt).toBeNull()
    expect(harness.playback.snapshot().track?.id).toBe(track.id)
    expect(harness.station.queue.list()).toEqual([])
  })

  it('gives a socket carrying an admin cookie no more than an anonymous one', async () => {
    const cookie = await signIn(harness)
    const client = await connectWith({ cookie })
    await client.nextState()

    harness.playback.play(track)
    await client.nextState()

    command(client, { type: 'pause' })

    expect(((await client.waitFor((m) => m.type === 'error')) as ErrorMessage).message).toMatch(
      /over HTTP/,
    )
    expect(harness.playback.snapshot().pausedAt).toBeNull()
  })

  it('lets the same admin do it over HTTP, which is where the gate is', async () => {
    const cookie = await signIn(harness)
    const client = await connectWith({ cookie })
    await client.nextState()

    harness.playback.play(track)
    await client.nextState()

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/playback',
      headers: { cookie },
      payload: { action: 'pause' },
    })

    expect(res.statusCode).toBe(200)
    // And the change arrives on the socket, like every other change does.
    expect((await client.nextState()).pausedAt).toBe(0)
  })
})
