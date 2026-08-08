/**
 * The sample session the page plays back as you scroll.
 *
 * Every visible number and line on the landing page comes from here, and all of
 * it is invented — one evening's worth of a station that is not running. It has
 * to be: the page in front of the station cannot ask the station anything, and
 * that is the whole reason the page exists. What it must not do is *look* like a
 * report. Everything this drives sits behind `aria-hidden`, and the page says
 * so in words at the one place somebody would otherwise wonder.
 *
 * Kept as data and pure functions, apart from the components that draw it, so
 * the arithmetic underneath the trick — where in the song the scroll has got to,
 * and which lines have been said by then — is testable without a window.
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

/**
 * Where the scroll has got to, as a position in the song.
 *
 * The page is the song: the top is 0:00 and the bottom is the last bar. It is
 * deliberately the whole document rather than one section, because the point of
 * the thing is that a reader arrives at the room section already somewhere in
 * particular, without having been asked to do anything.
 *
 * A page too short to scroll — a very tall window, a phone in landscape — has
 * nothing to divide by. That reads as 0:00 rather than as a division by zero,
 * and the bar simply sits at the start.
 */
export function scrubbed(scrolled: number, scrollable: number, duration: number): number {
  if (!(scrollable > 0)) return 0
  const through = Math.min(1, Math.max(0, scrolled / scrollable))
  // Whole seconds: a clock re-rendering on every pixel of scroll would shimmer,
  // and a listener's clock counts in seconds anyway.
  return Math.round(through * duration)
}

/** How far through the song a position is, as a fraction, for drawing a bar. */
export function through(seconds: number, duration: number): number {
  if (!(duration > 0)) return 0
  return Math.min(1, Math.max(0, seconds / duration))
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
 * The station has no pictures of anybody — a nickname in localStorage is the
 * whole of what it knows — so the avatar is the one thing it can honestly draw:
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
   * A head count in the range the station is actually built for — around thirty,
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
 * lively — it is that all of this is happening at the same instant for
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
 * A sentence and nothing else. Each of these used to carry what became of it —
 * played, or still waiting — and the card said so underneath. The cards are one
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
 * Not an archive — the station keeps this for as long as it is up, so a person
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
 * The records with a sleeve, newest first — what the pile is made of.
 *
 * Derived rather than listed, so the pile cannot come to disagree with the
 * evening it is the top of.
 */
export const SLEEVES = BEEN_ON.filter(
  (play): play is Played & { cover: NonNullable<Played['cover']> } => play.cover !== undefined,
)
