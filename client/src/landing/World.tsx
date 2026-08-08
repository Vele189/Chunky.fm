import { Canvas, extend, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import { Color, Vector3 } from 'three'
import ThreeGlobe from 'three-globe'
import countries from './data/countries.json'

/**
 * The globe.
 *
 * A port of Aceternity UI's GitHub Globe
 * (<https://ui.aceternity.com/components/github-globe>), which arrives via
 * `npx shadcn add` into a Tailwind + shadcn project. This is neither, so the
 * mechanics are kept: three-globe's hex polygons, the dashed animated arcs,
 * the rings that fire at the arc origins, the locked OrbitControls doing the
 * slow spin. Everything that was a Tailwind class or an `@/` alias is a
 * rule in landing.css or a relative import here.
 *
 * Four things are deliberately not the original's:
 *
 *  - **Colour.** The demo is a blue globe with cyan, blue and indigo arcs. This
 *    design has one accent (white) and one signal (red, meaning on the air right
 *    now, and nothing else may borrow it). So the globe is monochrome: white
 *    land at low alpha on a near-black sphere, white arcs, and no red anywhere
 *    near it.
 *  - **Where the arcs go.** The demo's are a mesh of city-to-city routes, which
 *    is the picture of a network. This is not a network: it is one station and
 *    one link. So every arc lands on the same point, which is both the truer
 *    picture and the one this section is actually about.
 *  - **The country data.** The component imports `@/data/globe.json`, which
 *    shadcn does not install and you are expected to supply. `data/countries.json`
 *    is Natural Earth 110m (public domain, from three-globe's own examples) with
 *    every property stripped (the globe reads geometry and nothing else) and
 *    the coordinates rounded to two decimal places, which at this scale is well
 *    under one hex. 477 KB to 164 KB.
 *  - **Pixel ratio.** The original sets the renderer to `devicePixelRatio`
 *    uncapped. Past 2 those are pixels nobody can see, costing frames on the
 *    phones least able to spare them.
 *  - **No drei, and no hand-built camera.** The original spins the globe with
 *    an `OrbitControls` that has pan, zoom and rotate all switched off: a whole
 *    dependency for `autoRotate`, which is one line in `useFrame`. And its
 *    camera is an instance built with a hardcoded 1.2 aspect ratio, which draws
 *    the sphere as an ellipse in any box that is not that shape; described to
 *    the Canvas instead, react-three-fiber keeps the aspect in step with the
 *    box on every resize.
 *
 * Nothing here reports anything, like every other instrument on this page. It
 * is a picture of listeners on one station; there is no station behind this
 * page to ask.
 */

extend({ ThreeGlobe })

declare module '@react-three/fiber' {
  interface ThreeElements {
    threeGlobe: ThreeElements['mesh'] & { new (): ThreeGlobe }
  }
}

const RING_PROPAGATION_SPEED = 3
const CAMERA_Z = 300

/** White. Bright enough that land reads as land on a near-black sphere. */
const LAND = 'rgba(255,255,255,0.82)'

export interface Arc {
  order: number
  startLat: number
  startLng: number
  endLat: number
  endLng: number
  arcAlt: number
  color: string
}

export interface GlobeConfig {
  pointSize?: number
  globeColor?: string
  showAtmosphere?: boolean
  atmosphereColor?: string
  atmosphereAltitude?: number
  emissive?: string
  emissiveIntensity?: number
  shininess?: number
  polygonColor?: string
  ambientLight?: string
  directionalLeftLight?: string
  directionalTopLight?: string
  pointLight?: string
  arcTime?: number
  arcLength?: number
  rings?: number
  maxRings?: number
  autoRotate?: boolean
  autoRotateSpeed?: number
  /** The longitude to have facing the viewer on the first frame. */
  faceLng?: number
}

interface WorldProps {
  globeConfig: GlobeConfig
  data: Arc[]
  /** False stops the frame loop. See `useOnScreen`. */
  running?: boolean
}

function Globe({ globeConfig, data }: WorldProps) {
  const globe = useRef<ThreeGlobe | null>(null)
  // Typed, unlike the original's bare `useRef()`, which does not survive
  // `strict` and would be an `any` reaching into three's scene graph.
  const group = useRef<import('three').Group>(null)
  const [ready, setReady] = useState(false)

  const props = {
    pointSize: 1,
    atmosphereColor: '#ffffff',
    showAtmosphere: true,
    atmosphereAltitude: 0.1,
    polygonColor: LAND,
    globeColor: '#141414',
    emissive: '#000000',
    emissiveIntensity: 0.1,
    shininess: 0.9,
    arcTime: 2000,
    arcLength: 0.9,
    rings: 1,
    maxRings: 3,
    ...globeConfig,
  }

  useEffect(() => {
    if (globe.current || !group.current) return
    globe.current = new ThreeGlobe()
    group.current.add(globe.current)
    /* Turned so the station is facing the viewer on the first frame. three-globe
       puts longitude −90 at the camera, so this is how far round the station's
       own longitude has to come; otherwise the page opens on the Pacific and
       the arcs are all round the back for the first half-minute. */
    group.current.rotation.y = ((-90 - (globeConfig.faceLng ?? 0)) * Math.PI) / 180
    setReady(true)
  }, [])

  useEffect(() => {
    if (!globe.current || !ready) return
    const material = globe.current.globeMaterial() as unknown as {
      color: Color
      emissive: Color
      emissiveIntensity: number
      shininess: number
    }
    material.color = new Color(props.globeColor)
    material.emissive = new Color(props.emissive)
    material.emissiveIntensity = props.emissiveIntensity
    material.shininess = props.shininess
  }, [ready, props.globeColor, props.emissive, props.emissiveIntensity, props.shininess])

  useEffect(() => {
    if (!globe.current || !ready || !data) return

    /*
     * A point at each end of every arc, deduplicated, the way the original builds this
     * the same way. With every arc landing on the same place, the dedupe is
     * what stops the station being drawn once per listener.
     */
    const points = data.flatMap((arc) => [
      { size: props.pointSize, order: arc.order, color: arc.color, lat: arc.startLat, lng: arc.startLng },
      { size: props.pointSize, order: arc.order, color: arc.color, lat: arc.endLat, lng: arc.endLng },
    ])
    const unique = points.filter(
      (point, index, all) =>
        all.findIndex((other) => other.lat === point.lat && other.lng === point.lng) === index,
    )

    globe.current
      .hexPolygonsData(countries.features)
      .hexPolygonResolution(3)
      .hexPolygonMargin(0.7)
      .showAtmosphere(props.showAtmosphere)
      .atmosphereColor(props.atmosphereColor)
      .atmosphereAltitude(props.atmosphereAltitude)
      .hexPolygonColor(() => props.polygonColor)

    globe.current
      .arcsData(data)
      .arcStartLat((d) => (d as Arc).startLat)
      .arcStartLng((d) => (d as Arc).startLng)
      .arcEndLat((d) => (d as Arc).endLat)
      .arcEndLng((d) => (d as Arc).endLng)
      .arcColor((d: object) => (d as Arc).color)
      .arcAltitude((d) => (d as Arc).arcAlt)
      .arcStroke(() => 0.55)
      .arcDashLength(props.arcLength)
      // What staggers them, so they do not all set off together.
      .arcDashInitialGap((d) => (d as Arc).order)
      /* The original's is 15, which with a dash of 0.85 leaves every arc dark
         for about 95% of its cycle: on a demo with fifty arcs something is
         always lit, but with twelve the globe is mostly empty. Small enough
         here that arcs are usually in flight, large enough that they still
         arrive rather than being twelve static lines. */
      .arcDashGap(1.6)
      .arcDashAnimateTime(() => props.arcTime)

    globe.current
      .pointsData(unique)
      .pointColor((d: object) => (d as { color: string }).color)
      .pointsMerge(true)
      .pointAltitude(0)
      .pointRadius(1)

    globe.current
      .ringsData([])
      .ringColor(() => props.polygonColor)
      .ringMaxRadius(props.maxRings)
      .ringPropagationSpeed(RING_PROPAGATION_SPEED)
      .ringRepeatPeriod((props.arcTime * props.arcLength) / props.rings)
  }, [ready, data])

  /** A ripple at a handful of origins every couple of seconds. */
  useEffect(() => {
    if (!globe.current || !ready || !data) return

    const beat = setInterval(() => {
      if (!globe.current) return
      const chosen = pickSome(data.length, Math.floor((data.length * 4) / 5))
      globe.current.ringsData(
        data
          .filter((_, index) => chosen.includes(index))
          .map((arc) => ({ lat: arc.startLat, lng: arc.startLng, color: arc.color })),
      )
    }, 2000)

    return () => clearInterval(beat)
  }, [ready, data])

  // What `OrbitControls autoRotate` was doing, without the dependency: a slow
  // turn, tied to elapsed time so it is the same speed on a 60Hz panel and a
  // 120Hz one. Stopped for anyone who has asked their machine not to animate.
  const still = useRef(
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useFrame((_state, delta) => {
    if (!group.current || still.current) return
    group.current.rotation.y += delta * (globeConfig.autoRotateSpeed ?? 0.12)
  })

  return <group ref={group} />
}

function RendererConfig() {
  const { gl, size } = useThree()

  useEffect(() => {
    // Capped at 2. See the note at the top of the file.
    gl.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    gl.setSize(size.width, size.height)
    gl.setClearAlpha(0)
  }, [gl, size])

  return null
}

export default function World({ globeConfig, data, running = true }: WorldProps) {
  return (
    /* Camera described rather than constructed, so its aspect tracks the box;
       see the note at the top. No fog: the original's is white and this page is
       not, and at this camera distance it only ever greyed the far limb. */
    <Canvas
      camera={{ position: [0, 0, CAMERA_Z], fov: 50, near: 180, far: 1800 }}
      frameloop={running ? 'always' : 'never'}
    >
      <RendererConfig />
      <ambientLight color={globeConfig.ambientLight} intensity={1.1} />
      <directionalLight
        color={globeConfig.directionalLeftLight}
        position={new Vector3(-400, 100, 400)}
      />
      <directionalLight
        color={globeConfig.directionalTopLight}
        position={new Vector3(-200, 500, 200)}
      />
      <pointLight
        color={globeConfig.pointLight}
        position={new Vector3(-200, 500, 200)}
        intensity={0.8}
      />
      <Globe globeConfig={globeConfig} data={data} />
    </Canvas>
  )
}

/** `count` distinct indexes below `max`. The original's `genRandomNumbers`. */
function pickSome(max: number, count: number): number[] {
  const picked: number[] = []
  while (picked.length < Math.min(count, max)) {
    const index = Math.floor(Math.random() * max)
    if (!picked.includes(index)) picked.push(index)
  }
  return picked
}
