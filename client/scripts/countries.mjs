/**
 * The country outlines the globe draws, from `assets-src/` into `src/landing/data`.
 *
 * three-globe's `hexPolygonsData` runs every ring through h3-js to work out
 * which hexagons it covers, and h3 is stricter about geometry than a renderer
 * is. Two things here are for it rather than for size:
 *
 *  - Consecutive duplicate points are dropped. Rounding coordinates makes them,
 *    and a zero-length edge is what h3 throws `E_FAILED` on — an uncaught
 *    "The operation failed but a more specific error is not available (code: 1)"
 *    on the page, and the countries after the bad one silently missing.
 *  - Rings left with fewer than four points are dropped, and polygons left with
 *    no outer ring go with them. A triangle-with-a-repeated-corner is not a
 *    polygon, and h3 says so the same way.
 *
 * The rest is size. Every property is stripped — the globe reads geometry and
 * nothing else — and coordinates are cut to three decimal places, which is
 * about 100m and far under one hex at resolution 3. Two was smaller and is what
 * produced the degenerate rings above; three has none.
 *
 * Source: Natural Earth 110m admin-0, public domain, as shipped in
 * three-globe's own examples.
 */
import fs from 'node:fs'

const PLACES = 3
const IN = 'assets-src/ne_110m_admin_0_countries.geojson'
const OUT = 'src/landing/data/countries.json'

const cut = (n) => Math.round(n * 10 ** PLACES) / 10 ** PLACES

/** A ring with no zero-length edges, or null if there is not enough left of it. */
function clean(ring) {
  const out = []
  for (const [lng, lat] of ring) {
    const point = [cut(lng), cut(lat)]
    const last = out[out.length - 1]
    if (last && last[0] === point[0] && last[1] === point[1]) continue
    out.push(point)
  }
  // A closed ring repeats its first point last; that pair is the one duplicate
  // that belongs there, so it is re-made rather than left to the loop above.
  if (out.length > 1) {
    const [first, last] = [out[0], out[out.length - 1]]
    if (first[0] === last[0] && first[1] === last[1]) out.pop()
  }
  return out.length >= 3 ? [...out, out[0]] : null
}

const raw = JSON.parse(fs.readFileSync(IN, 'utf8'))
let dropped = 0

const features = raw.features.flatMap((feature) => {
  const { type, coordinates } = feature.geometry
  const polygons = type === 'Polygon' ? [coordinates] : coordinates

  const kept = polygons
    .map((rings) => rings.map(clean).filter(Boolean))
    // No outer ring, no polygon.
    .filter((rings) => rings.length > 0)

  dropped += polygons.length - kept.length
  if (kept.length === 0) return []

  return [
    {
      type: 'Feature',
      properties: {},
      geometry:
        kept.length === 1
          ? { type: 'Polygon', coordinates: kept[0] }
          : { type: 'MultiPolygon', coordinates: kept },
    },
  ]
})

fs.mkdirSync('src/landing/data', { recursive: true })
fs.writeFileSync(OUT, JSON.stringify({ type: 'FeatureCollection', features }))

const kb = (p) => (fs.statSync(p).size / 1024).toFixed(0)
console.log(`${raw.features.length} features in (${kb(IN)} KB) → ${features.length} out (${kb(OUT)} KB)`)
console.log(`degenerate rings dropped: ${dropped}`)
