import {
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  type Episode,
  episodePosterUrl,
  formatDate,
  formatPosition,
  paragraphs,
  subtitleFor,
} from '../lib/episodes.js'
import { Blob } from './Blob.js'

/**
 * One episode, and the controls to listen to it.
 *
 * Modelled on Apple Music's transport, which is worth being precise about
 * because "like Apple Music" covers several different things and only some of
 * them are right for an hour of talk:
 *
 *  - **A scrubber with the elapsed time on the left and the time remaining on
 *    the right**, the remaining one negative. That is Apple's, and it is the
 *    better of the two conventions for a podcast: "how much of this is left" is
 *    the question somebody deciding whether to start it actually has.
 *  - **A three-part transport**, big play in the middle. The outer two are
 *    *skips*, not track changes: there is no next episode to go to from here,
 *    and 15 back / 30 forward is the podcast convention rather than the music
 *    one, because the reasons are "I missed that" and "get past the ad". How
 *    far each one goes is in its label and its tooltip rather than drawn inside
 *    the arrow: at the size these are actually rendered a two-digit number is a
 *    smudge, and the arrows already say which way they go.
 *
 * Two things are deliberately absent, and both were here and were removed. A
 * **speed control**, which most podcast players have: it is a preference, and
 * this is a page for listening to one conversation rather than a client for
 * getting through a backlog. A **volume slider**, because every device this
 * runs on already has one that works — and on iOS `audio.volume` is read-only,
 * so the slider was inert on exactly the devices where it took up the most
 * room. The queue is absent for a third reason: an archive is browsed rather
 * than played through, and autoplaying the next episode of a conversation
 * because somebody let one finish is presumptuous.
 *
 * Everything about position lives in this component's own state and in the
 * element, and nothing is broadcast anywhere. This is the opposite of the
 * station, where a listener may not seek because seeking is how you stop being
 * in the same second as everybody else. Nobody else is here.
 *
 * The page is one viewport and does not scroll. On a desk the artwork is the
 * left column and everything you read or press is the right one; on a phone
 * the same three regions stack. The show notes are the only thing that moves,
 * which is what keeps the transport on screen while they are being read. See
 * `.player` in podcast.css.
 */

/** How far the back button goes. The podcast convention: "I missed that." */
const SKIP_BACK_S = 15
/** And forward. Longer, because the reason is "get past this bit". */
const SKIP_FORWARD_S = 30

/**
 * Where the position is remembered between visits, keyed by episode.
 *
 * An hour is more than one sitting, and coming back to an episode at zero is
 * the single most annoying thing a podcast player can do. `localStorage` rather
 * than anything on the server: it is this browser's business where this person
 * got to, there is no account to hang it on, and the archive is public — a
 * server-side position would mean the station knowing what strangers listen to,
 * which it has no reason to want.
 */
const POSITION_KEY = (slug: string) => `chunky.fm/podcast/at/${slug}`

/**
 * How near the end still counts as finished.
 *
 * Somebody who reached the last few seconds has heard it, and restoring them to
 * 59:57 so they can listen to three seconds of outro is not resuming, it is a
 * bug with good intentions.
 */
const FINISHED_TAIL_S = 15

function rememberPosition(slug: string, seconds: number, duration: number): void {
  try {
    if (!Number.isFinite(duration) || duration <= 0) return
    if (seconds < 5 || seconds > duration - FINISHED_TAIL_S) {
      window.localStorage.removeItem(POSITION_KEY(slug))
      return
    }
    window.localStorage.setItem(POSITION_KEY(slug), String(Math.floor(seconds)))
  } catch {
    // Private mode, or storage turned off. Resuming is a convenience.
  }
}

function rememberedPosition(slug: string): number {
  try {
    const stored = Number(window.localStorage.getItem(POSITION_KEY(slug)))
    return Number.isFinite(stored) && stored > 0 ? stored : 0
  } catch {
    return 0
  }
}

export interface PlayerProps {
  episode: Episode
  /** Where the back link goes. The archive, always; there is nowhere else. */
  onBack: () => void
}

