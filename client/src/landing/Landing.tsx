import bolt from '../assets/poster/stickers/bolt.webp'
import cassette from '../assets/poster/stickers/cassette.webp'
import hand from '../assets/poster/stickers/hand.webp'
import headphones from '../assets/poster/stickers/headphones.webp'
import lamp from '../assets/poster/stickers/lamp.webp'
import mic from '../assets/poster/stickers/mic.webp'
import record from '../assets/poster/stickers/record.webp'
import star from '../assets/poster/stickers/star.webp'
import { PODCAST_PATH } from '../lib/episodes.js'
import type { ScheduledSession } from '../lib/protocol.js'
import { stationUrl } from '../lib/routes.js'
import { nextSessionShort } from '../lib/schedule.js'
import { posterUrl } from '../lib/protocol.js'
import { ASSETS, coverFor } from '../poster/assets.js'
import { NextSession, promiseOf, useSchedule } from './NextSession.js'
import { WISHES } from './session.js'
import { Slot } from '../poster/Slot.js'
import { type ArchiveCard, useArchive } from './useArchive.js'
import { useStill } from './useStill.js'
import { LiveVideo } from '../LiveVideo.js'
import { useLiveVideo } from '../hooks/useLiveVideo.js'

/**
 * The page in front of the station, printed as a poster.
 *
 * It is a separate document from the station itself (see landing.html) and it
 * knows nothing about a socket, a clock or a listener. That is why it keeps
 * working when the station behind it does not: it has to answer "what is this"
 * for somebody who cannot get in yet.
 *
 * Two things on it are true and the rest is an invented evening. The true ones
 * are the announced sessions (`useSchedule`, an open read) and the archive
 * (`useArchive`, another). The wishes and the copy describe a night the way it
 * goes.
 *
 * The look comes from the Figma page "revamp — poster": newsprint and ink in
 * solid bands, one condensed display face, monospace for everything that is a
 * label, square corners. Pictures that do not exist yet are `Slot`s, labelled
 * with the same ids as the prompts in docs/midjourney-prompts.md. See assets.ts
 * for how one is dropped in.
 *
 * The fancier motion the old page had (a gramophone, a globe, a split-flap
 * board) is gone on purpose. A poster earns attention with type and contrast;
 * the only thing here that moves by itself is the ticker, and that stops when
 * asked to.
 */
export function Landing() {
  const { next, upcoming } = useSchedule()
  const liveUrl = useLiveVideo()

  return (
    <div className="poster">
      <Bar />
      <Ticker next={next} live={liveUrl !== null} />
      <main>
        {liveUrl ? <LiveHero url={liveUrl} /> : <Hero />}
        <NextSession next={next} />
        <Upcoming sessions={upcoming} />
        <Creed />
        <Archive />
        <Asked />
        <Dj />
        <Limits />
        <Join next={next} />
      </main>
      <Foot />
      <TuneBar next={next} live={liveUrl !== null} />
    </div>
  )
}

/**
 * The ways off this page, named once. See STATION_PATH in lib/routes.ts and
 * PODCAST_PATH in lib/episodes.ts.
 *
 * The archive is the one worth something when the station is dark, which is
 * most of the time. That is why it is in the bar, the hero and the foot rather
 * than only in the prose.
 */
const TUNE_IN = stationUrl()
const DECKS = stationUrl('admin')
const PODCAST = PODCAST_PATH

/**
 * Where the bar goes. Fragments in the order the sections are in, then the one
 * address that leaves, last, so the link that unloads the page is not sitting
 * between two that only scroll it.
 */
const NAV = [
  { name: 'Upcoming', link: '#sessions' },
  { name: 'Archive', link: '#archive' },
  { name: 'The DJ', link: '#dj' },
  { name: 'Podcast', link: PODCAST },
]

function Wordmark({ className }: { className?: string }) {
  return <span className={className ? `mark ${className}` : 'mark'}>chunky.fm</span>
}

