import { motion, useMotionValue, useTransform } from 'motion/react'
import { type ReactNode, useEffect, useRef, useState } from 'react'

/**
 * A card that tilts up to face you as you scroll it into place.
 *
 * A port of Aceternity UI's Container Scroll Animation
 * (<https://ui.aceternity.com/components/container-scroll-animation>), and the
 * same three transforms tied to the same thing: how far this container has got
 * through the viewport. The card starts laid back 20° and comes upright, the
 * title above it drifts up 100px, and the card settles from 1.05 to 1 — so it is
 * an object being stood up in front of the reader rather than a panel scrolling
 * past. The whole effect is `useScroll({ target })`, which is 0 when the
 * container's top reaches the top of the window and 1 when its bottom reaches
 * the bottom, and the container is tall on purpose because that range *is* the
 * animation.
 *
 * Two departures, both this page's materials rather than the effect:
 *
 *  - **The bezel is the design's.** The original's `#6C6C6C` border and `#222222`
 *    body are close to `--raised-soft` and `--raised` already; using the tokens
 *    means the frame is the same grey as the deck in the hero, which is what
 *    stops it reading as a screenshot of somebody else's site.
 *  - **The card is not a fixed 30/40rem.** The original's content is an image,
 *    which crops happily; ours is text, and text in a box `overflow-hidden` at a
 *    height nobody measured is text with its last line sliced off. It takes the
 *    height of what is in it instead, with a floor so a short panel still reads
 *    as a screen.
 */

export function ContainerScroll({
  title,
  children,
  className = '',
}: {
  title: ReactNode
  children: ReactNode
  className?: string
}) {
  const container = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)
  const progress = useMotionValue(0)

  /*
   * How far this container has got through the window, measured rather than
   * subscribed to.
   *
   * The original uses `useScroll({ target })`, which caches where the element
   * sits in the document and re-measures on resize. That is right on a page of
   * fixed height and wrong on this one: the room panel opens a row every time
   * the playhead reaches another line, so everything below it moves down without
   * a resize ever firing. The cached offsets go stale and the progress comes out
   * as a step — the card sat at 20° through the whole section and then snapped
   * flat in a single frame. (The floating bar has the same page to deal with,
   * and deals with it the same way: by not trusting a cached measurement.)
   *
   * `getBoundingClientRect` is live geometry, so it cannot be stale. 0 when the
   * top edge is at the bottom of the window, 1 when the bottom edge has left the
   * top of it — the same quantity, correct whatever the page did while nobody
   * was looking.
   */
  useEffect(() => {
    let frame = 0

    const read = () => {
      frame = 0
      const box = container.current?.getBoundingClientRect()
      if (!box) return
      const window_ = window.innerHeight
      progress.set(Math.min(1, Math.max(0, (window_ - box.top) / (box.height + window_))))
    }

    const onScroll = () => {
      if (frame === 0) frame = window.requestAnimationFrame(read)
    }

    const onResize = () => {
      setNarrow(window.innerWidth <= 768)
      onScroll()
    }

    onResize()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize, { passive: true })

    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
    }
  }, [progress])

  /* Standing up over the middle third of that pass: by the time the card is in
     the middle of the window it is facing the reader, and it stays there. */
  const BAND: [number, number] = [0.16, 0.5]

  const rotate = useTransform(progress, BAND, [20, 0])
  // The original's two settings. On a narrow screen the card is drawn smaller
  // throughout, because a full-width panel tilted 20° runs off both edges.
  const scale = useTransform(progress, BAND, narrow ? [0.7, 0.9] : [1.05, 1])
  const lift = useTransform(progress, BAND, [0, -100])

  return (
    <div className={`stand ${className}`} ref={container}>
      <div className="stand__perspective">
        <motion.div className="stand__title" style={{ translateY: lift }}>
          {title}
        </motion.div>

        <motion.div className="stand__card" style={{ rotateX: rotate, scale }}>
          <div className="stand__screen">{children}</div>
        </motion.div>
      </div>
    </div>
  )
}
