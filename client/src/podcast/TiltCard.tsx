import {
  type CSSProperties,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useId,
  useRef,
  useState,
} from 'react'

/**
 * A card that turns to face the pointer, with its contents at different depths.
 *
 * A port of Aceternity UI's 3D Card Effect
 * (<https://ui.aceternity.com/components/3d-card-effect>), which arrives via
 * `npx shadcn add` into a Tailwind + shadcn project. This is neither, so the
 * effect is kept and the wall of Tailwind arbitrary values that expressed it is
 * `.tilt*` in podcast.css instead — the same trade `GlareCard` and `FeyCards`
 * made, for the same reason.
 *
 * The original's three parts, and they are worth naming because the whole
 * effect is the relationship between them:
 *
 *   CardContainer  the perspective box. Nothing about it moves.
 *   CardBody       the thing that rotates, on `--r-x` and `--r-y`.
 *   CardItem       one layer inside it, pushed toward the reader on Z.
 *
 * What makes it read as depth rather than as a tilted picture is that the
 * items are on `preserve-3d` and are translated along Z *inside* the rotation,
 * so they swing through different arcs as the body turns. A poster at Z=0 with
 * a title at Z=60 is a title floating in front of a poster; both at Z=0 is a
 * postcard being waved about.
 *
 * Three departures, and all three are about what the card is here:
 *
 *  - **The rotation is gentler.** The original divides the pointer offset by 25,
 *    which on its demo card is about 12 degrees at the corner. These are 4:5
 *    posters in a grid of them, and a grid where every card is visibly askew is
 *    a page that will not sit still; see `TILT_DIVISOR`.
 *  - **It is a link, not a div.** The original's container is a plain element
 *    with a mouse handler. Every card here goes somewhere, so the body is
 *    whatever the caller passes — an anchor, in the grid — and the whole card
 *    is one target rather than a title inside it being the only clickable part.
 *  - **A pointer that is not a mouse does nothing.** The original binds
 *    `onMouseMove`, which on a touchscreen fires once on tap and leaves the card
 *    stuck at whatever angle the finger landed at until something else touches
 *    it. Here the handlers are `onPointer*` and ignore anything whose type is
 *    not `mouse`, so a phone gets a flat, fast grid and a desk gets the effect.
 *
 * Also not ported: the original's `useEffect` that walks the DOM to find its
 * children, which is what its `CardItem` needs in order to write transforms
 * imperatively. Here an item is a `<div>` with a CSS custom property on it and
 * the browser does the rest, so there is nothing to walk.
 */

/**
 * How far the card leans, as a divisor of the pointer's offset in pixels.
 *
 * Larger is gentler. The original is 25; this is more than twice that because
 * the original is one hero card on a page of its own and this is a grid of
 * them. At 60, a pointer at the far corner of a 300px card moves it about five
 * degrees — enough to read as an object catching the light, not enough to make
 * a page of nine of them feel unstable.
 */
const TILT_DIVISOR = 60

/**
 * Whether the pointer is over the card, shared with the items inside it.
 *
 * Context rather than a prop, because the items are written by the caller as
 * ordinary children — that is the whole ergonomic point of the original's API —
 * and threading a boolean through arbitrary nesting would mean the caller had
 * to know about it. The original does the same job by walking the DOM.
 */
const HoverContext = createContext(false)

export interface TiltCardProps {
  children: ReactNode
  className?: string
}

/** The perspective box. Nothing here moves; it is what makes Z mean anything. */
export function TiltCard({ children, className = '' }: TiltCardProps) {
  const body = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState(false)

  /**
   * Written straight to the element's style rather than held in state.
   *
   * A `setState` per pointermove is a React render per frame, for a value that
   * only ever reaches CSS. The original does the same thing for the same reason
   * (`ref.current.style.transform = ...`), and `GlareCard` in this project
   * already sets its six custom properties this way.
   */
  const follow = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse') return
    const element = body.current
    if (!element) return
    const box = element.getBoundingClientRect()
    const x = (event.clientX - box.left - box.width / 2) / TILT_DIVISOR
    const y = (event.clientY - box.top - box.height / 2) / TILT_DIVISOR
    // Negated on Y so the card leans *away* from the pointer along the vertical
    // axis, which is what reads as a surface being pressed rather than pulled.
    element.style.setProperty('--r-y', `${x}deg`)
    element.style.setProperty('--r-x', `${-y}deg`)
  }, [])

  const enter = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse') return
    setHovered(true)
  }, [])

  const leave = useCallback(() => {
    setHovered(false)
    const element = body.current
    if (!element) return
    element.style.setProperty('--r-x', '0deg')
    element.style.setProperty('--r-y', '0deg')
  }, [])

  return (
    <div className={`tilt ${className}`}>
      <HoverContext.Provider value={hovered}>
        <div
          className="tilt__body"
          ref={body}
          data-hovered={hovered ? 'true' : 'false'}
          onPointerMove={follow}
          onPointerEnter={enter}
          onPointerLeave={leave}
          // A keyboard never fires a pointer event, so the card stays flat when
          // it is tabbed to — which is right. What it must not do is stay flat
          // *and* give no sign of being focused; see `.tilt__body:focus-within`
          // in podcast.css, which lifts the whole card the way a hover does.
          onBlur={leave}
        >
          {children}
        </div>
      </HoverContext.Provider>
    </div>
  )
}

export interface TiltItemProps {
  children: ReactNode
  /**
   * How far toward the reader this layer sits, in the same units the rest of the
   * scene is drawn in. Zero is the card's own surface.
   */
  z?: number
  className?: string
  as?: 'div' | 'span' | 'h2' | 'p'
}

/**
 * One layer inside the card.
 *
 * The translation is applied only while the card is being pointed at, which is
 * the original's behaviour and is not merely taste: a card whose title sits
 * permanently 60px in front of it overlaps its neighbour in a grid, and the
 * whole page becomes a pile. At rest everything is flat on the surface and the
 * grid is a grid.
 */
export function TiltItem({ children, z = 0, className = '', as = 'div' }: TiltItemProps) {
  const hovered = useContext(HoverContext)
  const Tag = as
  return (
    <Tag
      className={`tilt__item ${className}`}
      style={{ '--z': `${hovered ? z : 0}px` } as CSSProperties}
    >
      {children}
    </Tag>
  )
}

/**
 * A card's poster, with the space it will occupy reserved before it lands.
 *
 * Every poster in this archive is 1080x1350 — the server refuses anything else,
 * see `routes/podcast.ts` — so the ratio is known and can be stated. That is
 * what stops the grid reflowing as images arrive, which on a page that is
 * mostly pictures is the difference between a page that settles and one that
 * jumps while somebody is trying to click it.
 *
 * `alt` is the episode title rather than a description of the artwork, because
 * that is what the picture is standing in for here: the card is a link, and a
 * screen reader should hear where it goes.
 */
export function TiltPoster({
  src,
  alt,
  eager = false,
}: {
  src: string | null
  alt: string
  eager?: boolean
}) {
  const id = useId()
  if (src === null) {
    // An episode with no poster is not supposed to exist — the upload refuses
    // one without it — but a row predating that rule, or a file lost from the
    // volume, must not render as a broken image icon in a grid.
    return <div className="tilt__poster tilt__poster--none" aria-hidden="true" key={id} />
  }
  return (
    <img
      className="tilt__poster"
      src={src}
      alt={alt}
      width={1080}
      height={1350}
      // The first row is what somebody is looking at; everything below the fold
      // can wait. `eager` is passed by the grid for the first few cards only.
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
    />
  )
}
