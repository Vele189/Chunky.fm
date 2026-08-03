import { describe, expect, it } from 'vitest'
import { chatRefusal } from '../src/lib/chat.js'
import {
  type ErrorMessage,
  type SocketErrorCode,
  type Wish,
  refusalAbout,
} from '../src/lib/protocol.js'
import {
  MAX_KEPT_WISHES,
  WISH_MAX_LENGTH,
  isSendableWish,
  mergeWishes,
  normalizeWishText,
  wishRefusal,
  wishStatusLabel,
} from '../src/lib/wishes.js'

const wish = (id: number, text = `wish ${id}`): Wish => ({
  id,
  nickname: 'sam',
  text,
  at: 1_700_000_000_000 + id,
  status: 'new',
})

describe('normalizeWishText', () => {
  it('trims and collapses, and flattens a pasted newline', () => {
    expect(normalizeWishText('  anything   off Rumours  ')).toBe('anything off Rumours')
    expect(normalizeWishText('anything by\nFleetwood Mac')).toBe('anything by Fleetwood Mac')
  })

  it('caps by character, not by UTF-16 unit', () => {
    const capped = normalizeWishText('🎵'.repeat(WISH_MAX_LENGTH + 10))

    expect([...capped]).toHaveLength(WISH_MAX_LENGTH)
    expect(capped.endsWith('🎵')).toBe(true)
  })

  it('knows what is worth asking for', () => {
    expect(isSendableWish('some Bowie')).toBe(true)
    expect(isSendableWish('   ')).toBe(false)
    expect(isSendableWish('')).toBe(false)
  })
})

describe('mergeWishes', () => {
  it('appends what is new, oldest first', () => {
    expect(mergeWishes([wish(1)], [wish(2)]).map((w) => w.id)).toEqual([1, 2])
  })

  it('ignores a wish already shown', () => {
    const current = [wish(1)]

    // The same array back, so a re-render is skipped entirely.
    expect(mergeWishes(current, [wish(1)])).toBe(current)
  })

  it('keeps a bounded list of a long evening', () => {
    const many = Array.from({ length: MAX_KEPT_WISHES + 5 }, (_, i) => wish(i + 1))

    const merged = mergeWishes([], many)

    expect(merged).toHaveLength(MAX_KEPT_WISHES)
    expect(merged.at(-1)!.id).toBe(MAX_KEPT_WISHES + 5)
  })
})

describe('what a wish looks like to the person who made it', () => {
  it('reads as asked until somebody has done something about it', () => {
    expect(wishStatusLabel('new')).toBe('asked')
    expect(wishStatusLabel('handled')).toBe('played')
  })
})

/**
 * Two composers share one socket, so every refusal has to land under the right
 * one. `about` is what separates them: without it, a wish refused for pace also
 * lit up the chat, telling a listener a message they never sent was not sent.
 */
describe('a refusal finds its own composer', () => {
  const refusal = (code: SocketErrorCode, about?: ErrorMessage['about'], seq = 1) => ({
    error: { type: 'error', code, message: 'nope', ...(about ? { about } : {}) } as ErrorMessage,
    seq,
  })

  it('hands a wish refusal to the wishes and nothing to the chat', () => {
    const paced = refusal('slow_down', 'wish')

    expect(refusalAbout(paced, 'wish')).toBe(paced)
    expect(refusalAbout(paced, 'say')).toBeNull()
  })

  it('hands a message refusal to the chat and nothing to the wishes', () => {
    const paced = refusal('slow_down', 'say')

    expect(refusalAbout(paced, 'say')).toBe(paced)
    expect(refusalAbout(paced, 'wish')).toBeNull()
  })

  it('gives neither of them a refusal that was about neither', () => {
    // A malformed frame is this client's bug, and a rename is not a composer.
    expect(refusalAbout(refusal('unrecognised_message'), 'say')).toBeNull()
    expect(refusalAbout(refusal('slow_down', 'join'), 'wish')).toBeNull()
    expect(refusalAbout(null, 'wish')).toBeNull()
  })

  it('explains itself for every refusal a wish can cause', () => {
    for (const code of ['slow_down', 'not_joined', 'no_wishes', 'wish_too_long', 'empty_wish'] as const) {
      const notice = wishRefusal(code)
      expect(notice, code).not.toBeNull()
      // The point of the line is that it was not asked, not the code itself.
      expect(notice).toMatch(/not asked/i)
    }
  })

  it('says nothing about refusals a wish composer cannot cause', () => {
    expect(wishRefusal('message_too_long')).toBeNull()
    expect(wishRefusal('empty_message')).toBeNull()
    expect(wishRefusal('no_chat')).toBeNull()
    expect(wishRefusal('unrecognised_message')).toBeNull()

    // And the chat says nothing about a wish's, so a station that ever dropped
    // `about` would go quiet rather than blaming the wrong box.
    expect(chatRefusal('wish_too_long')).toBeNull()
    expect(chatRefusal('empty_wish')).toBeNull()
    expect(chatRefusal('no_wishes')).toBeNull()
  })
})
