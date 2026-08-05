import chatIcon from '../assets/icons/chat.svg'
import heartIcon from '../assets/icons/heart.svg'
import onAirIcon from '../assets/icons/on-air.svg'
import scheduleIcon from '../assets/icons/schedule.svg'
import slidersIcon from '../assets/icons/sliders.svg'
import { memo, useEffect, useRef } from 'react'
import { stationUrl } from '../lib/routes.js'
import { Deck, Waveform } from '../Turntable.js'
import { ContainerScroll } from './ContainerScroll.js'
import { DraggableCard, DraggableCardStage } from './DraggableCard.js'
import { GlareCard } from './GlareCard.js'
import { Globe } from './Globe.js'
import { GridPattern } from './GridPattern.js'
import { Gramophone } from './Gramophone.js'
import { ResizableNavbar } from './ResizableNavbar.js'
import { SquigglyText } from './SquigglyText.js'
import { InfiniteMovingCards } from './InfiniteMovingCards.js'
import { StickyScroll } from './StickyScroll.js'
import {
  BEEN_ON,
  clock,
  initial,
  ROOM,
  saidBy,
  SESSION,
  SKIPS,
  SLEEVES,
  through,
  WISHES,
} from './session.js'
import { useOneByOne } from './useOneByOne.js'
import { useScrubbedSession } from './useScrubbedSession.js'

/**
 * The page in front of the station.
 *
 * It is a separate document from the station itself — see landing.html — and it
 * knows nothing about a socket, a clock or a listener. Everything on it is
 * fixed, so it renders the same whether the station is on the air, off it, or
 * not deployed yet. That is the point: it has to answer "what is this" for
 * somebody who cannot get in, and a page that needed the station to be up in
 * order to describe the station would be down exactly when it was needed.
 *
 * It is arranged as one question at a time — what is this, why does it exist,
 * how does it work, what is it not, who is running it — because a visitor who
 * has to hold six ideas at once puts the page down. The philosophy is meant to
 * arrive by the end rather than in the first screen.
 *
 * The one thing it does not invent is the design. The deck and the level meter
 * here are the station's own components imported unchanged, and every colour
 * comes from tokens.css — so what a visitor sees before tuning in is the thing
 * they get afterwards, not an artist's impression of it.
 *
 * And one thing it does that a page of prose could not: the whole document is
 * scrubbed through a song. See `useScrubbedSession`. By the time somebody
 * reaches the bottom they have moved through five and a half minutes with a
 * room talking around them, which is the product, felt rather than described.
 */
export function Landing() {
  const at = useScrubbedSession(SESSION.duration)

  return (
    <div className="landing">
      {/* One bar that is both: full width at the top of the page, and a floating
          pill once you have started reading. See ResizableNavbar. */}
      <ResizableNavbar items={NAV} action={TUNE_IN_ACTION} aside={DECKS_ASIDE} brand={WORDMARK} />
      <main>
        <Hero />
        <Moment />
        <Why />
        <Works />
        <Room at={at} />
        <Wishes />
        <Live />
        <BeenOn />
        <Dj />
        <Yours />
        <Limits />
        <Call />
      </main>
      <Foot />
      <SessionBar at={at} />
    </div>
  )
}

/** The two ways off this page, named once — see STATION_PATH in lib/routes.ts. */
const TUNE_IN = stationUrl()
const DECKS = stationUrl('admin')

/** Where the bar can take you. The same three the foot repeats. */
const NAV = [
  { name: 'The room', link: '#room' },
  { name: 'What has been on', link: '#been-on' },
  { name: 'The DJ', link: '#dj' },
]

/**
 * The station's name, and the bar's other two props.
 *
 * Built once at the module rather than per render. `Landing` re-renders on every
 * scroll frame — the playhead moves — and a fresh object literal here would
 * re-render the bar with it, throwing away the spring it is in the middle of.
 */