export function Player({ episode, onBack }: PlayerProps) {
  const audio = useRef<HTMLAudioElement>(null)
  // Held in state as well as on the element, because the element is not a React
  // value: nothing re-renders when it starts playing, and every number on this
  // page is a function of that.
  const [element, setElement] = useState<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(episode.durationMs / 1000)
  const [scrubbing, setScrubbing] = useState(false)
  const [failed, setFailed] = useState(false)

  const poster = episodePosterUrl(episode)
  const subtitle = subtitleFor(episode)
  const notes = useMemo(() => paragraphs(episode.notes), [episode.notes])

  // The element only exists after the first render, and the blob needs it.
  useEffect(() => setElement(audio.current), [])

  /**
   * Pick up where this browser left off.
   *
   * On `loadedmetadata` rather than on mount, because seeking an element that
   * does not yet know its own duration is either ignored or clamped to zero
   * depending on the browser. Keyed on the slug so that moving between episodes
   * in one session restores each one to its own place.
   */
  useEffect(() => {
    const media = audio.current
    if (!media) return
    setFailed(false)
    const resume = () => {
      setDuration(Number.isFinite(media.duration) ? media.duration : episode.durationMs / 1000)
      const at = rememberedPosition(episode.slug)
      if (at > 0) {
        media.currentTime = at
        setPosition(at)
      }
    }
    media.addEventListener('loadedmetadata', resume)
    return () => media.removeEventListener('loadedmetadata', resume)
  }, [episode.slug, episode.durationMs])

  /** Write the position down as it moves, but not while a finger is on it. */
  useEffect(() => {
    const media = audio.current
    if (!media) return

    const tick = () => {
      if (scrubbing) return
      setPosition(media.currentTime)
      rememberPosition(episode.slug, media.currentTime, media.duration)
    }
    const start = () => setPlaying(true)
    const stop = () => setPlaying(false)
    const ended = () => {
      setPlaying(false)
      rememberPosition(episode.slug, 0, media.duration)
    }
    const broke = () => {
      setPlaying(false)
      setFailed(true)
    }

    media.addEventListener('timeupdate', tick)
    media.addEventListener('play', start)
    media.addEventListener('pause', stop)
    media.addEventListener('ended', ended)
    media.addEventListener('error', broke)
    return () => {
      media.removeEventListener('timeupdate', tick)
      media.removeEventListener('play', start)
      media.removeEventListener('pause', stop)
      media.removeEventListener('ended', ended)
      media.removeEventListener('error', broke)
    }
  }, [episode.slug, scrubbing])

  const toggle = useCallback(() => {
    const media = audio.current
    if (!media) return
    if (media.paused) {
      // Refused where a gesture is required, which is the ordinary case on a
      // page nobody has touched yet; the button click *is* the gesture, so this
      // only fails for genuinely unplayable media, which `error` already covers.
      void media.play().catch(() => setFailed(true))
    } else {
      media.pause()
    }
  }, [])

  const skip = useCallback(
    (by: number) => {
      const media = audio.current
      if (!media) return
      const to = Math.min(Math.max(0, media.currentTime + by), duration)
      media.currentTime = to
      setPosition(to)
    },
    [duration],
  )

  const seek = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const media = audio.current
    const to = Number(event.target.value)
    setPosition(to)
    if (media) media.currentTime = to
  }, [])

  /**
   * Keyboard, the way every player does it.
   *
   * Bound to the document rather than to the player, because the thing somebody
   * wants after pressing play is to read the notes — at which point focus is
   * inside the notes' scroller and nowhere near a button. Space is deliberately
   * *not* bound globally: it is the scroll key, and stealing it from somebody
   * reading an hour of show notes is a worse trade than making them reach for
   * the button. The play button itself takes space, being a button.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      // Never while somebody is typing, which on this page is the console's
      // fields and the browser's own find bar.
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return

      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        skip(-SKIP_BACK_S)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        skip(SKIP_FORWARD_S)
      } else if (event.key === 'k') {
        event.preventDefault()
        toggle()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [skip, toggle])

  const remaining = Math.max(0, duration - position)
  // The filled part of the scrubber, as a percentage, so the track can be
  // painted with a gradient rather than an extra element inside the input.
  const progress = duration > 0 ? (position / duration) * 100 : 0

  return (
    /*
      Three regions, laid out by named grid areas so one DOM order serves both
      shapes: on a desk the artwork is the left column and everything you read
      or press is the right one; on a phone the same three stack. The page
      itself never scrolls — the notes are the only thing that does, which is
      what keeps the transport on screen while somebody reads them.
    */
    <article className="player">
      <div className="player__bar">
        <button type="button" className="player__back" onClick={onBack}>
          <span aria-hidden="true">&larr;</span> All episodes
        </button>
      </div>

      <div className="player__left">
        <div className="player__stage">
          {/* The blob sits behind the artwork and swells past its edges. See
              Blob.tsx: it is driven by the actual audio rather than by a
              keyframe loop. */}
          <Blob audio={element} playing={playing} className="player__blob" />
          {poster ? (
            <img
              className="player__art"
              src={poster}
              alt={episode.title}
              width={1080}
              height={1350}
              // The one image on this page and the reason somebody is here.
              loading="eager"
              decoding="async"
            />
          ) : (
            <div className="player__art player__art--none" aria-hidden="true" />
          )}
        </div>
      </div>

      <div className="player__right">
        <header className="player__heading">
          <h1 className="player__title">{episode.title}</h1>
          {subtitle && <p className="player__subtitle">{subtitle}</p>}
          <p className="player__date">{formatDate(episode.publishedAt)}</p>
        </header>

        {failed && (
          <p className="player__failed" role="alert">
            This episode would not play. The file may still be uploading, or your connection
            dropped &mdash; reloading the page is usually enough.
          </p>
        )}

        {/* Never scrolls away. The notes below are the only thing on this page
            that moves, so the transport is always where it was. */}
        <div className="player__controls">
          <div className="player__scrub">
            <input
              className="player__range"
              type="range"
              min={0}
              max={duration || 1}
              step={0.5}
              value={position}
              onChange={seek}
              // Committed on release rather than continuously, so dragging
              // across a long episode does not fire a request per pixel.
              onPointerDown={() => setScrubbing(true)}
              onPointerUp={(event: ReactPointerEvent<HTMLInputElement>) => {
                setScrubbing(false)
                const media = audio.current
                if (media) media.currentTime = Number((event.target as HTMLInputElement).value)
              }}
              onKeyUp={() => setScrubbing(false)}
              onKeyDown={() => setScrubbing(true)}
              style={{ '--progress': `${progress}%` } as React.CSSProperties}
              aria-label="Position"
              aria-valuetext={formatPosition(position)}
            />
            <div className="player__clock">
              <span className="player__elapsed">{formatPosition(position)}</span>
              {/* Negative, the way Apple writes it: what is left is the question. */}
              <span className="player__remaining">-{formatPosition(remaining)}</span>
            </div>
          </div>

          <div className="player__transport">
            <button
              type="button"
              className="player__skip"
              onClick={() => skip(-SKIP_BACK_S)}
              aria-label={`Back ${SKIP_BACK_S} seconds`}
              title={`Back ${SKIP_BACK_S} seconds`}
            >
              <SkipIcon direction="back" />
            </button>

            <button
              type="button"
              className="player__play"
              onClick={toggle}
              aria-label={playing ? 'Pause' : 'Play'}
              data-playing={playing ? 'true' : 'false'}
            >
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>

            <button
              type="button"
              className="player__skip"
              onClick={() => skip(SKIP_FORWARD_S)}
              aria-label={`Forward ${SKIP_FORWARD_S} seconds`}
              title={`Forward ${SKIP_FORWARD_S} seconds`}
            >
              <SkipIcon direction="forward" />
            </button>
          </div>
        </div>

        {/* The one scrolling region on the page. `min-height: 0` on it is what
            makes that work inside a grid; see podcast.css. */}
        {notes.length > 0 && (
          <section className="player__notes">
            <h2 className="player__notes-heading">Show notes</h2>
            {notes.map((block, index) => (
              // Index as key: these are paragraphs of one immutable block of
              // text, they have no identity of their own, and nothing reorders.
              // biome-ignore lint/suspicious/noArrayIndexKey: paragraphs have no id
              <p key={index}>{block}</p>
            ))}
          </section>
        )}
      </div>

      {/* No `controls`: the transport above is the transport. `preload`
          metadata rather than auto, because an hour of audio downloaded by
          somebody who was only reading the notes is rude on a phone. */}
      <audio ref={audio} src={episode.audioUrl} preload="metadata" />
    </article>
  )
}