function Bar() {
  return (
    <header className="bar">
      <a className="bar__home" href="#top" aria-label="chunky.fm, top of the page">
        <Wordmark />
      </a>
      <nav className="bar__links" aria-label="On this page">
        {NAV.map((item) => (
          <a key={item.link} className="bar__link" href={item.link}>
            {item.name}
          </a>
        ))}
      </nav>
      <a className="button button--press bar__tune" href={TUNE_IN}>
        Tune in <Arrow />
      </a>
    </header>
  )
}

/**
 * The strip of type that runs under the bar.
 *
 * It says the one live thing the page knows, the next session, and otherwise
 * the station's three promises. It says "live" only while the DJ camera is
 * actually on (`useLiveVideo`): a ticker shouting that over a dark room would
 * be the page lying in its biggest type.
 *
 * The text is laid down twice and the track slides by exactly one copy, which
 * is what makes the loop seamless. Only the first copy is read aloud; the
 * second is there for the eye. Under reduced motion the track holds still and
 * reads as a printed band.
 */
function Ticker({ next, live }: { next: ScheduledSession | null; live: boolean }) {
  const still = useStill()
  const said = live
    ? ['Live now', 'On the decks', 'Come in']
    : next
    ? ['Next session', nextSessionShort(next.startsAt, Date.now()), promiseOf(next), 'Same link as always']
    : ['Music is a culture', 'Listen together', 'Chosen by hand', 'No algorithm']
  const run = (
    <>
      {[...said, ...said].map((phrase, index) => (
        // The phrases repeat inside one copy, so the index is the identity.
        // biome-ignore lint/suspicious/noArrayIndexKey: see above
        <span className="ticker__phrase" key={index}>
          {phrase}
        </span>
      ))}
    </>
  )

  return (
    <div className="ticker" data-still={still}>
      <p className="ticker__track">
        <span className="ticker__copy">{run}</span>
        <span className="ticker__copy" aria-hidden="true">
          {run}
        </span>
      </p>
    </div>
  )
}

/** The top of the page while the DJ is on camera: the set is the page. */
function LiveHero({ url }: { url: string }) {
  return (
    <section className="live-hero" id="top" data-testid="live-hero">
      <LiveVideo url={url} title="chunky.fm, live from the decks" />
      <div className="live-hero__words">
        <h1 className="live-hero__headline">Live now</h1>
        <a className="button button--press button--large" href={TUNE_IN}>
          Join the room <Arrow />
        </a>
      </div>
    </section>
  )
}

/**
 * The top of the page: the room, and the claim laid over it.
 *
 * The picture is MJ-01 when it exists. Until then the slot is the same size,
 * so the headline sits where it will sit. The shade under the words is CSS, not
 * part of the picture, so the type stays readable whatever image lands behind it.
 */
function Hero() {
  return (
    <section className="hero" id="top">
      <Slot asset={ASSETS.room} className="hero__room" eager />
      <div className="hero__shade" aria-hidden="true" />
      <div className="hero__words">
        <p className="kicker kicker--paper">A live radio station for a small room</p>
        <h1 className="hero__headline">Music deserves more than an algorithm.</h1>
        <p className="hero__blurb">
          The room chooses the theme. I spend the day curating the story. Then we sit with the
          music together, and talk about what we heard.
        </p>
        {/* Two, and not the same offer. The first is the station, which is dark
            more often than it is on; the second is the archive, which never is.
            Saying both on the first screen is the page admitting that half of
            what it describes already happened and can be heard right now. */}
        <div className="hero__ways">
          <a className="button button--press button--large" href={TUNE_IN}>
            Join tonight’s session <Arrow />
          </a>
          <a className="button button--outline-paper button--large" href={PODCAST}>
            Listen to the podcast
          </a>
        </div>
      </div>
    </section>
  )
}