const WORDMARK = (
  <p className="wordmark navbar__brand">
    chunky<span className="wordmark__tld">.fm</span>
  </p>
)
const TUNE_IN_ACTION = { name: 'Tune in', link: TUNE_IN }
const DECKS_ASIDE = {
  name: 'Run the decks',
  link: DECKS,
  icon: <img src={slidersIcon} alt="" width={16} height={16} />,
}

/**
 * The top of the page.
 *
 * One sentence, one paragraph, one thing to press. Everything else that could
 * go here is somewhere below it, and the reason it is almost empty is that the
 * job of this screen is not to explain the station — it is to make somebody
 * want to hear it, and then to get out of the way.
 *
 * The gramophone behind the words is inside `aria-hidden` and is not a report on
 * anything: it turns because a gramophone turns, on a page with no station
 * behind it to ask. Shown as an object, in the place a reader takes as a
 * picture, it is honest; shown as a live instrument it would be claiming
 * something the page cannot know. See `Gramophone` — until the model arrives,
 * and forever on a machine that cannot draw it, this is the flat deck instead.
 */
const Hero = memo(function Hero() {
  return (
    <section className="hero">
      <div className="hero__stage" aria-hidden="true">
        <Gramophone />
      </div>

      <div className="hero__copy">
        <h1 className="hero__headline">Music wasn’t meant to be heard alone.</h1>
        <p className="hero__blurb">
          A live radio station where everyone hears the same second of the same song, chosen by one
          person on the decks.
        </p>
        <a className="button button--large" href={TUNE_IN}>
          Tune in
        </a>
      </div>

      <a className="hero__onward" href="#moment" aria-label="What it is">
        <span aria-hidden="true">scroll</span>
        <span className="hero__arrow" aria-hidden="true" />
      </a>
    </section>
  )
})

/**
 * The product, in five seconds.
 *
 * Before any explanation, because the thing is easier to see than to describe:
 * a globe with every listener's arc landing on the one station, the sentence
 * beside it, under them the evening's records in a pile across the whole width,
 * and under those the level meter. The pile gets the whole width because there
 * are nine records — four sat in a column beside the sentence, and nine want a
 * table.
 *
 * They can be picked up and thrown — see DraggableCard, a port of Aceternity
 * UI's. Which is not decoration: the argument of this whole page is that a
 * station is a person putting records on rather than a queue running, and a
 * pile of sleeves you can shove around says that in a way a rectangle with a
 * progress bar in it does not.
 *
 * Every sleeve is the same sleeve. The one that is on is the one at the front
 * of the pile and nothing else — no badge on it, no clock, no head count. It is
 * a record, and a record does not report anything; the LIVE mark beside the
 * sentence and the bar along the bottom of the page are where this page says
 * what is happening, and saying it three times would be the pile pretending to
 * be an interface rather than a stack of records on a table.
 *
 * The records are `SLEEVES`, the same evening the list further down draws.
 */

/**
 * Where each sleeve lies on the table, and how far it is turned.
 *
 * By hand rather than at random: a random scatter has to be re-rolled until it
 * looks like a pile, and this one is the roll that did. Newest first, so the
 * record that is on is the one on top and nearest the middle, with the rest of
 * the evening spread out under it — which is the only thing on the page that
 * says which one is playing.
 *
 * Positions are percentages of the table rather than pixels, so the whole
 * arrangement holds its shape from a phone to a wide monitor instead of being
 * three separate scatters in three media queries.
 *
 * Falls back to square-on rather than to nothing, so a tenth sleeve added to the
 * evening lands on the table instead of at a rotation of `undefined`.
 */
const SQUARE_ON = { top: '22%', left: '40%', turn: 0, z: 1 }
const PILE = [
  { top: '22%', left: '37%', turn: -3, z: 9 },
  { top: '2%', left: '20%', turn: -8, z: 8 },
  { top: '6%', left: '52%', turn: 6, z: 7 },
  { top: '48%', left: '44%', turn: 4, z: 6 },
  { top: '44%', left: '24%', turn: -6, z: 5 },
  { top: '4%', left: '70%', turn: 9, z: 4 },
  { top: '50%', left: '64%', turn: -4, z: 3 },
  { top: '0%', left: '2%', turn: 5, z: 2 },
  { top: '50%', left: '5%', turn: -9, z: 1 },
]