/* --- the icons -------------------------------------------------------------
 *
 * Phosphor (<https://phosphoricons.com>), fill weight, vendored inline from
 * `phosphor-icons/core` — `assets/fill/{play,pause,skip-back,skip-forward}-fill.svg`.
 * The paths are upstream's, untouched, on Phosphor's own 256x256 grid.
 *
 * The rest of this project uses Phosphor too, but through `src/assets/icons/`
 * as Figma exports loaded with `<img src=…>`. That cannot work here, and the
 * reason is colour: those files carry a hardcoded `#171717` or `white`, because
 * an `<img>` has no access to the colour of the thing it sits in. These three
 * are inside buttons that change colour on hover and invert entirely on the
 * play button, so they are inline SVG and keep upstream's `fill="currentColor"`.
 *
 * Fill rather than regular for all three, so the transport reads as one set:
 * the play button is a solid glyph on a white disc, and a stroked skip arrow
 * beside it would look like a different family of control.
 */

function PlayIcon() {
  return (
    <svg viewBox="0 0 256 256" width="30" height="30" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M240,128a15.74,15.74,0,0,1-7.6,13.51L88.32,229.65a16,16,0,0,1-16.2.3A15.86,15.86,0,0,1,64,216.13V39.87a15.86,15.86,0,0,1,8.12-13.82,16,16,0,0,1,16.2.3L232.4,114.49A15.74,15.74,0,0,1,240,128Z" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 256 256" width="30" height="30" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M216,48V208a16,16,0,0,1-16,16H160a16,16,0,0,1-16-16V48a16,16,0,0,1,16-16h40A16,16,0,0,1,216,48ZM96,32H56A16,16,0,0,0,40,48V208a16,16,0,0,0,16,16H96a16,16,0,0,0,16-16V48A16,16,0,0,0,96,32Z" />
    </svg>
  )
}