/**
 * Every announced session, soonest first.
 *
 * True, like the next-session band above it: these are the nights somebody
 * has actually set in the console, read from the same open `GET /api/schedule`.
 * The band is the next one at poster size; this is the list a person scans to
 * decide which evening to keep free, so it carries the date as well as the
 * time, which a single "Saturday at 21:00" does not need.
 *
 * Unlike the band it stays on the page when nothing is announced, and says so.
 * The bar links here, and a link to a section that is not there would be the
 * page breaking on the very days it has to work.
 */
function Upcoming({ sessions }: { sessions: ScheduledSession[] }) {
  return (
    <section className="band band--ink sessions" id="sessions">
      <div className="sessions__head">
        <p className="kicker kicker--paper">On the calendar</p>
        <h2 className="display sessions__title">
          <span>Upcoming</span> <span>sessions</span>
        </h2>
      </div>

      {sessions.length > 0 ? (
        <ol className="order" data-testid="upcoming-sessions">
          {sessions.map((session) => (
            <Session key={session.id} session={session} />
          ))}
        </ol>
      ) : (
        <p className="sessions__none" data-testid="upcoming-none">
          Nothing is announced yet. When the next night is set, it goes up here first.
        </p>
      )}

      <p className="sessions__note">
        One person chooses the records, around one question a night. No shuffle, no skipping.
      </p>
    </section>
  )
}

/**
 * One announced night, as a row: the date, the time, what it is, and its poster
 * if it has one.
 *
 * The date and the time are the reader's own, from the browser, because the
 * question being answered is "which of my evenings". The poster is shown in its
 * own colours: it is whoever runs the night saying what it is, not a sleeve
 * standing in a row of sleeves.
 */
function Session({ session }: { session: ScheduledSession }) {
  const at = new Date(session.startsAt)
  const day = at.toLocaleDateString(undefined, { weekday: 'short' })
  const date = at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  const time = at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const art = posterUrl(session)

  return (
    <li className="order__row sessions__row">
      <time className="sessions__date" dateTime={at.toISOString()}>
        <span className="sessions__day">{day}</span>
        <span>{date}</span>
      </time>
      <span className="order__time">{time}</span>
      <span className="order__title">{promiseOf(session)}</span>
      {art ? (
        <img
          className="sessions__poster"
          src={art}
          alt={`Poster for ${promiseOf(session)}`}
          width={40}
          height={50}
          loading="lazy"
          decoding="async"
        />
      ) : (
        <span className="sessions__poster sessions__poster--none" aria-hidden="true" />
      )}
    </li>
  )
}

/** The argument, in the biggest type on the page. */
function Creed() {
  return (
    <section className="band band--paper creed">
      <div className="creed__words">
        <h2 className="display creed__headline">Listen together. Talk about it. Come back.</h2>
        <p className="creed__body">
          chunky.fm is about building a culture around music: songs chosen with care, heard with
          other people, and talked about while they play. Bring a question, a request or just your
          ears. Anyone in the room can put a hand up and say something.
        </p>
        <a className="button button--outline" href="/how-it-works">
          How a session works
        </a>
      </div>
      <Stickers />
    </section>
  )
}

/**
 * MJ-07, the sticker wall: each one cut out of its backing and slapped on at
 * its own angle, overlapping, the way stickers end up on a studio door.
 *
 * Where each sits is fixed, not random, so the wall is the same on every visit
 * and in every screenshot. `x`, `y` and `w` are percentages of the square, in
 * paint order: later ones go on top. Decoration only, so the whole wall is
 * hidden from screen readers and every `alt` is empty.
 */
const STICKERS = [
  { src: record, x: 0, y: 20, w: 40, turn: 8 },
  { src: star, x: 64, y: 4, w: 34, turn: 12 },
  { src: lamp, x: 30, y: 0, w: 38, turn: -6 },
  { src: bolt, x: 76, y: 38, w: 22, turn: -10 },
  { src: cassette, x: 28, y: 40, w: 46, turn: -4 },
  { src: headphones, x: 0, y: 60, w: 34, turn: 6 },
  { src: mic, x: 68, y: 62, w: 20, turn: -14 },
  { src: hand, x: 32, y: 76, w: 40, turn: 3 },
]

