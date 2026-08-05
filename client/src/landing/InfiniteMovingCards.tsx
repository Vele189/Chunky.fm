import type { CSSProperties, ReactNode } from 'react'

/**
 * A row of cards that never stops going past.
 *
 * A port of Aceternity UI's Infinite Moving Cards
 * (<https://ui.aceternity.com/components/infinite-moving-cards>). The mechanism
 * is the same one: lay the items out twice in a flex row, then translate the
 * row by exactly half its width forever. Half a width later the second lap is
 * sitting precisely where the first one started, so the loop has no seam. The
 * `- 8px` is half the gap, which would otherwise be counted twice.
 *
 * Two things are done differently, and both are because of what is *in* the row
 * here rather than preference:
 *
 *  - **The second lap is rendered, not cloned.** The original walks the DOM and
 *    `cloneNode(true)`s every card into the same list. That is fine for its own
 *    cards, which are markup — but ours are `GlareCard`s, and a cloned node has
 *    no React on it: half the cards in the row would sit there dead, not
 *    tilting, not catching the light, for no reason a visitor could work out.
 *    Rendering the list twice gives both laps live handlers.
 *  - **It pauses on focus and on touch, not only on hover.** The original pauses
 *    on hover, which it has to — but a glare card only shows you anything while
 *    a pointer is on it, so a card that slid out from under the cursor would be
 *    the one thing on the page you cannot actually look at. Focus covers a
 *    keyboard, and `:active` covers a finger, which has no hover at all.
 *
 * The second lap is `aria-hidden`. It is the same six things said twice, and a
 * screen reader being read the evening's six steps twelve times is the loop
 * leaking out of the visual layer it belongs in.
 */

/** The original's three. Seconds for one full lap of the row. */
const SPEEDS = { fast: '20s', normal: '40s', slow: '80s' } as const

export interface InfiniteMovingCardsProps {
  items: readonly { key: string; node: ReactNode }[]
  direction?: 'left' | 'right'
  speed?: keyof typeof SPEEDS
  /** Also on focus and on touch — see the note above. */
  pauseOnHover?: boolean
  className?: string
}

export function InfiniteMovingCards({
  items,
  direction = 'left',
  speed = 'slow',
  pauseOnHover = true,
  className = '',
}: InfiniteMovingCardsProps) {
  const style = {
    '--scroll-duration': SPEEDS[speed],
    // `forwards` runs the keyframes as written, which walks the row to the left.
    '--scroll-direction': direction === 'left' ? 'forwards' : 'reverse',
  } as CSSProperties

  return (
    <div className={`scroller ${className}`} style={style} data-pause={pauseOnHover ? 'true' : 'false'}>
      <ol className="scroller__track">
        {items.map((item) => (
          <li className="scroller__item" key={item.key}>
            {item.node}
          </li>
        ))}
        {items.map((item) => (
          <li className="scroller__item" key={`${item.key}-again`} aria-hidden="true">
            {item.node}
          </li>
        ))}
      </ol>
    </div>
  )
}
