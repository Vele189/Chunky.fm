/**
 * The sync numbers, remembered long enough to draw.
 *
 * The sync view used to print four live numbers and a paragraph about each.
 * The numbers were exact and nobody could read them: whether an offset is
 * *settling or wandering* is a shape, not a value, and a shape needs the last
 * few minutes on screen at once. So the page keeps a short trail of each
 * metric — a few minutes, sampled every couple of seconds — and draws it as a
 * line. This file is the remembering and the geometry; the drawing is a
 * handful of SVG elements in the component.
 *
 * Pure functions over {at, value} pairs, because that is what makes the
 * geometry testable without a browser: given these samples at this moment,
 * the line must pass through these points.
 */

export interface TrailPoint {
  /** Wall-clock ms — only ever compared against other wall-clock ms. */
  at: number
  value: number
}

/** How much of the recent past a graph shows. */
export const TRAIL_WINDOW_MS = 3 * 60_000

/** How often a metric is sampled onto its trail. */
export const TRAIL_SAMPLE_MS = 2_000

/**
 * A trail with one more sample on the end and the expired ones gone. A new
 * array, so React state can tell something changed.
 */
export function record(
  trail: TrailPoint[],
  value: number,
  at: number,
  windowMs = TRAIL_WINDOW_MS,
): TrailPoint[] {
  const kept = trail.filter((point) => at - point.at <= windowMs)
  kept.push({ at, value })
  return kept
}

export interface ChartOptions {
  /** Drawing area in px. */
  width: number
  height: number
  /** The moment the right-hand edge represents. */
  now: number
  windowMs?: number
  /**
   * The narrowest range the y-axis is allowed to show. Without a floor, a
   * chart of metrics all holding steady within a millisecond would have that
   * millisecond stretched across the whole height, and noise would read as
   * mountains.
   */
  minSpanMs?: number
  /** Breathing room above and below the lines, in px. */
  pad?: number
}

export interface ChartSeries {
  /** `x,y` pairs for an SVG polyline, or null with nothing yet to draw. */
  points: string | null
  /** Where this line's newest sample landed. The "now" end, for its label. */
  endX: number | null
  endY: number | null
}

export interface ChartGeometry {
  /** One entry per trail handed in, in the same order. */
  series: ChartSeries[]
  /** Where zero crosses, or null when zero is out of frame. */
  zeroY: number | null
  /** The y-range actually shown — one scale shared by every line. */
  min: number
  max: number
  /** Where a given sample lands, in the shared frame — for the hover marks. */
  project: (point: TrailPoint) => { x: number; y: number }
  /** Where a moment sits horizontally — for the crosshair. */
  xAt: (at: number) => number
}

const NOTHING_SHOWN: ChartSeries = { points: null, endX: null, endY: null }

/**
 * Where the lines go — all of them in one frame, on one scale.
 *
 * One scale on purpose: every metric here is milliseconds, and the whole
 * reason to draw them together is that their sizes can be compared. A second
 * axis would let a 2ms wiggle stand as tall as a 200ms one, which is a lie
 * told with geometry.
 *
 * Time runs left to right and ends at `now` on the right edge, so the lines
 * visibly slide left as the page sits there — the movement is the point.
 * The y-range is the data's own, padded to the floor, *not* clamped to zero:
 * an offset of −120ms is a fine place for a flat line to sit.
 */
export function chart(trails: TrailPoint[][], options: ChartOptions): ChartGeometry {
  const { width, height, now, windowMs = TRAIL_WINDOW_MS, minSpanMs = 8, pad = 4 } = options
  const shown = trails.map((trail) => trail.filter((point) => now - point.at <= windowMs))

  let min = Infinity
  let max = -Infinity
  for (const trail of shown) {
    for (const point of trail) {
      if (point.value < min) min = point.value
      if (point.value > max) max = point.value
    }
  }
  const x = (at: number) => width * (1 - (now - at) / windowMs)
  if (min > max) {
    // Nothing anywhere yet.
    return {
      series: trails.map(() => NOTHING_SHOWN),
      zeroY: null,
      min: 0,
      max: 0,
      project: () => ({ x: 0, y: 0 }),
      xAt: x,
    }
  }
  if (max - min < minSpanMs) {
    const middle = (max + min) / 2
    min = middle - minSpanMs / 2
    max = middle + minSpanMs / 2
  }

  const y = (value: number) => pad + (1 - (value - min) / (max - min)) * (height - pad * 2)

  return {
    series: shown.map((trail) => {
      if (trail.length === 0) return NOTHING_SHOWN
      const last = trail[trail.length - 1]!
      return {
        points: trail.map((point) => `${x(point.at).toFixed(1)},${y(point.value).toFixed(1)}`).join(' '),
        endX: x(last.at),
        endY: y(last.value),
      }
    }),
    zeroY: min <= 0 && 0 <= max ? y(0) : null,
    min,
    max,
    project: (point) => ({ x: x(point.at), y: y(point.value) }),
    xAt: x,
  }
}

/** The sample nearest a moment — what a finger on the graph is pointing at. */
export function nearest(trail: TrailPoint[], at: number): TrailPoint | null {
  let best: TrailPoint | null = null
  for (const point of trail) {
    if (best === null || Math.abs(point.at - at) < Math.abs(best.at - at)) best = point
  }
  return best
}