const Moment = memo(function Moment() {
  // Drag on a touch screen swallows the gesture that started on it, and a pile
  // covering half a column would be a pile that stops the page scrolling under
  // a thumb. On a phone it is a pile of records to look at.
  const canDrag =
    typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches

  return (
    <section className="moment" id="moment">
      <div className="moment__top">
        {/* Twelve listeners, one station, and every arc landing on it. See
            Globe — nothing arrives until the page is readable, and on a machine
            that cannot draw it the sentence stands on its own. */}
        <Globe />

        <div className="moment__said">
          <p className="moment__lead">Everyone is hearing this exact moment.</p>
          <ul className="moment__nots">
            <li>No skips.</li>
            <li>No shuffle.</li>
            <li>No algorithm.</li>
          </ul>
          <p className="moment__tail">
            One room, one song, one instant. Arrive at 2:43 and you arrive at 2:43 — not near it,
            not a few seconds behind it.
          </p>
        </div>
      </div>

      {/* The flag is on the stage rather than each card so the CSS can drop the
          grab cursor for the whole pile in one rule. */}
      <DraggableCardStage className="pile" dragEnabled={canDrag}>
        {SLEEVES.map((play, index) => {
          const where = PILE[index] ?? SQUARE_ON
          return (
            <DraggableCard
              key={play.title}
              className="sleeve"
              dragEnabled={canDrag}
              style={{ top: where.top, left: where.left, zIndex: where.z, rotate: where.turn }}
            >
              <img
                className="sleeve__art"
                src={play.cover.src}
                alt={`${play.cover.album} by ${play.artist}`}
                width={640}
                height={640}
                draggable={false}
                // The one on top is above the fold and is the first thing to
                // draw; the three under it can wait their turn.
                loading={index === 0 ? 'eager' : 'lazy'}
              />
              <p className="sleeve__what">
                <span className="sleeve__album">{play.cover.album}</span>
                <span className="sleeve__artist">{play.artist}</span>
              </p>
            </DraggableCard>
          )
        })}
      </DraggableCardStage>

      {/* The station's own level meter, centred under the table.
          Inside `aria-hidden` like every other instrument on this page: it moves
          because the page says sound is coming out, not because any is. */}
      <div className="moment__levels" aria-hidden="true">
        <Waveform live />
      </div>
    </section>
  )
})

/**
 * Why it exists.
 *
 * The only section on the page with no interface in it, and no numbers. It is
 * also the only one making an argument rather than a description, so it is set
 * large and given a screen to itself.
 */
const Why = memo(function Why() {
  return (
    <section className="why">
      {/* One word wriggles, and it is the right one: the sentence is about a
          thing that will not hold still or stop, and `infinite` is where that
          lands. Squiggling the whole line would just be a wobbly headline. */}
      <p className="why__line">
        Music is <SquigglyText>infinite</SquigglyText> now.
      </p>
      <p className="why__line why__line--quiet">
        Millions of songs. Millions of playlists. A recommendation for every mood you have ever
        had, and several you haven’t.
      </p>
      <p className="why__line why__line--quiet">And almost none of it is heard with anyone.</p>
      <p className="why__turn">chunky.fm puts the room back.</p>
    </section>
  )
})

/**
 * How an evening actually runs.
 *
 * Six steps, in order, as a row you read across — the format the brief called
 * for, pointed at what the station really does. Every one of these is a thing in
 * the codebase: the library is uploads, the tuple is what the socket publishes,
 * the wishes are free text, the tally is the skip vote, the evening is `plays`.
 */
