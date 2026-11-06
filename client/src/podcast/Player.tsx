import { useCallback, useEffect, useRef, useState } from 'react'
import { type Episode, episodeThumbnailUrl, formatDate, subtitleFor } from '../lib/episodes.js'
import { BackChevron } from './Chevron.js'
import { Controls } from './Controls.js'
import { Transcript } from './Transcript.js'

/**
 * One episode, playing.
 *
 * The page is the video. That is the whole of the design now, and it is worth
 * saying what it replaced, because most of this file used to be the other
 * thing: an Apple Music transport built out of a scrubber, a play button, two
 * skips and a countdown, with the show notes beside it and a keyboard map over
 * the document. All of it was right for an archive of audio, where a page with
 * no controls is a page with nothing on it at all.
 *
 * A video does not need a page built around it. The browser already draws a
 * transport for one — the one every viewer knows, with volume and speed and
 * fullscreen on every platform — so this hands it the element and gets out of
 * the way.
 *
 * What is left on the page beside it is deliberate rather than leftover: a way
 * back to the archive, the episode's name, and the transcript. The show notes
 * are gone with the transport — an introduction to a conversation is something
 * you read on the card before deciding to watch it, not something to keep
 * beside a video that is already playing.
 *
 * **`playsInline` is the one attribute doing real work.** Without it iOS takes
 * any play into its own fullscreen player, turning the phone landscape and
 * throwing away the page around it, which is exactly what this page does not
 * want: fullscreen stays something a viewer chooses from the browser's own
 * controls, on either platform, rather than something that happens to them the
 * moment they press play.
 *
 * The position is still tracked, and there are still two readers for it even
 * with nothing of ours drawing a clock: the transcript follows the playhead,
 * and `localStorage` remembers where somebody got to, because an hour is more
 * than one sitting. Nothing is broadcast anywhere. This is the opposite of the
 * station, where a listener may not seek because seeking is how you stop being
 * in the same second as everybody else. Nobody else is here.
 *
 * The page is one viewport and does not scroll, and it is laid out the way the
 * station's listening view is: **the thing on the left, the words on the
 * right**. There, that is the deck and the lyric sheet beside it; here it is
 * the video and the transcript. The same shape for the same reason — what is
 * being played and what is being said are two different things to look at, and
 * neither should be underneath the other. An episode with no transcript has no
 * second column at all, and the video takes the middle of the page.
 *
 * On a phone the two stack, and there is not room for both: the transcript is
 * behind a button, and pressing it shrinks the video to a header strip so the
 * words get the screen. Again the station's own answer — its sheet falls under
 * the deck and is capped there rather than being a second page. See `.player`
 * in podcast.css, and `Transcript.tsx`.
 */

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
  const video = useRef<HTMLVideoElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  /*
   * The two nodes the bar needs, held in state as well as in refs.
   *
   * A ref does not re-render anything, and `Controls` has to *see* both to do
   * its job — the element to attach listeners to, the frame to put fullscreen.
   * Handed nulls on the first render it would sit there with neither, on nodes
   * that arrived a tick later. So the refs drive the DOM and these tell React
   * about them, once, on mount.
   */
  const [element, setElement] = useState<HTMLVideoElement | null>(null)
  const [frame, setFrame] = useState<HTMLDivElement | null>(null)
  // Held in state as well as on the element, because the element is not a React
  // value: nothing re-renders when it starts playing, and every number on this
  // page is a function of that.
  const [position, setPosition] = useState(0)
  const [failed, setFailed] = useState(false)
  /**
   * Whether the transcript has been asked for, which only matters on a phone.
   *
   * On a desk it is simply the other column and this is ignored. Stacked, the
   * poster and the transport and an hour of talk cannot share a screen, so the
   * words are behind a button and pressing it takes the room back off the
   * artwork. Closed to begin with: somebody arriving at an episode is deciding
   * whether to listen to it, and the picture and the play button are what that
   * decision is made of.
   */
  const [reading, setReading] = useState(false)

  // The 16:9 still, not the portrait card: this is the `poster` attribute of a
  // video element, and a 4:5 image in it is a black frame with a strip of
  // picture in the middle. See `episodeThumbnailUrl`.
  const poster = episodeThumbnailUrl(episode)
  const subtitle = subtitleFor(episode)
  const stacked = useStacked()

  /**
   * Whether there is a second column, which now means one thing: a transcript.
   *
   * Two shapes rather than the three this had while the show notes could also
   * fill it. `podcast.css` reads this off the element and lays the page out
   * accordingly — one column, holding the middle of the page, when there is
   * nothing to read beside the video.
   */
  const beside: 'transcript' | 'none' = episode.hasTranscript ? 'transcript' : 'none'

  // Both nodes exist from the first render onward; this is what tells the bar.
  useEffect(() => {
    setElement(video.current)
    setFrame(stage.current)
  }, [])

  // A new episode closes the transcript again: the video is what somebody
  // deciding whether to watch is looking at.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the slug is the point
  useEffect(() => setReading(false), [episode.slug])

  /**
   * Pick up where this browser left off.
   *
   * On `loadedmetadata` rather than on mount, because seeking an element that
   * does not yet know its own duration is either ignored or clamped to zero
   * depending on the browser. Keyed on the slug so that moving between episodes
   * in one session restores each one to its own place.
   */
  useEffect(() => {
    const media = video.current
    if (!media) return
    setFailed(false)
    const resume = () => {
      const at = rememberedPosition(episode.slug)
      if (at > 0) {
        media.currentTime = at
        setPosition(at)
      }
    }
    media.addEventListener('loadedmetadata', resume)
    return () => media.removeEventListener('loadedmetadata', resume)
  }, [episode.slug, episode.durationMs])

  /**
   * Where the playhead is, written down as it moves.
   *
   * Two readers, now that the transport is the browser's. The transcript
   * follows it, which is the reason this page tracks a position at all, and
   * `localStorage` remembers it so an hour is allowed to be more than one
   * sitting. Nothing here draws a clock any more.
   *
   * `timeupdate` fires about four times a second whoever is driving, so a
   * viewer dragging the browser's own scrubber is followed exactly as a viewer
   * pressing a transcript line is — which is what dropped with our scrubber:
   * there is no longer a control of ours to hold still for.
   */
  useEffect(() => {
    const media = video.current
    if (!media) return

    const tick = () => {
      setPosition(media.currentTime)
      rememberPosition(episode.slug, media.currentTime, media.duration)
    }
    const ended = () => rememberPosition(episode.slug, 0, media.duration)
    const broke = () => setFailed(true)

    media.addEventListener('timeupdate', tick)
    media.addEventListener('ended', ended)
    media.addEventListener('error', broke)
    return () => {
      media.removeEventListener('timeupdate', tick)
      media.removeEventListener('ended', ended)
      media.removeEventListener('error', broke)
    }
  }, [episode.slug])

  /**
   * Straight to a moment, because somebody pressed a line of the transcript.
   *
   * Not clamped against `duration`, unlike `skip`: these come from timestamps
   * inside the episode's own transcript, and a browser clamps a seek past the
   * end anyway. What it does do is *play* — pressing a line of a paused
   * transcript means "let me hear this", and leaving it paused on the right
   * second would be an odd sort of obedience.
   */
  const jumpTo = useCallback((seconds: number) => {
    const media = video.current
    if (!media) return
    media.currentTime = seconds
    setPosition(seconds)
    if (media.paused) void media.play().catch(() => setFailed(true))
  }, [])

  return (
    /*
      Three regions, laid out by named grid areas so one DOM order serves both
      shapes: on a desk the poster and everything you press are the left column
      and what there is to read is the right one; on a phone the same three
      stack. The page itself never scrolls — the right column is the only thing
      that does, which is what keeps the transport on screen while somebody
      reads.

      The two data attributes are the layout's switches, and both are read only
      by podcast.css: `data-beside` says what the right column is (and whether
      there is one at all), `data-reading` says whether a phone has asked for
      the transcript, which is what shrinks the poster.
    */
    <article className="player" data-beside={beside} data-reading={reading ? 'true' : 'false'}>
      <div className="player__bar">
        <button type="button" className="player__back" onClick={onBack}>
          <BackChevron /> All episodes
        </button>
      </div>

      <div className="player__left">
        {/* The picture, and nothing of ours over it.
            
            No `controls`: `Controls.tsx` draws the bar, modelled on YouTube's
            — a hairline that thickens under the pointer, two clusters and an
            empty middle, and the keys people already have in their fingers. The
            browser's own were here in between and are the reason this exists:
            they are three different bars on three different engines, and the
            one element carrying the actual content looked borrowed from
            somewhere else on a page this deliberate about its surfaces.
            
            `playsInline` is the one that has to stay, and it is doing more work
            here than it looks like: without it iOS takes any play into its own
            fullscreen player, which turns the phone landscape and throws away
            the page around it. With it, a phone plays the video where it sits,
            in the shape the page put it in, and going fullscreen stays
            something the viewer chooses rather than something playing does to
            them.
            
            `poster` is the episode's own 16:9 still, standing in until the
            first frame is decoded — which matters most in the moment this page
            is otherwise silent about: the wait before a slow file starts. It is
            deliberately not the poster the collection draws; that one is
            portrait, and portrait in this frame is two black bands. */}
        <div className="player__stage" ref={stage}>
          <video
            ref={video}
            className="player__video"
            src={episode.videoUrl}
            poster={poster ?? undefined}
            preload="metadata"
            playsInline
          />
          <Controls media={element} stage={frame} />
        </div>

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

        {/* The way in to the words on a phone, and drawn nowhere else: at any
            width with room for two columns the transcript is simply the other
            one, and a button to reveal a thing that is already on screen would
            be a button that does nothing. `aria-expanded` rather than
            `aria-pressed` because that is what this is — a region that is or is
            not there. */}
        {beside === 'transcript' && (
          <button
            type="button"
            className="player__reveal"
            aria-expanded={reading}
            aria-controls="player-reading"
            onClick={() => setReading((was) => !was)}
          >
            {reading ? 'Hide the transcript' : 'Read the transcript'}
          </button>
        )}
      </div>

      <div className="player__right" id="player-reading">
        {/* Not mounted on a phone until it is asked for: a transcript is a
            hundred kilobytes of text, and a reader who never opens it should
            not be made to fetch it. On a desk it is on screen from the start,
            so it is fetched from the start. */}
        {beside === 'transcript' && (!stacked || reading) && (
          <Transcript slug={episode.slug} positionSeconds={position} onSeek={jumpTo} />
        )}
      </div>

    </article>
  )
}

/**
 * Whether the page is in its stacked shape rather than its two-column one.
 *
 * The width is a layout decision and lives in podcast.css; this exists because
 * one thing about it is *not* only a layout decision. A transcript that is off
 * screen behind a button should not be fetched — it is a hundred kilobytes —
 * and `display: none` does not stop a component that has been rendered from
 * asking for it. So the breakpoint is read here too, and it has to be the same
 * number: see the `@media (max-width: 900px)` block in podcast.css, which is
 * where the columns actually stack.
 *
 * `matchMedia` rather than a resize listener, which fires on every pixel of a
 * drag and on a phone's address bar sliding away. Subscribed rather than read
 * once, so turning a tablet from portrait to landscape does the right thing.
 */
const STACKED = '(max-width: 900px)'

function useStacked(): boolean {
  const [stacked, setStacked] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(STACKED).matches,
  )

  useEffect(() => {
    const query = window.matchMedia(STACKED)
    const answer = (event: MediaQueryListEvent) => setStacked(event.matches)
    setStacked(query.matches)
    query.addEventListener('change', answer)
    return () => query.removeEventListener('change', answer)
  }, [])

  return stacked
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