function Stickers() {
  return (
    <div className="creed__stickers" aria-hidden="true">
      {STICKERS.map((sticker) => (
        <img
          key={sticker.src}
          className="sticker"
          src={sticker.src}
          alt=""
          loading="lazy"
          decoding="async"
          style={{
            left: `${sticker.x}%`,
            top: `${sticker.y}%`,
            width: `${sticker.w}%`,
            transform: `rotate(${sticker.turn}deg)`,
          }}
        />
      ))}
    </div>
  )
}

/**
 * The podcast, as a row of folded-corner cards.
 *
 * Real episodes when the station answers and an invented few when it does not
 * (see useArchive). **Invented ones are inert**: a card that looks like an
 * episode and leads to a 404 is worse than no card, so the whole row goes
 * `inert` and the way to the archive is the button under it, which works
 * either way.
 */
function Archive() {
  const { cards, real } = useArchive()

  return (
    <section className="band band--bone archive" id="archive">
      <div className="archive__head">
        <h2 className="display archive__title">From the archive</h2>
        <div className="archive__side">
          <p className="archive__body">
            A session ends and takes the evening with it. The conversations worth keeping do not go
            anywhere.
          </p>
          <a className="button button--outline" href={PODCAST}>
            All sessions <Arrow />
          </a>
        </div>
      </div>

      <ul className="archive__cards" inert={!real}>
        {cards.map((card, index) => (
          <li key={card.key}>
            <Kept card={card} eager={index < 2} />
          </li>
        ))}
      </ul>

      {!real && (
        <p className="archive__note">
          A picture of the shelf. The episodes themselves are through the link above.
        </p>
      )}
    </section>
  )
}

function Kept({ card, eager }: { card: ArchiveCard; eager: boolean }) {
  return (
    <article className="kept">
      <div className="kept__head">
        <div className="kept__names">
          <h3 className="kept__title">{card.title}</h3>
          {card.sub && <p className="kept__sub">{card.sub}</p>}
        </div>
        <p className="kept__meta">
          <span className="kept__when">{card.when}</span>
          <span className="kept__length">{card.length}</span>
        </p>
      </div>

      {card.href ? (
        <a className="button button--press kept__play" href={card.href}>
          Play <Arrow />
        </a>
      ) : (
        <span className="button button--press kept__play" aria-hidden="true">
          Play <Arrow />
        </span>
      )}

      {card.poster ? (
        <img
          className="kept__cover kept__cover--poster"
          src={card.poster}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
        />
      ) : (
        <Slot asset={coverFor(card.title)} className="kept__cover" />
      )}
    </article>
  )
}

/** What the room asked for. Sentences, not genres, because that is what arrives. */
function Asked() {
  return (
    <section className="band band--charcoal asked">
      <p className="kicker kicker--paper">What the room asked for</p>
      <ul className="asked__list">
        {WISHES.map((wish) => (
          <li className="asked__wish" key={wish.says}>
            “{wish.says}”
          </li>
        ))}
      </ul>
      <p className="asked__after">The room asks. The DJ decides.</p>
    </section>
  )
}

/**
 * Who is on the decks, in his own words.
 *
 * The portrait is MJ-05, the photocopied host picture, in the same slot as the
 * rest of the poster's pictures. The CSS adds the same grey, hard contrast the
 * photo it replaced had, so the band prints like the others.
 */
const DJ = [
  'Hi, I’m Ndamulelo.',
  'I don’t think music is something we consume.',
  'I think it’s something we learn to hear.',
  'Every session begins with a question.',
  'Then I spend hours listening, reading, researching, and connecting songs that answer it.',
  'Sometimes the best music isn’t the song you were looking for.',
  'It’s the song someone convinced you to stay with.',
]

