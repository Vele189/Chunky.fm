import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ChatLog,
  MESSAGE_MAX_LENGTH,
  RateLimit,
  isSendableMessage,
  normalizeMessageText,
} from '../src/chat.js'
import { type Db, closeSession, openDb, openSession } from '../src/db.js'
import { parseClientMessage } from '../src/protocol.js'
import { fakeClock } from './helpers.js'

let db: Db
let sessionId: number

beforeEach(() => {
  db = openDb(':memory:')
  sessionId = openSession(db, 1_700_000_000_000)
})

afterEach(() => {
  db.close()
})

const log = (options: { historyLimit?: number; now?: () => number } = {}) =>
  new ChatLog({ db, session: { current: sessionId }, ...options })

describe('normalizeMessageText', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeMessageText('  hello   there  ')).toBe('hello there')
  })

  it('flattens a pasted newline instead of refusing it', () => {
    expect(normalizeMessageText('one\ntwo\nthree')).toBe('one two three')
  })

  it('caps length', () => {
    expect(normalizeMessageText('x'.repeat(MESSAGE_MAX_LENGTH + 50))).toHaveLength(
      MESSAGE_MAX_LENGTH,
    )
  })

  it('cuts between characters, not through one', () => {
    // Sliced by UTF-16 unit this would end in half a surrogate pair.
    const emoji = '🎵'.repeat(MESSAGE_MAX_LENGTH + 10)
    const capped = normalizeMessageText(emoji)

    expect([...capped]).toHaveLength(MESSAGE_MAX_LENGTH)
    expect(capped.endsWith('🎵')).toBe(true)
  })

  it('reads whitespace and control characters as nothing to say', () => {
    expect(normalizeMessageText('  \n\t ')).toBe('')
    expect(isSendableMessage('   ')).toBe(false)
    expect(isSendableMessage('hi')).toBe(true)
  })
})

describe('ChatLog', () => {
  it('is empty before anyone says anything', () => {
    expect(log().recent()).toEqual([])
    expect(log().count()).toBe(0)
  })

  it('writes a message down and hands it back as stored', () => {
    const clock = fakeClock(1_700_000_500_000)
    const posted = log({ now: clock.now }).post('sam', '  hello   room ')

    expect(posted).toEqual({
      id: expect.any(Number),
      nickname: 'sam',
      text: 'hello room',
      at: 1_700_000_500_000,
    })
  })

  it('reads back in the order things were said', () => {
    const chat = log()
    chat.post('sam', 'first')
    chat.post('ana', 'second')
    chat.post('sam', 'third')

    expect(chat.recent().map((m) => `${m.nickname}: ${m.text}`)).toEqual([
      'sam: first',
      'ana: second',
      'sam: third',
    ])
  })

  it('hands a joiner the end of the conversation, not the start of it', () => {
    const chat = log({ historyLimit: 3 })
    for (const text of ['one', 'two', 'three', 'four', 'five']) chat.post('sam', text)

    expect(chat.recent().map((m) => m.text)).toEqual(['three', 'four', 'five'])
    // Still oldest-first within the window, so a client can append blindly.
    expect(chat.recent().map((m) => m.id)).toEqual([...chat.recent()].map((m) => m.id).sort())
  })

  it('survives being reopened — the messages are in the database', () => {
    log().post('sam', 'still here?')

    // A new log over the same session id is what a reconnect reads from.
    expect(log().recent().map((m) => m.text)).toEqual(['still here?'])
  })

  it('keeps one session out of another', () => {
    log().post('sam', 'first session')

    closeSession(db, sessionId)
    const second = new ChatLog({ db, session: { current: openSession(db) } })
    second.post('ana', 'second session')

    expect(second.recent().map((m) => m.text)).toEqual(['second session'])
    expect(log().recent().map((m) => m.text)).toEqual(['first session'])
  })

  it('keeps the name as it was at the time, not as it is now', () => {
    const chat = log()
    chat.post('sam', 'before the rename')
    chat.post('samantha', 'after it')

    expect(chat.recent().map((m) => m.nickname)).toEqual(['sam', 'samantha'])
  })
})

describe('sessions', () => {
  it('opens with no end, and ends once', () => {
    const row = () =>
      db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as {
        started_at: number
        ended_at: number | null
      }

    expect(row().started_at).toBe(1_700_000_000_000)
    expect(row().ended_at).toBeNull()

    closeSession(db, sessionId, 1_700_000_900_000)
    expect(row().ended_at).toBe(1_700_000_900_000)

    // Closing again leaves the original time alone.
    closeSession(db, sessionId, 1_700_009_999_999)
    expect(row().ended_at).toBe(1_700_000_900_000)
  })

  it('refuses a message that belongs to no session', () => {
    // The foreign key is what keeps orphaned chat out of the table.
    expect(() =>
      db
        .prepare(
          `INSERT INTO messages (session_id, nick, text, created_at) VALUES (9999, 'sam', 'hi', 0)`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY/i)
  })
})

describe('RateLimit', () => {
  it('allows a burst and then refuses', () => {
    const clock = fakeClock()
    const limit = new RateLimit({ burst: 3, refillMs: 1_000, now: clock.now })

    expect([limit.take(), limit.take(), limit.take()]).toEqual([true, true, true])
    expect(limit.take()).toBe(false)
  })

  it('earns one back per interval', () => {
    const clock = fakeClock()
    const limit = new RateLimit({ burst: 2, refillMs: 1_000, now: clock.now })
    limit.take()
    limit.take()

    clock.advance(999)
    expect(limit.take()).toBe(false)

    clock.advance(1)
    expect(limit.take()).toBe(true)
    expect(limit.take()).toBe(false)
  })

  it('does not bank more than the burst while idle', () => {
    const clock = fakeClock()
    const limit = new RateLimit({ burst: 2, refillMs: 1_000, now: clock.now })

    clock.advance(60_000) // a minute of saying nothing

    expect([limit.take(), limit.take()]).toEqual([true, true])
    expect(limit.take()).toBe(false)
  })
})

describe('the say frame', () => {
  it('is accepted, normalised', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'say', text: ' hi  there ' }))).toEqual({
      ok: true,
      message: { type: 'say', text: 'hi there' },
    })
  })

  it('is refused when there is nothing in it', () => {
    for (const text of ['', '   ', '\n']) {
      expect(parseClientMessage(JSON.stringify({ type: 'say', text })).ok).toBe(false)
    }
  })

  it('is refused when it is not a string', () => {
    for (const text of [42, null, { text: 'hi' }, ['hi']]) {
      expect(parseClientMessage(JSON.stringify({ type: 'say', text })).ok).toBe(false)
    }
  })

  it('is refused rather than truncated when it is too long', () => {
    const parsed = parseClientMessage(
      JSON.stringify({ type: 'say', text: 'x'.repeat(MESSAGE_MAX_LENGTH + 1) }),
    )

    expect(parsed.ok).toBe(false)
    expect(parsed.ok === false && parsed.error).toMatch(/at most/)
  })

  it('carries no author — that is the roster’s to say', () => {
    const parsed = parseClientMessage(
      JSON.stringify({ type: 'say', text: 'hi', nickname: 'someone else', id: 1 }),
    )

    expect(parsed).toEqual({ ok: true, message: { type: 'say', text: 'hi' } })
  })
})
