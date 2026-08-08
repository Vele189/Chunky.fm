import type { ScheduledSession } from './protocol.js'

/**
 * When the station is next on, said the way somebody would say it.
 *
 * A timestamp is not an answer. "Back Saturday at 21:00" is, and so is "Tonight
 * at 21:00", and the difference between them is the whole reason this file
 * exists: the same instant means something different depending on when it is
 * being read, and the page is read at every hour of the week.
 *
 * Everything here takes `now` rather than reaching for the clock, so the
 * wording is a pure function of two numbers and can be tested at any hour from
 * any timezone. The station clock is not used and should not be: this is about
 * when the listener's own Saturday evening is, not the server's.
 */

/** Close enough that a countdown would be more annoying than useful. */
const SOON_MS = 15 * 60 * 1000

/**
 * How long an announcement outlives the time it named.
 *
 * A station that starts late is the ordinary case, so the poster has to stay up
 * past the hour on it. But an admin who announced a Saturday and never took it
 * down should not have the page still promising it on Tuesday, so it stops
 * being shown a few hours after the fact rather than never.
 */
const STALE_MS = 6 * 60 * 60 * 1000

/** Local midnight-to-midnight distance, which is what "tomorrow" means. */
function daysApart(from: number, to: number): number {
  const a = new Date(from)
  const b = new Date(to)
  a.setHours(0, 0, 0, 0)
  b.setHours(0, 0, 0, 0)
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

/**
 * Is this announcement still worth showing?
 *
 * The page asks before it draws anything, so a stale one falls back to the
 * plain off-air screen rather than to a promise that has expired.
 */
export function isUpcoming(next: ScheduledSession | null, now: number): next is ScheduledSession {
  return next !== null && now - next.startsAt < STALE_MS
}

/**
 * The line under the poster: "Tonight at 21:00", "Saturday at 21:00".
 *
 * Not a countdown. A station is an evening somebody has to decide to spend, so
 * the useful unit is which evening rather than how many minutes, and a number
 * ticking down would also be wrong the moment the admin ran late.
 */
export function nextSessionLabel(startsAt: number, now: number, locale?: string): string {
  if (startsAt - now <= SOON_MS) return 'Starting soon'

  const at = new Date(startsAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  const days = daysApart(now, startsAt)

  if (days <= 0) return `Tonight at ${at}`
  if (days === 1) return `Tomorrow at ${at}`
  if (days < 7) {
    return `${new Date(startsAt).toLocaleDateString(locale, { weekday: 'long' })} at ${at}`
  }
  const on = new Date(startsAt).toLocaleDateString(locale, { day: 'numeric', month: 'long' })
  return `${on} at ${at}`
}

/**
 * The same thing where there is room for one line and no more: the top bar,
 * which carries it from every view rather than only from the off-air screen.
 */
export function nextSessionShort(startsAt: number, now: number, locale?: string): string {
  if (startsAt - now <= SOON_MS) return 'soon'

  const at = new Date(startsAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  const days = daysApart(now, startsAt)

  if (days <= 0) return at
  if (days === 1) return `tomorrow ${at}`
  if (days < 7) {
    const day = new Date(startsAt).toLocaleDateString(locale, { weekday: 'short' })
    return `${day} ${at}`
  }
  return new Date(startsAt).toLocaleDateString(locale, { day: 'numeric', month: 'short' })
}

/**
 * What an admin's date field needs, which is the one place this goes the other
 * way: an epoch back into the `datetime-local` spelling, in *local* time,
 * because that is the only thing the input understands.
 */
export function toLocalInput(at: number): string {
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * And back again. Null for a field that is empty or half-typed.
 *
 * The shape is checked before `Date` is allowed near it, because `Date` is
 * far too willing: `new Date('2024-01-')` is a real instant in January rather
 * than the error it ought to be, and an admin halfway through typing a date
 * would otherwise announce one.
 */
const LOCAL_INPUT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/

export function fromLocalInput(value: string): number | null {
  if (!LOCAL_INPUT.test(value)) return null
  const at = new Date(value).getTime()
  return Number.isFinite(at) ? at : null
}