function Dj() {
  return (
    <section className="band band--ink dj" id="dj">
      <h2 className="display dj__title">The DJ</h2>
      <div className="dj__row">
        <Slot asset={ASSETS.host} className="dj__face" />
        <div className="dj__words">
          {DJ.map((line, index) => (
            // Position is the identity: the lines of one statement, in order.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            <p className="dj__line" key={index}>
              {line}
            </p>
          ))}
        </div>
      </div>
    </section>
  )
}

/**
 * What it is not, kept on the page rather than left for somebody to discover.
 *
 * The last line is not a limit. It is what is left when you take all of them
 * away, so it is set apart from the rest.
 */
const LIMITS = [
  'Deliberately small.',
  'One station.',
  'One DJ.',
  'No endless feed.',
  'No autoplay.',
  'No algorithm deciding what’s next.',
  'No pressure to maximize listening time.',
]

function Limits() {
  return (
    <section className="band band--paper limits">
      <p className="kicker">What it deliberately is not</p>
      <ul className="limits__list">
        {LIMITS.map((limit) => (
          <li className="limits__item" key={limit}>
            {limit}
          </li>
        ))}
      </ul>
      <p className="display limits__left">
        Just people showing up to hear something worth sharing.
      </p>
    </section>
  )
}

function Join({ next }: { next: ScheduledSession | null }) {
  return (
    <section className="band band--press join">
      <h2 className="display join__headline">Join the room.</h2>
      {next && (
        <p className="join__next">
          Next session · {nextSessionShort(next.startsAt, Date.now())} · {promiseOf(next)}
        </p>
      )}
      <div className="join__ways">
        <a className="button button--ink button--large" href={TUNE_IN}>
          Tune in <Arrow />
        </a>
        <a className="button button--outline-paper button--large" href={PODCAST}>
          Listen to the podcast
        </a>
      </div>
      <p className="join__note">
        Sessions happen live, on the nights above. Between them, the podcast keeps the ones worth
        hearing again.
      </p>
    </section>
  )
}

function Foot() {
  return (
    <footer className="band band--ink foot">
      <Wordmark className="foot__mark" />
      <nav className="foot__ways" aria-label="Elsewhere">
        <a href={TUNE_IN}>Tune in</a>
        <a href="#archive">Archive</a>
        <a href="#dj">The DJ</a>
        <a href={PODCAST}>The podcast</a>
        <a href="/how-it-works">How it works</a>
        <a href={DECKS}>Run the decks</a>
      </nav>
      <p className="foot__line">Music worth sharing, heard together.</p>
    </footer>
  )
}

/**
 * The strip pinned to the foot of the window.
 *
 * The station puts its transport here, and this is the same place on the page
 * in front of it, so a thumb learns one spot. But there is no audio on this
 * page and the bar does not pretend there is: no pause, no volume, no level.
 * It says what it knows (when the next session is, if one is announced) and
 * has one thing to press, which takes you to where the sound is.
 */
function TuneBar({ next, live }: { next: ScheduledSession | null; live: boolean }) {
  return (
    <aside className="tunebar" aria-label="Tune in">
      <span className="tunebar__channel">chunky.fm</span>
      <span className="tunebar__status">
        {live
          ? 'Live now'
          : next
            ? `Next session · ${nextSessionShort(next.startsAt, Date.now())}`
            : 'Live on announced nights'}
      </span>
      <a className="tunebar__go" href={TUNE_IN}>
        Tune in <Arrow />
      </a>
    </aside>
  )
}

/**
 * The poster's one arrow, from the Figma icon set: 24 grid, square caps. In
 * `currentColor` so it takes the colour of the button it is in.
 */
function Arrow() {
  return (
    <svg className="arrow" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M8 4 H20 V16 M20 4 L5 19"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="square"
      />
    </svg>
  )
}