const WORKS = [
  {
    title: 'A record goes on',
    body: 'One person, at the decks, choosing. Nothing auto-DJs and nothing fills a gap with filler.',
  },
  {
    title: 'The station says where it is',
    body: 'Not a stream — one fact: the track, and the instant it was at 0:00.',
  },
  {
    title: 'Every page puts itself there',
    body: 'Your browser works out where the needle should be and goes there. Joining at 2:14 runs the same code as joining at the start.',
  },
  {
    title: 'It stays there',
    body: 'Clocks drift over an evening. The correction is a two per cent nudge in playback rate, which nobody hears.',
  },
  {
    title: 'The room asks',
    body: 'No library to browse, nothing to queue yourself. You write a sentence, and it lands on the decks beside everyone else’s.',
  },
  {
    title: 'The evening is written down',
    body: 'What has been on, in order, so somebody arriving at eleven can see what they missed.',
  },
]

const Works = memo(function Works() {
  return (
    <section className="works">
      <h2 className="section__title">How an evening runs</h2>
      {/* The six of them, going past forever. Slow, because they are six steps
          to be read rather than a row of logos — and paused the moment a pointer,
          a finger or a keyboard lands on one, which is the only way a card that
          reveals itself on hover can be looked at at all. */}
      <InfiniteMovingCards
        className="works__row"
        speed="slow"
        items={WORKS.map((step, index) => ({
          key: step.title,
          node: (
            <GlareCard>
              <span className="step__n" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <h3 className="step__title">{step.title}</h3>
              <p className="step__body">{step.body}</p>
            </GlareCard>
          ),
        }))}
      />
    </section>
  )
})

/**
 * The room, talking — and the one section that moves.
 *
 * The lines arrive as the page's playhead reaches them, so a reader who has
 * scrolled this far is somewhere in particular in a song and the room is
 * somewhere in particular with them. That is the entire product in one panel,
 * and it is doing it rather than saying it.
 *
 * Every line is in the DOM from the first render and only its appearance is
 * withheld, so a screen reader gets the conversation whole rather than a
 * transcript that depends on how far somebody scrolled. The playhead chip is
 * `aria-hidden` for the same reason the bar at the bottom is: it is a picture of
 * a clock, not a clock.
 *
 * The three of them are a `StickyScroll`, so what is beside the words changes as
 * you read down them: a name, then the room talking, then the room disagreeing.
 */
function Room({ at }: { at: number }) {
  return (
    <section className="room" id="room">
      <div className="section__head">
        <span className="section__mark" aria-hidden="true">
          <img src={chatIcon} alt="" width={18} height={18} />
        </span>
        <h2 className="section__title">And the room around it</h2>
      </div>

      <StickyScroll
        className="room__reveal"
        items={[
          {
            title: 'Just a nickname',
            description: (
              <p>
                No account, no profile, nothing kept once the tab closes. You type what everyone
                should call you, you press one thing, and you are in the room.
              </p>
            ),
            panel: <JoinPanel />,
          },
          {
            title: 'The room, talking',
            description: (
              <>
                <p>
                  Everything anyone says lands at the same point in the song for everyone, because
                  there is only one point in the song.
                </p>
                <p>
                  Which you can watch happen. That conversation is arriving as you scroll the page,
                  each line at the second of the record it was said at — and some of it had already
                  been said when you got here, which is what walking into a station mid-song is
                  like.
                </p>
              </>
            ),
            panel: <TalkPanel at={at} />,
          },
          {
            title: 'And it can disagree',
            description: (
              <p>
                When the room would rather hear something else it can say so. It arrives on the
                decks as a tally rather than as a veto — whoever is running the station still
                decides, which is the whole point of there being somebody running it.
              </p>
            ),
            panel: <SkipPanel />,
          },
        ]}
      />
    </section>
  )
}

