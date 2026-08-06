import { type CSSProperties, type ReactNode, useEffect, useState } from 'react'

/**
 * Columns of things going past each other, forever.
 *
 * The same loop as `InfiniteMovingCards` stood on end: lay the items out twice
 * down a column, then translate the column by exactly half its height. Half a
 * height later the second lap is sitting where the first one started, so there is
 * no seam. The keyframe also backs off half the gap, which the halving would
 * otherwise count twice — it reads that from `--wish-gap` rather than repeating
 * the number, because the two have to agree or the loop jumps once a lap.
 *
 * What is different is that there is more than one of them and they do not agree
 * on which way is forward: the first column falls, the second rises, and so on
 * alternately. Two things moving in opposite directions read as a wall in motion
 * rather than as a list being scrolled — which is the point here, because these
 * are wishes arriving from a room rather than an ordered set of anything.
 *
 * The items are dealt out round-robin rather than cut into blocks, and none is
 * in two columns at once. Both of those are the same lesson learned by trying it
 * the other way: columns holding the same list pass each other, and every so
 * often the same sentence is on screen twice at the same height, which is the
 * loop showing itself. Dealing rather than slicing is so a column is not four
 * consecutive wishes — the first four are not a worse four than the last, but
 * they are a *run*, and a run reads as an order somebody chose.
 *
 * On a narrow screen it collapses to one column, and the deal collapses with it:
 * one column is then every wish rather than half of them. What a phone loses is
 * the disagreement about which way is down, which is the one thing here that
 * needs two columns to exist at all.
 *
 * Only the first lap is left to a screen reader. The second is the same sentences
 * again to make the loop seamless, and a screen reader being read them twice is
 * the visual layer leaking out of itself.
 */

/** Seconds for one full lap of a column. Slower than the row: these are read. */
const SPEEDS = { fast: '25s', normal: '45s', slow: '75s' } as const

/** The width the wall gives up its second column at — matches landing.css. */
const NARROW = '(max-width: 720px)'

export interface MovingColumnsProps {
  items: readonly { key: string; node: ReactNode }[]
  /** How many columns to run, at the width there is room for them. */
  columns?: number
  speed?: keyof typeof SPEEDS
  className?: string
}

export function MovingColumns({
  items,
  columns = 2,
  speed = 'normal',
  className = '',
}: MovingColumnsProps) {
  const many = useColumnCount(columns)

  return (
    <div
      className={`columns ${className}`}
      style={{ '--scroll-duration': SPEEDS[speed], '--columns': many } as CSSProperties}
    >
      {Array.from({ length: many }, (_, column) => {
        const mine = items.filter((_item, index) => index % many === column)

        return (
          <ol
            className="columns__track"
            key={column}
            // Written as a fall; the odd ones play it backwards and rise.
            style={
              { '--scroll-direction': column % 2 === 0 ? 'reverse' : 'forwards' } as CSSProperties
            }
          >
            {mine.map((item) => (
              <li className="columns__item" key={item.key}>
                {item.node}
              </li>
            ))}
            {mine.map((item) => (
              <li className="columns__item" key={`${item.key}-again`} aria-hidden="true">
                {item.node}
              </li>
            ))}
          </ol>
        )
      })}
    </div>
  )
}

/**
 * How many columns there is room for.
 *
 * A media query cannot do this bit: which cards are in which column is decided in
 * JavaScript, so the layout has to know the same thing the stylesheet does. The
 * width itself lives in `NARROW`, next to the rule it matches.
 */
function useColumnCount(wanted: number) {
  const [narrow, setNarrow] = useState(false)

  useEffect(() => {
    const query = window.matchMedia(NARROW)
    const read = () => setNarrow(query.matches)

    read()
    query.addEventListener('change', read)
    return () => query.removeEventListener('change', read)
  }, [])

  return narrow ? 1 : wanted
}
