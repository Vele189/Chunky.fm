import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { useStill } from './useStill.js'

/**
 * A strip of cards you push along, and a card that opens into a panel.
 *
 * A port of Aceternity UI's Apple Cards Carousel
 * (<https://ui.aceternity.com/components/apple-cards-carousel>). The mechanism
 * is the same one: an ordinary horizontal scroll container with the scrollbar
 * hidden, two round buttons that push it by a card at a time and go out at
 * either end, and a card that opens into a panel over a dimmed page.
 *
 * Five things are done differently, and all five are because of what is in the
 * strip here rather than preference:
 *
 *  - **The step is measured, not declared.** The original scrolls a hardcoded
 *    300px, which is most of a card at one width and a third of one at another.
 *    A card and the gap beside it are both on the page already, so the button
 *    asks them.
 *  - **The card is whatever the caller passes.** The original's `Card` owns a
 *    fixed shape (`src`, `title`, `category`, `content`) and draws it. Ours are
 *    episodes, and how an episode reads on a card is the archive's business,
 *    not the scroller's. Same call `InfiniteMovingCards` makes.
 *  - **The panel is separate from the strip.** The original couples them: a
 *    card holds its own open state and the carousel holds the context that
 *    scrolls it back into view afterwards. Split, the strip can hold cards that
 *    open nothing — which is exactly what the invented archive is, on a page
 *    that could not reach the real one.
 *  - **The entrance is a stylesheet's.** The original staggers the cards in
 *    with `motion`, one every 200ms. These arrive when a network answers, and a
 *    stagger on top of that is two waits stacked. `--card-index` lets the CSS
 *    do it in one pass with nothing running.
 *  - **The arrows are inline SVG.** `@tabler/icons-react` is a dependency for
 *    two glyphs, and the icons this project loads with `<img>` carry a
 *    hardcoded fill, which cannot work inside a button that dims when it is
 *    disabled. Same reason `Player.tsx` inlines its three.
 *
 * Asked to hold still, both halves stop: the strip jumps to where the arrow
 * sent it instead of gliding, and the panel is simply there. Nothing is
 * withheld, which is the rule everywhere else on this page.
 */

export interface CarouselProps {
  items: readonly { key: string; node: ReactNode }[]
  /**
   * What the strip holds, for the two arrows.
   *
   * Without it they are a pair of unlabelled circles, and "next" on its own
   * says nothing about what is coming next. Named by the caller because only
   * the caller knows: "episodes" here, something else in the next section that
   * wants a strip.
   */
  label: string
  className?: string
}

/** How much of a card is left showing when the strip cannot measure one. */
const BLIND_STEP = 0.8

