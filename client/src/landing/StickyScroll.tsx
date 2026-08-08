import { type ReactNode, useEffect, useRef, useState } from 'react'
import { CardStack } from './CardStack.js'

/**
 * A column of things to read, and one panel beside it that changes as you do.
 *
 * A port of Aceternity UI's Sticky Scroll Reveal
 * (<https://ui.aceternity.com/components/sticky-scroll-reveal>). The mechanism
 * is the original's: the whole thing is its own scroll container, the items are
 * laid out down the left of it, and the one nearest a breakpoint at
 * `index / count` is the active one, brought to full opacity while the others
 * sit at 0.3, with its panel shown in the sticky box on the right.
 *
 * Being its own scroller rather than reading the page is the good part of the
 * design: the element it measures is one whose height nobody changes, so unlike
 * the two other components on this page it cannot be thrown by the document
 * growing underneath it.
 *
 * What is *not* ported is how it reads that scroller. The original goes through
 * `useScroll({ container, offset })`, and the progress that came back did not
 * line up with the `index / count` breakpoints the same file then compares it
 * against: the middle item of three was never the nearest one to anything, so
 * the panel went straight from the first to the last and one third of the
 * section was unreachable. `scrollTop / (scrollHeight − clientHeight)` is the
 * fraction those breakpoints are expressed in, so this reads that instead.
 *
 * Two departures. The original animates the container between three slate-to-
 * black backgrounds and the panel between three saturated gradients: cyan to
 * emerald, pink to indigo, orange to yellow. `tokens.css` gives this design one
 * accent (white) and one signal (red, meaning on the air right now), and unlike
 * the glare card's foil these are not a hover: they would be on screen the whole
 * time somebody is reading. So the change of state is kept and drawn in the
 * design's own greys, which is enough to say "this one, now" without the section
 * becoming the only part of the site with a palette.
 *
 * And the sticky side is a `CardStack` rather than one panel swapped under a
 * crossfade. The three are a deck with the one you are reading face up, and
 * scrolling deals the next.
 */

export interface StickyItem {
  title: string
  description: ReactNode
  panel: ReactNode
}

export function StickyScroll({ items, className = '' }: { items: readonly StickyItem[]; className?: string }) {
  const scroller = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)
  const count = items.length

  useEffect(() => {
    const box = scroller.current
    if (!box) return
    let frame = 0

    const read = () => {
      frame = 0
      const travel = box.scrollHeight - box.clientHeight
      const progress = travel > 0 ? box.scrollTop / travel : 0

      // The original's rule: a breakpoint per item, and whichever is nearest to
      // where you are wins.
      let nearest = 0
      for (let index = 1; index < count; index++) {
        if (Math.abs(progress - index / count) < Math.abs(progress - nearest / count)) {
          nearest = index
        }
      }
      setActive(nearest)
    }

    const onScroll = () => {
      if (frame === 0) frame = window.requestAnimationFrame(read)
    }

    read()
    box.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })

    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame)
      box.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
    // `count`, not `items`. The array is built inline by the caller, so it is a
    // new one on every render, and the section it lives in re-renders on every
    // scroll frame, because the conversation panel follows the page's playhead.
    // Depending on the array tore this listener down and put it back constantly,
    // and a scroll event landing in the gap was simply lost: the active item
    // stopped changing until something else forced a re-render. A number is a
    // stable dependency.
  }, [count])

  return (
    <div className={`sticky-reveal ${className}`} data-active={active} ref={scroller}>
      <div className="sticky-reveal__column">
        {items.map((item, index) => (
          <div className="reveal" key={item.title} data-on={index === active ? 'true' : 'false'}>
            <h3 className="reveal__title">{item.title}</h3>
            <div className="reveal__body">{item.description}</div>
          </div>
        ))}
        {/* The original's trailing spacer. Without it the last item can never
            reach its own breakpoint; there is nothing left to scroll. */}
        <div className="sticky-reveal__tail" />
      </div>

      {/* A deck rather than a crossfade: the panels are stacked, the one you
          are reading about is face up, and scrolling deals the next. Every card
          stays mounted. See the note in CardStack.
          
          The deck sits inside the sticky box rather than being it. Sharing one
          element meant `.stack` and `.sticky-reveal__panel` both setting
          `position` and `width`, and whichever came later in the stylesheet
          won, which collapsed the column of text once and killed the stickiness
          once. Two elements, two jobs. */}
      <div className="sticky-reveal__panel">
        <CardStack active={active} items={items.map((item) => ({ key: item.title, node: item.panel }))} />
      </div>
    </div>
  )
}
