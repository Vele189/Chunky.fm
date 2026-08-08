import { useSyncExternalStore } from 'react'

/**
 * Whether this is a phone.
 *
 * The stylesheet already draws a line here, the width at which the rail
 * lies down across the top and the two columns become one, and this is the
 * same line asked in JavaScript, because on the other side of it the listener
 * page stops being one page. Below it the landing view is the deck and what is
 * on it and nothing else; the queue, the evening, the wishes and the room go to
 * the rail's own destinations, which is what a rail full of destinations is for
 * and what a phone has room for.
 *
 * The two have to agree, so the number is written once, here, and the media
 * queries in styles.css quote it. A stylesheet cannot read a constant out of a
 * module, so what keeps them together is that they are both spelled 720 and
 * both say why.
 */
export const PHONE_MAX_WIDTH = 720

const QUERY = `(max-width: ${PHONE_MAX_WIDTH}px)`

/**
 * `matchMedia` rather than a resize listener on `innerWidth`: the browser
 * already knows when the answer changes and says so once, instead of this
 * asking again on every frame of a drag.
 */
function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => undefined
  const list = window.matchMedia(QUERY)
  list.addEventListener('change', onChange)
  return () => list.removeEventListener('change', onChange)
}

function read(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia(QUERY).matches
}

/**
 * Read through `useSyncExternalStore` rather than state set from an effect, and
 * it matters on the first paint: an effect runs after the browser has already
 * drawn once, so a phone would render the wide page (deck, wishes, roster,
 * queue, history, the whole room) and then throw all of it away. This gets the
 * answer during the render that needs it.
 */
export function useNarrow(): boolean {
  return useSyncExternalStore(subscribe, read, () => false)
}
