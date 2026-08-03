import { describe, expect, it } from 'vitest'
import {
  MAX_KEPT_MESSAGES,
  MESSAGE_MAX_LENGTH,
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
