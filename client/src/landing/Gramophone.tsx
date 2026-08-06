import { useEffect, useRef, useState } from 'react'
import { Deck } from '../Turntable.js'
import modelUrl from '../assets/models/gramophone.glb?url'
import { useOnScreen } from './useOnScreen.js'

/**
 * The object in the hero.
 *
 * A real gramophone, turned slowly, behind the headline. It replaces the flat
 * `Deck` that used to sit there — but only once it has actually arrived, and
 * only on a machine that can draw it. Until then, and forever on a machine that
 * cannot, the `Deck` is what is on screen. That is the whole design of this
 * component: the page has never needed the model, so nothing about the page
 * waits for it, breaks without it, or reserves a hole where it would have gone.
 *
 * Three things follow from that, and all three are the point:
 *
 *  - **three.js and the model are both loaded after the page is.** They are a
 *    dynamic `import()`, so neither is in the landing bundle and neither is
 *    fetched until the browser has something readable on screen. The landing
 *    page's own bundle is a few kilobytes and has to stay that way — it is the
 *    page that has to work on the days nothing else does.
 *  - **WebGL is checked before three is fetched.** A machine that cannot draw
 *    this should not download a renderer to discover that.
 *  - **Nothing here reports anything.** Like the deck it replaces, it is an
 *    object on a page, not an instrument: it turns because gramophones turn,
 *    not because a station is playing. There is no station behind this page.
 *
 * `still` stops it. The page uses this once, beside the DJ — the station is off
 * more than it is on, and a stopped gramophone next to the person who decides
 * that is the page saying so without a sentence. It is not the same as
 * `prefers-reduced-motion`, which stops every instance and is the visitor's
 * setting rather than the page's meaning; both end in the same frame loop, and
 * a still gramophone stops drawing rather than redrawing an identical frame.
 *
 * The model is 30 MB as it came off Sketchfab and 1 MB in the bundle — 25 PNG
 * textures down to WebP at 1024, and the geometry quantized. See the
 * `assets:models` script in package.json, which is the command that did it and
 * the way to do it again. Quantization rather than Draco deliberately: Draco
 * needs a decoder fetched at runtime, and this app does not reach off its own
 * origin for anything.
 */

/** How long one turn takes. Slower than the flat deck — this one has detail. */
const TURN_MS = 26_000

/**
 * The shortest gap between two draws, in milliseconds.
 *
 * A full turn takes twenty-six seconds, so at 60fps this object moves about a
 * seventh of a degree per frame — half of those frames are indistinguishable
 * from the one before, and every one of them costs the same as a real one. At
 * 30 it looks identical and gives the rest of the page back half a budget it
 * badly wants while the bar is resizing over the top of it.
 */
const DRAW_EVERY_MS = 33

