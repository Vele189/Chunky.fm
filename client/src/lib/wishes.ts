import type { SocketErrorCode, Wish, WishStatus } from './protocol.js'

/**
 * The client's half of wishes: what is worth asking for, and what to do with
 * the note that comes back.
 *
 * Mirrors `server/src/wishes.ts` — keep the two in step. The cap here is the
 * composer's; the server enforces its own, and refuses rather than truncates.
 */

export const WISH_MAX_LENGTH = 200

/**
 * How many of a listener's own wishes are kept on screen. Nobody asks for
 * twenty things in one sitting, and this is only ever this client's own — the
 * room's wishes are the admin's list, not this one.
 */
export const MAX_KEPT_WISHES = 20

/** One line, trimmed and capped — the same shape the server will store. */
export function normalizeWishText(raw: string): string {
  const collapsed = raw
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return [...collapsed].slice(0, WISH_MAX_LENGTH).join('').trim()
}

/** Is this worth asking for? The button asks exactly this. */
export function isSendableWish(raw: string): boolean {
  return normalizeWishText(raw).length > 0
}

/**
 * Folds a wish the station wrote down into the list of this listener's own.
 *
 * Keyed on id and ordered by it, so it is idempotent — a frame seen twice
 * changes nothing — and a later wish lands at the end where it was asked.
 * Returns the original array when nothing was new, so React can skip a render.
 */
export function mergeWishes(current: Wish[], incoming: Wish[]): Wish[] {
  const seen = new Set(current.map((wish) => wish.id))
  const fresh = incoming.filter((wish) => !seen.has(wish.id))
  if (fresh.length === 0) return current

  const merged = [...current, ...fresh].sort((a, b) => a.id - b.id)
  return merged.length > MAX_KEPT_WISHES ? merged.slice(-MAX_KEPT_WISHES) : merged
}

/** How a wish's state reads to the person who made it. */
export function wishStatusLabel(status: WishStatus): string {
  return status === 'handled' ? 'played' : 'asked'
}

/**
 * What to tell a listener whose wish the station would not take.
 *
 * Null for anything that is not about a wish they tried to make — including
 * every refusal that belongs to the chat, which has its own notice. The `about`
 * field on the frame is what separates the two; this only has to explain the
 * codes a wish composer can actually cause.
 */
export function wishRefusal(code: SocketErrorCode): string | null {
  switch (code) {
    case 'slow_down':
      return 'Not asked — you are asking faster than the station will take it.'
    case 'not_joined':
      return 'Not asked — the station has not finished putting you in the room yet.'
    case 'no_wishes':
      return 'Not asked — this station takes no wishes.'
    case 'wish_too_long':
      return 'Not asked — that wish is too long.'
    case 'empty_wish':
      return 'Not asked — there was nothing in that wish.'
    default:
      return null
  }
}
