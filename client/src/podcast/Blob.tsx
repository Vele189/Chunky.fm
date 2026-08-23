import { type CSSProperties, useEffect, useRef } from 'react'

/**
 * A blob that moves with the voice coming out of the speakers.
 *
 * The brief was "a pulsing sort of blob for when it's in play, to emulate the
 * speakers talking", and there are two ways to build that. The easy one is a
 * CSS keyframe animation that breathes on a fixed two-second loop; it looks
 * fine in a screenshot and wrong within about four seconds of watching it,
 * because it is plainly not listening to anything — it keeps pulsing through
 * silences and sits still through a laugh.
 *
 * So this reads the actual audio. An `AnalyserNode` is tapped off the element
 * that is already playing, and every frame the blob is resized and reshaped
 * from what is actually coming out. When somebody talks it swells; when they
 * stop it settles; when two people laugh over each other it goes wide.
 *
 * ## What it costs, and the one thing to know before touching this
 *
 * `createMediaElementSource` **permanently reroutes an element's audio through
 * the graph**. From the moment it is called, that element reaches the speakers
 * only via `context.destination`, and if the context is suspended the result is
 * not quiet audio, it is silence. Browsers start every context suspended and
 * only a user gesture may resume one.
 *
 * That is why the graph is built lazily, on the first play — which is a click —
 * rather than on mount. `lib/audio-graph.ts` in the station makes exactly this
 * choice for exactly this reason, and its note is worth reading; this is the
 * same hazard in a much smaller room.
 *
 * A browser with no Web Audio at all, or one that refuses the graph, gets an
 * element playing normally and a blob that breathes on a gentle default. The
 * audio is never sacrificed for the decoration.
 */

/**
 * How many buckets the spectrum is split into.
 *
 * 64 bins from a 128-point FFT, which is coarse for a spectrum analyser and
 * exactly right here: this is not a visualisation anybody reads values off, it
 * is three numbers driving a shape. A larger transform costs more per frame and
 * produces a blob that jitters on detail nobody can see.
 */
const FFT_SIZE = 128

/**
 * How much of the previous frame's value is kept, as the analyser's own
 * smoothing constant.
 *
 * High, deliberately. Speech is spiky at frame rate, and a blob driven by raw
 * amplitude vibrates rather than breathes. This is most of what makes the thing
 * look like a lung instead of a strobe.
 */
const SMOOTHING = 0.8

/**
 * How fast the blob settles toward the level, per frame, as a lerp factor.
 *
 * A second stage of smoothing on top of the analyser's, and it is not
 * redundant: the analyser smooths the *spectrum*, and this smooths the shape's
 * response to it. Slower on the way down than up (see `ease`), because a voice
 * stopping should let the blob relax rather than drop it.
 */
const RISE = 0.35
const FALL = 0.08

/** Where the three bands are cut, as fractions of the bins. See `bands`. */
const LOW_END = 0.15
const MID_END = 0.5

export interface BlobProps {
  /** The element being listened to. Null before there is one. */
  audio: HTMLAudioElement | null
  /** Whether sound is actually coming out. A paused blob rests. */
  playing: boolean
  className?: string
}

interface Graph {
  context: AudioContext
  analyser: AnalyserNode
  /**
   * The scratch array the spectrum is read into each frame.
   *
   * Held here rather than allocated per frame: this is read sixty times a
   * second for as long as an episode is playing, and a fresh array each time is
   * an hour of garbage for no reason.
   *
   * Explicitly backed by an `ArrayBuffer` rather than left as a bare
   * `Uint8Array`, because the analyser will not take one that might be over a
   * `SharedArrayBuffer` — the default type parameter admits both, and this one
   * never is.
   */
  bins: Uint8Array<ArrayBuffer>
}

/**
 * Graphs already built, per element.
 *
 * `createMediaElementSource` may be called exactly once for a given element; a
 * second call throws `InvalidStateError`. React's StrictMode double-invokes
 * effects in development, so without this the naive version throws on the first
 * render in every dev session. The same `WeakMap` trick `lib/audio-graph.ts`
 * uses, for the same reason.
 */
const graphs = new WeakMap<HTMLAudioElement, Graph | null>()

/**
 * Tap an analyser off an element, or null if this browser will not have it.
 *
 * Null is a real answer and not an error: the caller falls back to a blob that
 * breathes on its own, and the audio plays untouched. That is much better than
 * the alternative failure, which is a graph that was built and cannot be
 * resumed — silence with a very pretty animation over it.
 */
