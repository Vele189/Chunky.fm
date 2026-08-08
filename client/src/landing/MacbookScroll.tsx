import { motion, useMotionValue, useTransform } from 'motion/react'
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react'

/**
 * A laptop that opens as you scroll it.
 *
 * A port of Aceternity UI's Macbook Scroll
 * (<https://ui.aceternity.com/components/macbook-scroll>). The mechanism is the
 * original's: a tall frame, and a lid whose `rotateX` goes from folded to
 * upright across the first third of the reader's pass through it, while the
 * whole machine drifts down the page at almost the rate the page is scrolling,
 * which is what keeps it in front of you long enough to open at all.
 *
 * Four departures, and all four are this page's rather than preference:
 *
 *  - **The screen is a live page, not a JPEG.** The original takes `src` and
 *    puts an image behind the bezel. Ours takes a node, because what is on this
 *    screen is the listener's view built out of the station's own components.
 *    See `ListenerView`. That is the point of the section: not a picture of the
 *    thing, the thing.
 *  - **It ends at scale 1.** The original grows the screen to 1.5 as it opens,
 *    which an image does not mind. Text does: a transform is a raster, and a
 *    page of 12px type drawn at 8px and blown up is the blurry screenshot every
 *    product site has. So the lid is *built* at its open size and scaled up to
 *    it, ending at exactly 1: the same rendered geometry as the original,
 *    arrived at from the other end, and crisp at the size it is read at.
 *  - **The keyboard is dealt from a list.** The original writes all sixty-odd
 *    keys out by hand with an icon on each function key. The icons are a
 *    dependency this page does not have, and at the size a key ends up they are
 *    two grey pixels; the letters are the part that reads as a keyboard.
 *  - **It is measured, not subscribed to.** `useScroll` caches where the element
 *    is and re-measures on resize; this page changes height without resizing, since
 *    the room panel opens a row every time the playhead reaches a line, so
 *    everything below it moves down and no resize ever fires. The cached offsets
 *    go stale and the progress comes out as a step rather than a sweep.
 *    `getBoundingClientRect`, read in the scroll handler below, is live geometry
 *    and cannot be stale.
 *  - **It stays put by being sticky.** The original translates the machine down
 *    by a flat 1500px as you scroll, which very nearly cancels the scroll and
 *    keeps it in front of you. Nearly is fine on a page that ends there; this one
 *    has a paragraph and then a person's name under it, and a machine translated
 *    1500px out of its own box is drawn straight over both of them. `sticky` is
 *    what that translate is imitating, and it stops at the bottom of the frame
 *    because that is what stopping is for.
 *
 * The whole machine is one `aria-hidden` picture. It is a drawing of a laptop
 * with a drawing of a page on it, and everything it says in words is said again
 * in the section around it.
 */

/**
 * The keys, as they sit on the machine this is a drawing of.
 *
 * A row is a list of caps and a weight: how many key-widths it takes, where a
 * letter key is 1. Space is the wide one; the rest are the mac's own oddities.
 * `sub` is the character above the main one, which only the number row has.
 */
interface Key {
  cap: string
  sub?: string
  wide?: number
  /** Set on keys that are a shape rather than a word: the arrow cluster. */
  glyph?: boolean
}

const KEYS: readonly (readonly Key[])[] = [
  [
    { cap: 'esc', wide: 1.6 },
    ...['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'].map((cap) => ({
      cap,
    })),
    { cap: '', wide: 1 },
  ],
  [
    { cap: '`', sub: '~' },
    { cap: '1', sub: '!' },
    { cap: '2', sub: '@' },
    { cap: '3', sub: '#' },
    { cap: '4', sub: '$' },
    { cap: '5', sub: '%' },
    { cap: '6', sub: '^' },
    { cap: '7', sub: '&' },
    { cap: '8', sub: '*' },
    { cap: '9', sub: '(' },
    { cap: '0', sub: ')' },
    { cap: '-', sub: '_' },
    { cap: '=', sub: '+' },
    { cap: 'delete', wide: 1.6 },
  ],
  [
    { cap: 'tab', wide: 1.6 },
    ...[...'QWERTYUIOP'].map((cap) => ({ cap })),
    { cap: '[' },
    { cap: ']' },
    { cap: '\\' },
  ],
  [
    { cap: 'caps', wide: 1.9 },
    ...[...'ASDFGHJKL'].map((cap) => ({ cap })),
    { cap: ';' },
    { cap: "'" },
    { cap: 'return', wide: 1.9 },
  ],
  [
    { cap: 'shift', wide: 2.5 },
    ...[...'ZXCVBNM'].map((cap) => ({ cap })),
    { cap: ',' },
    { cap: '.' },
    { cap: '/' },
    { cap: 'shift', wide: 2.5 },
  ],
  [
    { cap: 'fn' },
    { cap: 'ctrl' },
    { cap: 'opt' },
    { cap: 'cmd', wide: 1.4 },
    { cap: '', wide: 5.6 },
    { cap: 'cmd', wide: 1.4 },
    { cap: 'opt' },
    { cap: '◀', glyph: true },
    { cap: '▲▼', glyph: true },
    { cap: '▶', glyph: true },
  ],
]

