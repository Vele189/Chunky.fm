/**
 * The pictures the poster page is waiting for, by the id they have everywhere.
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
}

export const ASSETS = {
  room: {
    id: 'MJ-01',
    what: 'The room',
    alt: 'A small home radio studio at night: somebody at the decks, friends on a couch behind with headphones round their necks.',
    src: null,
  },
  offAir: {
    id: 'MJ-08',
    what: 'Off air',
    alt: 'The same studio, empty, with only a desk lamp on.',
    src: null,
  },
  cover: {
    id: 'MJ-04',
    what: 'Session cover',
    alt: '',
    src: null,
  },
  stickers: {
    id: 'MJ-07',
    what: 'Sticker sheet',
    alt: '',
    src: null,
  },
} satisfies Record<string, Asset>
