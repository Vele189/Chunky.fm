import { useEffect, useRef, useState } from 'react'
import { useLyrics } from './hooks/useLyrics.js'
import { activeLineIndex, parsePlain } from './lib/lyrics.js'
import { expectedPositionSeconds } from './lib/position.js'
import type { StateMessage } from './lib/protocol.js'

/**
 * The words, floating beside the deck.
 *
 * Deliberately not a panel. Everything else on the aside is a list in a card;
 * the words are the one thing on the page that should read like the song
 * rather than like the interface, so there is no border, no heading and no
 * card: lines of text, the current one bright, the rest dimmed, drifting up
 * as the song moves through them.
 *
 * The bright line runs on the same clock the audio does. Nothing here listens
 * to the `<audio>` element: the position is computed from the server tuple the
 * way `useSyncedAudio` computes it, so the words agree with the ear because
 * both agree with the station.
 */

/** How often the page asks which line the song is on. Well under a line's length. */
const TICK_MS = 250

export interface LyricsProps {
  /** The playback tuple. The words follow whatever track is on it. */
  state: StateMessage | null
  /** The synced clock's idea of now. See useServerClock. */
  serverNow: () => number
}

export function Lyrics({ state, serverNow }: LyricsProps) {
  const track = state?.track ?? null
  const sheet = useLyrics(track?.id ?? null)
  const [active, setActive] = useState(-1)
  const sheetRef = useRef<HTMLDivElement>(null)

  // A ticking read of a position everything already knows, not a subscription:
  // re-rendering happens only when the answer changes, which is once per line.
  useEffect(() => {
    if (state === null || sheet.lines.length === 0) {
      setActive(-1)
      return
    }
    const tick = () => {
      setActive(activeLineIndex(sheet.lines, expectedPositionSeconds(state, serverNow()) * 1000))
    }
    tick()
    const timer = setInterval(tick, TICK_MS)
    return () => clearInterval(timer)
  }, [state, sheet.lines, serverNow])

  // The bright line stays centred, the way a lyric sheet is read: the eye
  // holds still and the words move. Scrolled by hand the sheet stays where it
  // was put until the next line arrives, which is when following resumes.
  useEffect(() => {
    if (active < 0) return
    const container = sheetRef.current
    const line = container?.querySelector<HTMLElement>(`[data-line="${active}"]`)
    if (!container || !line) return
    container.scrollTo({
      top: line.offsetTop - container.clientHeight / 2 + line.clientHeight / 2,
      behavior: 'smooth',
    })
  }, [active])

  if (!track) return null

  if (sheet.status === 'looking') {
    return <div className="lyrics lyrics--quiet" aria-hidden="true" />
  }

  if (sheet.lines.length > 0) {
    return (
      <div className="lyrics" ref={sheetRef} data-testid="lyrics" aria-label="Lyrics">
        {/* Breathing room so the first and last lines can reach the centre. */}
        <div className="lyrics__breath" aria-hidden="true" />
        {sheet.lines.map((line, index) => (
          <p
            key={`${line.timeMs}-${index}`}
            data-line={index}
            className={`lyrics__line${index === active ? ' lyrics__line--bright' : ''}${
              line.text === '' ? ' lyrics__line--hum' : ''
            }`}
          >
            {/* A timestamped silence: an intro, a solo. The song is still
                going, so the sheet says so quietly rather than going blank. */}
            {line.text === '' ? '· · ·' : line.text}
          </p>
        ))}
        <div className="lyrics__breath" aria-hidden="true" />
      </div>
    )
  }

  if (sheet.plain !== null) {
    // Words with no clock on them. Not a sheet to follow but a sheet to read, so
    // it is laid out as one: verses kept apart, every line evenly lit, and a
    // note at the top saying why nothing is lighting up, because a listener
    // watching an unmoving sheet should be told it isn't broken. No bright
    // line, because guessing one would put it in the wrong place for most of
    // every song.
    return (
      <div className="lyrics lyrics--plain" ref={sheetRef} data-testid="lyrics" aria-label="Lyrics">
        <p className="lyrics__untimed">Untimed sheet, read along</p>
        {parsePlain(sheet.plain).map((stanza, index) => (
          <section key={index} className="lyrics__stanza">
            {stanza.map((text, line) => (
              <p key={line} className="lyrics__line lyrics__line--even">
                {text}
              </p>
            ))}
          </section>
        ))}
      </div>
    )
  }

  return (
    <div className="lyrics lyrics--quiet" data-testid="lyrics">
      <p className="lyrics__none">No words for this one. Just listen.</p>
    </div>
  )
}