/**
 * The machine's one measurement, in pixels, as a plain number.
 *
 * Every length in the laptop and in the page on its screen is written in `em` of
 * this, so the whole object scales as one drawing: the original's three
 * Tailwind scale steps, made continuous. It is a number rather than a CSS
 * `clamp()` because two things need it and only one of them is a length: the
 * turntable inside the screen is a fixed 340px object whose arm is placed in
 * hand-tuned pixels, so it is *scaled* rather than resized, and a transform
 * needs a ratio. CSS cannot divide one length by another; this can.
 */
const BIGGEST = 17
const PER_VIEWPORT = 0.015
const SMALLEST = 6

export interface MacbookScrollProps {
  /** What is on the screen. A node rather than an image. See above. */
  screen: ReactNode
  /** Above the machine, and gone by the time it is open. */
  title?: ReactNode
  className?: string
}

export function MacbookScroll({ screen, title, className = '' }: MacbookScrollProps) {
  const frame = useRef<HTMLDivElement>(null)
  const progress = useMotionValue(0)
  const [still, setStill] = useState(false)
  const [unit, setUnit] = useState(BIGGEST)

  /*
   * How far the reader has got through this frame.
   *
   * The original's `["start start", "end start"]`: 0 when the frame's top edge
   * reaches the top of the window, 1 when its bottom edge does. Live geometry
   * every frame rather than a cached offset, for the reason in the note above.
   */
  useEffect(() => {
    const motionless = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frameId = 0

    const read = () => {
      frameId = 0
      const box = frame.current?.getBoundingClientRect()
      if (!box || box.height === 0) return
      progress.set(Math.min(1, Math.max(0, -box.top / box.height)))
    }

    const onScroll = () => {
      if (frameId === 0) frameId = window.requestAnimationFrame(read)
    }

    const onResize = () => {
      setStill(motionless.matches)
      setUnit(Math.min(BIGGEST, Math.max(SMALLEST, window.innerWidth * PER_VIEWPORT)))
      onScroll()
    }

    onResize()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize, { passive: true })
    motionless.addEventListener('change', onResize)

    return () => {
      if (frameId !== 0) window.cancelAnimationFrame(frameId)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      motionless.removeEventListener('change', onResize)
    }
  }, [progress])

  /* The original's band: shut for the first tenth, then open by three. */
  const OPENING: [number, number] = [0, 0.3]

  // Squat and slightly splayed while it is shut, its own size once it is up.
  // The original's 1.2 → 1.5 and 0.6 → 1.5, divided through by the 1.5 it ends
  // at, which is the whole of the departure noted above.
  const wide = useTransform(progress, OPENING, [0.8, 1])
  const tall = useTransform(progress, OPENING, [0.4, 1])
  const tilt = useTransform(progress, [0.1, 0.12, 0.3], [-28, -28, 0])
  const lift = useTransform(progress, OPENING, [0, 100])
  const fade = useTransform(progress, [0, 0.2], [1, 0])

  return (
    <div
      className={`macbook ${className}`}
      ref={frame}
      data-still={still ? 'true' : 'false'}
      style={{ '--unit': unit } as CSSProperties}
    >
      {title === undefined ? null : (
        <motion.div
          className="macbook__title"
          style={still ? undefined : { translateY: lift, opacity: fade }}
        >
          {title}
        </motion.div>
      )}

      {/* Sticky, not translated. The note above says why. */}
      <div className="macbook__stack">
        {/* The lid, which is two things in the same place: the back of it,
            lying shut at a fixed angle, and the screen that lifts off it. */}
        <div className="macbook__lid">
          <div className="macbook__shut" aria-hidden="true" />

          <motion.div
            className="macbook__screen"
            style={still ? undefined : { scaleX: wide, scaleY: tall, rotateX: tilt }}
          >
            <div className="macbook__bezel">{screen}</div>
            <span className="macbook__brand" aria-hidden="true">
              chunky<span className="wordmark__tld">.fm</span>
            </span>
          </motion.div>
        </div>

        {/* The base: the hinge's black lip, the speakers either side of the
            keyboard, the trackpad, and the foot the whole thing stands on. */}
        <div className="macbook__base" aria-hidden="true">
          <div className="macbook__hinge">
            <span className="macbook__lip" />
          </div>

          <div className="macbook__deck">
            <span className="macbook__speaker" />
            <div className="macbook__keys">
              {KEYS.map((row, index) => (
                <div className="macbook__row" key={index}>
                  {row.map((key, place) => (
                    <span
                      className="macbook__key"
                      key={`${key.cap}-${place}`}
                      style={{ flexGrow: key.wide ?? 1 }}
                      data-glyph={key.glyph ? 'true' : 'false'}
                    >
                      {key.sub === undefined ? null : (
                        <span className="macbook__sub">{key.sub}</span>
                      )}
                      {key.cap}
                    </span>
                  ))}
                </div>
              ))}
            </div>
            <span className="macbook__speaker" />
          </div>

          <div className="macbook__trackpad" />
          <span className="macbook__foot" />
        </div>
      </div>
    </div>
  )
}
