import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { routeInHash, stationUrl } from '../lib/routes.js'
import { Landing } from './Landing.js'
import './landing.css'

/**
 * The landing page's own entry.
 *
 * Separate from src/main.tsx so the two documents share nothing but the design:
 * this bundle has no station in it (no socket, no clock, no audio element)
 * which is why the page in front of the station keeps working when the station
 * behind it does not.
 */

/**
 * Anything still pointing at the old address of a station view.
 *
 * `/#admin` was the console's address for the whole of the project so far: it
 * is in the README, in start.sh's parting words, and in whatever bookmark
 * whoever runs the decks is using, and `/#chat` and the rest were links people
 * sent each other. All of them now arrive here, at the page in front of the
 * station, and the fragment is the only part of the request nginx never saw.
 * So this is the only place that can honour them, and it does.
 *
 * `replace` rather than an assignment: a bookmark that bounced should not need
 * two taps of Back to get out of. Fragments this page owns, such as `#clockwork`, name
 * no route and are left alone.
 */
const bookmarked = routeInHash(window.location.hash)
if (bookmarked !== null) window.location.replace(stationUrl(bookmarked))

const root = document.getElementById('root')
if (!root) throw new Error('missing #root')

createRoot(root).render(
  <StrictMode>
    <Landing />
  </StrictMode>,
)
