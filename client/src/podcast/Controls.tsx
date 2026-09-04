import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from 'react'

/**
 * The transport, drawn the way YouTube draws one.
 *
 * The browser's own controls were here for a while and they are the honest
 * default — every viewer knows them and they cost nothing to keep working. What
 * they are not is *the same on two machines*: Chrome, Safari and Firefox each
 * draw a different bar, at a different height, with a different idea of where
 * the time goes, and on a page this deliberate about its own surfaces the one
 * element carrying the actual content looked like it had been dropped in from
 * somewhere else. So this is a control bar of our own, and the thing it is
 * modelled on is the one people have already learned.
 *
 * What "like YouTube's" means here, precisely, because it is a handful of
 * decisions rather than a look:
 *
 *  - **A hairline that thickens under the pointer.** The bar is 3px of grey
 *    with red behind the playhead and a lighter grey showing what has buffered.
 *    Point at it and the whole thing grows to 5px and a red knob appears. That
 *    growth is the whole reason the resting state can be as thin as it is: a
 *    3px target would be unusable if it stayed 3px, and it does not.
 *  - **Two clusters and nothing in the middle.** Play, volume and the clock on
 *    the left; speed and fullscreen on the right. The middle of the bar is
 *    empty because the middle of the bar is *the picture*.
 *  - **The volume slider is not there until you want it.** A button that
 *    expands sideways into a slider on hover, which is how a control that
 *    matters twice a session earns its place beside one that matters every few
 *    seconds.
 *  - **It goes away — under a pointer, or in fullscreen.** Three seconds after
 *    the last movement, while playing, the bar and the scrim fade out; any
 *    movement brings them back, and a paused video keeps them.
 *
 *    **On a phone, inline, it does not.** A mouse brings the bar back for free
 *    by moving, and a thumb cannot: a faded bar takes `pointer-events` with it,
 *    so the first tap wakes it and only the second one presses the thing that
 *    was tapped. Every action costing two taps is what "the buttons are hard to
 *    press" turns out to mean, and it is not a size problem — the targets are
 *    44px. Fading exists because a bar over a face for an hour is in the way,
 *    and inline on a phone the video is a third of the screen with a title
 *    under it: there is no face for it to be in the way of. In fullscreen there
 *    is, so there it fades on touch as well, and a tap wakes it.
 *  - **The keys are YouTube's.** Space and `k` play, `j`/`l` and the arrows
 *    seek, `m` mutes, `f` is fullscreen, `0`–`9` jump to a tenth. Bound to the
 *    page rather than to the element, because the thing somebody wants after
 *    pressing play is the transcript, and by then focus is over there.
 *
 * What is deliberately *not* YouTube's: there is no next video, no autoplay
 * toggle, no miniplayer, no captions button (the transcript beside it is the
 * captions, and it is better), and no quality menu, because an episode is one
 * file — see `lib/publish.ts`, which does not make renditions and says why.
 */

/** How long the bar stays up after the last movement, while playing. */
const IDLE_MS = 3000

/** What the speed menu offers. YouTube's list, minus the ones nobody picks. */
const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const

/** `0:04`, `12:31`, `1:02:09` — as long as it needs to be and no longer. */
function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const whole = Math.floor(seconds)
  const s = whole % 60
  const m = Math.floor(whole / 60) % 60
  const h = Math.floor(whole / 3600)
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

export interface ControlsProps {
  /** The element being driven. Null until the first render has put it there. */
  media: HTMLVideoElement | null
  /**
   * What goes fullscreen.
   *
   * The frame around the video rather than the video itself, which is what
   * keeps this bar on screen in fullscreen: an element put fullscreen takes its
   * descendants with it, and a `<video>` put fullscreen takes only itself and
   * draws the *browser's* controls over it. See `enterFullscreen`.
   */
  stage: HTMLElement | null
}

