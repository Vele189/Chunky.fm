import { useEffect, useMemo, useRef, useState } from 'react'
import { formatPosition, paragraphs } from '../lib/episodes.js'
import { type TranscriptCue, activeCueIndex, fetchTranscript, parseTranscript } from '../lib/transcript.js'

/**
 * What was said, following the episode as it plays.
 *
 * The station has this for songs — see `Lyrics.tsx`, which is the same idea and
 * where the look comes from: no card, no border, lines of text with the current
 * one bright and the rest dimmed, drifting up as the thing moves through them.
 * A conversation is the same problem as a lyric sheet, so it gets the same
 * answer, and the two differences between them are both about what a
 * conversation is:
 *
 *  - **Every line is a way in.** The station refuses to let a listener seek,
 *    because seeking is how you stop being in the same second as everybody
 *    else. Nobody else is here, so a line somebody wants to hear again is a
 *    button that takes them to it.
 *  - **It stops following when you start reading.** A lyric is four seconds
 *    long and a spoken paragraph is forty, which is long enough to read ahead,
 *    look something up, and be dragged back by a sheet that thinks it knows
 *    best. So the first scroll of a wheel hands the pane over, and a button
 *    appears to hand it back.
 *
 * The words are fetched here rather than with the episode, and only when this
 * is on screen: an hour of talk is a hundred kilobytes of text, and the reader
 * who only wanted the audio should not pay for it. See `Episode.hasTranscript`.
 */

export interface TranscriptProps {
  /** Whose transcript. The address the archive knows this episode by. */
  slug: string
  /** Where the episode is, in seconds. The player's own clock. */
  positionSeconds: number
  /** Take the episode to a moment, because somebody pressed a line. */
  onSeek: (seconds: number) => void
}

/** What the pane has, and whether it is still finding out. */
type Sheet =
  | { state: 'looking' }
  | { state: 'timed'; cues: TranscriptCue[] }
  /** Words with no clock on them: a sheet to read rather than one to follow. */
  | { state: 'untimed'; blocks: string[] }
  | { state: 'none' }

/**
 * The transcript for one episode, asked for once.
 *
 * Local to this file rather than in `src/hooks/`, because it is asked by
 * exactly one component and the whole of it is a fetch and two pieces of state.
 * Keyed on the slug, and everything is forgotten the moment that changes: last
 * episode's words scrolling under this episode's audio would be worse than no
 * words at all — the same rule `useLyrics` follows when a track changes.
 */
function useTranscript(slug: string): Sheet {
  const [text, setText] = useState<string | null>(null)
  const [settled, setSettled] = useState(false)

  useEffect(() => {
    let cancelled = false
    setText(null)
    setSettled(false)
    void fetchTranscript(slug).then((found) => {
      if (cancelled) return
      setText(found)
      setSettled(true)
    })
    return () => {
      cancelled = true
    }
  }, [slug])

  const cues = useMemo(() => (text === null ? [] : parseTranscript(text)), [text])

  if (!settled) return { state: 'looking' }
  if (cues.length > 0) return { state: 'timed', cues }
  if (text !== null) {
    // Something came back and none of it carries a time. Not a failure: it is a
    // transcript nobody has timestamped, and it is still the words that were
    // said. `paragraphs` is the show notes' own splitter, and a transcript's
    // blank lines mean exactly what a paragraph break in the notes means.
    const blocks = paragraphs(text)
    if (blocks.length > 0) return { state: 'untimed', blocks }
  }
  return { state: 'none' }
}

