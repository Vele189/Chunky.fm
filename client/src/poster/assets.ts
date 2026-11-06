/**
 * The pictures the app is waiting for, by the id they have everywhere.
 *
 * Every image on the page is one of these, and each id is the same one on the
 * Figma page ("revamp — poster", the grey crossed boxes) and on its prompt in
 * docs/midjourney-prompts.md. That way a picture has one name from the prompt
 * to the pixel.
 *
 * `src` is null until the picture exists, and `Slot` draws a labelled
 * placeholder in its place. To drop one in, put the file in src/assets/poster/,
 * import it here and set it as `src`. Nothing else on the page changes, because
 * the slot already has the picture's size and crop.
 *
 *   import room from '../assets/poster/mj-01-room.webp'
 *   ...
 *   room: { id: 'MJ-01', what: 'The room', alt: '…', src: room },
 *
 * `alt` is written now rather than when the picture arrives. Otherwise it is
 * the line most likely to be forgotten, and the prompt already says what the
 * picture will show.
 */

import room from '../assets/poster/mj-01-room.webp'
import deck from '../assets/poster/mj-02-deck.webp'
import roomPhone from '../assets/poster/mj-01-room-phone.webp'
import coverA from '../assets/poster/mj-04a-cover.webp'
import coverB from '../assets/poster/mj-04b-cover.webp'
import host from '../assets/poster/mj-05-host.webp'
import offAir from '../assets/poster/mj-08-off-air.webp'

export interface Asset {
  id: string
  /** What the placeholder calls it, in the same words as the prompt's title. */
  what: string
  /**
   * What a screen reader is told once the picture exists. Placeholders are
   * `aria-hidden` and never read this.
   */
  alt: string
  src: string | null
  /**
   * A second crop for narrow screens, when the wide one would lose its
   * subject. `Slot` serves it below `PHONE` through a `<picture>`.
   */
  phone?: string
}

/** Where `phone` crops take over. The landing page's own phone breakpoint. */
export const PHONE = '(max-width: 760px)'

export const ASSETS = {
  room: {
    id: 'MJ-01',
    what: 'The room',
    alt: 'A small home radio studio at night: somebody at the decks, friends on a couch behind with headphones round their necks.',
    src: room,
    phone: roomPhone,
  },
  offAir: {
    id: 'MJ-08',
    what: 'Off air',
    alt: 'The same studio, empty, with only a desk lamp on.',
    src: offAir,
  },
  cover: {
    id: 'MJ-04a',
    what: 'Session cover',
    alt: '',
    src: coverA,
  },
  deck: {
    id: 'MJ-02',
    what: 'The deck',
    alt: 'A well-used turntable and a small mixer on a wooden table, seen from above.',
    src: deck,
  },
  host: {
    id: 'MJ-05',
    what: 'Host portrait',
    alt: 'A black and white photocopied portrait of the host, headphones round the neck.',
    src: host,
  },
} satisfies Record<string, Asset>

/**
 * The session covers (MJ-04a, MJ-04b, …), for anything that has no poster of
 * its own. One picture repeated down a grid reads as a placeholder, so each
 * key gets one of the set, and always the same one: the same episode keeps its
 * cover between visits. Add a cover by importing it and appending it here.
 */
const COVERS: Asset[] = [
  ASSETS.cover,
  { ...ASSETS.cover, id: 'MJ-04b', src: coverB },
]

export function coverFor(key: string): Asset {
  let hash = 0
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return COVERS[Math.abs(hash) % COVERS.length] ?? ASSETS.cover
}