export function Controls({ media, stage }: ControlsProps) {
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [rate, setRate] = useState(1)
  const [full, setFull] = useState(false)
  const [shown, setShown] = useState(true)
  /**
   * Whether the thing pointing at this is a thumb.
   *
   * Watched rather than read once, because it genuinely changes under a page:
   * a tablet with a keyboard folded back, a laptop whose screen is a touch
   * screen, a phone with a mouse paired to it.
   */
  const [coarse, setCoarse] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  /** Where the pointer is along the scrubber, as seconds, for the tooltip. */
  const [hover, setHover] = useState<number | null>(null)
  const scrubbing = useRef(false)
  const idle = useRef(0)

  /* --- what the element is doing ------------------------------------------ */

  useEffect(() => {
    if (!media) return

    const sync = () => {
      setPlaying(!media.paused && !media.ended)
      setVolume(media.volume)
      setMuted(media.muted)
      setRate(media.playbackRate)
    }
    const time = () => {
      // Not while a finger is on the scrubber: the element is being *told*
      // where to be, and letting its own reports back in makes the knob stutter
      // between where it was dragged to and where the decoder has got to.
      if (!scrubbing.current) setPosition(media.currentTime)
    }
    const measure = () => setDuration(Number.isFinite(media.duration) ? media.duration : 0)
    const ahead = () => {
      const ranges = media.buffered
      // The range the playhead is actually inside. A file seeked around in has
      // several, and the one that matters is the one being watched.
      for (let i = 0; i < ranges.length; i++) {
        if (ranges.start(i) <= media.currentTime && media.currentTime <= ranges.end(i)) {
          setBuffered(ranges.end(i))
          return
        }
      }
      setBuffered(0)
    }

    sync()
    measure()
    for (const event of ['play', 'pause', 'ended', 'volumechange', 'ratechange'] as const) {
      media.addEventListener(event, sync)
    }
    media.addEventListener('timeupdate', time)
    media.addEventListener('timeupdate', ahead)
    media.addEventListener('progress', ahead)
    media.addEventListener('loadedmetadata', measure)
    media.addEventListener('durationchange', measure)

    return () => {
      for (const event of ['play', 'pause', 'ended', 'volumechange', 'ratechange'] as const) {
        media.removeEventListener(event, sync)
      }
      media.removeEventListener('timeupdate', time)
      media.removeEventListener('timeupdate', ahead)
      media.removeEventListener('progress', ahead)
      media.removeEventListener('loadedmetadata', measure)
      media.removeEventListener('durationchange', measure)
    }
  }, [media])

  useEffect(() => {
    const query = window.matchMedia('(pointer: coarse)')
    const read = () => setCoarse(query.matches)
    read()
    query.addEventListener('change', read)
    return () => query.removeEventListener('change', read)
  }, [])

  /* --- fullscreen ---------------------------------------------------------- */

  useEffect(() => {
    const answer = () => setFull(document.fullscreenElement === stage)
    document.addEventListener('fullscreenchange', answer)
    return () => document.removeEventListener('fullscreenchange', answer)
  }, [stage])

  const toggleFull = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
      return
    }
    if (stage?.requestFullscreen) {
      void stage.requestFullscreen().catch(() => undefined)
      return
    }
    /*
     * iPhone, where element fullscreen does not exist.
     *
     * Safari on iOS will only put a *video* fullscreen, and it draws its own
     * controls when it does — so on that one platform the fullscreen button
     * hands over to the system player, which is what every site including
     * YouTube ends up doing there. Everything else on the page is unchanged;
     * this is a button that stops being ours for as long as it is held.
     */
    const legacy = media as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null
    legacy?.webkitEnterFullscreen?.()
  }, [media, stage])

  /* --- showing and hiding --------------------------------------------------- */

  /** A thumb inline keeps the bar; see the note at the top. */
  const stays = coarse && !full

  const wake = useCallback(() => {
    setShown(true)
    window.clearTimeout(idle.current)
    if (stays) return
    // Paused, being scrubbed, or with the speed menu open: the bar stays. The
    // first because a paused video is one somebody is deciding about, and the
    // other two because it is being used right now.
    idle.current = window.setTimeout(() => {
      if (media && !media.paused && !scrubbing.current && !menuOpen) setShown(false)
    }, IDLE_MS)
  }, [media, menuOpen, stays])

  useEffect(() => {
    if (!playing || stays) setShown(true)
    else wake()
    return () => window.clearTimeout(idle.current)
  }, [playing, stays, wake])

  /* --- the things the buttons do -------------------------------------------- */

  const toggle = useCallback(() => {
    if (!media) return
    if (media.paused) void media.play().catch(() => undefined)
    else media.pause()
  }, [media])

  const seekBy = useCallback(
    (by: number) => {
      if (!media) return
      const to = Math.min(Math.max(0, media.currentTime + by), media.duration || 0)
      media.currentTime = to
      setPosition(to)
      wake()
    },
    [media, wake],
  )

  const seekTo = useCallback(
    (seconds: number) => {
      if (!media) return
      media.currentTime = seconds
      setPosition(seconds)
    },
    [media],
  )

  /* --- the scrubber --------------------------------------------------------- */

  const track = useRef<HTMLDivElement>(null)

  /** Where along the bar a pointer is, as a fraction, clamped to its ends. */
  const fractionAt = useCallback((clientX: number): number => {
    const box = track.current?.getBoundingClientRect()
    if (!box || box.width === 0) return 0
    return Math.min(1, Math.max(0, (clientX - box.left) / box.width))
  }, [])

  const onScrubDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!media || !duration) return
      scrubbing.current = true
      // Captured, so a drag that leaves the bar — which every drag does, because
      // the bar is 5px tall — keeps being this bar's drag rather than becoming
      // a text selection halfway down the page.
      event.currentTarget.setPointerCapture(event.pointerId)
      const to = fractionAt(event.clientX) * duration
      setPosition(to)
      seekTo(to)
    },
    [duration, fractionAt, media, seekTo],
  )

  const onScrubMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!duration) return
      const at = fractionAt(event.clientX) * duration
      setHover(at)
      if (!scrubbing.current) return
      // Live rather than on release, which is YouTube's: the frame under the
      // knob is the whole point of dragging one.
      setPosition(at)
      seekTo(at)
    },
    [duration, fractionAt, seekTo],
  )

  const onScrubUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    scrubbing.current = false
    event.currentTarget.releasePointerCapture(event.pointerId)
  }, [])

  /* --- volume ---------------------------------------------------------------- */

  const setLevel = useCallback(
    (level: number) => {
      if (!media) return
      const next = Math.min(1, Math.max(0, level))
      media.volume = next
      // Moving the slider off zero unmutes, which is what somebody moving it
      // means; dragging it *to* zero is a mute rather than a silent stereo.
      media.muted = next === 0
    },
    [media],
  )

  const volumeTrack = useRef<HTMLDivElement>(null)
  const volumeDragging = useRef(false)

  const levelAt = useCallback((clientX: number): number => {
    const box = volumeTrack.current?.getBoundingClientRect()
    if (!box || box.width === 0) return 0
    return Math.min(1, Math.max(0, (clientX - box.left) / box.width))
  }, [])

  /* --- the keyboard ---------------------------------------------------------- */

  useEffect(() => {
    if (!media) return
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      // Never while somebody is typing, and never over a control that has its
      // own idea about the key — a button and space, most of all.
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (target?.isContentEditable) return
      if (event.metaKey || event.ctrlKey || event.altKey) return

      const keys: Record<string, () => void> = {
        ' ': toggle,
        k: toggle,
        j: () => seekBy(-10),
        l: () => seekBy(10),
        ArrowLeft: () => seekBy(-5),
        ArrowRight: () => seekBy(5),
        ArrowUp: () => setLevel(media.volume + 0.1),
        ArrowDown: () => setLevel(media.volume - 0.1),
        m: () => {
          media.muted = !media.muted
        },
        f: toggleFull,
      }

      // A digit is a tenth of the way in, which is the one YouTube shortcut
      // people are surprised to find they know.
      if (/^[0-9]$/.test(event.key) && media.duration) {
        event.preventDefault()
        seekTo((Number(event.key) / 10) * media.duration)
        wake()
        return
      }

      const act = keys[event.key]
      if (!act) return
      event.preventDefault()
      act()
      wake()
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [media, seekBy, seekTo, setLevel, toggle, toggleFull, wake])

  /* --- and the bar itself ---------------------------------------------------- */

  const played = duration > 0 ? (position / duration) * 100 : 0
  const loaded = duration > 0 ? (buffered / duration) * 100 : 0
  const level = muted ? 0 : volume

  return (
    <div
      className="tape"
      data-shown={shown || !playing ? 'true' : 'false'}
      data-full={full ? 'true' : 'false'}
      onPointerMove={wake}
      // A tap is not a move: without this, touching a control in fullscreen —
      // where the bar does fade — would press it and then let the timer that
      // was already running hide the bar a moment later, mid-gesture.
      onPointerDown={wake}
      onPointerLeave={() => {
        // A mouse leaving means the pointer is elsewhere. A *touch* pointer
        // "leaves" at the end of every tap, which would hide the bar the
        // instant somebody pressed play.
        if (stays) return
        if (playing && !scrubbing.current && !menuOpen) setShown(false)
      }}
    >
      {/* The picture itself is the play button, which is how every video player
          on the web behaves and the one gesture nobody has to be taught. A
          double click is fullscreen, also YouTube's. */}
      <button
        type="button"
        className="tape__surface"
        onClick={() => {
          /*
           * A tap that only brings the bar back, when the bar is away.
           *
           * Reached on a phone in fullscreen, which is the one place a thumb
           * meets a faded bar now: there is no pointer to hover with, and if
           * the tap that brings it back also paused the episode, reaching the
           * scrubber would mean stopping what you are watching first.
           */
          if (!shown && coarse) {
            wake()
            return
          }
          toggle()
        }}
        onDoubleClick={toggleFull}
        aria-label={playing ? 'Pause' : 'Play'}
        tabIndex={-1}
      />

      {/* Big, centred, and only while paused: the affordance for somebody who
          has just arrived and is looking at a still frame. */}
      {!playing && (
        <button type="button" className="tape__start" onClick={toggle} aria-label="Play">
          <PlayGlyph />
        </button>
      )}

      <div className="tape__bar">
        {/* biome-ignore lint/a11y/useSemanticElements: a range input cannot carry
            the buffered range, the hover preview or the growing track; the
            slider role and the arrow keys above are what make it reachable. */}
        <div
          className="tape__track"
          ref={track}
          role="slider"
          tabIndex={0}
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(position)}
          aria-valuetext={clock(position)}
          onPointerDown={onScrubDown}
          onPointerMove={onScrubMove}
          onPointerUp={onScrubUp}
          onPointerLeave={() => setHover(null)}
        >
          <div className="tape__rail">
            <div className="tape__loaded" style={{ width: `${loaded}%` }} />
            <div className="tape__played" style={{ width: `${played}%` }}>
              <span className="tape__knob" />
            </div>
          </div>
          {hover !== null && (
            <span
              className="tape__preview"
              style={{ left: `${duration > 0 ? (hover / duration) * 100 : 0}%` }}
            >
              {clock(hover)}
            </span>
          )}
        </div>

        <div className="tape__row">
          <button
            type="button"
            className="tape__button"
            onClick={toggle}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? <PauseGlyph /> : <PlayGlyph />}
          </button>

          <div className="tape__volume">
            <button
              type="button"
              className="tape__button"
              onClick={() => media && (media.muted = !media.muted)}
              aria-label={muted || volume === 0 ? 'Unmute' : 'Mute'}
            >
              <SpeakerGlyph level={level} />
            </button>
            {/* biome-ignore lint/a11y/useSemanticElements: see the seek bar. */}
            <div
              className="tape__level"
              ref={volumeTrack}
              role="slider"
              tabIndex={0}
              aria-label="Volume"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(level * 100)}
              onPointerDown={(event) => {
                volumeDragging.current = true
                event.currentTarget.setPointerCapture(event.pointerId)
                setLevel(levelAt(event.clientX))
              }}
              onPointerMove={(event) => {
                if (volumeDragging.current) setLevel(levelAt(event.clientX))
              }}
              onPointerUp={(event) => {
                volumeDragging.current = false
                event.currentTarget.releasePointerCapture(event.pointerId)
              }}
            >
              <div className="tape__level-rail">
                <div className="tape__level-fill" style={{ width: `${level * 100}%` }}>
                  <span className="tape__knob" />
                </div>
              </div>
            </div>
          </div>

          {/* Elapsed and total, with the separator between them, which is the
              shape YouTube uses and the opposite of the countdown a podcast
              player wants. Tabular figures, so a digit rolling over does not
              shove the rest of the bar sideways. */}
          <span className="tape__clock">
            {clock(position)} <span className="tape__of">/</span> {clock(duration)}
          </span>

          <span className="tape__gap" />

          <div className="tape__menu-holder">
            {menuOpen && (
              <div className="tape__menu" role="menu">
                {RATES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="menuitemradio"
                    aria-checked={rate === option}
                    className="tape__rate"
                    data-on={rate === option ? 'true' : 'false'}
                    onClick={() => {
                      if (media) media.playbackRate = option
                      setMenuOpen(false)
                    }}
                  >
                    {option === 1 ? 'Normal' : `${option}×`}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              className="tape__button"
              onClick={() => setMenuOpen((was) => !was)}
              aria-label="Playback speed"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              data-on={rate !== 1 ? 'true' : 'false'}
            >
              <GearGlyph />
            </button>
          </div>

          <button
            type="button"
            className="tape__button"
            onClick={toggleFull}
            aria-label={full ? 'Exit full screen' : 'Full screen'}
          >
            {full ? <ExitFullGlyph /> : <FullGlyph />}
          </button>
        </div>
      </div>
    </div>
  )
}

/* --- the glyphs -------------------------------------------------------------
 *
 * Drawn here rather than vendored, because these are YouTube's shapes rather
 * than any icon set's: the play triangle that fills its box, the two square
 * bars, the speaker whose waves come and go with the level, the gear, and the
 * four corners that mean fullscreen everywhere. All on a 24 grid, all
 * `currentColor`, all with the same optical weight so the row reads as one set.
 */

function PlayGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M8 5.14v13.72L19 12 8 5.14z" fill="currentColor" />
    </svg>
  )
}

function PauseGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6 5h4v14H6zM14 5h4v14h-4z" fill="currentColor" />
    </svg>
  )
}

/** Waves that appear as the level rises, and a cross when there is none. */
function SpeakerGlyph({ level }: { level: number }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
      {level === 0 ? (
        <path
          d="M16.5 9.5l5 5m0-5l-5 5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          fill="none"
        />
      ) : (
        <>
          <path
            d="M16 9.2a4 4 0 010 5.6"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            fill="none"
          />
          {level > 0.5 && (
            <path
              d="M18.6 6.6a7.6 7.6 0 010 10.8"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              fill="none"
            />
          )}
        </>
      )}
    </svg>
  )
}

function GearGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M12 15.2a3.2 3.2 0 100-6.4 3.2 3.2 0 000 6.4z"
        stroke="currentColor"
        strokeWidth="1.8"
        fill="none"
      />
      <path
        d="M19.4 13.6a7.6 7.6 0 000-3.2l1.7-1.3-1.8-3.1-2 .8a7.7 7.7 0 00-2.8-1.6L14.2 3H9.8l-.3 2.2a7.7 7.7 0 00-2.8 1.6l-2-.8L2.9 9.1l1.7 1.3a7.6 7.6 0 000 3.2l-1.7 1.3 1.8 3.1 2-.8a7.7 7.7 0 002.8 1.6l.3 2.2h4.4l.3-2.2a7.7 7.7 0 002.8-1.6l2 .8 1.8-3.1-1.7-1.3z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}

function FullGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}

function ExitFullGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}
