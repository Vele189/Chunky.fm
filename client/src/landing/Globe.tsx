import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { Arc, GlobeConfig } from './World.js'
import { useOnScreen } from './useOnScreen.js'

/**
 * The globe, and the arithmetic of when to fetch one.
 *
 * Same shape as `Gramophone`, for the same reasons: three.js, three-globe,
 * react-three-fiber and a hundred and sixty kilobytes of country polygons are
 * a lot to make a visitor download before they can read a sentence. So WebGL is
 * probed first (a machine that cannot draw this should not fetch a renderer to
 * find that out) and then the whole thing arrives on a dynamic import, after
 * the page is readable. Until it does, and forever on a machine that cannot
 * draw it, the space is simply empty and the sentence beside it stands alone.
 *
 * The box is sized in landing.css rather than here, so nothing moves when the
 * globe finally lands in it.
 */

const World = lazy(() => import('./World.js'))

/** Johannesburg. One station, one link: everything below arrives here. */
const STATION = { lat: -26.2041, lng: 28.0473 }

/**
 * Where the listeners are.
 *
 * Twelve, scattered, and every one of them arcs to the same place, because the
 * thing this section is about is that there is one of it. A mesh of city-to-city
 * routes, which is what the original demo draws, would be a picture of a
 * network, and this is not a network.
 *
 * `order` staggers the dashes so they do not all set off at once; `arcAlt` is
 * how high each one bows, roughly by how far it has to come.
 */
const LISTENERS: readonly { lat: number; lng: number; alt: number }[] = [
  { lat: 51.5072, lng: -0.1276, alt: 0.42 }, // London
  { lat: 40.7128, lng: -74.006, alt: 0.5 }, // New York
  { lat: -23.5505, lng: -46.6333, alt: 0.42 }, // São Paulo
  { lat: 35.6762, lng: 139.6503, alt: 0.48 }, // Tokyo
  { lat: 6.5244, lng: 3.3792, alt: 0.2 }, // Lagos
  { lat: -1.2921, lng: 36.8219, alt: 0.14 }, // Nairobi
  { lat: 48.8566, lng: 2.3522, alt: 0.4 }, // Paris
  { lat: 19.076, lng: 72.8777, alt: 0.3 }, // Mumbai
  { lat: -33.8688, lng: 151.2093, alt: 0.5 }, // Sydney
  { lat: 55.7558, lng: 37.6173, alt: 0.4 }, // Moscow
  { lat: -33.9249, lng: 18.4241, alt: 0.1 }, // Cape Town
  { lat: 43.6532, lng: -79.3832, alt: 0.5 }, // Toronto
]

const ARCS: Arc[] = LISTENERS.map((listener, index) => ({
  order: index % 6,
  startLat: listener.lat,
  startLng: listener.lng,
  endLat: STATION.lat,
  endLng: STATION.lng,
  arcAlt: listener.alt,
  color: '#ffffff',
}))

/**
 * Monochrome, unlike the original's blue.
 *
 * On this page white is the one accent and red means on the air right now. A
 * globe in three shades of blue would be the only object on the site with a
 * palette of its own, and a globe with red arcs would be claiming something.
 */
const CONFIG: GlobeConfig = {
  pointSize: 3,
  globeColor: '#141414',
  showAtmosphere: true,
  atmosphereColor: '#ffffff',
  atmosphereAltitude: 0.16,
  emissive: '#1a1a1a',
  emissiveIntensity: 0.2,
  shininess: 0.6,
  polygonColor: 'rgba(255,255,255,0.82)',
  ambientLight: '#ffffff',
  directionalLeftLight: '#ffffff',
  directionalTopLight: '#ffffff',
  pointLight: '#ffffff',
  arcTime: 2200,
  arcLength: 0.85,
  rings: 1,
  maxRings: 3,
  autoRotate: true,
  autoRotateSpeed: 0.14,
  faceLng: STATION.lng,
}

export function Globe() {
  const [drawable, setDrawable] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const near = useOnScreen(box)

  useEffect(() => {
    // Cheap, and it saves a machine that cannot draw this from downloading a
    // renderer and a world map in order to find out.
    const probe = document.createElement('canvas')
    if (probe.getContext('webgl2') || probe.getContext('webgl')) setDrawable(true)
  }, [])

  return (
    <div className="globe" ref={box} data-shown={drawable ? 'true' : 'false'} aria-hidden="true">
      {drawable ? (
        <Suspense fallback={null}>
          {/* Stopped rather than unmounted when it is off screen: rebuilding the
              scene would refetch nothing but would cost a stutter every time it
              came back, and stopping is a one-word change react-three-fiber
              already has. */}
          <World globeConfig={CONFIG} data={ARCS} running={near} />
        </Suspense>
      ) : null}
    </div>
  )
}
