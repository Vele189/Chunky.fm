import { useEffect, useState } from 'react'

/**
 * One word in a sentence, changing to another.
 *
 * A port of Aceternity UI's Flip Words
 * (<https://ui.aceternity.com/components/flip-words>). What is kept is the
 * idea: a sentence that is true more than one way, saying so by swapping the
 * word that changes rather than by listing the alternatives.
 *
 * Three departures:
 *
 *  - **The box is as wide as the widest word.** The original lets the word be
 *    whatever width it is, so everything after it in the sentence slides
 *    sideways every few seconds. That is fine at the end of a line and wrong in
 *    the middle of one, which is where this sits. Every word is rendered into
 *    the same grid cell, so the sentence is laid out once at the width of the
 *    longest and nothing after it ever moves.
 *  - **The letters do not animate.** The original blurs and lifts each letter
 *    on a stagger, which is around forty animated elements for two words and
 *    reads, at this size, as a word being assembled rather than a word being
 *    swapped. One crossfade and a small lift says the same thing.
 *  - **It can be held.** The original runs from the moment it mounts, forever.
 *    This takes `running`, the way `FlipBoard` does, so it is not turning over
 *    six screens above somebody reading the bottom of the page.
 *
 * Asked to hold still, this should not be used at all: a word that changes on a
 * timer is content updating by itself, and stopping the animation while still
 * changing the word is the wrong half. The caller is expected to say the
 * sentence a different way instead — see `Hero`, which writes both nights out.
 */

/** How long a word holds. The original's default, which reads about right. */
const EVERY = 3000

export interface FlipWordsProps {
  words: readonly string[]
  /** Held on the word it is on while this is false. */
  running?: boolean
  className?: string
}

export function FlipWords({ words, running = true, className = '' }: FlipWordsProps) {
  const [showing, setShowing] = useState(0)

  useEffect(() => {
    if (!running || words.length < 2) return
    const round = setInterval(() => setShowing((was) => (was + 1) % words.length), EVERY)
    return () => clearInterval(round)
  }, [running, words.length])

  return (
    <span className={`flip ${className}`}>
      {words.map((word, index) => (
        <span
          className="flip__word"
          key={word}
          data-showing={index === showing ? 'true' : 'false'}
          // Everything not on screen is out of the sentence as well as out of
          // the picture. A reader hearing this page read aloud gets one night
          // named, which is a sentence; all of them at once is not.
          aria-hidden={index === showing ? undefined : true}
        >
          {word}
        </span>
      ))}
    </span>
  )
}
