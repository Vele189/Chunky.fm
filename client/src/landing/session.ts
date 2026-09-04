/**
 * The sample session the page plays back as you scroll.
 *
 * Every visible number and line on the landing page comes from here, and all of
 * it is invented: one evening's worth of a station that is not running. It has
 * to be: the page in front of the station cannot ask the station anything, and
 * that is the whole reason the page exists. What it must not do is *look* like a
 * report. Everything this drives sits behind `aria-hidden`, and the page says
 * so in words at the one place somebody would otherwise wonder.
 *
 * Kept as data and pure functions, apart from the components that draw it, so
 * the arithmetic underneath the trick (where in the song the scroll has got to,
 * and which lines have been said by then) is testable without a window.
 */

import childishGambino from '../assets/albums/childish-gambino.webp'
import erykahBadu from '../assets/albums/erykah-badu.webp'
import fleetwoodMac from '../assets/albums/fleetwood-mac.webp'
import jeffBuckley from '../assets/albums/jeff-buckley.webp'
import laurynHill from '../assets/albums/lauryn-hill.webp'
import pinkFloyd from '../assets/albums/pink-floyd.webp'
import prince from '../assets/albums/prince.webp'
import radiohead from '../assets/albums/radiohead.webp'
import sade from '../assets/albums/sade.webp'

