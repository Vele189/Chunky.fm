import { useEffect, useState } from 'react'

/**
 * A count that catches up to another one, a step at a time.
 *
 * The conversation knows how many of its lines are due, since the playhead has gone
 * past them, but due is not the same as said. Arriving at the room section with
 * the record already at 2:13 means five lines are due at once, and five bubbles
 * appearing in the same frame is not a conversation, it is a transcript. So the
 * panel is shown this number instead, which walks up to the real one and lets
 * each line land on its own.
 *
 * Backwards is not animated. Scrolling up takes the playhead with it and lines
 * fall out of the conversation again; running that in reverse a step at a time
 * would be the room un-saying things at a stately pace while the reader is
 * already somewhere else.
 */

/** How long between one line landing and the next. */
const GAP_MS = 420

/**
 * The next value on the way to `target`. Pure, so the pacing is testable
 * without a clock: forwards one at a time, backwards all at once.
 */
export function nextStep(shown: number, target: number): number {
  return shown > target ? target : Math.min(shown + 1, target)
}

export function useOneByOne(target: number, gap = GAP_MS): number {
  const [shown, setShown] = useState(0)

  useEffect(() => {
    if (shown === target) return

    // Backwards settles immediately; there is nothing to watch happen.
    if (shown > target) {
      setShown(target)
      return
    }

    const next = window.setTimeout(() => setShown((was) => nextStep(was, target)), gap)
    return () => window.clearTimeout(next)
  }, [shown, target, gap])

  return shown
}