function tap(element: HTMLAudioElement): Graph | null {
  const existing = graphs.get(element)
  if (existing !== undefined) return existing

  const Ctor =
    window.AudioContext ??
    (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) {
    graphs.set(element, null)
    return null
  }

  try {
    const context = new Ctor()
    const source = context.createMediaElementSource(element)
    const analyser = context.createAnalyser()
    analyser.fftSize = FFT_SIZE
    analyser.smoothingTimeConstant = SMOOTHING
    source.connect(analyser)
    // And on to the speakers. Without this the element is routed into a graph
    // that ends nowhere, which is a silent page and a working blob.
    analyser.connect(context.destination)

    const graph: Graph = {
      context,
      analyser,
      bins: new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount)),
    }
    graphs.set(element, graph)
    return graph
  } catch {
    // Most likely a source node already built for this element somewhere else.
    // Nothing to recover: the element is routed, and a second graph would not
    // be heard.
    graphs.set(element, null)
    return null
  }
}

/**
 * Three numbers out of a spectrum: how much bass, body and air there is.
 *
 * Three rather than one overall level, because a blob driven by a single
 * amplitude only ever gets bigger and smaller, and that reads as a volume meter.
 * Splitting the spectrum lets the *shape* change with the sound: the low end
 * drives how much it swells, the mids (where a voice lives) drive how far it
 * deforms, and the top end drives the wobble. A vowel and a consonant then look
 * different, which is the whole illusion.
 */
function bands(bins: Uint8Array<ArrayBuffer>): { low: number; mid: number; high: number } {
  const lowEnd = Math.floor(bins.length * LOW_END)
  const midEnd = Math.floor(bins.length * MID_END)
  const mean = (from: number, to: number) => {
    let total = 0
    for (let i = from; i < to; i++) total += bins[i] ?? 0
    return to > from ? total / (to - from) / 255 : 0
  }
  return { low: mean(0, lowEnd), mid: mean(lowEnd, midEnd), high: mean(midEnd, bins.length) }
}

export function Blob({ audio, playing, className = '' }: BlobProps) {
  const root = useRef<HTMLDivElement>(null)
  // Read through a ref inside the animation loop so that the loop is started
  // once and never restarted by a re-render — `playing` changes on every
  // play and pause, and a frame loop torn down and rebuilt each time would
  // drop the smoothing state that makes the motion continuous.
  const playingRef = useRef(playing)
  playingRef.current = playing

  useEffect(() => {
    const element = root.current
    if (!element) return

    let frame = 0
    // The smoothed values the shape is actually drawn from, kept across frames.
    let level = 0
    let deform = 0
    let wobble = 0

    const ease = (current: number, target: number) =>
      current + (target - current) * (target > current ? RISE : FALL)

    const draw = () => {
      frame = requestAnimationFrame(draw)

      // The graph is built here rather than in the effect body: on the first
      // frame after a play, which is inside the gesture's aftermath and after
      // the element has a source. Before anything plays there is nothing to
      // analyse and no reason to have permanently rerouted the element.
      const graph = audio && playingRef.current ? tap(audio) : null

      if (graph && playingRef.current) {
        // A context can be suspended out from under a page — a call, a lock
        // screen, a backgrounded tab. Asking costs nothing and often works.
        if (graph.context.state === 'suspended') void graph.context.resume().catch(() => undefined)
        graph.analyser.getByteFrequencyData(graph.bins)
        const { low, mid, high } = bands(graph.bins)
        level = ease(level, low * 0.7 + mid * 0.5)
        deform = ease(deform, mid)
        wobble = ease(wobble, high)
      } else {
        // At rest, or on a browser with no Web Audio. Everything relaxes toward
        // nothing and the CSS takes over with its own slow breath; see
        // `.blob[data-live='false']` in podcast.css.
        level = ease(level, 0)
        deform = ease(deform, 0)
        wobble = ease(wobble, 0)
      }

      element.style.setProperty('--level', level.toFixed(3))
      element.style.setProperty('--deform', deform.toFixed(3))
      element.style.setProperty('--wobble', wobble.toFixed(3))
    }

    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [audio])

  return (
    <div
      className={`blob ${className}`}
      ref={root}
      data-live={playing ? 'true' : 'false'}
      // Decoration. It says nothing a listener cannot hear, and announcing a
      // shape that changes sixty times a second would be actively hostile.
      aria-hidden="true"
      style={{ '--level': 0, '--deform': 0, '--wobble': 0 } as CSSProperties}
    >
      <span className="blob__layer blob__layer--back" />
      <span className="blob__layer blob__layer--mid" />
      <span className="blob__layer blob__layer--front" />
    </div>
  )
}
