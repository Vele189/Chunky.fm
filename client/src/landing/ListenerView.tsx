import type { ReactNode } from 'react'
import broadcastIcon from '../assets/icons/broadcast.svg'
import chatIcon from '../assets/icons/chat.svg'
import clockIcon from '../assets/icons/clock.svg'
import heartIcon from '../assets/icons/heart.svg'
import lyricsIcon from '../assets/icons/lyrics.svg'
import slidersIcon from '../assets/icons/sliders.svg'
import usersIcon from '../assets/icons/users.svg'
import volumeIcon from '../assets/icons/volume.svg'
import { Deck, OnAir, Waveform } from '../Turntable.js'
import { BEEN_ON, SESSION } from './session.js'

/**
 * The listener's page, drawn small.
 *
 * What is on the laptop in the "what has been on" section — see `MacbookScroll`.
 * Everything above this on the page describes the station a piece at a time: the
 * deck, the room talking, the wishes, the evening. This is all of it at once, in
 * the arrangement a listener actually gets it in, which is the one thing a column
 * of prose cannot show and the reason the section is a screen rather than a list.
 *
 * The arrangement is the station's current one: the deck and who is in the room
 * on the left, and the whole right-hand column given to the words — no panels,
 * no cards, the current line bright and the rest dimmed, the way the real page
 * reads a song. The queue, the evening and the chat are not on this screen any
 * more because they are not on that one: each lives at a mark on the rail, and
 * the rail here has the same six marks in the same order.
 *
 * The parts that exist are the station's own: `Deck`, `OnAir` and `Waveform` are
 * imported from Turntable.tsx unchanged, and the record on the platter is the
 * record the rest of the page has been playing. What is drawn here rather than
 * imported is the furniture around them — the rail, the bar across the top, the
 * lyric sheet — because that lives in styles.css, which belongs to the
 * station's bundle and is not loaded by this document. Drawn from the same
 * tokens and the same measurements, so it is a copy rather than an impression,
 * and the sizes are the only thing scaled: this is a screen inside a screen.
 * (The mute under the meter is drawn too, as spans rather than the real button:
 * a focusable control inside an `aria-hidden` picture would be a tab stop that
 * announces nothing.)
 *
 * `aria-hidden`, whole. It is a picture of a page, and every word in it is said
 * properly somewhere on the real one — a screen reader given this would get the
 * page twice and a keyboard's worth of nothing in between.
 */

/** The rail's destinations — Sidebar.tsx's six marks, in the station's order. */
const RAIL = [
  { icon: broadcastIcon, name: 'On air' },
  { icon: lyricsIcon, name: 'Lyrics' },
  { icon: slidersIcon, name: 'Sync' },
  { icon: chatIcon, name: 'Chat' },
  { icon: heartIcon, name: 'Wishes' },
  { icon: clockIcon, name: 'History' },
]

/**
 * The sheet on the screen, mid-verse.
 *
 * Invented, like everything else in the sample session — these are not the
 * words to the record on the platter, because the record is a real one and its
 * words are somebody's property. What the drawing needs is the *shape* of a
 * lyric sheet: short lines, a bright one past the middle, a timestamped
 * silence rendered the way the real sheet renders one.
 */
const WORDS = [
  'Static settles on the evening air',
  'A needle drops into the quiet',
  'Every window leaning on the same slow song',
  '· · ·',
  'Miles apart and humming along',
  'Nobody ahead and nobody behind',
  'Hold the moment while it plays',
  'It only comes around the once',
  'The chorus lands on every roof at once',
  'And the room goes quiet together',
  '· · ·',
  'Somebody writes the hour down',
  'So sing it soft and sing it slow',
  'The night is long and the night knows',
]

/** The line the song is on when this is drawn. */
const BRIGHT = 6

/** Who the roster pills name. The rest of the room is the count beside them. */
const HERE = ['thandi', 'sipho', 'lerato', 'ana', 'nadia', 'kofi', 'sam', 'mira']

export function ListenerView() {
  const cover = BEEN_ON.find((play) => play.cover !== undefined)?.cover

  return (
    <div className="listener" aria-hidden="true">
      <nav className="listener__rail">
        {RAIL.map((where, index) => (
          <span className="listener__stop" key={where.name} data-on={index === 0 ? 'true' : 'false'}>
            <img src={where.icon} alt="" width={11} height={11} />
          </span>
        ))}
      </nav>

      <div className="listener__main">
        <header className="listener__top">
          <p className="listener__wordmark">
            chunky<span className="wordmark__tld">.fm</span>
          </p>
          <span className="listener__count">
            <img src={usersIcon} alt="" width={9} height={9} />
            {SESSION.listeners} listening
          </span>
          <span className="listener__signal">live</span>
        </header>

        <div className="listener__columns">
          <section className="listener__stage">
            {/* The station's turntable, at its own size and scaled down as an
                object — see the note in landing.css. */}
            <div className="listener__platter">
              <Deck artwork={cover?.src ?? null} spinning />
            </div>

            <div className="listener__now">
              <OnAir live idleLabel="OFF AIR" />
              <p className="listener__title">{SESSION.title}</p>
              <p className="listener__artist">{SESSION.artist}</p>
              <Waveform live />
            </div>

            {/* The mute under the meter, drawn — see the note above. */}
            <div className="listener__mute">
              <span className="listener__mute-button">
                <img src={volumeIcon} alt="" width={11} height={11} />
              </span>
              <span className="listener__mute-hint">Streaming live — tap to mute</span>
            </div>

            {/* Under the deck, where the station puts it: who else is in the
                room, as the pills the real roster wears. */}
            <ScreenPanel title="Listening now" aside={String(SESSION.listeners)}>
              <ul className="listener__names">
                {HERE.map((who) => (
                  <li className="listener__name" key={who}>
                    {who}
                  </li>
                ))}
                <li className="listener__name listener__name--more">
                  +{SESSION.listeners - HERE.length} more
                </li>
              </ul>
            </ScreenPanel>
          </section>

          {/* The whole column, and nothing else on it — the words, floating
              beside the deck the way the station floats them: no panel, no
              heading, the current line bright and the sheet fading out at both
              ends of the screen. */}
          <section className="listener__aside">
            <div className="listener__lyrics">
              {WORDS.map((line, index) => (
                <p
                  className={`listener__lyric${index === BRIGHT ? ' listener__lyric--bright' : ''}${
                    line === '· · ·' ? ' listener__lyric--hum' : ''
                  }`}
                  key={index}
                >
                  {line}
                </p>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

/** The station's panel: a heading, a count beside it, and a list under it. */
function ScreenPanel({
  title,
  aside,
  children,
}: {
  title: string
  aside?: string
  children: ReactNode
}) {
  return (
    <section className="listener__panel">
      <div className="listener__panel-head">
        <h3 className="listener__panel-title">{title}</h3>
        {aside === undefined ? null : <p className="listener__panel-aside">{aside}</p>}
      </div>
      {children}
    </section>
  )
}
