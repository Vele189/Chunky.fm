import type { ReactNode } from 'react'
import broadcastIcon from '../assets/icons/broadcast.svg'
import chatIcon from '../assets/icons/chat.svg'
import clockIcon from '../assets/icons/clock.svg'
import heartIcon from '../assets/icons/heart.svg'
import scheduleIcon from '../assets/icons/schedule.svg'
import searchIcon from '../assets/icons/search.svg'
import usersIcon from '../assets/icons/users.svg'
import { Deck, OnAir, Waveform } from '../Turntable.js'
import { BEEN_ON, clock, initial, ROOM, SESSION, SKIPS, WISHES } from './session.js'

/**
 * The listener's page, drawn small.
 *
 * What is on the laptop in the "what has been on" section — see `MacbookScroll`.
 * Everything above this on the page describes the station a piece at a time: the
 * deck, the room talking, the wishes, the evening. This is all of it at once, in
 * the arrangement a listener actually gets it in, which is the one thing a column
 * of prose cannot show and the reason the section is a screen rather than a list.
 *
 * The parts that exist are the station's own: `Deck`, `OnAir` and `Waveform` are
 * imported from Turntable.tsx unchanged, and the record on the platter is the
 * record the rest of the page has been playing. What is drawn here rather than
 * imported is the furniture around them — the rail, the bar across the top, the
 * panels down the right — because that lives in styles.css, which belongs to the
 * station's bundle and is not loaded by this document. Drawn from the same
 * tokens and the same measurements, so it is a copy rather than an impression,
 * and the sizes are the only thing scaled: this is a screen inside a screen.
 *
 * The lists are the page's own sample session. The evening in the right-hand
 * column is `BEEN_ON`, which is what the section used to print as a list of its
 * own — so the section still says exactly what it said, in the place a listener
 * would have read it.
 *
 * `aria-hidden`, whole. It is a picture of a page, and every word in it is said
 * properly somewhere on the real one — a screen reader given this would get the
 * evening twice and a keyboard's worth of nothing in between.
 */

/** The rail's destinations, in the station's order. */
const RAIL = [
  { icon: broadcastIcon, name: 'On air' },
  { icon: chatIcon, name: 'The room' },
  { icon: heartIcon, name: 'Wishes' },
  { icon: scheduleIcon, name: 'Up next' },
  { icon: clockIcon, name: 'Earlier' },
]

/** Where the sample session is when this is drawn: far enough in to be talking. */
const AT = 171

/** The three the room has heard from, named. The rest are a count. */
const HERE = ['thandi', 'lerato', 'ana']

export function ListenerView() {
  const said = ROOM.filter((line) => line.at <= AT).slice(-5)
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
          <span className="listener__search">
            <img src={searchIcon} alt="" width={9} height={9} />
            Search this session
          </span>
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
              <p className="listener__time">
                {clock(AT)} / {clock(SESSION.duration)}
              </p>
              <Waveform live />
              <p className="listener__skip">
                Skip this one? <span className="listener__tally">{SKIPS.votes} of {SKIPS.of}</span>
              </p>
            </div>

            {/* Under the deck, where the station puts them: what this listener
                has asked for, and who else is in the room. */}
            <ScreenPanel title="What you asked for">
              <ol className="listener__rows">
                {WISHES.slice(0, 2).map((wish) => (
                  <li className="listener__row" key={wish.says}>
                    <span className="listener__what">
                      <span className="listener__what-title">“{wish.says}”</span>
                    </span>
                  </li>
                ))}
              </ol>
            </ScreenPanel>

            <p className="listener__here">
              {SESSION.listeners} here: {HERE.join(', ')} and {SESSION.listeners - HERE.length}{' '}
              others
            </p>
          </section>

          <section className="listener__aside">
            <ScreenPanel title="Up next" aside="2 queued">
              <ol className="listener__rows">
                {BEEN_ON.slice(1, 3).map((play, index) => (
                  <li className="listener__row" key={play.title}>
                    <span className="listener__index">{index + 1}</span>
                    <span className="listener__what">
                      <span className="listener__what-title">{play.title}</span>
                      <span className="listener__what-sub">{play.artist}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </ScreenPanel>

            {/* The evening, where a listener reads it. This is the section's
                own list, in the column it belongs to. */}
            <ScreenPanel title="Recently Played" aside={`${BEEN_ON.length} played`}>
              <ol className="listener__rows">
                {BEEN_ON.slice(0, 4).map((play, index) => (
                  <li className="listener__row" key={play.at} data-now={index === 0 ? 'true' : 'false'}>
                    <span className="listener__index">{index + 1}</span>
                    <span className="listener__what">
                      <span className="listener__what-title">{play.title}</span>
                      <span className="listener__what-sub">{play.artist}</span>
                    </span>
                    <span className="listener__at">{play.at}</span>
                  </li>
                ))}
              </ol>
            </ScreenPanel>

            <ScreenPanel title="The room">
              <ol className="listener__said">
                {said.map((line) => (
                  <li className="listener__line" key={line.at}>
                    <span className="listener__face">{initial(line.who)}</span>
                    <span className="listener__says">
                      <span className="listener__who">{line.who}</span>
                      {line.says}
                    </span>
                  </li>
                ))}
              </ol>
            </ScreenPanel>
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
