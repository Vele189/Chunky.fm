import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Podcast } from './Podcast.js'
import './podcast.css'

/**
 * The archive's own entry.
 *
 * A fifth document, and the reason is the same one that made the co-host page
 * its own: what the bundle has to carry. The station's carries a globe, a
 * gramophone, three.js and a websocket protocol, none of which has anything to
 * do with reading show notes and pressing play — and this is the one page here
 * that strangers arrive at cold, from a link in a message, often on a phone on
 * a mobile connection.
 *
 * It shares what matters and nothing that is heavy: the design tokens, the
 * admin session, and the refusal vocabulary. What it deliberately does not
 * share is the clock. The station's whole premise is that everybody is inside
 * the same second; a podcast is the opposite promise — it is yours, you can
 * scrub it, and nobody else is there.
 */

const root = document.getElementById('root')
if (!root) throw new Error('missing #root')

createRoot(root).render(
  <StrictMode>
    <Podcast />
  </StrictMode>,
)