export function Gramophone({ still = false }: { still?: boolean }) {
  const mount = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)
  const near = useOnScreen(mount)

  /* Both read inside the frame loop rather than closed over, so the loop does
     not have to be torn down and rebuilt every time one of them changes. */
  const drawing = useRef(true)
  drawing.current = near
  const stopped = useRef(still)
  stopped.current = still

  useEffect(() => {
    const host = mount.current
    if (!host) return

    // Cheap enough to do synchronously, and it saves a machine that cannot draw
    // this from fetching a renderer in order to find out.
    const probe = document.createElement('canvas')
    if (!probe.getContext('webgl2') && !probe.getContext('webgl')) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let cancelled = false
    let teardown: (() => void) | undefined

    const draw = async () => {
      const [THREE, { GLTFLoader }] = await Promise.all([
        import('three'),
        import('three/examples/jsm/loaders/GLTFLoader.js'),
      ])
      if (cancelled) return

      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100)
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
      // Transparent: the sheet behind it is the page's own near-black, and a
      // renderer clearing to its own black would draw a visible square on it.
      renderer.setClearAlpha(0)
      // Capped at 2 — past that it is pixels nobody can see costing frames on
      // the phones least able to spare them.
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = 1.15

      /*
       * Lighting, and it is doing more work than it looks.
       *
       * The model came with metal and lacquer materials that expect an
       * environment to reflect. There isn't one — an HDR would be another
       * megabyte off the network — so this is three lights standing in for a
       * room: a key from the front left, a rim from behind to pick the horn's
       * edge out of a near-black page, and enough ambient that the unlit side
       * is dark rather than absent.
       */
      scene.add(new THREE.AmbientLight(0xffffff, 1.1))
      const key = new THREE.DirectionalLight(0xffffff, 2.6)
      key.position.set(-3, 4, 5)
      scene.add(key)
      const rim = new THREE.DirectionalLight(0xffffff, 1.9)
      rim.position.set(4, 2, -4)
      scene.add(rim)

      const gltf = await new GLTFLoader().loadAsync(modelUrl)
      if (cancelled) {
        renderer.dispose()
        return
      }

      /*
       * The model arrives at whatever size and offset it was exported at, which
       * for anything off Sketchfab is not a size or an offset anybody chose.
       * So it is measured and normalised: centred on its own bounding box and
       * scaled to a known height, which is what lets the camera below be a
       * fixed number rather than one tuned by eye against this one file.
       */
      const object = gltf.scene
      const box = new THREE.Box3().setFromObject(object)
      const size = box.getSize(new THREE.Vector3())
      const centre = box.getCenter(new THREE.Vector3())
      object.position.sub(centre)
      object.scale.setScalar(2 / Math.max(size.x, size.y, size.z))

      // A turntable is a thing you look slightly down at, and the horn reads
      // as a horn from about three quarters on rather than face on.
      const spin = new THREE.Group()
      spin.add(object)
      spin.rotation.x = 0.12
      scene.add(spin)
      camera.position.set(0, 0.35, 4.4)
      camera.lookAt(0, 0, 0)

      /* Whether the next frame would differ from the one already on screen.
         A turning gramophone sets this every frame and it means nothing; a
         still one only sets it when the box changes size, and then this is the
         difference between drawing thirty identical frames a second and
         drawing one. */
      let dirty = true

      const resize = () => {
        const { width, height } = host.getBoundingClientRect()
        if (width === 0 || height === 0) return
        renderer.setSize(width, height, false)
        camera.aspect = width / height
        camera.updateProjectionMatrix()
        dirty = true
      }
      const watcher = new ResizeObserver(resize)
      watcher.observe(host)
      resize()

      host.append(renderer.domElement)
      setShown(true)

      let frame = 0
      let last = 0
      let drawn = 0
      const tick = (now: number) => {
        frame = requestAnimationFrame(tick)
        // Elapsed time rather than a per-frame increment, so the turn takes
        // TURN_MS on a 60Hz panel and on a 120Hz one alike.
        if (!reduced && !stopped.current) {
          spin.rotation.y += ((now - last) / TURN_MS) * Math.PI * 2
          dirty = true
        }
        last = now

        // Off screen this is a turning record nobody can see, costing frames the
        // bar's resize and the reveal both want. The clock above still runs, so
        // it comes back at the angle it would have reached rather than the one
        // it left at.
        if (!drawing.current) return
        if (now - drawn < DRAW_EVERY_MS) return
        if (!dirty) return
        drawn = now
        dirty = false
        renderer.render(scene, camera)
      }
      last = performance.now()
      frame = requestAnimationFrame(tick)

      teardown = () => {
        cancelAnimationFrame(frame)
        watcher.disconnect()
        renderer.domElement.remove()
        // Textures and buffers are GPU allocations and are not garbage —
        // without this, a re-mount in development leaks a whole model each time.
        scene.traverse((node) => {
          if (!(node instanceof THREE.Mesh)) return
          node.geometry.dispose()
          for (const material of [node.material].flat()) material.dispose()
        })
        renderer.dispose()
      }
    }

    // A model that fails to arrive is a hero that keeps the deck it already had.
    // Nothing is said about it: a visitor was never promised a gramophone.
    void draw().catch(() => {})

    return () => {
      cancelled = true
      teardown?.()
    }
  }, [])

  return (
    <div className="gram" data-shown={shown ? 'true' : 'false'}>
      {/* What is on screen until the model is, and what stays there if it never
          comes. Not a placeholder box — it is the station's own deck, which is
          what the hero was before this and is a finished thing in its own right.
          It stands still where the model would, so a machine that cannot draw
          one still says the same thing about the station. */}
      <div className="gram__fallback">
        <Deck artwork={null} spinning={!still} />
      </div>
      <div className="gram__stage" ref={mount} />
    </div>
  )
}
