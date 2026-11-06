import { describe, expect, it } from 'vitest'
import { AudioTrace, type TraceBatch, bufferedAhead, srcName } from '../src/lib/audio-trace.js'

function recorder(options: Partial<ConstructorParameters<typeof AudioTrace>[0]> = {}) {
  const sent: TraceBatch[] = []
  const trace = new AudioTrace({ send: (batch) => sent.push(batch), now: () => 1_000, ...options })
  return { trace, sent }
}

const ranges = (...pairs: [number, number][]) => ({
  length: pairs.length,
  start: (i: number) => pairs[i]![0],
  end: (i: number) => pairs[i]![1],
})

describe('AudioTrace', () => {
  it('holds events until flushed', () => {
    const { trace, sent } = recorder()
    trace.record('waiting')
    expect(sent).toHaveLength(0)
    trace.flush()
    expect(sent[0]!.events).toEqual([{ at: 1_000, server: null, kind: 'waiting' }])
  })

  it('flushes on its own once a batch is full', () => {
    const { trace, sent } = recorder({ batchSize: 3 })
    for (let i = 0; i < 3; i++) trace.record('beat')
    expect(sent).toHaveLength(1)
    expect(trace.pending).toBe(0)
  })

  it('sends the user agent once per page, not once per batch', () => {
    const { trace, sent } = recorder({ ua: 'Safari' })
    trace.record('a')
    trace.flush()
    trace.record('b')
    trace.flush()
    expect(sent[0]!.ua).toBe('Safari')
    expect(sent[1]!.ua).toBeUndefined()
  })

  it('drops the oldest events past its cap, and says how many', () => {
    const { trace, sent } = recorder({ batchSize: 100, maxBuffered: 2 })
    trace.record('one')
    trace.record('two')
    trace.record('three')
    trace.flush()
    expect(sent[0]!.events.map((e) => e.kind)).toEqual(['two', 'three'])
    expect(sent[0]!.dropped).toBe(1)
  })

  it('records an element against where the station says it should be', () => {
    const { trace, sent } = recorder({ serverNow: () => 5_000.4 })
    const audio = {
      currentTime: 10.5,
      readyState: 2,
      networkState: 2,
      playbackRate: 1.02,
      buffered: ranges([0, 11]),
      getAttribute: () => '/api/audio/abc.mp3',
    } as unknown as HTMLMediaElement
    trace.recordElement('waiting', 'b', audio, { track: 7, expected: 12 })
    trace.flush()
    expect(sent[0]!.events[0]).toEqual({
      at: 1_000,
      server: 5_000,
      kind: 'waiting',
      deck: 'b',
      src: 'abc.mp3',
      track: 7,
      pos: 10.5,
      expected: 12,
      diff: -1.5,
      ready: 2,
      net: 2,
      ahead: 0.5,
      rate: 1.02,
    })
  })
})

describe('bufferedAhead', () => {
  it('measures from the needle to the end of its range', () => {
    expect(bufferedAhead({ currentTime: 30, buffered: ranges([0, 10], [25, 40]) } as never)).toBe(10)
  })

  it('is null when the needle sits in a hole, which is a stall waiting to happen', () => {
    expect(bufferedAhead({ currentTime: 15, buffered: ranges([0, 10]) } as never)).toBeNull()
  })
})

describe('srcName', () => {
  it('keeps the filename only', () => {
    expect(srcName({ getAttribute: () => '/api/audio/f00.flac' } as never)).toBe('f00.flac')
    expect(srcName({ getAttribute: () => null } as never)).toBeNull()
  })
})
