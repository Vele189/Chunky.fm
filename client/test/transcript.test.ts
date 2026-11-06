import { describe, expect, it } from 'vitest'
import { activeCueIndex, fetchTranscript, parseTranscript } from '../src/lib/transcript.js'

/** The shape the transcription tool this archive uses actually writes. */
const REAL = [
  'Untitled - August 23, 2026',
  '',
  '00:00:00 Speaker 1: All right, there we go. There we go.',
  '',
  '00:00:04 Speaker 2: Okay. Um, but you had asked about the name.',
  '',
  '00:04:31 Speaker 3: So me personally, uh, the reason why that episode.',
].join('\n')

describe('parseTranscript', () => {
  it('reads a tool transcript into cues, and drops its title line', () => {
    expect(parseTranscript(REAL)).toEqual([
      { timeMs: 0, speaker: 'Speaker 1', text: 'All right, there we go. There we go.' },
      { timeMs: 4000, speaker: 'Speaker 2', text: 'Okay. Um, but you had asked about the name.' },
      {
        timeMs: 271_000,
        speaker: 'Speaker 3',
        text: 'So me personally, uh, the reason why that episode.',
      },
    ])
  })

  it('reads an hour past the hour, rather than starting again at zero', () => {
    expect(parseTranscript('01:27:42 Speaker 3: Right. Um.')[0]?.timeMs).toBe(5_262_000)
  })

  it('takes the hour as optional, and a bracketed timestamp as well', () => {
    const cues = parseTranscript('04:31 first\n[00:09:02] second')
    expect(cues.map((cue) => cue.timeMs)).toEqual([271_000, 542_000])
    expect(cues.map((cue) => cue.text)).toEqual(['first', 'second'])
  })

  it('ignores a fraction of a second, and does not choke on one', () => {
    expect(parseTranscript('00:00:04.250 Speaker 1: Okay.')[0]).toEqual({
      timeMs: 4000,
      speaker: 'Speaker 1',
      text: 'Okay.',
    })
  })

  it('keeps a cue with no speaker on it', () => {
    expect(parseTranscript('00:00:04 Okay, but you had asked about the name.')[0]).toEqual({
      timeMs: 4000,
      speaker: null,
      text: 'Okay, but you had asked about the name.',
    })
  })

  it('does not read a clause ending in a colon as somebody s name', () => {
    // The trap: "So here is the thing: it was fine" is one person talking, not
    // a person called "So here is the thing".
    const cue = parseTranscript('00:00:04 So here is the thing: it was fine.')[0]
    expect(cue?.speaker).toBeNull()
    expect(cue?.text).toBe('So here is the thing: it was fine.')
  })

  it('reads a name with an initial in it', () => {
    expect(parseTranscript('00:00:04 Dr. Naledi M: We were talking about Kemet.')[0]).toEqual({
      timeMs: 4000,
      speaker: 'Dr. Naledi M',
      text: 'We were talking about Kemet.',
    })
  })

  it('joins a hard-wrapped paragraph back into one cue', () => {
    const cues = parseTranscript(
      '00:00:04 Speaker 2: Okay. Um, but you had\nasked about the name.\n\n00:00:16 Speaker 3: Oh.',
    )
    expect(cues).toHaveLength(2)
    expect(cues[0]?.text).toBe('Okay. Um, but you had asked about the name.')
  })

  it('does not mistake a time somebody mentioned for the time they said it', () => {
    // No separator after it: this is a cue about half past twelve, not a cue at
    // half past twelve.
    const cues = parseTranscript('00:00:04 Speaker 1: Right.\n12:30pm is when we started.')
    expect(cues).toHaveLength(1)
    expect(cues[0]?.text).toBe('Right. 12:30pm is when we started.')
  })

  it('sorts cues that arrive out of order', () => {
    const cues = parseTranscript('00:01:00 second\n00:00:30 first')
    expect(cues.map((cue) => cue.text)).toEqual(['first', 'second'])
  })

  it('parses a transcript with no timestamps to nothing, so the page can read it instead', () => {
    // Not a failure. The player lays an untimed transcript out as paragraphs,
    // the way the station's lyric sheet handles words with no clock on them.
    expect(parseTranscript('Speaker 1: All right, there we go.\n\nSpeaker 2: Okay.')).toEqual([])
  })
})

describe('activeCueIndex', () => {
  const cues = parseTranscript(REAL)

  it('is nobody before the first word is spoken', () => {
    // The cue at 0:00 is the first thing said, so a player that has not started
    // is not inside it.
    expect(activeCueIndex(parseTranscript('00:00:04 Speaker 1: Okay.'), 0)).toBe(-1)
  })

  it('is the last cue whose moment has arrived', () => {
    expect(activeCueIndex(cues, 0)).toBe(0)
    expect(activeCueIndex(cues, 3_999)).toBe(0)
    expect(activeCueIndex(cues, 4_000)).toBe(1)
    expect(activeCueIndex(cues, 270_000)).toBe(1)
    expect(activeCueIndex(cues, 900_000)).toBe(2)
  })
})

describe('fetchTranscript', () => {
  it('reads the transcript out of the archive s answer', async () => {
    const fake = (async () =>
      new Response(JSON.stringify({ transcript: REAL }), { status: 200 })) as typeof fetch
    expect(await fetchTranscript('leaving-johannesburg', fake)).toBe(REAL)
  })

  it('is null for an episode nobody has transcribed', async () => {
    // A 404 is the archive s considered answer, not an error.
    const fake = (async () => new Response('{}', { status: 404 })) as typeof fetch
    expect(await fetchTranscript('leaving-johannesburg', fake)).toBeNull()
  })

  it('is null when the station cannot be reached at all', async () => {
    const fake = (async () => {
      throw new Error('offline')
    }) as typeof fetch
    expect(await fetchTranscript('leaving-johannesburg', fake)).toBeNull()
  })

  it('escapes a slug on its way into the address', async () => {
    let asked = ''
    const fake = (async (url: string) => {
      asked = url
      return new Response('{}', { status: 404 })
    }) as unknown as typeof fetch
    await fetchTranscript('a b', fake)
    expect(asked).toBe('/api/episodes/a%20b/transcript')
  })
})
