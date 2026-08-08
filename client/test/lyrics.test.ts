import { describe, expect, it } from 'vitest'
import { activeLineIndex, fetchLyrics, parseLrc } from '../src/lib/lyrics.js'

describe('parseLrc', () => {
  it('reads LRCLIB lines into time order', () => {
    const lines = parseLrc(
      '[00:05.69] And disciplinary remains mercifully\n' +
        '[00:08.51] Yes and um\n' +
        '[00:12.24] Yes, yes',
    )
    expect(lines).toEqual([
      { timeMs: 5690, text: 'And disciplinary remains mercifully' },
      { timeMs: 8510, text: 'Yes and um' },
      { timeMs: 12240, text: 'Yes, yes' },
    ])
  })

  it('keeps a timestamped silence as a line with no words', () => {
    const lines = parseLrc('[00:14.10] I am sure of it\n[00:17.10] \n[01:34.73] So, so you think')
    expect(lines[1]).toEqual({ timeMs: 17100, text: '' })
  })

  it('sorts lines whose timestamps arrive out of order', () => {
    const lines = parseLrc('[01:00.00] second\n[00:30.00] first')
    expect(lines.map((line) => line.text)).toEqual(['first', 'second'])
  })

  it('unrolls a chorus tagged with every time it comes around', () => {
    const lines = parseLrc('[00:10.00][01:10.00] how I wish\n[00:20.00] you were here')
    expect(lines).toEqual([
      { timeMs: 10_000, text: 'how I wish' },
      { timeMs: 20_000, text: 'you were here' },
      { timeMs: 70_000, text: 'how I wish' },
    ])
  })

  it('drops headers and stray prose — a line with no time has no moment', () => {
    const lines = parseLrc('[ar:Pink Floyd]\n[ti:Wish You Were Here]\nnot a lyric\n[00:05.00] one')
    expect(lines).toEqual([{ timeMs: 5000, text: 'one' }])
  })

  it('takes fractions in centiseconds, milliseconds or not at all', () => {
    const lines = parseLrc('[00:01] a\n[00:01.5] b\n[00:01.500] c\n[10:00.00] d')
    expect(lines.map((line) => line.timeMs)).toEqual([1000, 1500, 1500, 600_000])
  })
})

describe('activeLineIndex', () => {
  const lines = parseLrc('[00:05.00] one\n[00:10.00] two\n[00:15.00] three')

  it('is nobody before the first line — an intro has no lyric', () => {
    expect(activeLineIndex(lines, 0)).toBe(-1)
    expect(activeLineIndex(lines, 4999)).toBe(-1)
  })

  it('is the last line whose moment has arrived', () => {
    expect(activeLineIndex(lines, 5000)).toBe(0)
    expect(activeLineIndex(lines, 12_000)).toBe(1)
  })

  it('holds the final line to the end of the song', () => {
    expect(activeLineIndex(lines, 90_000)).toBe(2)
  })
})

describe('fetchLyrics', () => {
  it('unwraps the words from the station', async () => {
    const found = await fetchLyrics(3, async () =>
      new Response(JSON.stringify({ lyrics: { synced: '[00:01.00] hi', plain: 'hi' } }), {
        status: 200,
      }),
    )
    expect(found).toEqual({ synced: '[00:01.00] hi', plain: 'hi' })
  })

  it('reads a 404 as no words and network trouble the same way', async () => {
    expect(await fetchLyrics(3, async () => new Response(null, { status: 404 }))).toBeNull()
    expect(
      await fetchLyrics(3, async () => {
        throw new Error('offline')
      }),
    ).toBeNull()
  })
})
