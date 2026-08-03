import { describe, expect, it } from 'vitest'
import { NICKNAME_MAX_LENGTH, Presence, normalizeNickname } from '../src/presence.js'
import { parseClientMessage } from '../src/protocol.js'

describe('normalizeNickname', () => {
  it('trims, collapses whitespace and drops control characters', () => {
    expect(normalizeNickname('  sam  ')).toBe('sam')
    expect(normalizeNickname('sam\nthe\tdj')).toBe('sam the dj')
    expect(normalizeNickname('sam\u200b')).toBe('sam') // zero-width space: not a name
  })

  it('caps length, and does not leave the cut mid-padding', () => {
    expect(normalizeNickname('x'.repeat(50))).toHaveLength(NICKNAME_MAX_LENGTH)
    expect(normalizeNickname(`${'a'.repeat(23)}   b`)).toBe('a'.repeat(23))
  })

  it('reads a name made only of whitespace as no name at all', () => {
    expect(normalizeNickname('   \n\t ')).toBe('')
  })
})

describe('Presence', () => {
  it('is empty until someone names themselves', () => {
    const presence = new Presence()
    expect(presence.size).toBe(0)
    expect(presence.list()).toEqual([])
    expect(presence.has(1)).toBe(false)
  })

  it('lists listeners in the order they joined', () => {
    const presence = new Presence()
    presence.join(1, 'first')
    presence.join(2, 'second')
    presence.join(3, 'third')

    expect(presence.list()).toEqual([
      { id: 1, nickname: 'first' },
      { id: 2, nickname: 'second' },
      { id: 3, nickname: 'third' },
    ])
  })

  it('keeps two listeners who chose the same name apart', () => {
    const presence = new Presence()
    presence.join(1, 'sam')
    presence.join(2, 'sam')

    expect(presence.size).toBe(2)
    expect(presence.list().map((l) => l.id)).toEqual([1, 2])
  })

  it('normalises what it is given rather than trusting it', () => {
    const presence = new Presence()
    presence.join(1, '  sam\nthe dj  ')

    expect(presence.list()).toEqual([{ id: 1, nickname: 'sam the dj' }])
  })

  it('refuses a nickname that normalises to nothing', () => {
    const presence = new Presence()

    expect(presence.join(1, '   ')).toBe(false)
    expect(presence.size).toBe(0)
  })

  it('reports whether the roster actually changed', () => {
    const presence = new Presence()

    expect(presence.join(1, 'sam')).toBe(true)
    expect(presence.join(1, 'sam')).toBe(false) // same socket, same name
    expect(presence.join(1, 'sam ')).toBe(false) // and the same after normalising
    expect(presence.join(1, 'samantha')).toBe(true) // a rename is a change
    expect(presence.list()).toEqual([{ id: 1, nickname: 'samantha' }])
  })

  it('keeps a renamed listener in place rather than moving them to the end', () => {
    const presence = new Presence()
    presence.join(1, 'first')
    presence.join(2, 'second')
    presence.join(1, 'renamed')

    expect(presence.list().map((l) => l.nickname)).toEqual(['renamed', 'second'])
  })

  it('removes a listener, and says whether there was one to remove', () => {
    const presence = new Presence()
    presence.join(1, 'sam')

    expect(presence.leave(1)).toBe(true)
    expect(presence.leave(1)).toBe(false)
    // The common case: a tab that loaded the page and closed it without joining.
    expect(presence.leave(99)).toBe(false)
    expect(presence.list()).toEqual([])
  })

  it('hands out a copy — a caller cannot edit the roster by editing the list', () => {
    const presence = new Presence()
    presence.join(1, 'sam')

    presence.list().pop()

    expect(presence.size).toBe(1)
  })
})

describe('the join frame', () => {
  it('is accepted, normalised, from a listener', () => {
    const parsed = parseClientMessage(JSON.stringify({ type: 'join', nickname: '  sam\n ' }))

    expect(parsed).toEqual({ ok: true, message: { type: 'join', nickname: 'sam' } })
  })

  it('is refused when the nickname is empty or not a name at all', () => {
    // The last is a lone control character: not whitespace, and not a name.
    for (const nickname of ['', '   ', '\u0000']) {
      const parsed = parseClientMessage(JSON.stringify({ type: 'join', nickname }))
      expect(parsed.ok, JSON.stringify(nickname)).toBe(false)
    }
  })

  it('is refused when the nickname is not a string', () => {
    for (const nickname of [42, null, ['sam'], { name: 'sam' }]) {
      expect(parseClientMessage(JSON.stringify({ type: 'join', nickname })).ok).toBe(false)
    }
    expect(parseClientMessage(JSON.stringify({ type: 'join' })).ok).toBe(false)
  })

  it('buys no control: a join is still not a command', () => {
    const parsed = parseClientMessage(JSON.stringify({ type: 'join', nickname: 'sam', play: 1 }))

    // The extra field is dropped, not honoured — what comes out is the frame
    // this parser knows and nothing else.
    expect(parsed).toEqual({ ok: true, message: { type: 'join', nickname: 'sam' } })
  })
})
