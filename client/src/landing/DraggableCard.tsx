import {
  animate,
  motion,
  type MotionStyle,
  useAnimationControls,
  useMotionValue,
  useSpring,
  useTransform,
  useVelocity,
} from 'motion/react'
import { type ReactNode, useEffect, useRef, useState } from 'react'

/**
 * A card you can pick up and throw.
 *
 * A port of Aceternity UI's Draggable Card
 * (<https://ui.aceternity.com/components/draggable-card>), which is written for
 * a Tailwind + shadcn project and arrives via `npx shadcn add`. This is neither:
 * there is no Tailwind here, no `cn`, and no `components/ui`. So the physics is
 * kept exactly — the same spring, the same tilt range, the same velocity fling —
 * and everything that was a utility class is a rule in landing.css instead,
 * drawn from tokens.css like the rest of the page.
 *
 * What the physics is doing, since the numbers look arbitrary and are not:
 *
 *  - **Tilt.** The pointer's distance from the card's centre maps ±300px to
 *    ∓25°, so a card leans away from where you are pointing. Through a spring
 *    (stiffness 100, damping 20, mass 0.5), which is what stops it snapping.
 *  - **Glare.** A white overlay that comes up as the card turns away, standing
 *    in for a light source the page does not have. Same mapping, same spring.
 *  - **The throw.** On release, the pointer's velocity is carried on for 0.3 of
 *    a second's worth of travel and settled with a spring whose bounce grows
 *    with how hard it was thrown. A flick sends a record skidding; a nudge
 *    moves it an inch.
 *
 * The one departure is `dragEnabled`, which is not in the original. See the note
 * on it below: on a touch screen, a draggable thing covering half a column is a
 * thing that eats the page's scrolling.
 */

export interface DraggableCardProps {
  children?: ReactNode
  /** Where the card sits in its stage, and how far it is turned. */
  className?: string
  /* motion's own style type rather than React's: `rotate` here is a transform
     taking a number of degrees, where CSSProperties would insist on a string. */
  style?: MotionStyle
  /**
   * False leaves the card exactly where it is, with no drag and no tilt.
   *
   * Not in the original, and it is here for touch. A dragged element swallows
   * the gesture that started on it, so on a phone a pile of these across the
   * column is a pile of things that stop the page scrolling when a thumb lands
   * on one. The pile is worth having on a phone; being unable to scroll past it
   * is not.
   */
  dragEnabled?: boolean
}

const SPRING = { stiffness: 100, damping: 20, mass: 0.5 } as const

export function DraggableCard({
  children,
  className = '',
  style,
  dragEnabled = true,
}: DraggableCardProps) {
  const pointerX = useMotionValue(0)
  const pointerY = useMotionValue(0)
  const card = useRef<HTMLDivElement>(null)
  const controls = useAnimationControls()
  const [bounds, setBounds] = useState({ top: 0, left: 0, right: 0, bottom: 0 })

  const velocityX = useVelocity(pointerX)
  const velocityY = useVelocity(pointerY)

  const rotateX = useSpring(useTransform(pointerY, [-300, 300], [25, -25]), SPRING)
  const rotateY = useSpring(useTransform(pointerX, [-300, 300], [-25, 25]), SPRING)
  const opacity = useSpring(useTransform(pointerX, [-300, 0, 300], [0.8, 1, 0.8]), SPRING)
  const glare = useSpring(useTransform(pointerX, [-300, 0, 300], [0.2, 0, 0.2]), SPRING)

  useEffect(() => {
    // Half the window in each direction: far enough that a hard throw goes
    // somewhere, near enough that a record never leaves the page for good.
    const measure = () =>
      setBounds({
        top: -window.innerHeight / 2,
        left: -window.innerWidth / 2,
        right: window.innerWidth / 2,
        bottom: window.innerHeight / 2,
      })

    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const follow = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!dragEnabled) return
    const box = card.current?.getBoundingClientRect()
    if (!box) return
    pointerX.set(event.clientX - (box.left + box.width / 2))
    pointerY.set(event.clientY - (box.top + box.height / 2))
  }

  const settle = () => {
    pointerX.set(0)
    pointerY.set(0)
  }

  return (
    <motion.div
      ref={card}
      className={`card3d ${className}`}
      drag={dragEnabled}
      dragConstraints={bounds}
      onDragStart={() => {
        document.body.style.cursor = 'grabbing'
      }}
      onDragEnd={(_event, info) => {
        document.body.style.cursor = ''

        controls.start({ rotateX: 0, rotateY: 0, transition: { type: 'spring', ...SPRING } })

        const vx = velocityX.get()
        const vy = velocityY.get()
        // How hard it was thrown, as one number, turned into how much it
        // overshoots before it settles. Capped, or a hard flick never stops.
        const bounce = Math.min(0.8, Math.hypot(vx, vy) / 1000)
        const throwTo = { duration: 0.8, bounce, type: 'spring', stiffness: 50, damping: 15, mass: 0.8 } as const

        animate(info.point.x, info.point.x + vx * 0.3, throwTo)
        animate(info.point.y, info.point.y + vy * 0.3, throwTo)
      }}
      style={{ ...style, rotateX, rotateY, opacity }}
      animate={controls}
      whileHover={dragEnabled ? { scale: 1.02 } : undefined}
      onMouseMove={follow}
      onMouseLeave={settle}
    >
      {children}
      {/* The light the page does not have. Pointer-events off, or it would be
          the thing under the cursor instead of the card. */}
      <motion.div className="card3d__glare" style={{ opacity: glare }} />
    </motion.div>
  )
}

/**
 * The stage the cards are thrown around inside.
 *
 * Only there for the perspective: without it every `rotateX` above is a flat
 * shear rather than a card leaning away from you.
 */
export function DraggableCardStage({
  children,
  className = '',
  dragEnabled = true,
}: {
  children?: ReactNode
  className?: string
  /** Mirrors the cards' own flag, so one rule can drop the grab cursor. */
  dragEnabled?: boolean
}) {
  return (
    <div className={`card3d-stage ${className}`} data-drag={dragEnabled ? 'true' : 'false'}>
      {children}
    </div>
  )
}
