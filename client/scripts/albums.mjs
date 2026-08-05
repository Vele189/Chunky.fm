/**
 * The sleeves in the pile, from `assets-src/albums` into `src/assets/albums`.
 *
 * Square and small: a record sleeve is square and the scans are not — the Pink
 * Floyd one is 461x600 — so each is cropped to its most interesting region
 * rather than squashed into shape. WebP at 640 is more than the 236px the
 * largest card is ever drawn at, twice over for a retina panel, and lands each
 * one between 25 and 70 KB.
 *
 * The originals stay in assets-src/, which is not copied into the image. What
 * ships is what this writes, and Vite hashes those filenames on the way out.
 */
import fs from 'node:fs'
import sharp from 'sharp'

const SLEEVES = {
  'Pink_Floyd.jpeg': 'pink-floyd.webp',
  'erykah.jpeg': 'erykah-badu.webp',
  'sade.jpeg': 'sade.webp',
  'childish-gambino.jpeg': 'childish-gambino.webp',
  'fleetwood.jpeg': 'fleetwood-mac.webp',
  'jeff-buckle.jpeg': 'jeff-buckley.webp',
  'lauryn-hill.jpeg': 'lauryn-hill.webp',
  'Prince.jpeg': 'prince.webp',
  'radiohead.jpeg': 'radiohead.webp',
}

fs.mkdirSync('src/assets/albums', { recursive: true })

for (const [from, to] of Object.entries(SLEEVES)) {
  await sharp(`assets-src/albums/${from}`)
    .resize(640, 640, { fit: 'cover', position: 'attention' })
    .webp({ quality: 82 })
    .toFile(`src/assets/albums/${to}`)
  console.log(`${to.padEnd(24)} ${(fs.statSync(`src/assets/albums/${to}`).size / 1024).toFixed(1)} KB`)
}
