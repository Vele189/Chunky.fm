import { describe, expect, it } from 'vitest'
import {
  BEEN_ON,
  clock,
  ROOM,
  saidBy,
  scrubbed,
  SESSION,
  SLEEVES,
  through,
  WISHES,
} from '../src/landing/session.js'
import { nextStep } from '../src/landing/useOneByOne.js'

describe('clock', () => {
  it('reads a position the way the station does', () => {
    expect(clock(0)).toBe('0:00')
    expect(clock(9)).toBe('0:09')
    expect(clock(63)).toBe('1:03')
    expect(clock(334)).toBe('5:34')
  })

  it('pads the seconds, so a digit changing never shifts what is beside it', () => {
    for (let second = 0; second < 600; second++) {
      expect(clock(second)).toMatch(/^\d+:[0-5]\d$/)
    }
  })

  it('does not run backwards past the start', () => {
    expect(clock(-1)).toBe('0:00')
    expect(clock(-999)).toBe('0:00')
  })
})

/**
 * The arithmetic under the page's one trick: the document is the song, the top
 * is 0:00 and the bottom is the last bar.
 */
describe('scrubbed', () => {
  it('runs the length of the song from the top of the page to the bottom', () => {
    expect(scrubbed(0, 1000, 334)).toBe(0)
    expect(scrubbed(500, 1000, 334)).toBe(167)
    expect(scrubbed(1000, 1000, 334)).toBe(334)
  })

  /**
   * A page too short to scroll (a very tall window, a phone on its side) has
   * nothing to divide by. That has to read as the start of the song rather than
   * as a NaN in the address of every message on the page.
   */
  it('sits at the start when there is nothing to scroll', () => {
    expect(scrubbed(0, 0, 334)).toBe(0)
    expect(scrubbed(40, 0, 334)).toBe(0)
    expect(scrubbed(0, -100, 334)).toBe(0)
  })

  /** Overscroll and rubber-banding both hand this numbers outside the range. */
  it('never leaves the song', () => {
    for (const scrolled of [-500, -1, 0, 1000, 5000]) {
      const at = scrubbed(scrolled, 1000, 334)
      expect(at).toBeGreaterThanOrEqual(0)
      expect(at).toBeLessThanOrEqual(334)
    }
  })

  it('is whole seconds, so the clock ticks rather than shimmers', () => {
    for (let scrolled = 0; scrolled <= 1000; scrolled += 7) {
      expect(Number.isInteger(scrubbed(scrolled, 1000, 334))).toBe(true)
    }
  })
})

describe('through', () => {
  it('is the fraction the bar is drawn from', () => {
    expect(through(0, 334)).toBe(0)
    expect(through(167, 334)).toBe(0.5)
    expect(through(334, 334)).toBe(1)
  })

  it('stays a fraction whatever it is handed', () => {
    expect(through(999, 334)).toBe(1)
    expect(through(-10, 334)).toBe(0)
    expect(through(10, 0)).toBe(0)
  })
})

describe('saidBy', () => {
  it('has said nothing at the top of the page', () => {
    expect(saidBy(ROOM, 0)).toEqual([])
  })

  it('has said everything by the end of the song', () => {
    expect(saidBy(ROOM, SESSION.duration)).toHaveLength(ROOM.length)
  })

  it('says a line the moment the playhead reaches it, not after', () => {
    const first = ROOM[0]
    if (!first) throw new Error('the sample room is empty')
    expect(saidBy(ROOM, first.at - 1)).toEqual([])
    expect(saidBy(ROOM, first.at)).toEqual([first])
  })

  /**
   * Somebody scrolling back up should find the room still saying what it said,
   * rather than watching it be un-said, so this only ever grows.
   */
  it('never un-says a line as the playhead moves on', () => {
    let seen = 0
    for (let at = 0; at <= SESSION.duration; at++) {
      const said = saidBy(ROOM, at).length
      expect(said).toBeGreaterThanOrEqual(seen)
      seen = said
    }
  })

  it('keeps the conversation in the order it happened', () => {
    const said = saidBy(ROOM, SESSION.duration)
    for (let i = 1; i < said.length; i++) {
      // biome-ignore lint/style/noNonNullAssertion: bounded by the loop
      expect(said[i]!.at).toBeGreaterThanOrEqual(said[i - 1]!.at)
    }
  })
})

/**
 * The sample session is invented, and it is allowed to be: the page cannot ask
 * a station anything. What it is not allowed to do is advertise a station other
 * than the one this is.
 */
