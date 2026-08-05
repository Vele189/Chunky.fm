import { useId } from 'react'

/**
 * The graph paper in the corner of a card.
 *
 * A port of the `Grid` / `GridPattern` pair out of Aceternity UI's features
 * section (<https://ui.aceternity.com/components/feature-sections-free>): an SVG
 * `<pattern>` of 20px cells, a handful of those cells filled in, and two masks
 * over the top — a linear one fading the whole thing downward and a radial one
 * fading it away from the top edge. What is left is a suggestion of grid in the
 * upper-left corner rather than a texture across the card.
 *
 * One departure. The original picks its filled cells with `Math.random()` in the
 * render body, so every re-render re-rolls the pattern — on a page whose
 * sections re-render as you scroll, the squares would twitch. `seed` gives each
 * card a fixed arrangement of its own instead.
 */

const CELL = 20

/**
 * Five cells, placed from a seed rather than at random.
 *
 * The original's ranges: 7–10 across, 1–6 down. Same shape of scatter, and the
 * same one every time this card is drawn.
 */
function cellsFor(seed: number): [number, number][] {
  const cells: [number, number][] = []
  let n = seed * 9301 + 49297
  for (let i = 0; i < 5; i++) {
    n = (n * 9301 + 49297) % 233280
    const across = 7 + (n % 4)
    n = (n * 9301 + 49297) % 233280
    const down = 1 + (n % 6)
    cells.push([across, down])
  }
  return cells
}

export function GridPattern({ seed = 0 }: { seed?: number }) {
  const id = useId().replace(/[:_]/g, '')
  const cells = cellsFor(seed)

  return (
    <div className="paper" aria-hidden="true">
      <div className="paper__wash">
        <svg className="paper__grid">
          <defs>
            <pattern
              id={`grid-${id}`}
              width={CELL}
              height={CELL}
              patternUnits="userSpaceOnUse"
              x="-12"
              y="4"
            >
              <path d={`M.5 ${CELL}V.5H${CELL}`} fill="none" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" strokeWidth={0} fill={`url(#grid-${id})`} />
          <svg x="-12" y="4" className="paper__cells">
            <title>Grid</title>
            {cells.map(([across, down]) => (
              <rect
                key={`${across}-${down}`}
                strokeWidth="0"
                width={CELL + 1}
                height={CELL + 1}
                x={across * CELL}
                y={down * CELL}
              />
            ))}
          </svg>
        </svg>
      </div>
    </div>
  )
}
