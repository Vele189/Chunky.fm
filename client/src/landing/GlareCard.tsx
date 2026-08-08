import { type CSSProperties, type PointerEvent, type ReactNode, useRef } from 'react'

/**
 * A card that catches the light like a foil trading card.
 *
 * A port of Aceternity UI's Glare Card
 * (<https://ui.aceternity.com/components/glare-card>), which arrives via
 * `npx shadcn add` into a Tailwind + shadcn project. This is neither, so the
 * whole effect is kept — the pointer-driven tilt, the white glare that follows
 * the cursor, and the rainbow foil under it with its four stacked gradients and
 * its blend modes — and the wall of Tailwind arbitrary values that expressed it
 * is `.glare*` in landing.css instead.
 *
 * The effect is entirely CSS custom properties. Everything this component does
 * in JavaScript is measure the pointer and write six numbers:
 *
 *   --m-x / --m-y    where the glare is, as a percentage of the card
 *   --r-x / --r-y    how far it is tilted, in degrees
 *   --bg-x / --bg-y  where the foil's gradients are scrolled to
 *
 * Two departures from the original, and both are about this page rather than
 * about the effect:
 *
 *  - **The radius is 18px, not 48px.** Everything on this site is drawn at
 *    14–22px, and a 48px corner on a 236px card is not a card, it is a lozenge.
 *  - **`--opacity` at rest is 0.** So is the original's — which matters more
 *    here than there. `tokens.css` allows this design one accent (white) and one
 *    signal (red, meaning on the air right now); a rainbow is neither. Keeping
 *    it to a hover means the page a visitor reads is still monochrome, and the
 *    foil is something they find rather than something they are shown.
 *
 * Also not ported: the `console.log(state.current)` the original leaves inside
 * its pointermove handler, which fires on every frame the cursor is over a card.
 */

/** The tilt, as a fraction of what the pointer's offset would otherwise give. */
const TILT = 0.4

export function GlareCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  const card = useRef<HTMLDivElement>(null)
  const inside = useRef(false)

  const follow = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const percent = {
      x: (100 / box.width) * (event.clientX - box.left),
      y: (100 / box.height) * (event.clientY - box.top),
    }
    const from = { x: percent.x - 50, y: percent.y - 50 }

    const set = (name: string, value: string) => card.current?.style.setProperty(name, value)
    set('--m-x', `${percent.x}%`)
    set('--m-y', `${percent.y}%`)
    // Negated on x so the card leans away from the pointer rather than toward
    // it, which is what reads as an object being tilted rather than pushed.
    set('--r-x', `${-(from.x / 3.5) * TILT}deg`)
    set('--r-y', `${(from.y / 2) * TILT}deg`)
    // The foil scrolls at a different rate from the tilt, which is what stops
    // it looking painted on.
    set('--bg-x', `${50 + percent.x / 4 - 12.5}%`)
    set('--bg-y', `${50 + percent.y / 3 - 16.67}%`)
  }

  return (
    <div
      ref={card}
      className={`glare ${className}`}
      style={REST}
      onPointerMove={follow}
      onPointerEnter={() => {
        inside.current = true
        // The card eases into place on the way in, and then follows the pointer
        // with no easing at all — a transition still running while the cursor
        // moves is a card that lags behind it.
        setTimeout(() => {
          if (inside.current) card.current?.style.setProperty('--duration', '0s')
        }, 300)
      }}
      onPointerLeave={() => {
        inside.current = false
        card.current?.style.removeProperty('--duration')
        card.current?.style.setProperty('--r-x', '0deg')
        card.current?.style.setProperty('--r-y', '0deg')
      }}
    >
      <div className="glare__tilt">
        <div className="glare__face">
          <div className="glare__content">{children}</div>
        </div>
        <div className="glare__glow" />
        <div className="glare__foil" style={FOIL} />
      </div>
    </div>
  )
}

/** Where every custom property sits before a pointer has touched the card. */
const REST = {
  '--m-x': '50%',
  '--m-y': '50%',
  '--r-x': '0deg',
  '--r-y': '0deg',
  '--bg-x': '50%',
  '--bg-y': '50%',
  '--duration': '300ms',
  '--foil-size': '100%',
  '--opacity': '0',
  '--radius': '18px',
  '--easing': 'ease',
  '--transition': 'var(--duration) var(--easing)',
} as CSSProperties

/**
 * The foil itself: four backgrounds stacked and blended.
 *
 * Verbatim from the original, because this is the effect. `--pattern` is the
 * swoosh that catches the light, `--rainbow` the spectrum it catches, `--diagonal`
 * the brushed sheen across it, and `--shade` the soft highlight under the
 * pointer. Inline rather than in the stylesheet because two of them are data
 * URIs and one is a seven-stop repeating gradient — in CSS they would be one
 * unreadable line each, and here they are at least labelled.
 */
const FOIL = {
  '--step': '5%',
  '--foil-svg': `url("data:image/svg+xml,%3Csvg width='26' height='26' viewBox='0 0 26 26' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M2.99994 3.419C2.99994 3.419 21.6142 7.43646 22.7921 12.153C23.97 16.8695 3.41838 23.0306 3.41838 23.0306' stroke='white' stroke-width='5' stroke-miterlimit='3.86874' stroke-linecap='round' style='mix-blend-mode:darken'/%3E%3C/svg%3E")`,
  '--pattern': 'var(--foil-svg) center/100% no-repeat',
  '--rainbow':
    'repeating-linear-gradient( 0deg,rgb(255,119,115) calc(var(--step) * 1),rgba(255,237,95,1) calc(var(--step) * 2),rgba(168,255,95,1) calc(var(--step) * 3),rgba(131,255,247,1) calc(var(--step) * 4),rgba(120,148,255,1) calc(var(--step) * 5),rgb(216,117,255) calc(var(--step) * 6),rgb(255,119,115) calc(var(--step) * 7) ) 0% var(--bg-y)/200% 700% no-repeat',
  '--diagonal':
    'repeating-linear-gradient( 128deg,#0e152e 0%,hsl(180,10%,60%) 3.8%,hsl(180,10%,60%) 4.5%,hsl(180,10%,60%) 5.2%,#0e152e 10%,#0e152e 12% ) var(--bg-x) var(--bg-y)/300% no-repeat',
  '--shade':
    'radial-gradient( farthest-corner circle at var(--m-x) var(--m-y),rgba(255,255,255,0.1) 12%,rgba(255,255,255,0.15) 20%,rgba(255,255,255,0.25) 120% ) var(--bg-x) var(--bg-y)/300% no-repeat',
  backgroundBlendMode: 'hue, hue, hue, overlay',
} as CSSProperties