/**
 * Phosphor's `skip-back-fill` and `skip-forward-fill`, one component.
 *
 * Worth being straight about what these say. They are the *track* skip glyph —
 * a triangle against a bar — and these buttons do not change track; they jump
 * fifteen seconds back and thirty forward. There is no next episode to reach
 * from here, so nothing is actually reachable by pressing one that the icon
 * would be lying about, and the label and the tooltip both say the duration.
 * The honest alternative is Phosphor's `arrow-counter-clockwise`, which is what
 * a seconds-jump usually wears. This is the set that was asked for.
 */
function SkipIcon({ direction }: { direction: 'back' | 'forward' }) {
  return (
    <svg viewBox="0 0 256 256" width="24" height="24" fill="currentColor" aria-hidden="true" focusable="false">
      {direction === 'back' ? (
        <path d="M208,47.88V208.12a16,16,0,0,1-24.43,13.43L64,146.77V216a8,8,0,0,1-16,0V40a8,8,0,0,1,16,0v69.23L183.57,34.45A15.95,15.95,0,0,1,208,47.88Z" />
      ) : (
        <path d="M208,40V216a8,8,0,0,1-16,0V146.77L72.43,221.55A15.95,15.95,0,0,1,48,208.12V47.88A15.95,15.95,0,0,1,72.43,34.45L192,109.23V40a8,8,0,0,1,16,0Z" />
      )}
    </svg>
  )
}