describe('the sample session', () => {
  it('fits inside the song it claims to be', () => {
    for (const line of ROOM) {
      expect(line.at).toBeGreaterThanOrEqual(0)
      expect(line.at).toBeLessThanOrEqual(SESSION.duration)
    }
  })

  /**
   * PLAN.md: around thirty listeners, not thirty thousand; playback state
   * lives in one process on purpose. The limits board used to carry the number
   * as well and now says `Deliberately small` instead, so this is the only place
   * the ceiling is written down where anything checks it.
   */
  it('shows a head count the station could actually hold', () => {
    expect(SESSION.listeners).toBeLessThanOrEqual(40)
  })

  it('asks for things in sentences rather than genres', () => {
    for (const wish of WISHES) {
      expect(wish.says.split(' ').length).toBeGreaterThan(3)
    }
  })

  /**
   * The wall deals these out one to each of its two columns in turn (see
   * MovingColumns.tsx) so an odd number leaves one column a card short, which on
   * a loop is one column visibly emptier than the other for as long as anybody
   * watches it. It is a property of the list's length rather than of any wish, so
   * nothing about a single entry catches it going wrong.
   */
  it('divides evenly between the columns it is dealt into', () => {
    expect(WISHES.length % 2).toBe(0)
  })

  it('has an evening in it, most recent first', () => {
    expect(BEEN_ON.length).toBeGreaterThan(0)
    const times = BEEN_ON.map((play) => play.at)
    expect([...times].sort().reverse()).toEqual(times)
  })

  /** The record at the top of the evening is the one the page is playing. */
  it('agrees with itself about what is on now', () => {
    expect(BEEN_ON[0]?.title).toBe(SESSION.title)
    expect(BEEN_ON[0]?.artist).toBe(SESSION.artist)
  })
})

/**
 * The pile at the top of the page is the evening, filtered to the records the
 * page has a sleeve for, not a second list. These are the checks that keep it
 * that way, because the failure is silent: a pile that drifted would show a
 * record in the hand that the evening two screens down says was never on.
 */
describe('the pile', () => {
  it('is drawn from the evening rather than listed separately', () => {
    for (const sleeve of SLEEVES) {
      expect(BEEN_ON).toContain(sleeve)
    }
  })

  it('is every record with a sleeve, and only those', () => {
    expect(SLEEVES).toHaveLength(BEEN_ON.filter((play) => play.cover).length)
    for (const sleeve of SLEEVES) {
      expect(sleeve.cover.src.length).toBeGreaterThan(0)
      expect(sleeve.cover.album.length).toBeGreaterThan(0)
    }
  })

  /**
   * Nothing on a sleeve says which one is playing; they are all the same card.
   * Being at the front of the pile is the only thing that says it, so the front
   * of the pile has to be the record that is on.
   */
  it('has the record that is on at the front', () => {
    expect(SLEEVES[0]?.title).toBe(SESSION.title)
    expect(SLEEVES[0]?.artist).toBe(SESSION.artist)
  })

  it('keeps the evening’s order, newest first', () => {
    const times = SLEEVES.map((sleeve) => sleeve.at)
    expect([...times].sort().reverse()).toEqual(times)
  })
})

/**
 * Due is not the same as said. The playhead can reach five lines in one frame, and
 * arriving at the section with the record already at 2:13 does exactly that,
 * so five bubbles appearing together is a transcript rather than a
 * conversation. This is the pacing that stops it.
 */
describe('nextStep', () => {
  it('walks forwards one line at a time', () => {
    expect(nextStep(0, 5)).toBe(1)
    expect(nextStep(1, 5)).toBe(2)
    expect(nextStep(4, 5)).toBe(5)
  })

  it('stops on arrival rather than running past', () => {
    expect(nextStep(5, 5)).toBe(5)
    expect(nextStep(0, 0)).toBe(0)
  })

  /**
   * Scrolling up takes the playhead with it and lines fall back out of the
   * conversation. Running that in reverse a step at a time would be the room
   * un-saying things at a stately pace while the reader is already elsewhere.
   */
  it('goes backwards all at once', () => {
    expect(nextStep(9, 2)).toBe(2)
    expect(nextStep(5, 0)).toBe(0)
  })

  it('always ends up at the target if you keep asking', () => {
    for (const target of [0, 1, 4, ROOM.length]) {
      let shown = 0
      for (let i = 0; i < 50; i++) shown = nextStep(shown, target)
      expect(shown).toBe(target)
    }
  })
})
