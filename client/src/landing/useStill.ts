import { useEffect, useState } from 'react'

/**
 * Whether this visitor has asked for things to hold still.
 *
 * `prefers-reduced-motion`, read as state rather than in a stylesheet, for the
 * things CSS cannot be asked about: a scroll written by `scrollBy`, a row
 * carried by `requestAnimationFrame`, a panel that fades in. Anything that can
 * be said in a media query should still be said in one; this is for the rest.
 *
 * Watched rather than read once. The setting can change under a page — a system
 * theme switching at dusk takes it with it on some platforms — and a component
 * that read it on mount would keep moving for the rest of the visit.
 *
 * The rule everywhere this is used is the station's: asked to hold still,
 * things **stop** rather than slow down. See `BackgroundLines.tsx`, which is
 * not drawn at all when it is asked to hold still.
 */
export function useStill(): boolean {
  const [still, setStill] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const read = () => setStill(query.matches)

    read()
    query.addEventListener('change', read)
    return () => query.removeEventListener('change', read)
  }, [])

  return still
}
