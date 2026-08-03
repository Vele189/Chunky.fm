import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chatRefusal } from '../src/lib/chat.js'
import {
  type ErrorMessage,
  type ServerMessage,
  type SkipsMessage,
  type SocketErrorCode,
  refusalAbout,
} from '../src/lib/protocol.js'
import { StationConnection } from '../src/lib/station.js'
import { FakeSocket, fakeSocketFactory } from './fake-socket.js'
import {
  NO_VOTES,
  type SkipTally,
  skipTallyLabel,
  skipVotesLabel,
  tallyFor,
  voteButtonLabel,
  voteRefusal,
} from '../src/lib/skips.js'
import { wishRefusal } from '../src/lib/wishes.js'

const tally = (trackId: number | null, votes: number, voted = false): SkipTally => ({
  trackId,
  votes,
  voted,
})

describe('the tally is only ever about what is on', () => {
  it('passes it through when it is about this track', () => {
    const current = tally(7, 3, true)

    expect(tallyFor(current, 7)).toBe(current)
  })

  it('shows nothing when the tally is about the track before this one', () => {
    // The station clears votes on a track change and says so, but the two
    // frames arrive one after the other — this is the moment in between, and
    // the old count against the new song would be a number about nothing.
    expect(tallyFor(tally(7, 3, true), 8)).toEqual(NO_VOTES)
  })

  it('shows nothing when there is no track, and nothing before the first frame', () => {
    expect(tallyFor(tally(null, 0), null)).toEqual(NO_VOTES)
    expect(tallyFor(null, 7)).toEqual(NO_VOTES)
  })

  it('takes a tally straight off the wire', () => {
    const frame: SkipsMessage = { type: 'skips', trackId: 7, votes: 2, voted: true }
    const { type, ...rest } = frame

    expect(tallyFor(rest, 7)).toEqual({ trackId: 7, votes: 2, voted: true })
  })
})

describe('how the tally reads', () => {
  it('says so plainly when nobody has voted', () => {
    expect(skipTallyLabel(0, 5)).toMatch(/nobody/i)
  })

  it('reads as a fraction of the room, because a bare count means nothing', () => {
    expect(skipTallyLabel(3, 4)).toBe('3 of 4 want the next one.')
    expect(skipTallyLabel(3, 30)).toBe('3 of 30 want the next one.')
  })

  it('agrees with itself about one listener', () => {
    expect(skipTallyLabel(1, 4)).toBe('1 of 4 wants the next one.')
  })

  it('still says something with no roster to be a fraction of', () => {
    // A vote counted before this client's own roster frame arrived. Rare, and
    // "3 of 0" would be worse than a plain count.
    expect(skipTallyLabel(1, 0)).toBe('1 vote to skip this one.')
    expect(skipTallyLabel(3, 0)).toBe('3 votes to skip this one.')
  })

  it('offers to take a vote back once it is in', () => {
    expect(voteButtonLabel(false)).toBe('Skip this one')
    expect(voteButtonLabel(true)).toMatch(/back/i)
  })

  it('reads without a room on the admin panel, where there is no roster', () => {
    expect(skipVotesLabel(0)).toBe('no skip votes')
    expect(skipVotesLabel(1)).toBe('1 skip vote')
    expect(skipVotesLabel(4)).toBe('4 skip votes')
  })
})

/**
 * The vote at the wire.
 *
 * Two things can go wrong here that no label test would see: the frame carrying
 * a toggle rather than a position, and a vote sent on a socket that has not
 * finished opening — thrown away in silence, which is a vote nobody ever counts
 * and no error to show for it.
 */
describe('voting over the socket', () => {
  let messages: ServerMessage[]
  let station: StationConnection

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

  it('says where the listener stands, not "toggle"', () => {
    station.connect()
    FakeSocket.last.open()

    station.send({ type: 'vote_skip', voted: true })
    station.send({ type: 'vote_skip', voted: true })

    // Twice is once: a button that has not caught up yet cannot cancel a vote
    // the listener meant to cast.
    expect(FakeSocket.last.sent).toEqual([
      { type: 'vote_skip', voted: true },
      { type: 'vote_skip', voted: true },
    ])
  })

  it('drops a vote sent before the socket is open', () => {
    station.connect()

    station.send({ type: 'vote_skip', voted: true })

    expect(FakeSocket.last.sent).toEqual([])
  })

  it('passes the tally through as the station describes it', () => {
    station.connect()
    FakeSocket.last.open()

    const frame: SkipsMessage = { type: 'skips', trackId: 7, votes: 2, voted: true }
    FakeSocket.last.deliver(frame)

    expect(messages).toEqual([frame])
  })
})

/**
 * Three things a listener can send over one socket, and three places on the
 * page for a refusal to land. `about` is what keeps them apart.
 */
describe('a refusal about a vote finds the vote', () => {
  const refusal = (code: SocketErrorCode, about?: ErrorMessage['about'], seq = 1) => ({
    error: { type: 'error', code, message: 'nope', ...(about ? { about } : {}) } as ErrorMessage,
    seq,
  })

  it('goes to the vote and to neither composer', () => {
    const paced = refusal('slow_down', 'vote')

    expect(refusalAbout(paced, 'vote')).toBe(paced)
    expect(refusalAbout(paced, 'say')).toBeNull()
    expect(refusalAbout(paced, 'wish')).toBeNull()
  })

  it('leaves the vote alone when the refusal was about something typed', () => {
    expect(refusalAbout(refusal('slow_down', 'say'), 'vote')).toBeNull()
    expect(refusalAbout(refusal('not_joined', 'wish'), 'vote')).toBeNull()
    expect(refusalAbout(null, 'vote')).toBeNull()
  })

  it('explains itself for every refusal a vote can cause', () => {
    for (const code of ['slow_down', 'not_joined', 'nothing_playing'] as const) {
      const notice = voteRefusal(code)
      expect(notice, code).not.toBeNull()
      // The point of the line is that the vote is not in, not the code itself.
      expect(notice).toMatch(/not counted/i)
    }
  })

  it('says nothing about refusals a vote cannot cause', () => {
    expect(voteRefusal('empty_message')).toBeNull()
    expect(voteRefusal('wish_too_long')).toBeNull()
    expect(voteRefusal('unrecognised_message')).toBeNull()

    // And neither composer claims a vote's own refusal, so a station that ever
    // dropped `about` would go quiet rather than blaming the wrong box.
    expect(chatRefusal('nothing_playing')).toBeNull()
    expect(wishRefusal('nothing_playing')).toBeNull()
  })
})
