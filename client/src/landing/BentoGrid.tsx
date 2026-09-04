import type { ReactNode } from 'react'

/**
 * Cells of unequal size, holding unequal things.
 *
 * A port of Aceternity UI's Bento Grid
 * (<https://ui.aceternity.com/components/bento-grid>). The mechanism is the
 * whole component: a grid with auto rows, and cells that say how many columns
 * they want. Everything else about the original is a card design, and this page
 * already has one.
 *
 * Three departures:
 *
 *  - **No hover.** The original nudges a cell's text sideways when you point at
 *    it. That is a card saying it can be pressed, and none of these can: they
 *    are five things a session gives you, drawn, not five links. A page that
 *    reacted to a pointer and then did nothing under it is worse than one that
 *    sat still.
 *  - **The span is a prop, not a class.** The original is told `md:col-span-2`
 *    by whoever uses it, which puts a page's layout in the middle of its
 *    content. `wide` here is a data attribute the stylesheet reads, so the
 *    arrangement lives in landing.css with the rest of the arrangement.
 *  - **It is an ordered list.** The original is nested divs. These are the
 *    things on one screen described one after another, and a reader who cannot
 *    see the grid should get them as a list rather than as five loose
 *    paragraphs.
 *
 * The cell is deliberately dumb: it holds whatever is handed to it above one
 * line of words. What goes in them is in Landing.tsx, because every one of them
 * is a piece of the station drawn with the station's own components, and this
 * file has no business knowing what a level meter is.
 */

export interface BentoGridProps {
  children: ReactNode
  className?: string
}

export function BentoGrid({ children, className = '' }: BentoGridProps) {
  return <ol className={`bento ${className}`}>{children}</ol>
}

export interface BentoCellProps {
  /** The one line the cell is making. */
  says: ReactNode
  /** What sits above the words: a meter, a sheet, a wish, a row of records. */
  shows: ReactNode
  /** Takes the whole width instead of its share of it. */
  wide?: boolean
  className?: string
}

export function BentoCell({ says, shows, wide = false, className = '' }: BentoCellProps) {
  return (
    <li className={`bento__cell ${className}`} data-wide={wide}>
      {/* The drawing is `aria-hidden` at the point it is put in, not here: some
          of what goes in these is a picture of an instrument and some of it is
          words worth reading. The line below is always the honest version. */}
      <div className="bento__shows">{shows}</div>
      <p className="bento__says">{says}</p>
    </li>
  )
}
