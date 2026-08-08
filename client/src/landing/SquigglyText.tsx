import { type ReactNode, useEffect, useId, useRef } from 'react'
import { useOnScreen } from './useOnScreen.js'

/**
 * Text that will not sit still.
 *
 * A port of Aceternity UI's Squiggly Text
 * (<https://ui.aceternity.com/components/squiggly-text>), which is Lucas
 * Bebber's trick: a handful of SVG filters, each one `feTurbulence` noise fed
 * into an `feDisplacementMap`, cycled fast enough that the letters appear to
 * wriggle. Nothing moves; it is five stills shown in turn.
 *
 * Two departures, both about not spending frames this page has other plans for:
 *
 *  - **A timer rather than `useTime`.** The original derives the current filter
 *    from motion's clock, which means a callback on every one of sixty frames a
 *    second to pick a value that changes twelve times a second. An interval at
 *    the step duration writes the same filter at the same moments and costs
 *    a twentieth of that.
 *  - **It stops when nobody is looking.** Off screen it was still swapping
 *    filters, and an SVG filter swap re-rasterises the text it is applied to,
 *    which is not free. Same `useOnScreen` the gramophone and the globe use.
 *
 * And it does not run at all for anyone who has asked their machine not to
 * animate. Text that wobbles continuously is close to the top of the list of
 * things that setting exists for.
 */

export interface SquigglyTextProps {
  children: ReactNode
  /** How many stills to cycle. More is smoother and more filters in the DOM. */
  steps?: number
  /** Milliseconds between swaps. Lower is more frantic. */
  stepDuration?: number
  /** Displacement in px. A pair alternates, as the original demo does. */
  scale?: number | [number, number]
  /** Lower is longer, smoother waves; higher is tighter jitter. */
  baseFrequency?: number
  numOctaves?: number
  className?: string
}

export function SquigglyText({
  children,
  steps = 5,
  stepDuration = 80,
  scale = [6, 8],
  baseFrequency = 0.02,
  numOctaves = 3,
  className = '',
}: SquigglyTextProps) {
  const word = useRef<HTMLSpanElement>(null)
  const near = useOnScreen(word)

  // `useId` gives back something like `:r7:`, and a colon is not valid inside a
  // `url(#…)` reference.
  const id = useId().replace(/[:_]/g, '')
  const filterId = (index: number) => `squiggly-${id}-${index}`

  useEffect(() => {
    const element = word.current
    if (!element) return

    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!near || still) {
      element.style.filter = ''
      return
    }

    let at = 0
    const swap = () => {
      element.style.filter = `url(#${filterId(at % steps)})`
      at += 1
    }
    swap()
    const ticking = window.setInterval(swap, stepDuration)

    return () => {
      window.clearInterval(ticking)
      element.style.filter = ''
    }
  }, [near, steps, stepDuration, id])

  return (
    <span className={`squiggly ${className}`} ref={word}>
      {/* No `<title>`: this svg is a bag of filter definitions, not a picture.
          A title here is read as part of the sentence by anything taking the
          element's text (`Music is Displacement filtersinfinite now.`) and
          `aria-hidden` already keeps it away from anything that would announce
          it. */}
      <svg className="squiggly__filters" aria-hidden="true" focusable="false">
        <defs>
          {Array.from({ length: steps }, (_, index) => (
            <filter id={filterId(index)} key={filterId(index)}>
              <feTurbulence
                baseFrequency={baseFrequency}
                numOctaves={numOctaves}
                result="noise"
                seed={index}
              />
              <feDisplacementMap
                in="SourceGraphic"
                in2="noise"
                scale={Array.isArray(scale) ? scale[index % scale.length] : scale}
              />
            </filter>
          ))}
        </defs>
      </svg>
      {children}
    </span>
  )
}
