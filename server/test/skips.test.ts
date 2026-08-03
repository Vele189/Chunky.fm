import { describe, expect, it } from 'vitest'
import { parseClientMessage } from '../src/protocol.js'
import { SkipVotes } from '../src/skips.js'

describe('SkipVotes', () => {
  it('counts a listener once, however many times they vote', () => {
    const skips = new SkipVotes()
    skips.retarget(1)

    expect(skips.cast(7, true)).toBe(true)
    expect(skips.cast(7, true)).toBe(false)
    expect(skips.cast(7, true)).toBe(false)

    expect(skips.size).toBe(1)
  })

  it('lets a listener take a vote back, and says whether that changed anything', () => {
    const skips = new SkipVotes()
    skips.retarget(1)
    skips.cast(7, true)

    expect(skips.cast(7, false)).toBe(true)
    expect(skips.has(7)).toBe(false)
    // Withdrawing a vote nobody cast is not a change, so it broadcasts nothing.
    expect(skips.cast(7, false)).toBe(false)
    expect(skips.cast(99, false)).toBe(false)
  })

  it('keeps listeners apart, so a tally is a count of people', () => {
    const skips = new SkipVotes()
    skips.retarget(1)

    skips.cast(1, true)
    skips.cast(2, true)
    skips.cast(3, true)
    skips.cast(2, false)

    expect(skips.tally()).toEqual({ trackId: 1, votes: 2 })
  })

  it('clears the tally when a different track goes on', () => {
    const skips = new SkipVotes()
    skips.retarget(1)
    skips.cast(1, true)
    skips.cast(2, true)

    expect(skips.retarget(2)).toBe(true)
    expect(skips.tally()).toEqual({ trackId: 2, votes: 0 })
    expect(skips.has(1)).toBe(false)
  })

  it('clears it when the station goes off air, too', () => {
    const skips = new SkipVotes()
    skips.retarget(1)
    skips.cast(1, true)

    expect(skips.retarget(null)).toBe(true)
    expect(skips.tally()).toEqual({ trackId: null, votes: 0 })
  })

  /**
   * The line that decides whether a tally can be wiped by the person it is
   * aimed at: pause, seek and resume all leave the same song on, and only the
   * track itself changing is a track change.
   */
  it('leaves the tally alone while the same track is still on', () => {
    const skips = new SkipVotes()
    skips.retarget(1)
    skips.cast(1, true)

    expect(skips.retarget(1)).toBe(false)
    expect(skips.retarget(1)).toBe(false)

    expect(skips.tally()).toEqual({ trackId: 1, votes: 1 })
  })

  it('says nothing was cleared when there was nothing to clear', () => {
    const skips = new SkipVotes()

    // The tally moved to a new track, but no listener loses a vote over it —
    // so there is nothing to tell the room about.
    expect(skips.retarget(1)).toBe(false)
    expect(skips.retarget(2)).toBe(false)
  })
})

describe('the vote frame', () => {
  it('carries where a listener stands, and nothing else', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'vote_skip', voted: true }))).toEqual({
      ok: true,
      message: { type: 'vote_skip', voted: true },
    })
    expect(parseClientMessage(JSON.stringify({ type: 'vote_skip', voted: false }))).toEqual({
      ok: true,
      message: { type: 'vote_skip', voted: false },
    })
  })

  it('names no track — which track it is about is the station’s answer', () => {
    const parsed = parseClientMessage(
      JSON.stringify({ type: 'vote_skip', voted: true, trackId: 99, listenerId: 3 }),
    )

    expect(parsed).toEqual({ ok: true, message: { type: 'vote_skip', voted: true } })
  })

  it('is refused when it does not say where the listener stands', () => {
    for (const frame of [
      { type: 'vote_skip' },
      { type: 'vote_skip', voted: 'yes' },
      { type: 'vote_skip', voted: 1 },
    ]) {
      const parsed = parseClientMessage(JSON.stringify(frame))
      expect(parsed.ok).toBe(false)
    }
  })

  /**
   * `skip` is the admin's command and stays refused by name. A vote is a
   * different thing wearing a different word: it says what the room wants, and
   * no number of them drives the decks.
   */
  it('is not the admin’s skip, which is still refused by name', () => {
    const parsed = parseClientMessage(JSON.stringify({ type: 'skip' }))

    expect(parsed).toMatchObject({ ok: false, code: 'command_over_http' })
  })
})
