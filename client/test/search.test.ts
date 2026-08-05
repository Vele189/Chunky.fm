import { describe, expect, it } from 'vitest'
import { matchesFilter, normalizeFilter } from '../src/lib/search.js'

describe('normalizeFilter', () => {
  it('folds case and trims', () => {
    expect(normalizeFilter('  Daily Chase ')).toBe('daily chase')
  })

  it('is empty for whitespace only', () => {
    expect(normalizeFilter('   ')).toBe('')
  })
})

describe('matchesFilter', () => {
  it('keeps everything when nothing has been typed', () => {
    expect(matchesFilter('', 'Daily Chase', 'eloise Case')).toBe(true)
    expect(matchesFilter('   ', null, undefined)).toBe(true)
  })

  it('matches a title or an artist, either case', () => {
    expect(matchesFilter('CHASE', 'Daily Chase', 'eloise Case')).toBe(true)
    expect(matchesFilter('eloise', 'Daily Chase', 'eloise Case')).toBe(true)
  })

  it('does not match across two fields at once', () => {
    expect(matchesFilter('chase eloise', 'Daily Chase', 'eloise Case')).toBe(false)
  })

  it('survives a row with no artist', () => {
    expect(matchesFilter('chase', 'Daily Chase', null)).toBe(true)
    expect(matchesFilter('eloise', 'Daily Chase', null)).toBe(false)
  })
})
