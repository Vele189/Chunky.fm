import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Db, closeSession, openDb, openSession } from '../src/db.js'
import { parseClientMessage } from '../src/protocol.js'
import {
  WISH_MAX_LENGTH,
  WishBook,
  isSendableWish,
  isWishStatus,
  normalizeWishText,
} from '../src/wishes.js'
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

const book = (options: { limit?: number; now?: () => number } = {}) =>
  new WishBook({ db, sessionId, ...options })

describe('normalizeWishText', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeWishText('  something   off Rumours  ')).toBe('something off Rumours')
  })

  it('flattens a pasted newline instead of refusing it', () => {
    expect(normalizeWishText('anything by\nFleetwood Mac')).toBe('anything by Fleetwood Mac')
  })

  it('caps by character, not by UTF-16 unit', () => {
    const capped = normalizeWishText('🎵'.repeat(WISH_MAX_LENGTH + 10))

    expect([...capped]).toHaveLength(WISH_MAX_LENGTH)
    expect(capped.endsWith('🎵')).toBe(true)
  })

  it('reads whitespace and control characters as nothing to ask for', () => {
    expect(normalizeWishText('  \n\t ')).toBe('')
    expect(isSendableWish('   ')).toBe(false)
    expect(isSendableWish('one more Bowie')).toBe(true)
  })
})

describe('WishBook', () => {
  it('is empty before anyone asks for anything', () => {
    expect(book().list()).toEqual([])
    expect(book().outstanding()).toBe(0)
  })

  it('writes a wish down and hands it back as stored', () => {
    const clock = fakeClock(1_700_000_500_000)
    const made = book({ now: clock.now }).make('sam', '  anything   by Bowie ')

    expect(made).toEqual({
      id: expect.any(Number),
      nickname: 'sam',
      text: 'anything by Bowie',
      at: 1_700_000_500_000,
      status: 'new',
    })
  })

  it('reads back in the order things were asked', () => {
    const wishes = book()
    wishes.make('sam', 'first')
    wishes.make('ana', 'second')
    wishes.make('sam', 'third')

    expect(wishes.list().map((wish) => `${wish.nickname}: ${wish.text}`)).toEqual([
      'sam: first',
      'ana: second',
      'sam: third',
    ])
  })

  it('hands over the end of a long session, still oldest first', () => {
    const wishes = book({ limit: 3 })
    for (const text of ['one', 'two', 'three', 'four', 'five']) wishes.make('sam', text)

    expect(wishes.list().map((wish) => wish.text)).toEqual(['three', 'four', 'five'])
  })

  it('survives being reopened — the wishes are in the database', () => {
    book().make('sam', 'still here?')

    expect(book().list().map((wish) => wish.text)).toEqual(['still here?'])
  })

  it('keeps one session out of another', () => {
    book().make('sam', 'first session')

    closeSession(db, sessionId)
    const second = new WishBook({ db, sessionId: openSession(db) })
    second.make('ana', 'second session')

    expect(second.list().map((wish) => wish.text)).toEqual(['second session'])
    expect(book().list().map((wish) => wish.text)).toEqual(['first session'])
  })

  it('marks a wish handled, and counts what is still waiting', () => {
    const wishes = book()
    const first = wishes.make('sam', 'one')
    wishes.make('ana', 'two')
    expect(wishes.outstanding()).toBe(2)

    expect(wishes.setStatus(first.id, 'handled')).toMatchObject({ id: first.id, status: 'handled' })
    expect(wishes.outstanding()).toBe(1)
    // The row stays in the book — handled is a note about it, not a deletion.
    expect(wishes.list()).toHaveLength(2)
  })

  it('puts a wish marked by mistake back', () => {
    const wishes = book()
    const wish = wishes.make('sam', 'the one I meant to keep')

    wishes.setStatus(wish.id, 'handled')
    expect(wishes.setStatus(wish.id, 'new')).toMatchObject({ status: 'new' })
    expect(wishes.outstanding()).toBe(1)
  })

  it('will not mark a wish that belongs to another session', () => {
    const mine = book().make('sam', 'this session')

    closeSession(db, sessionId)
    const later = new WishBook({ db, sessionId: openSession(db) })

    // Null is what the route turns into a 404: the admin of this time on air
    // has no business editing the last one's book.
    expect(later.setStatus(mine.id, 'handled')).toBeNull()
    expect(later.find(mine.id)).toBeNull()
    expect(book().find(mine.id)).toMatchObject({ status: 'new' })
  })

  it('keeps the name as it was at the time, not as it is now', () => {
    const wishes = book()
    wishes.make('sam', 'before the rename')
    wishes.make('samantha', 'after it')

    expect(wishes.list().map((wish) => wish.nickname)).toEqual(['sam', 'samantha'])
  })
})

describe('the wishes table', () => {
  it('refuses a wish that belongs to no session', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO wishes (session_id, nick, text, created_at) VALUES (9999, 'sam', 'hi', 0)`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY/i)
  })

  it('refuses a status nothing could render', () => {
    // The column outlives the process that wrote it, and a wish in a state the
    // admin panel has no row for is a wish nobody will ever see.
    expect(() =>
      db
        .prepare(
          `INSERT INTO wishes (session_id, nick, text, created_at, status)
           VALUES (?, 'sam', 'hi', 0, 'maybe')`,
        )
        .run(sessionId),
    ).toThrow(/CHECK/i)

    expect(isWishStatus('handled')).toBe(true)
    expect(isWishStatus('maybe')).toBe(false)
  })
})

describe('the wish frame', () => {
  it('is accepted, normalised', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'wish', text: ' some  Bowie ' }))).toEqual({
      ok: true,
      message: { type: 'wish', text: 'some Bowie' },
    })
  })

  it('is refused when there is nothing in it', () => {
    for (const text of ['', '   ', '\n']) {
      const parsed = parseClientMessage(JSON.stringify({ type: 'wish', text }))
      expect(parsed).toMatchObject({ ok: false, code: 'empty_wish', about: 'wish' })
    }
  })

  it('is refused when it is not a string', () => {
    for (const text of [42, null, { text: 'hi' }, ['hi']]) {
      expect(parseClientMessage(JSON.stringify({ type: 'wish', text })).ok).toBe(false)
    }
  })

  it('is refused rather than truncated when it is too long', () => {
    const parsed = parseClientMessage(
      JSON.stringify({ type: 'wish', text: 'x'.repeat(WISH_MAX_LENGTH + 1) }),
    )

    expect(parsed).toMatchObject({ ok: false, code: 'wish_too_long', about: 'wish' })
  })

  it('carries no author and no track — that is the roster’s and the admin’s', () => {
    const parsed = parseClientMessage(
      JSON.stringify({ type: 'wish', text: 'some Bowie', nickname: 'someone else', trackId: 3 }),
    )

    expect(parsed).toEqual({ ok: true, message: { type: 'wish', text: 'some Bowie' } })
  })
})