/** How the page shows a position in a song. Matches the station's own clocks. */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(whole / 60)
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`
}

export interface Line {
  /** Seconds into the song. */
  at: number
  who: string
  says: string
}

/**
 * The letter in somebody's avatar.
 *
 * The station has no pictures of anybody (a nickname in localStorage is the
 * whole of what it knows) so the avatar is the one thing it can honestly draw:
 * the first letter of what they asked to be called.
 */
export function initial(who: string): string {
  return (who.trim()[0] ?? '?').toUpperCase()
}

/**
 * Everything the room has said by a given point in the song.
 *
 * Oldest first, the way a conversation is read. Nothing is removed as the
 * playhead moves on: somebody scrolling back up should find the room still
 * saying what it said, rather than watching it be un-said.
 */
export function saidBy(lines: readonly Line[], seconds: number): Line[] {
  return lines.filter((line) => line.at <= seconds)
}

/** The record on the decks in the sample session. */
export const SESSION = {
  title: 'Wish You Were Here',
  artist: 'Pink Floyd',
  /** 5:34, in seconds. */
  duration: 334,
  /**
   * A head count in the range the station is actually built for: around thirty,
   * because playback state lives in one process on purpose. A landing page
   * boasting five figures would be advertising a different product, and the
   * limits section further down says so in as many words.
   */
  listeners: 31,
} as const

/**
 * The room, over the course of one song.
 *
 * Ordinary, and short. What is being demonstrated is not that the chat is
 * lively. It is that all of this is happening at the same instant for
 * everybody, which is a thing you feel rather than read.
 */
export const ROOM: readonly Line[] = [
  { at: 9, who: 'thandi', says: 'oh' },
  { at: 26, who: 'sipho', says: 'have not heard this since my dad’s car' },
  { at: 58, who: 'ana', says: 'wait. everyone is on the same second? actually?' },
  { at: 71, who: 'thandi', says: 'actually. try to get ahead of it, you can’t' },
  { at: 124, who: 'lerato', says: 'second guitar comes in around here' },
  { at: 149, who: 'ana', says: 'ok. yes. I hear it' },
  { at: 205, who: 'sipho', says: 'nobody speak' },
  { at: 268, who: 'lerato', says: 'the room went quiet at the same time. that’s the thing' },
  { at: 309, who: 'thandi', says: 'what is this doing to me at 11pm' },
]

/**
 * An episode of the podcast, as the page invents one.
 *
 * The fallback behind the archive strip, and the only fixture here that stands
 * in for something a visitor could otherwise go and look at. The real archive
 * is an open read (`GET /api/episodes`) so the section usually shows actual
 * episodes; this is what it draws on a page that could not reach the station,
 * which is the day the landing page matters most.
 *
 * Because these could be mistaken for real ones, the section draws them
 * **inert**: no link, `aria-hidden`, a picture of an archive rather than an
 * archive. Same call `ListenerView` makes about the station it draws. The link
 * to the real thing is in the words beside them, where it always works.
 *
 * `weeksAgo` rather than a date. A written-down date in a fixture is a date
 * that is wrong by next year, and these sit beside real episodes carrying real
 * ones; counted back from today they stay plausible without anybody
 * remembering to come back and edit them.
 */
export interface Invented {
  title: string
  /** Who came on, or null for a night that was just the decks. */
  guests: string | null
  number: number
  weeksAgo: number
  /** Minutes, turned into the same "1 hr 12 min" a real card carries. */
  minutes: number
  notes: string
}

export const KEPT: readonly Invented[] = [
  {
    title: 'What a song is for',
    guests: 'Thandi',
    number: 7,
    weeksAgo: 2,
    minutes: 74,
    notes:
      'An hour on the records people keep going back to, and why almost none of them are the ones anybody would call the best.\n\nWe got as far as agreeing that a song you have worn out is a different object from a song you admire, and no further.',
  },
  {
    title: 'The year everything was sampled',
    guests: 'Lerato',
    number: 6,
    weeksAgo: 5,
    minutes: 58,
    notes:
      'Where a break came from, who it belonged to, and what happened to them afterwards.\n\nMore of this was about money than either of us expected going in.',
  },
  {
    title: 'Records nobody asked for',
    guests: null,
    number: 5,
    weeksAgo: 9,
    minutes: 64,
    notes:
      'A night on the decks with nobody on the mic, talked through afterwards: what went on, what it followed, and the two that did not work.\n\nThe running order is the argument. It usually is.',
  },
]

/**
 * A line of the sheet beside the deck, and the second it is sung at.
 *
 * Invented, and it has to be: the record on the platter is a real one and its
 * words belong to somebody. What the page needs is the *shape* of a lyric
 * sheet — short lines, one of them lit, a timestamped silence drawn the way the
 * real sheet draws one — and that is a thing it can write for itself.
 */
export interface Sung {
  at: number
  says: string
}

/**
 * The sheet, once, for the two places that draw it.
 *
 * The station's own lyric view is a list in time order and a playhead (see
 * `activeLineIndex` in lib/lyrics.ts), which is exactly what this is. It is
 * used twice on this page — lit by the session grid's own loop, and frozen
 * mid-verse inside the drawn station in `ListenerView` — and it is one list for
 * the reason the evening is one list: two would be two things to keep in step,
 * and the first time they drifted the page would be showing a verse in one
 * place that the other says was never sung.
 *
 * `· · ·` is a bar with nobody singing over it, which the real sheet draws as
 * itself rather than leaving a hole. It is a line like any other here: it has a
 * second, and the playhead reaches it, and while it is lit nothing is being
 * said, which is what a rest looks like on a sheet that follows a record.
 *
 * The seconds are what the clock over the level meter reads, so the two cells
 * are on the same moment of the same record. See `Inside`.
 */
export const SHEET: readonly Sung[] = [
  { at: 34, says: 'Static settles on the evening air' },
  { at: 48, says: 'A needle drops into the quiet' },
  { at: 62, says: 'Every window leaning on the same slow song' },
  { at: 78, says: '· · ·' },
  { at: 96, says: 'Miles apart and humming along' },
  { at: 110, says: 'Nobody ahead and nobody behind' },
  { at: 124, says: 'Hold the moment while it plays' },
  { at: 138, says: 'It only comes around the once' },
  { at: 152, says: 'The chorus lands on every roof at once' },
  { at: 166, says: 'And the room goes quiet together' },
  { at: 188, says: '· · ·' },
  { at: 210, says: 'Somebody writes the hour down' },
  { at: 232, says: 'So sing it soft and sing it slow' },
  { at: 252, says: 'The night is long and the night knows' },
]

/**
 * Which line is being sung at a given second, or -1 before the first of them.
 *
 * The same question `saidBy` answers for the room, and answered separately
 * because the two are different shapes: a chat line arrives and stays on the
 * screen with everything said before it, and a sung line is lit *instead of*
 * the one before. One index rather than a count, because the sheet's whole job
 * is that exactly one line is bright.
 *
 * -1 rather than 0 before the singing starts. A sheet with its first line
 * already lit through a thirty-second intro is a sheet that is wrong for thirty
 * seconds, and the station's own view has the same opinion.
 */
export function sungAt(sheet: readonly Sung[], seconds: number): number {
  let index = -1
  for (const [position, line] of sheet.entries()) {
    if (line.at > seconds) break
    index = position
  }
  return index
}

export interface Wish {
  says: string
}

/**
 * What the room asked for.
 *
 * Free text, and that is the point of the section: there is no library to browse
 * and nothing a listener can queue themselves, so what arrives on the decks is a
 * sentence rather than a track id. None of these is a genre.
 *
 * Eight rather than four, because they are no longer a wall you read to the end
 * of: they go past in columns, and a loop short enough to recognise on its second
 * lap is a loop you stop believing.
 *
 * A sentence and nothing else. Each of these used to carry what became of it
 * (played, or still waiting) and the card said so underneath. The cards are one
 * quotation now, so there is nothing here for a state to be shown by, and a field
 * kept against the day something might read it is a field that will disagree with
 * the page. That not every wish gets played is still said further down, in words
 * rather than in a label: "the library is mine. The room asks; I decide."
 */
export const WISHES: readonly Wish[] = [
  { says: 'the song from the end of that film. you know the one' },
  { says: 'a song my mother would know the words to' },
  { says: 'the one you played last week that nobody could name' },
  { says: 'whatever you would put on if we all left' },
  { says: 'slower. we are all still here' },
  { says: 'anything with a room in it. people, not a studio' },
]

export interface Played {
  /** Wall clock, because this is the evening rather than the song. */
  at: string
  title: string
  artist: string
  /**
   * The sleeve, for the records the page has one for.
   *
   * Optional on purpose: an evening is longer than the art anyone has to hand,
   * and the list further down the page draws every record whether or not there
   * is a picture of it. Only the ones with a sleeve end up in the pile.
   */
  cover?: { src: string; album: string }
}

/**
 * The evening so far.
 *
 * Not an archive: the station keeps this for as long as it is up, so a person
 * arriving at nine can see what they missed. The section that draws it says so,
 * because a grid of past sessions is a thing this station does not have.
 *
 * One list, drawn twice: as the pile of sleeves at the top of the page, and as
 * the written-down evening further down. Two lists would be two things to keep
 * in step, and the first time they drifted the page would be showing a record
 * in the pile that the evening says was never on.
 */
export const BEEN_ON: readonly Played[] = [
  {
    at: '23:14',
    title: 'Wish You Were Here',
    artist: 'Pink Floyd',
    cover: { src: pinkFloyd, album: 'Wish You Were Here' },
  },
  {
    at: '23:08',
    title: 'Didn’t Cha Know',
    artist: 'Erykah Badu',
    cover: { src: erykahBadu, album: 'Mama’s Gun' },
  },
  {
    at: '23:01',
    title: 'Cherish the Day',
    artist: 'Sade',
    cover: { src: sade, album: 'Love Deluxe' },
  },
  {
    at: '22:54',
    title: 'Redbone',
    artist: 'Childish Gambino',
    cover: { src: childishGambino, album: '“Awaken, My Love!”' },
  },
  {
    at: '22:48',
    title: 'Dreams',
    artist: 'Fleetwood Mac',
    cover: { src: fleetwoodMac, album: 'Rumours' },
  },
  {
    at: '22:41',
    title: 'Lover, You Should’ve Come Over',
    artist: 'Jeff Buckley',
    cover: { src: jeffBuckley, album: 'Grace' },
  },
  {
    at: '22:35',
    title: 'Ex-Factor',
    artist: 'Lauryn Hill',
    cover: { src: laurynHill, album: 'The Miseducation of Lauryn Hill' },
  },
  {
    at: '22:29',
    title: 'I Wanna Be Your Lover',
    artist: 'Prince',
    cover: { src: prince, album: 'Prince' },
  },
  {
    at: '22:22',
    title: 'Fake Plastic Trees',
    artist: 'Radiohead',
    cover: { src: radiohead, album: 'The Bends' },
  },
  { at: '22:16', title: 'Tonight', artist: 'Sipho Gumede' },
  { at: '22:10', title: 'Africa', artist: 'D’Angelo' },
]

/**
 * The records with a sleeve, newest first: what the pile is made of.
 *
 * Derived rather than listed, so the pile cannot come to disagree with the
 * evening it is the top of.
 */
export const SLEEVES = BEEN_ON.filter(
  (play): play is Played & { cover: NonNullable<Played['cover']> } => play.cover !== undefined,
)
