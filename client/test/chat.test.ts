import { describe, expect, it } from 'vitest'
import {
  MAX_KEPT_MESSAGES,
  MESSAGE_MAX_LENGTH,
  chatRefusal,
  draftAfterRefusal,
  isSendableMessage,
  mergeMessages,
  normalizeMessageText,
} from '../src/lib/chat.js'
import type { ChatMessage } from '../src/lib/protocol.js'

const message = (id: number, text = `message ${id}`): ChatMessage => ({
  id,
  nickname: 'sam',
  text,
  at: 1_700_000_000_000 + id,
})

describe('normalizeMessageText', () => {
  it('trims and collapses, and flattens a pasted newline', () => {
    expect(normalizeMessageText('  hello   there  ')).toBe('hello there')
    expect(normalizeMessageText('one\ntwo')).toBe('one two')
  })

  it('caps by character, not by UTF-16 unit', () => {
    const capped = normalizeMessageText('🎵'.repeat(MESSAGE_MAX_LENGTH + 10))

    expect([...capped]).toHaveLength(MESSAGE_MAX_LENGTH)
    expect(capped.endsWith('🎵')).toBe(true)
  })

  it('knows what is worth sending', () => {
    expect(isSendableMessage('hi')).toBe(true)
    expect(isSendableMessage('   ')).toBe(false)
    expect(isSendableMessage('')).toBe(false)
  })
})

describe('mergeMessages', () => {
  it('appends what is new', () => {
    const merged = mergeMessages([message(1)], [message(2), message(3)])

    expect(merged.map((m) => m.id)).toEqual([1, 2, 3])
  })

  it('ignores a message already shown', () => {
    const current = [message(1), message(2)]

    // The same array back, so a re-render is skipped entirely.
    expect(mergeMessages(current, [message(2)])).toBe(current)
  })

  it('merges a reconnect’s replay without duplicating a line', () => {
    const shown = [message(1), message(2), message(3)]

    // What the server sends on connect: the tail of the conversation, most of
    // which this client already has.
    const merged = mergeMessages(shown, [message(2), message(3), message(4)])

    expect(merged.map((m) => m.id)).toEqual([1, 2, 3, 4])
  })

  it('puts back what was said during an outage, in order', () => {
    const shown = [message(1), message(2)]

    // 3 and 4 were said while this client was offline; 5 arrives with them.
    const merged = mergeMessages(shown, [message(3), message(4), message(5)])

    expect(merged.map((m) => m.id)).toEqual([1, 2, 3, 4, 5])
  })

  it('orders by id even when a batch arrives out of order', () => {
    const merged = mergeMessages([message(2)], [message(3), message(1)])

    expect(merged.map((m) => m.id)).toEqual([1, 2, 3])
  })

  it('keeps a bounded window of a long session', () => {
    const many = Array.from({ length: MAX_KEPT_MESSAGES + 50 }, (_, i) => message(i + 1))

    const merged = mergeMessages([], many)

    expect(merged).toHaveLength(MAX_KEPT_MESSAGES)
    // The end of the conversation is what is kept, not the start.
    expect(merged.at(-1)!.id).toBe(MAX_KEPT_MESSAGES + 50)
  })

  it('starts from nothing without complaining', () => {
    expect(mergeMessages([], [])).toEqual([])
    expect(mergeMessages([], [message(1)]).map((m) => m.id)).toEqual([1])
  })
})

/**
 * What a listener is told when the room would not take what they said.
 *
 * The socket answers a refused `say` with an error frame and nothing else: no
 * echo, no id, nothing that arrives in the conversation. Before this, the client
 * dropped that frame on the floor: the composer had already been cleared
 * optimistically, so a message the server declined left an empty box and an
 * unchanged conversation, which on screen is exactly what saying something
 * successfully looks like.
 */
describe('a message the room refused', () => {
  it('explains itself for every refusal a composer can cause', () => {
    for (const code of ['slow_down', 'not_joined', 'no_chat', 'message_too_long', 'empty_message'] as const) {
      const notice = chatRefusal(code)
      expect(notice, code).not.toBeNull()
      // The point of the line is that it was not sent, not the code itself.
      expect(notice).toMatch(/not sent/i)
    }
  })

  it('says nothing about refusals the listener did not cause', () => {
    // A frame this client got wrong is a bug to fix, not news for the person
    // using it, and putting it on screen would be blaming them for it.
    expect(chatRefusal('unrecognised_message')).toBeNull()
    expect(chatRefusal('command_over_http')).toBeNull()
    expect(chatRefusal('nickname_required')).toBeNull()
  })

  it('hands the unsent text back to an empty composer', () => {
    expect(draftAfterRefusal('', 'what I actually typed')).toBe('what I actually typed')
  })

  it('never types over something newer', () => {
    // The refused text is recoverable: it is still in the conversation nobody
    // had, or can be typed again. What is in the box right now is not.
    expect(draftAfterRefusal('already onto the next thing', 'the refused one')).toBe(
      'already onto the next thing',
    )
  })

  it('leaves the composer alone when nothing was waiting on an answer', () => {
    // A refusal for something other than a message (the socket refusing a
    // malformed frame) must not put stale text into the box.
    expect(draftAfterRefusal('half a thought', null)).toBe('half a thought')
    expect(draftAfterRefusal('', null)).toBe('')
  })
})

describe('what the composer says about the new refusals', () => {
  it('names being muted, rather than letting the message vanish', () => {
    // A message that disappeared quietly reads exactly like one that was sent.
    expect(chatRefusal('muted')).toMatch(/muted/)
  })

  it('says the station is off air', () => {
    expect(chatRefusal('off_air')).toMatch(/not on air/)
  })
})
