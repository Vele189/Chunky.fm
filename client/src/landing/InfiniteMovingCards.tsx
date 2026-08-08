import { type ReactNode, useEffect, useRef, useState } from 'react'

/**
 * A row of cards that never stops going past — unless you take hold of it.
 *
 * A port of Aceternity UI's Infinite Moving Cards
 * (<https://ui.aceternity.com/components/infinite-moving-cards>). The mechanism
 * is the same one: lay the items out twice in a flex row, then translate the
 * row by exactly half its width forever. Half a width later the second lap is
 * sitting precisely where the first one started, so the loop has no seam. The
 * `+ 8px` in the lap length is half the gap, which would otherwise be counted
 * twice.
 *
 * Three things are done differently, and all three are because of what is *in*
 * the row here rather than preference:
 *
 *  - **The second lap is rendered, not cloned.** The original walks the DOM and
 *    `cloneNode(true)`s every card into the same list. That is fine for its own
 *    cards, which are markup — but ours are `GlareCard`s, and a cloned node has
 *    no React on it: half the cards in the row would sit there dead, not
 *    tilting, not catching the light, for no reason a visitor could work out.
 *    Rendering the list twice gives both laps live handlers.
 *  - **It can be dragged.** The original is a marquee: a card that has gone past
 *    is gone until the next lap. These cards are steps to be read, and a reader
 *    who looked up mid-sentence should be able to pull the row back rather than
 *    wait most of a lap for the sentence to come round again. So the drift is a
 *    transform written by `requestAnimationFrame` instead of a CSS animation —
 *    a keyframe owns its own clock and cannot be handed a finger's offset — and
 *    a drag scrubs the same number the drift advances. Let go and the row
 *    drifts on from wherever you left it. `touch-action: pan-y` is what makes
 *    this work on a phone: sideways is the row's, up and down stays the page's.
 *  - **It pauses on hover, on focus and while held.** The original pauses on
 *    hover, which it has to — a glare card only shows you anything while a
 *    pointer is on it, so a card that slid out from under the cursor would be
 *    the one thing on the page you cannot actually look at. Focus covers a
 *    keyboard, and a finger holding the row is a drag, which pauses it by
 *    definition.
 *
 * Asked not to animate, none of this runs: the reduced-motion stylesheet turns
 * the row into an ordinary `overflow-x: auto` strip, which scrolls by exactly
 * the gestures this component would otherwise be imitating.
 *
 * The second lap is `aria-hidden`. It is the same things said twice, and a
 * screen reader being read the evening's steps twice over is the loop leaking
 * out of the visual layer it belongs in.
 */

/** The original's three. Seconds for one full lap of the row. */
const SPEEDS = { fast: 20, normal: 40, slow: 80 } as const

/** Half the track's 16px gap — the seam the 50% would otherwise count twice. */
const HALF_GAP = 8

export interface InfiniteMovingCardsProps {
  items: readonly { key: string; node: ReactNode }[]
  direction?: 'left' | 'right'
  speed?: keyof typeof SPEEDS
  /** Also on focus and while dragging — see the note above. */
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
  const frame = useRef<HTMLDivElement>(null)
  const row = useRef<HTMLOListElement>(null)
  const still = useStill()

  useEffect(() => {
    const scroller = frame.current
    const track = row.current
    if (!scroller || !track || still) return

    /** How far the row has been carried, in px. Wrapped into [0, lap). */
    let offset = 0
    /** The seam: half the doubled track, plus half the gap. */
    let lap = 0
    let hovered = false
    let focused = false
    /** The finger or mouse that has hold of the row, if one does. */
    let drag: { id: number; x: number; from: number } | null = null
    let frameId = 0
    let last: number | null = null

    const measure = () => {
      lap = track.scrollWidth / 2 + HALF_GAP
    }

    const wrap = (value: number) => (lap > 0 ? ((value % lap) + lap) % lap : 0)

    const draw = () => {
      track.style.transform = `translateX(${-offset}px)`
    }

    const step = (now: number) => {
      const dt = last === null ? 0 : now - last
      last = now
      const held = drag !== null || (pauseOnHover && (hovered || focused))
      if (!held && lap > 0) {
        const carried = (lap / (SPEEDS[speed] * 1000)) * dt
        offset = wrap(offset + (direction === 'left' ? carried : -carried))
        draw()
      }
      frameId = window.requestAnimationFrame(step)
    }

    const down = (event: PointerEvent) => {
      drag = { id: event.pointerId, x: event.clientX, from: offset }
      scroller.setPointerCapture(event.pointerId)
      scroller.dataset.dragging = 'true'
    }
    const move = (event: PointerEvent) => {
      if (drag === null || event.pointerId !== drag.id) return
      // From where the drag began, not from last frame: the wrap never
      // accumulates into the gesture, so a long pull cannot creep.
      offset = wrap(drag.from - (event.clientX - drag.x))
      draw()
    }
    const up = (event: PointerEvent) => {
      if (drag === null || event.pointerId !== drag.id) return
      drag = null
      scroller.dataset.dragging = 'false'
    }

    const over = () => {
      hovered = true
    }
    const out = () => {
      hovered = false
    }
    const focusIn = () => {
      focused = true
    }
    const focusOut = () => {
      focused = false
    }

    measure()
    const watcher = new ResizeObserver(measure)
    watcher.observe(track)

    frameId = window.requestAnimationFrame(step)
    scroller.addEventListener('pointerdown', down)
    scroller.addEventListener('pointermove', move)
    scroller.addEventListener('pointerup', up)
    scroller.addEventListener('pointercancel', up)
    scroller.addEventListener('mouseenter', over)
    scroller.addEventListener('mouseleave', out)
    scroller.addEventListener('focusin', focusIn)
    scroller.addEventListener('focusout', focusOut)

    return () => {
      window.cancelAnimationFrame(frameId)
      watcher.disconnect()
      scroller.removeEventListener('pointerdown', down)
      scroller.removeEventListener('pointermove', move)
      scroller.removeEventListener('pointerup', up)
      scroller.removeEventListener('pointercancel', up)
      scroller.removeEventListener('mouseenter', over)
      scroller.removeEventListener('mouseleave', out)
      scroller.removeEventListener('focusin', focusIn)
      scroller.removeEventListener('focusout', focusOut)
      // The reduced-motion stylesheet lays the row out as a scroll strip, and a
      // transform left behind would carry half of it out of the viewport.
      track.style.transform = ''
      delete scroller.dataset.dragging
    }
  }, [still, direction, speed, pauseOnHover])

  return (
    <div className={`scroller ${className}`} ref={frame}>
      <ol className="scroller__track" ref={row}>
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

/** Whether this visitor has asked for things to hold still. */
function useStill() {
  const [still, setStill] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const read = () => setStill(query.matches)

    read()
    query.addEventListener('change', read)
    return () => query.removeEventListener('change', read)
  }, [])

  return still
}
