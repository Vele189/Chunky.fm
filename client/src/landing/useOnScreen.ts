import { type RefObject, useEffect, useState } from 'react'

/**
 * Whether an element is anywhere near the window.
 *
 * Only used by the two things on this page that draw continuously. Both of them
 * were rendering every frame for the whole length of the document — a gramophone
 * turning six screens above you and a globe spinning four below — and the cost
 * lands on everything else: the bar's resize, the pile, the reveal. There is no
 * reason to pay it for an object nobody can see.
 *
 * `rootMargin` starts them a little before they arrive, so nothing appears
 * frozen for the frame it takes to spin up — but only a little. At 400px the
 * globe was still drawing while the bar shrank at 100px of scroll, which is
 * exactly the moment the page has least to spare. Both objects turn slowly
 * enough that resuming one screen-edge early is imperceptible.
 */
export function useOnScreen(ref: RefObject<Element | null>, margin = '150px'): boolean {
  const [near, setNear] = useState(true)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const watcher = new IntersectionObserver(
      ([entry]) => setNear(entry?.isIntersecting ?? true),
      { rootMargin: margin },
    )
    watcher.observe(element)
    return () => watcher.disconnect()
  }, [ref, margin])

  return near
}
