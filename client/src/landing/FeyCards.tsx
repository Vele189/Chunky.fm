import { type CSSProperties, useRef, useState } from 'react'
import { useOnScreen } from './useOnScreen.js'

/**
 * A fanned row of sleeves that opens where you point at it.
 *
 * A port of Aceternity UI's Fey Cards (<https://ui.aceternity.com/labs/fey-cards>),
 * which is itself after Fey's own hero. The mechanism is the original's: the
 * cards are absolutely placed a fixed step apart so each one covers most of the
 * one before it, and pointing at one pushes everything to its right further
 * right, opening a gap around the card under the pointer. They arrive staggered
 * from a stack on the left, last one first.
 *
 * Three departures, and all three are what the cards are:
 *
 *  - **They are records.** The original's cards are tall app screenshots, 9:16,
 *    and it swaps a dimmed idle image for a bright active one on hover — two
 *    files per card. Ours are the evening's sleeves, square, and there is one
 *    picture of a record: the idle state is the same image with the light off it.
 *    A second file would be a photograph of the same sleeve, which is not a thing
 *    that exists.
 *  - **The step is a fraction of the card, not 32 pixels.** A row of nine has to
 *    fit a phone as well as a desk, so the card is a fraction of the window and
 *    everything else is a fraction of the card — see the `--sleeve` chain in
 *    landing.css. That also means the shift cannot be a number handed to a
 *    spring, so it is a CSS transition on a curve that overshoots slightly,
 *    which is what the original's `bounce: 0.2` looks like from the outside.
 *  - **They arrive when they are reached.** The original animates on mount. This
 *    is the last section of a long page; on mount it is eight screens below the
 *    reader, and an entrance nobody is there for is not an entrance. See
 *    `useOnScreen`.
 *
 * Pointing is not the only way in: each card is a button, so a keyboard tabs
 * through the row and opens the fan at whichever record it is on.
 */

export interface Sleeve {
  src: string
  /** The record. Used as the picture's alt text, so it has to be the name. */
  album: string
}

export interface FeyCardsProps {
  sleeves: readonly Sleeve[]
  className?: string
}

export function FeyCards({ sleeves, className = '' }: FeyCardsProps) {
  const row = useRef<HTMLUListElement>(null)
  const shown = useOnScreen(row)
  // Which record the fan is open at, if any. One at a time: the row is a hand
  // of cards being spread, and two gaps in it would be two hands.
  const [open, setOpen] = useState<number | null>(null)

  return (
    <div className={`fan ${className}`}>
      <ul
        className="fan__row"
        ref={row}
        data-shown={shown ? 'true' : 'false'}
        style={{ '--count': sleeves.length } as CSSProperties}
        onPointerLeave={() => setOpen(null)}
      >
        {sleeves.map((sleeve, index) => (
          <li
            className="fan__slot"
            key={sleeve.src}
            style={{ '--index': index, zIndex: index } as CSSProperties}
            // Off to begin with; the one being pointed at is on, and everything
            // to its right is pushed out of the way of it.
            data-state={open === null ? 'off' : index === open ? 'on' : index > open ? 'pushed' : 'off'}
          >
            <button
              className="fan__card"
              type="button"
              onPointerEnter={() => setOpen(index)}
              onFocus={() => setOpen(index)}
              onBlur={() => setOpen(null)}
              // A finger has no hover: tapping opens the fan there, and tapping
              // the same record again closes it.
              onClick={() => setOpen((current) => (current === index ? null : index))}
            >
              <img className="fan__sleeve" src={sleeve.src} alt={sleeve.album} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
