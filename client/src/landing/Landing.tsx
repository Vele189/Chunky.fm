import ndamulelo from '../assets/ndamulelo.webp'
import { PODCAST_PATH } from '../lib/episodes.js'
import type { ScheduledSession } from '../lib/protocol.js'
import { stationUrl } from '../lib/routes.js'
import { nextSessionShort } from '../lib/schedule.js'
import { ASSETS } from './assets.js'
import { NextSession, promiseOf, useNextSession } from './NextSession.js'
import { BEEN_ON, WISHES } from './session.js'
import { Slot } from './Slot.js'
import { type ArchiveCard, useArchive } from './useArchive.js'
import { useStill } from './useStill.js'

/**
 * The page in front of the station, printed as a poster.
 *
 * It is a separate document from the station itself (see landing.html) and it
 * knows nothing about a socket, a clock or a listener. That is why it keeps
 * working when the station behind it does not: it has to answer "what is this"
 * for somebody who cannot get in yet.
 *
 * Two things on it are true and the rest is an invented evening. The true ones
 * are the next announced session (`useNextSession`, an open read) and the
 * archive (`useArchive`, another). The running order, the wishes and the copy
 * describe a night the way it goes, and the running order says it is a sample,
 * because a list of records with times beside it otherwise reads as tonight.
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
  const next = useNextSession()

  return (
    <div className="poster">
      <Bar />
      <Ticker next={next} />
      <main>
        <Hero />
        <NextSession next={next} />
        <Tonight />
        <Creed />
        <Archive />
        <Asked />
        <Dj />
        <Limits />
        <Join next={next} />
      </main>
      <Foot />
      <TuneBar next={next} />
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
  { name: 'Tonight', link: '#tonight' },
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
 * the station's three promises. It never says "on air": this page cannot ask
 * the station whether it is, and a ticker shouting ON AIR over a dark room is
 * the page lying in its biggest type.
 *
 * The text is laid down twice and the track slides by exactly one copy, which
 * is what makes the loop seamless. Only the first copy is read aloud; the
 * second is there for the eye. Under reduced motion the track holds still and
 * reads as a printed band.
 */
function Ticker({ next }: { next: ScheduledSession | null }) {
  const still = useStill()
  const said = next
    ? ['Next session', nextSessionShort(next.startsAt, Date.now()), promiseOf(next), 'Same link as always']
    : ['One room', 'One clock', 'Everyone on the same second', 'No algorithm']
  const run = (
    <>
      {[...said, ...said].map((phrase, index) => (
        // The phrases repeat inside one copy, so the index is the identity.
        // biome-ignore lint/suspicious/noArrayIndexKey: see above
        <span className="ticker__phrase" key={index}>
          {phrase}
          <span className="ticker__star" aria-hidden="true">
            ✶
          </span>
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
          The room chooses the theme. I spend the day curating the story. When the broadcast
          begins, everyone hears the same song at the same moment.
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
 * An evening, as a running order.
 *
 * `BEEN_ON` is kept latest-first, the way the station's own history reads.
 * A running order goes the other way, so it is turned round here rather than
 * stored twice.
 *
 * It is labelled as a sample in the heading's kicker. A list of records with
 * times beside them, under the word "tonight", is otherwise a claim about
 * tonight that this page cannot make.
 */
const ORDER = [...BEEN_ON].sort((a, b) => a.at.localeCompare(b.at))

function Tonight() {
  return (
    <section className="band band--ink tonight" id="tonight">
      <div className="tonight__head">
        <p className="kicker kicker--paper">A sample evening</p>
        <h2 className="display tonight__title">
          <span>Tonight’s</span> <span>running order</span>
        </h2>
      </div>

      <ol className="order">
        {ORDER.map((play) => (
          <li className="order__row" key={`${play.at}-${play.title}`}>
            <span className="order__time">{play.at}</span>
            {play.cover ? (
              <img
                className="order__sleeve"
                src={play.cover.src}
                alt=""
                width={40}
                height={40}
                loading="lazy"
                decoding="async"
              />
            ) : (
              <span className="order__sleeve order__sleeve--none" aria-hidden="true" />
            )}
            <span className="order__title">{play.title}</span>
            <span className="order__artist">{play.artist}</span>
          </li>
        ))}
      </ol>

      <p className="tonight__note">
        One person chooses the records. No shuffle, no skipping. The real running order is on the
        station while it is on.
      </p>
    </section>
  )
}

/** The argument, in the biggest type on the page. */
function Creed() {
  return (
    <section className="band band--paper creed">
      <div className="creed__words">
        <h2 className="display creed__headline">One room. One clock. Same second.</h2>
        <p className="creed__body">
          Every browser tuned in lines itself up to the station’s own clock, so people in different
          countries are inside the same bar of the same record at the same instant. The words are on
          screen, a room is talking around them, and anyone can put a hand up for the mic.
        </p>
        <a className="button button--outline" href="/how-it-works">
          How that is done
        </a>
      </div>
      <Slot asset={ASSETS.stickers} className="creed__stickers" />
    </section>
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
          className="kept__cover"
          src={card.poster}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
        />
      ) : (
        <Slot asset={ASSETS.cover} className="kept__cover" />
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
 * The one photograph on the page that is of a real person, so it has a real
 * `alt` and is not a slot. It is printed like the rest of the poster (grey,
 * hard contrast, a little grain from the CSS) so it sits with the Midjourney
 * pictures rather than looking like the only photo from a different shoot.
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
        <img
          className="dj__face"
          src={ndamulelo}
          alt="Ndamulelo"
          width={880}
          height={1100}
          loading="lazy"
          decoding="async"
        />
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
        The station is on when somebody is running it. If it isn’t, the page will say so. Leave it
        open and it will come back on by itself, or listen to a night that already happened.
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
      <p className="foot__line">One link. One song. Everyone on the same second.</p>
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
function TuneBar({ next }: { next: ScheduledSession | null }) {
  return (
    <aside className="tunebar" aria-label="Tune in">
      <span className="tunebar__channel">chunky.fm</span>
      <span className="tunebar__status">
        {next
          ? `Next session · ${nextSessionShort(next.startsAt, Date.now())}`
          : 'On when somebody is running it'}
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