/** What joining looks like: a name, and one thing to press. */
const JoinPanel = memo(function JoinPanel() {
  return (
    <div className="panel panel--join" aria-hidden="true">
      <p className="panel__label">What should everyone call you?</p>
      <p className="panel__field">thandi</p>
      <span className="button button--large panel__go">Tune in</span>
      <p className="panel__note">Nothing else is asked for, and nothing is kept.</p>
    </div>
  )
})

/**
 * The conversation, filling as the page's playhead advances.
 *
 * Mounted for as long as the section is, whichever item is active — see the
 * note in StickyScroll about not unmounting the panels. A conversation that
 * started again every time somebody scrolled past it would not be one.
 */
function TalkPanel({ at }: { at: number }) {
  /*
   * Due, and then said.
   *
   * The playhead says how many lines have been reached; `useOneByOne` lets them
   * land one at a time. Arriving here with the record already at 2:13 makes five
   * of them due in the same frame, and five bubbles appearing together is a
   * transcript rather than a conversation.
   */
  const due = saidBy(ROOM, at).length
  const shown = useOneByOne(due)
  const lines = useRef<HTMLOListElement>(null)

  /*
   * Follow the conversation down, the way a chat window does.
   *
   * In bubbles the nine lines are taller than the panel, so without this the one
   * that just arrived lands below the fold and the whole effect happens where
   * nobody can see it. Keyed on how many have been said rather than on the
   * playhead, so it only moves when there is actually something new — a panel
   * that re-scrolled every second of the song would fight anyone reading back
   * through it.
   *
   * Watching the rows rather than waiting a fixed time. A line arrives by
   * opening from `0fr` to `1fr`, so at the moment a new one is said the row is
   * still flat and `scrollHeight` does not include it yet — scrolling to the
   * bottom lands at a bottom that has not happened. A timer set to the length of
   * that transition works until somebody changes it in the stylesheet. A
   * `ResizeObserver` on the rows fires when they have actually finished opening,
   * whatever the CSS says, and costs nine observations.
   */
  useEffect(() => {
    const box = lines.current
    if (!box) return

    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const toBottom = () =>
      box.scrollTo({ top: box.scrollHeight, behavior: still ? 'auto' : 'smooth' })

    const watcher = new ResizeObserver(toBottom)
    for (const row of box.children) watcher.observe(row)
    toBottom()

    return () => watcher.disconnect()
  }, [])

  return (
    <div className="talk">
      <div className="talk__top">
        <span className="talk__where" aria-hidden="true">
          {clock(at)}
        </span>
        <span className="talk__of">{SESSION.title}</span>
      </div>

      <ol className="talk__lines" ref={lines}>
        {ROOM.map((line, index) => {
          // Two in a row from the same person is one person still talking, so
          // the second does not get their name and face again.
          const same = ROOM[index - 1]?.who === line.who
          return (
            <li className="line" key={line.at} data-said={index < shown ? 'true' : 'false'}>
              {/* The wrapper collapses to nothing rather than the line being
                  removed, so the panel fills like a chat window instead of
                  standing half empty from the start — and the conversation is
                  still whole in the DOM for anything not reading it by eye. */}
              <span className="line__inner" data-run={same ? 'true' : 'false'}>
                <span className="line__face" aria-hidden="true">
                  {same ? '' : initial(line.who)}
                </span>
                <span className="line__bubble">
                  {same ? null : (
                    <span className="line__top">
                      <span className="line__who">{line.who}</span>
                      <span className="line__at" aria-hidden="true">
                        {clock(line.at)}
                      </span>
                    </span>
                  )}
                  <span className="line__says">{line.says}</span>
                </span>
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** The skip tally. A count out of the room, not a verdict. */
const SkipPanel = memo(function SkipPanel() {
  return (
    <div className="panel panel--skip" aria-hidden="true">
      <p className="panel__label">Skip this one?</p>
      <p className="panel__tally">
        {SKIPS.votes}
        <span className="panel__of">/ {SKIPS.of}</span>
      </p>
      <div className="panel__meter">
        <span
          className="panel__fill"
          style={{ width: `${(SKIPS.votes / SKIPS.of) * 100}%` }}
        />
      </div>
      <p className="panel__note">
        {SKIPS.voted ? 'You have voted. ' : ''}It is a tally, not a veto.
      </p>
    </div>
  )
})

/**
 * What the room asks for.
 *
 * The section that would be genres on any other music page, and is not one here.
 * These are wishes — free text, straight to whoever is on the decks — and shown
 * as themselves because the shape of the sentences *is* the argument: nobody
 * types "indie folk, 1970s" into a box like this.
 *
 * The whole wall sits inside a `ContainerScroll`, so it is a panel being stood
 * up in front of the reader as they arrive at it rather than another block
 * scrolling past. It is the one centred thing on a left-aligned page, which is
 * the Aceternity pattern and is also why it reads as a moment rather than a
 * section: the wishes are the most surprising thing the station does, and this
 * is the page stopping to show them.
 */
const Wishes = memo(function Wishes() {
  return (
    <section className="wishes">
      <ContainerScroll
        title={
          <>
            <div className="section__head section__head--mid">
              <span className="section__mark" aria-hidden="true">
                <img src={heartIcon} alt="" width={18} height={18} />
              </span>
              <h2 className="section__title">What the room asks for</h2>
            </div>
            <p className="section__lede section__lede--mid">
              Not a genre, not a search box, not a queue. A sentence — and then a person deciding
              what to do about it.
            </p>
          </>
        }
      >
        <WishWall />

        <p className="section__body wishes__after">
          Yours are marked, so you can see what became of them. Some of them never get played, which
          is what it means for there to be somebody on the other end rather than a queue.
        </p>
      </ContainerScroll>
    </section>
  )
})

/**
 * The wall.
 *
 * The card is the one out of Aceternity UI's features section: a surface that
 * grades from the panel colour down into the sheet, a large radius, and a
 * suggestion of graph paper in the upper-left corner — see `GridPattern`.
 *
 * The wishes are simply on it. An earlier pass had them hidden until each card
 * was pointed at, which is a good effect and the wrong one here: these four
 * sentences *are* the section's argument, and a wall that says nothing until you
 * touch it says nothing at all on a phone.
 */
function WishWall() {
  return (
    <ul className="wishes__wall">
      {WISHES.map((wish, index) => (
        <li className="wish" key={wish.says} data-state={wish.state}>
          <GridPattern seed={index + 1} />
          <p className="wish__says">“{wish.says}”</p>
          <p className="wish__state">{wish.state === 'played' ? 'played' : 'still waiting'}</p>
        </li>
      ))}
    </ul>
  )
}

/**
 * Why it has to be live.
 *
 * The question every page like this forgets: what stops me just playing the same
 * songs tomorrow. The answer is not a feature, so this section has no cards in
 * it — and the honest half of the answer is the second paragraph, which is that
 * the station is often not on.
 */
const Live = memo(function Live() {
  return (
    <section className="live">
      <div className="section__head">
        <span className="section__mark" aria-hidden="true">
          <img src={onAirIcon} alt="" width={18} height={18} />
        </span>
        <h2 className="section__title">Why it has to be live</h2>
      </div>

      <p className="live__ask">“Why can’t I just play these songs myself tomorrow?”</p>
      <p className="section__lede">
        You can. You would hear the same notes and none of the evening — nobody going quiet at the
        same moment as you, nobody asking for the next one, nothing at stake in a song ending.
        Playing a record is not the thing. Being in the room while it plays is the thing.
      </p>
      <p className="section__body">
        Which is also why it is not always on. The station is on because somebody started it and
        off because they ended it, and when the decks stop the record on every listener’s page
        stops with them. <em>Off air</em> is a state this page is willing to admit to — you may
        well arrive and find nothing playing, and it will say so rather than pretending.
      </p>
    </section>
  )
})

/**
 * The evening so far.
 *
 * Deliberately not billed as an archive. The station keeps this for as long as
 * it is up and no longer — it is what a person arriving at eleven scrolls to
 * see, not a back catalogue — and the note under the grid says so, because a
 * page implying there are past sessions to browse would be selling one.
 */
const BeenOn = memo(function BeenOn() {
  return (
    <section className="been" id="been-on">
      <div className="section__head">
        <span className="section__mark" aria-hidden="true">
          <img src={scheduleIcon} alt="" width={18} height={18} />
        </span>
        <h2 className="section__title">What has been on</h2>
      </div>
      <p className="section__lede">
        Arrive at eleven and the evening is still there to read backwards.
      </p>

      <ol className="been__list">
        {BEEN_ON.map((play, index) => (
          <li className="play" key={play.at} data-now={index === 0 ? 'true' : 'false'}>
            <span className="play__at">{play.at}</span>
            <span className="play__what">
              <span className="play__title">{play.title}</span>
              <span className="play__artist">{play.artist}</span>
            </span>
            {index === 0 ? <span className="play__mark">on now</span> : null}
          </li>
        ))}
      </ol>

      <p className="section__body">
        This is the evening, not an archive. It lasts as long as the station is up — there is no
        back catalogue to browse, and nothing here is kept with your name on it.
      </p>
    </section>
  )
})

/**
 * Whoever is on the decks.
 *
 * Last but one, and not a word earlier: by the time somebody reaches this they
 * have already decided whether they want the thing, and a person introducing
 * themselves before that is asking for trust they have not been given yet.
 *
 * These are Ndamulelo's own lines, kept as written and broken where they were
 * written — one thought a line, the shortest first. Do not run them together
 * into paragraphs. It is the only section on the page in a voice that is not the
 * product's, and the whole reason it works is that it sounds like a person
 * rather than like the rest of the page.
 */
const DJ = [
  'Hi.',
  'I’m Ndamulelo.',
  'I don’t believe music is something to consume.',
  'I think it’s something to understand.',
  'Every session begins with a question.',
  'Then I spend hours finding songs that answer it.',
]

const Dj = memo(function Dj() {
  return (
    <section className="dj" id="dj">
      <div className="dj__mark" aria-hidden="true">
        <Deck artwork={null} spinning={false} />
      </div>
      <div className="dj__words">
        {DJ.map((line, index) => (
          // Position is the identity: these are the lines of one short
          // statement in order, not a list of anything that can be reordered.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          <p className="dj__line" key={index}>
            {line}
          </p>
        ))}
      </div>
    </section>
  )
})

/**
 * And it is yours if you want it.
 *
 * The software, kept to one quiet section near the bottom. It is true and it
 * matters to some readers, but it is not the reason anybody stayed on the page —
 * a stranger who came to hear a station does not want a docker-compose file in
 * the third screen.
 */
const Yours = memo(function Yours() {
  return (
    <section className="yours">
      <div className="section__head">
        <span className="section__mark" aria-hidden="true">
          <img src={slidersIcon} alt="" width={18} height={18} />
        </span>
        <h2 className="section__title">And it is yours, if you want one</h2>
      </div>

      <div className="yours__split">
        <div className="yours__prose">
          <p className="section__body">
            chunky.fm is a station you can also run. The whole thing comes up from one command, and
            it is two containers rather than three — the database is a SQLite file the server opens
            itself, sitting on the same volume as the audio. Nothing to sign up for, no third party
            in the path.
          </p>
          <p className="section__body">
            A station can be open to anyone with the link, or private, in which case the link
            carries an invite key, the browser trades it for a cookie once, and the key comes
            straight back out of the address bar.
          </p>
        </div>

        <pre className="snippet snippet--block">
          <code>
            <span className="snippet__prompt">$</span> ./start.sh{'\n'}
            {'\n'}
            <span className="snippet__quiet">building web, server…{'\n'}</span>
            <span className="snippet__quiet">the station is up:{'\n'}</span>
            <span className="snippet__quiet">  listen  http://localhost:18173/listen{'\n'}</span>
            <span className="snippet__quiet">  decks   http://localhost:18173/listen#admin</span>
          </code>
        </pre>
      </div>
    </section>
  )
})

/**
 * What it is not.
 *
 * Kept on the page rather than left for somebody to discover after an evening of
 * setting it up. Every line here is a decision in PLAN.md, and a landing page
 * that hid them would just be selling a different product.
 */
const LIMITS = [
  ['Around thirty listeners', 'not thirty thousand — playback state lives in one process on purpose.'],
  ['One station', 'one permanent link. There are no rooms and no channels to pick between.'],
  ['No listener uploads', 'the library is mine. The room asks; I decide.'],
  ['No accounts', 'a nickname in localStorage, and nothing on a server with your name on it.'],
  ['No schedule', 'it is on when it is on. There is no calendar and nothing to be notified about.'],
  ['No back catalogue', 'the evening is kept while the station is up, and not after.'],
]

const Limits = memo(function Limits() {
  return (
    <section className="limits">
      <h2 className="limits__title">What it deliberately is not</h2>
      <dl className="limits__list">
        {LIMITS.map(([head, tail]) => (
          <div className="limits__item" key={head}>
            <dt className="limits__head">{head}</dt>
            <dd className="limits__tail">{tail}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
})

/** The last thing on the page, and the only thing on its screen. */
const Call = memo(function Call() {
  return (
    <section className="call">
      <h2 className="call__headline">Join the room.</h2>
      <a className="button button--large" href={TUNE_IN}>
        Tune in
      </a>
      <p className="call__note">
        The station is on when somebody is running it. If it isn’t, the page will say so — leave it
        open and it will come back on by itself.
      </p>
    </section>
  )
})

const Foot = memo(function Foot() {
  return (
    <footer className="foot">
      <p className="wordmark">
        chunky<span className="wordmark__tld">.fm</span>
      </p>
      <p className="foot__line">One link. One song. Everyone on the same second.</p>
      <nav className="foot__ways">
        <a className="foot__way" href={TUNE_IN}>
          Tune in
        </a>
        <a className="foot__way" href="#room">
          The room
        </a>
        <a className="foot__way" href="#dj">
          The DJ
        </a>
        <a className="foot__way" href={DECKS}>
          Run the decks
        </a>
      </nav>
    </footer>
  )
})

/**
 * The bar along the bottom, playing the page.
 *
 * The signature of the whole document: a slim player whose clock advances as you
 * scroll, so by the end a reader has moved through a song rather than read about
 * one. It drives the room section above from the same number.
 *
 * Two things keep it honest. It is `aria-hidden`, like every other instrument on
 * this page, because it is a picture of a player and not a player. And it says
 * *sample session* in words, next to the LIVE badge — a red dot on this site
 * means "on the air right now" everywhere else it appears, and a bar that
 * borrowed that meaning to advertise with would be the one thing on the page
 * actively lying.
 *
 * It stays out of the way until the hero has been read: the first screen has one
 * thing to press on it, and a bar sliding in under the fold would be a second.
 */
function SessionBar({ at }: { at: number }) {
  return (
    <div className="bar" data-shown={at > 3 ? 'true' : 'false'} aria-hidden="true">
      <div className="bar__inner">
        <span className="bar__badge">
          <span className="bar__dot" />
          LIVE
        </span>
        <span className="bar__sample">sample session — scrubbing as you scroll</span>

        <span className="bar__what">
          <span className="bar__title">{SESSION.title}</span>
          <span className="bar__artist">{SESSION.artist}</span>
        </span>

        <span className="bar__clock">{clock(at)}</span>
        <span className="bar__track">
          <span className="bar__fill" style={{ width: `${through(at, SESSION.duration) * 100}%` }} />
        </span>
        <span className="bar__clock bar__clock--total">{clock(SESSION.duration)}</span>
      </div>
    </div>
  )
}
