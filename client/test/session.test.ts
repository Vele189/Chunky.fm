import { describe, expect, it } from 'vitest'
import {
  BEEN_ON,
  clock,
  ROOM,
  saidBy,
  SESSION,
  SHEET,
  SLEEVES,
  sungAt,
  WISHES,
} from '../src/landing/session.js'

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
 * The sheet beside the deck. A list in time order and a playhead, which is the
 * same shape the station's own lyric view is, and the same question its
 * `activeLineIndex` answers.
 */
describe('sungAt', () => {
  it('lights nothing through the intro', () => {
    expect(sungAt(SHEET, 0)).toBe(-1)
    expect(sungAt(SHEET, SHEET[0]!.at - 1)).toBe(-1)
  })

  it('lights a line the moment the playhead reaches it, not after', () => {
    for (const [index, line] of SHEET.entries()) {
      expect(sungAt(SHEET, line.at)).toBe(index)
    }
  })

  it('lights the line being sung rather than every line so far', () => {
    // The difference between a sheet and a chat window: `saidBy` accumulates,
    // this one moves.
    const second = SHEET[5]!.at
    expect(sungAt(SHEET, second)).toBe(5)
    expect(sungAt(SHEET, second + 1)).toBe(5)
  })

  it('holds the last line once the song has run out', () => {
    expect(sungAt(SHEET, SESSION.duration)).toBe(SHEET.length - 1)
    expect(sungAt(SHEET, SESSION.duration * 10)).toBe(SHEET.length - 1)
  })

  it('is an index into the sheet it was handed, always', () => {
    for (let second = 0; second <= SESSION.duration; second++) {
      const index = sungAt(SHEET, second)
      expect(index).toBeGreaterThanOrEqual(-1)
      expect(index).toBeLessThan(SHEET.length)
    }
  })

  it('has nothing to light in an empty sheet', () => {
    expect(sungAt([], 42)).toBe(-1)
  })
})

describe('the sheet', () => {
  it('is sung inside the song it belongs to', () => {
    for (const line of SHEET) {
      expect(line.at).toBeGreaterThan(0)
      expect(line.at).toBeLessThanOrEqual(SESSION.duration)
    }
  })

  it('is in the order it is sung', () => {
    const times = SHEET.map((line) => line.at)
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })

  it('sings no line twice in the same second', () => {
    expect(new Set(SHEET.map((line) => line.at)).size).toBe(SHEET.length)
  })

  it('draws its rests rather than leaving holes', () => {
    // `ListenerView` and the session grid both key off this exact string, and a
    // rest written any other way would be drawn as a lyric that is three dots.
    expect(SHEET.some((line) => line.says === '· · ·')).toBe(true)
  })

  it('is long enough for the still picture to have a line to light', () => {
    // ListenerView draws a fixed line bright rather than following a playhead,
    // and its index is written down there. This is the guard that says the
    // sheet is still long enough to have one.
    expect(SHEET.length).toBeGreaterThan(6)
  })
})
