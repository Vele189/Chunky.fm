import { motion } from 'motion/react'
import { type ReactNode, useEffect, useRef, useState } from 'react'

/**
 * Two texts, one over the other, and a hole in the top one that follows the
 * cursor.
 *
 * A port of Aceternity UI's SVG Mask Effect
 * (<https://ui.aceternity.com/components/svg-mask-effect>). The mechanism is
 * theirs exactly: a lit panel laid over the section, given a `mask-image` of a
 * single circle at `mask-repeat: no-repeat`, with the mask's size and position
 * animated — position tracking the pointer at 0.15s linear, size springing from
 * 10px to 600px over 0.3s when the pointer is actually on the words. A mask
 * shows its element only where the mask image is opaque, so what you get is a
 * disc of the covered layer travelling under the cursor.
 *
 * Four departures:
 *
 *  - **The mask is inlined, not fetched.** The original points at `/mask.svg`
 *    in the public directory, and that file turns out to be one `<circle>` on a
 *    1298 viewBox. It is the same circle here, as a data URI in the stylesheet —
 *    this app does not reach off its own origin for anything, and a mask that
 *    404s is a panel that covers the section completely with no hole in it.
 *  - **It is inert without a fine pointer.** The whole effect is a cursor, and a
 *    phone does not have one: there, this renders both texts plainly, one after
 *    the other, with no panel over anything. The alternative is a section that
 *    hides half of what it says from every visitor on a touchscreen, which is a
 *    mistake this page has already made once — see the note on `WishWall`.
 *  - **The hole starts off-canvas.** The original's first render puts the mask
 *    at `NaN px NaN px` because it has no pointer position yet. Parked well
 *    outside the box instead, so what is under the panel stays under it until
 *    the pointer is genuinely inside.
 *  - **`onMouseMove` rather than a listener.** The original adds one in an
 *    effect and reads `containerRef.current` in the cleanup, which is the stale
 *    ref that React's own lint rule is about. The prop does the same job.
 *
 * The original also fades the container's background from white to slate-900
 * while the pointer is on it, which is a light page increasing its contrast for
 * the dark disc. This page is already the dark end of that, so there is nothing
 * for it to do and it is not here.
 */

export interface MaskContainerProps {
  /** What is under the panel, found by the cursor. */
  children?: ReactNode
  /** What is on the page to begin with, and stays there. */
  revealText?: ReactNode
  /** The hole, in px, when the pointer is in the box but not on the words. */
  size?: number
  /** And when it is on them. */
  revealSize?: number
  className?: string
}

/** Far enough outside any container that the disc is nowhere on it. */
const OFF = -9999

export function MaskContainer({
  children,
  revealText,
  size = 10,
  revealSize = 600,
  className = '',
}: MaskContainerProps) {
  const box = useRef<HTMLDivElement>(null)
  const [on, setOn] = useState(false)
  const [at, setAt] = useState({ x: OFF, y: OFF })
  const cursor = useFinePointer()

  // No cursor, no effect — and then no panel either. Both texts, in order.
  if (!cursor) {
    return (
      <div className={`mask mask--flat ${className}`}>
        <div className="mask__under">{revealText}</div>
        <div className="mask__over">{children}</div>
      </div>
    )
  }

  const hole = on ? revealSize : size

  return (
    <div
      className={`mask ${className}`}
      ref={box}
      onMouseMove={(event) => {
        const frame = box.current?.getBoundingClientRect()
        if (!frame) return
        setAt({ x: event.clientX - frame.left, y: event.clientY - frame.top })
      }}
      onMouseLeave={() => setAt({ x: OFF, y: OFF })}
    >
      {/* First in the DOM and last in the paint: the panel below is positioned
          and this is not, so the panel covers it without either needing a
          z-index. It also gives the whole thing its height. */}
      <div className="mask__under">{revealText}</div>

      <motion.div
        className="mask__over"
        animate={{
          maskPosition: `${at.x - hole / 2}px ${at.y - hole / 2}px`,
          maskSize: `${hole}px`,
        }}
        transition={{
          maskSize: { duration: 0.3, ease: 'easeInOut' },
          maskPosition: { duration: 0.15, ease: 'linear' },
        }}
      >
        {/* The hole opens wide only over the words themselves, which is what
            makes it feel like the text is being looked for rather than like a
            torch that happens to be on. */}
        <div
          className="mask__words"
          onMouseEnter={() => setOn(true)}
          onMouseLeave={() => setOn(false)}
        >
          {children}
        </div>
      </motion.div>
    </div>
  )
}

/**
 * Whether this machine has the kind of pointer this effect is made of.
 *
 * `pointer: fine` is a mouse or a trackpad; `hover: hover` rules out the phones
 * that report a fine pointer for a stylus but cannot hover with it. Watched
 * rather than read once, because a tablet with a keyboard case attached and
 * removed changes the answer without reloading the page.
 */
function useFinePointer() {
  const [fine, setFine] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(hover: hover) and (pointer: fine)')
    const read = () => setFine(query.matches)

    read()
    query.addEventListener('change', read)
    return () => query.removeEventListener('change', read)
  }, [])

  return fine
}