export function Carousel({ items, label, className = '' }: CarouselProps) {
  const strip = useRef<HTMLUListElement>(null)
  const still = useStill()
  /**
   * Whether there is anything left that way.
   *
   * Both false is the honest answer for a strip that fits: two arrows greyed
   * out say "this is all of them" without a word, where hiding them would leave
   * a reader wondering whether the row scrolls at all.
   */
  const [more, setMore] = useState({ back: false, on: false })

  const read = useCallback(() => {
    const row = strip.current
    if (!row) return
    const { scrollLeft, scrollWidth, clientWidth } = row
    setMore({
      back: scrollLeft > 1,
      // A pixel of slack at each end. These are fractional at most zoom levels
      // and on most displays, and an arrow that stays lit at the end of the row
      // is an arrow that lies about there being more.
      on: scrollLeft < scrollWidth - clientWidth - 1,
    })
  }, [])

  useEffect(() => {
    const row = strip.current
    if (!row) return

    read()
    // The row's own width changes with the window, and its contents' width
    // changes when the episodes arrive. One observer covers both.
    const watcher = new ResizeObserver(read)
    watcher.observe(row)
    for (const card of row.children) watcher.observe(card)

    return () => watcher.disconnect()
  }, [read])

  const push = (direction: -1 | 1) => {
    const row = strip.current
    if (!row) return
    const card = row.firstElementChild
    const gap = Number.parseFloat(window.getComputedStyle(row).columnGap) || 0
    const step = card
      ? card.getBoundingClientRect().width + gap
      : row.clientWidth * BLIND_STEP
    row.scrollBy({ left: direction * step, behavior: still ? 'auto' : 'smooth' })
  }

  return (
    <div className={`carousel ${className}`}>
      {/* `onScroll` rather than a scroll listener: this is the one element
          whose scrolling matters, and React's handler is on it rather than on
          the page. The wheel, a finger, an arrow button and a card being tabbed
          into all move it, and all four have to relight the arrows. */}
      <ul className="carousel__strip" ref={strip} onScroll={read}>
        {items.map((item, index) => (
          <li
            className="carousel__cell"
            key={item.key}
            // Read by the stylesheet, which fades them in one after another. A
            // custom property rather than a delay written here, so the timing
            // lives beside the transition it belongs to.
            style={{ '--card-index': index } as React.CSSProperties}
          >
            {item.node}
          </li>
        ))}
      </ul>

      {/* Under the strip and to the right, where the original puts them. Both
          are drawn whatever the strip can do: a pair that appeared and
          disappeared as the row grew would move the section under a reader. */}
      <div className="carousel__arrows">
        <button
          type="button"
          className="carousel__arrow"
          onClick={() => push(-1)}
          disabled={!more.back}
          aria-label={`Previous ${label}`}
        >
          <Chevron back />
        </button>
        <button
          type="button"
          className="carousel__arrow"
          onClick={() => push(1)}
          disabled={!more.on}
          aria-label={`More ${label}`}
        >
          <Chevron />
        </button>
      </div>
    </div>
  )
}

/** One glyph, drawn both ways. `currentColor`, so the disabled state reaches it. */
function Chevron({ back = false }: { back?: boolean }) {
  return (
    <svg
      className="carousel__chevron"
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={back ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
    </svg>
  )
}

export interface CardPanelProps {
  open: boolean
  onClose: () => void
  /** The id of the heading inside, which is what names the panel. */
  labelledBy: string
  children: ReactNode
  className?: string
}

/**
 * What a card opens into.
 *
 * The original's modal, with the parts a landing page cannot do without: it
 * closes on Escape, on a click outside it and on the button in its corner; it
 * takes the focus and hands it back to whatever opened it; and it stops the
 * page behind it scrolling, which on a phone is the difference between a panel
 * and a trapdoor.
 *
 * `mousedown` rather than `click` for the outside press, because a click that
 * *began* inside the panel and ended outside it (a selection dragged past the
 * edge, which is how anybody copies a paragraph) is not somebody asking to
 * close it.
 */
export function CardPanel({ open, onClose, labelledBy, children, className = '' }: CardPanelProps) {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    /* Whatever the focus was on when this opened, so it can be given back. A
       reader who closes a panel with Escape and lands at the top of the
       document has lost their place in a page this long. */
    const opener = document.activeElement
    const scrollWas = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panel.current?.focus()

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const onDown = (event: MouseEvent) => {
      const box = panel.current
      if (box && event.target instanceof Node && !box.contains(event.target)) onClose()
    }

    window.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)

    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
      document.body.style.overflow = scrollWas
      if (opener instanceof HTMLElement) opener.focus()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="panel-over">
      <div className="panel-over__dim" aria-hidden="true" />
      {/* `tabindex={-1}` so the panel itself can hold the focus on the way in.
          It is not in the tab order: everything reachable inside it is. */}
      <div
        className={`panel-over__panel ${className}`}
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
      >
        <button
          type="button"
          className="panel-over__close"
          onClick={onClose}
          aria-label="Close"
        >
          <svg
            viewBox="0 0 24 24"
            width={16}
            height={16}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        {children}
      </div>
    </div>
  )
}
