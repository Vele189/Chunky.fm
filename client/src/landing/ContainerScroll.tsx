import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useStill } from './useStill.js'

/**
 * A panel that comes up off the page as you scroll to it.
 *
 * A port of Aceternity UI's Container Scroll Animation
 * (<https://ui.aceternity.com/components/container-scroll-animation>). The
 * mechanism is the original's: a perspective on the frame, the contents tilted
 * back on the X axis and slightly oversized when they are still below you, and
 * both resolving to flat and true as the thing arrives — with the words above
 * it drifting up a little while that happens, so the panel reads as rising to
 * meet them rather than as sliding underneath them.
 *
 * Four departures:
 *
 *  - **It is not 80rem tall.** The original reserves a fixed 60–80rem so there
 *    is scroll to spend, and measures progress across that reserved block. That
 *    is a page built around the effect; this is a section that already has a
 *    height, and padding it to twice its size would put a screen of nothing
 *    above and below a grid whose whole argument is that it is compact. So
 *    progress is measured against the window instead: it starts when the frame
 *    comes up past the bottom of the screen and finishes when its top is
 *    `SETTLED` of the way up, which is the same gesture without the spacer.
 *  - **No `motion`.** Two numbers written to one element's style, coalesced
 *    into a frame with `requestAnimationFrame`, because scroll fires far faster
 *    than a page can usefully redraw. A spring is not wanted here anyway: this
 *    follows a finger exactly, and anything with its own momentum would still
 *    be settling after the scroll had stopped.
 *  - **It lands on no transform at all.** Not `rotateX(0deg) scale(1)` — none.
 *    An element left with a transform keeps its compositing layer, and text on
 *    a composited layer is resampled: the grid would sit there very slightly
 *    soft for as long as somebody read it.
 *
 * Asked to hold still, none of it runs and nothing is listening: the panel is
 * simply where it ends up, which is where it was always going.
 */

/**
 * How far up the window the panel's top is when the tilt has resolved.
 *
 * A fifth, which is nearly the whole screen's worth of scroll to cross. It was
 * a shade under a half, and at that range the panel was upright again by the
 * time you could see enough of it to notice it had ever been leaning: the
 * effect happened, correctly, in the strip of screen nobody was looking at.
 * A thing that moves as you scroll has to still be moving once it is in front
 * of you.
 */
const SETTLED = 0.2

/**
 * How far back it leans before any of it has arrived.
 *
 * Past the original's 20°, because the original is looking at a panel about
 * half this wide: the same angle on something the width of the page reads as a
 * page that has come slightly unstuck rather than as an object being turned
 * over. The frame has to be leaning far enough that you can see it is a frame.
 */
const LEAN = 30

/**
 * The same, on a narrow screen, and the reason is arithmetic rather than taste.
 *
 * A rotation under a perspective brings the near edge *toward* the eye, and a
 * thing closer to you is drawn wider. How much wider depends on how tall the
 * panel is: at 20° a 700px panel's bottom edge comes forward about 120px, which
 * against a 1400px perspective is nine per cent — a few dozen pixels, and the
 * section has that much slack either side. The same 20° on a phone, where the
 * grid is one column and closer to 2000px tall, brings the bottom edge forward
 * 340px and flares it by nearly a third of the screen's width.
 *
 * So the lean comes down where the panel is tall, and `overflow-x: clip` on the
 * frame catches what is left. Both are needed: the clip alone would hide a
 * flare that still looked wrong on the way past.
 */
const NARROW_LEAN = 12

/** Below this the panel is one tall column rather than a grid. Matches the CSS. */
const NARROW = 720

/** How much bigger it is at that point. The original's 1.05, unchanged. */
const LOOM = 1.05

/** How far the words above it drift up while it comes, in px. */
const DRIFT = 48

export interface ContainerScrollProps {
  /** The words above it, which drift while the panel arrives. */
  title: ReactNode
  children: ReactNode
  className?: string
}

export function ContainerScroll({ title, children, className = '' }: ContainerScrollProps) {
  const panel = useRef<HTMLDivElement>(null)
  const still = useStill()
  const [through, setThrough] = useState(1)
  const [lean, setLean] = useState(LEAN)

  useEffect(() => {
    if (still) return
    /*
     * The panel, not the frame around it.
     *
     * The frame starts at the heading, and the heading and the two lines under
     * it are most of a screen tall: measured from there, the tilt had spent
     * two thirds of its range before the grid it is tilting had appeared at
     * all, so the effect happened almost entirely off the bottom of the window
     * and what arrived was a grid that was already flat. Measured from the
     * panel, the gesture is mapped to the thing doing it.
     */
    const box = panel.current
    if (!box) return

    let queued = 0

    const read = () => {
      queued = 0
      const rect = box.getBoundingClientRect()
      /*
       * From the bottom of the window to `SETTLED` of the way up it.
       *
       * `innerHeight - top` is how far the panel has risen since its top
       * touched the bottom edge. Divided by the span it has to cross, that is
       * the fraction of the way through the gesture it is, and it is clamped so
       * a panel above the window stays finished rather than running past one.
       */
      const span = window.innerHeight * (1 - SETTLED)
      const risen = window.innerHeight - rect.top
      setThrough(span > 0 ? Math.min(1, Math.max(0, risen / span)) : 1)
      setLean(window.innerWidth <= NARROW ? NARROW_LEAN : LEAN)
    }

    const onScroll = () => {
      // One read a frame however many events arrive in it, the same rule the
      // playhead follows. Scroll fires far faster than this can usefully redraw.
      if (queued === 0) queued = window.requestAnimationFrame(read)
    }

    read()
    window.addEventListener('scroll', onScroll, { passive: true })
    // The span is a fraction of the window's height, so a resize moves the
    // whole mapping even when nothing has scrolled.
    window.addEventListener('resize', onScroll, { passive: true })

    return () => {
      if (queued !== 0) window.cancelAnimationFrame(queued)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [still])

  const arrived = still || through >= 1

  return (
    <div className={`stage ${className}`}>
      <div
        className="stage__title"
        style={arrived ? undefined : { transform: `translateY(${-DRIFT * through}px)` }}
      >
        {title}
      </div>

      {/* Undefined rather than an identity transform once it is here. See the
          note above: a transform that is still set keeps the layer, and the
          layer is what softens the type. */}
      {/* The frame, which is the original's `Card`: a bezel with the thing
          inside it, so what tilts reads as an object being turned rather than
          as a grid that has come loose from the page. The two surfaces are the
          reason it reads at all — a lit edge catching the light at the top of
          the lean, and a darker face inside it for the contents to sit on. */}
      <div
        className="stage__panel"
        ref={panel}
        style={
          arrived
            ? undefined
            : {
                transform: `rotateX(${lean * (1 - through)}deg) scale(${1 + (LOOM - 1) * (1 - through)})`,
              }
        }
      >
        <div className="stage__screen">{children}</div>
      </div>
    </div>
  )
}