export function Transcript({ slug, positionSeconds, onSeek }: TranscriptProps) {
  const sheet = useTranscript(slug)
  const scroller = useRef<HTMLDivElement>(null)
  /**
   * Whether the pane is still the episode's or has become the reader's.
   *
   * True until somebody scrolls it themselves. Not derived from scroll
   * position, because the pane's own smooth scrolling *is* scrolling and would
   * switch itself off on the first line it followed; the signal is the gesture
   * (a wheel, a finger, an arrow key) rather than the result of one.
   */
  const [following, setFollowing] = useState(true)

  const cues = sheet.state === 'timed' ? sheet.cues : EMPTY
  const active = activeCueIndex(cues, positionSeconds * 1000)

  // The line being spoken stays centred, the way a lyric sheet is read: the eye
  // holds still and the words move.
  useEffect(() => {
    if (!following || active < 0) return
    const container = scroller.current
    const line = container?.querySelector<HTMLElement>(`[data-cue="${active}"]`)
    if (!container || !line) return
    container.scrollTo({
      top: line.offsetTop - container.clientHeight / 2 + line.clientHeight / 2,
      behavior: 'smooth',
    })
  }, [active, following])

  /**
   * The gestures that mean "I am reading this myself now".
   *
   * A wheel, a finger dragging, and the keys that scroll — but not a click,
   * which is somebody choosing a line and is handled where the line is: that
   * one hands the pane *back*, because it moves the episode to where they are.
   */
  useEffect(() => {
    const container = scroller.current
    if (!container) return
    const taken = () => setFollowing(false)
    const key = (event: KeyboardEvent) => {
      if (/^(Arrow|Page)|^(Home|End| )$/.test(event.key)) setFollowing(false)
    }
    container.addEventListener('wheel', taken, { passive: true })
    container.addEventListener('touchmove', taken, { passive: true })
    container.addEventListener('keydown', key)
    return () => {
      container.removeEventListener('wheel', taken)
      container.removeEventListener('touchmove', taken)
      container.removeEventListener('keydown', key)
    }
    // On the state, not on nothing: while the words are being fetched there is
    // no pane to listen to — the ref is null — and an effect that ran once on
    // mount would have bound itself to that and never come back.
  }, [sheet.state])

  // A new episode is a new sheet, and a new sheet follows again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the slug is the point
  useEffect(() => setFollowing(true), [slug])

  if (sheet.state === 'looking') {
    return (
      <div className="transcript transcript--quiet" aria-busy="true">
        <p className="transcript__waiting">Finding the words&hellip;</p>
      </div>
    )
  }

  if (sheet.state === 'none') {
    return (
      <div className="transcript transcript--quiet">
        <p className="transcript__waiting">
          The transcript for this one could not be read. Reloading the page is usually enough.
        </p>
      </div>
    )
  }

  if (sheet.state === 'untimed') {
    // No clock on any of it, so nothing lights up and nothing follows. Said at
    // the top rather than left to be noticed, because a reader watching an
    // unmoving transcript should be told it is not broken — the same note the
    // station's lyric sheet carries for an untimed one.
    return (
      <div
        className="transcript transcript--plain"
        ref={scroller}
        data-testid="transcript"
      >
        <p className="transcript__untimed">Untimed transcript, read along</p>
        {sheet.blocks.map((block, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: paragraphs have no id
          <p className="transcript__plain" key={index}>
            {block}
          </p>
        ))}
      </div>
    )
  }

  return (
    <>
      <div className="transcript" ref={scroller} data-testid="transcript">
        {/* Room at the ends. Not the same amount at each; see podcast.css. */}
        <div className="transcript__breath transcript__breath--first" aria-hidden="true" />
        {cues.map((cue, index) => (
          <TurnLine
            key={`${cue.timeMs}-${index}`}
            cue={cue}
            index={index}
            // The head is drawn when the speaker changes, which is what makes
            // this read as a conversation rather than as a list of lines. With
            // nobody named it is drawn every time, because then the timestamp
            // is the only way back to a moment.
            opens={cue.speaker === null || cue.speaker !== cues[index - 1]?.speaker}
            active={index === active}
            onSeek={() => {
              onSeek(cue.timeMs / 1000)
              // They chose a moment; the pane is the episode's again.
              setFollowing(true)
            }}
          />
        ))}
        <div className="transcript__breath" aria-hidden="true" />
      </div>

      {!following && (
        <button
          type="button"
          className="transcript__follow"
          onClick={() => setFollowing(true)}
        >
          Follow the audio
        </button>
      )}
    </>
  )
}

/** Kept out of the render so an empty sheet is not a new array every frame. */
const EMPTY: TranscriptCue[] = []

/**
 * One thing somebody said.
 *
 * A button rather than a paragraph with a click on it, because it does
 * something: it moves the episode. That means the keyboard reaches it and a
 * screen reader announces it as the control it is, which for a transcript is
 * the difference between a wall of text and a way of getting around an hour of
 * audio.
 */
function TurnLine({
  cue,
  index,
  opens,
  active,
  onSeek,
}: {
  cue: TranscriptCue
  index: number
  opens: boolean
  active: boolean
  onSeek: () => void
}) {
  return (
    <button
      type="button"
      className="transcript__turn"
      data-cue={index}
      data-active={active ? 'true' : 'false'}
      onClick={onSeek}
      title={`Play from ${formatPosition(cue.timeMs / 1000)}`}
    >
      {opens && (
        <span className="transcript__head">
          {cue.speaker && <span className="transcript__who">{cue.speaker}</span>}
          <span className="transcript__at">{formatPosition(cue.timeMs / 1000)}</span>
        </span>
      )}
      <span className="transcript__said">{cue.text}</span>
    </button>
  )
}
