import { describe, expect, it } from 'vitest'
import { TRAIL_WINDOW_MS, chart, nearest, record } from '../src/lib/trail.js'

const NOW = 1_700_000_000_000

describe('record', () => {
  it('appends the sample and hands back a new array', () => {
    const before = [{ at: NOW - 1000, value: 5 }]
    const after = record(before, 7, NOW)
    expect(after).toEqual([
      { at: NOW - 1000, value: 5 },
      { at: NOW, value: 7 },
    ])
    expect(before).toHaveLength(1)
  })

  it('lets samples older than the window go', () => {
    const trail = [
      { at: NOW - TRAIL_WINDOW_MS - 1, value: 1 },
      { at: NOW - 1000, value: 2 },
    ]
    expect(record(trail, 3, NOW).map((p) => p.value)).toEqual([2, 3])
  })
})

describe('chart', () => {
  const frame = { width: 100, height: 40, now: NOW, pad: 0 }

  it('draws nothing from nothing', () => {
    const geometry = chart([[], []], frame)
    expect(geometry.series.map((line) => line.points)).toEqual([null, null])
  })

  it('puts the newest sample at the right edge and time runs left', () => {
    const geometry = chart(
      [
        [
          { at: NOW - TRAIL_WINDOW_MS / 2, value: 0 },
          { at: NOW, value: 10 },
        ],
      ],
      frame,
    )
    expect(geometry.series[0]!.endX).toBe(100)
    // Halfway through the window sits halfway across the frame.
    expect(geometry.series[0]!.points!.startsWith('50.0,')).toBe(true)
  })

  it('holds every line to one shared scale', () => {
    const geometry = chart(
      [
        [{ at: NOW, value: 100 }], // the tall series sets the top…
        [{ at: NOW, value: 0 }], // …the low one the bottom…
        [{ at: NOW, value: 50 }], // …and this one must land in the middle.
      ],
      frame,
    )
    expect(geometry.series[0]!.endY).toBe(0)
    expect(geometry.series[1]!.endY).toBe(40)
    expect(geometry.series[2]!.endY).toBe(20)
  })

  it('leaves an empty series blank without disturbing the others', () => {
    const geometry = chart([[], [{ at: NOW, value: 5 }]], frame)
    expect(geometry.series[0]!.points).toBeNull()
    expect(geometry.series[1]!.points).not.toBeNull()
  })

  it('marks where zero is only when zero is in frame', () => {
    const spanning = chart(
      [
        [
          { at: NOW - 1000, value: -50 },
          { at: NOW, value: 50 },
        ],
      ],
      frame,
    )
    expect(spanning.zeroY).toBe(20)

    const above = chart([[{ at: NOW - 1000, value: 100 }, { at: NOW, value: 120 }]], frame)
    expect(above.zeroY).toBeNull()
  })

  it('refuses to stretch steady lines into mountains', () => {
    const geometry = chart(
      [[{ at: NOW - 1000, value: 100 }, { at: NOW, value: 100.4 }]],
      { ...frame, minSpanMs: 8 },
    )
    // The range is held open to the floor, so the samples sit near the middle.
    expect(geometry.max - geometry.min).toBe(8)
    expect(geometry.series[0]!.endY).toBeGreaterThan(15)
    expect(geometry.series[0]!.endY).toBeLessThan(25)
  })

  it('projects a held sample onto the same frame as the lines', () => {
    const trail = [
      { at: NOW - 2000, value: 0 },
      { at: NOW, value: 100 },
    ]
    const geometry = chart([trail], frame)
    expect(geometry.project(trail[1]!)).toEqual({
      x: geometry.series[0]!.endX,
      y: geometry.series[0]!.endY,
    })
  })

  it('places a moment on the time axis for the crosshair', () => {
    const geometry = chart([[{ at: NOW, value: 1 }]], frame)
    expect(geometry.xAt(NOW)).toBe(100)
    expect(geometry.xAt(NOW - TRAIL_WINDOW_MS / 2)).toBe(50)
  })
})

describe('nearest', () => {
  it('finds the sample closest to a moment', () => {
    const trail = [
      { at: NOW - 4000, value: 1 },
      { at: NOW - 2000, value: 2 },
      { at: NOW, value: 3 },
    ]
    expect(nearest(trail, NOW - 2500)?.value).toBe(2)
    expect(nearest(trail, NOW + 500)?.value).toBe(3)
  })

  it('has nothing to point at in an empty trail', () => {
    expect(nearest([], NOW)).toBeNull()
  })
})
