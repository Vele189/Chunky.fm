import ndamulelo from '../assets/ndamulelo.webp'
import slidersIcon from '../assets/icons/sliders.svg'
import { memo, useEffect, useRef, useState } from 'react'
import { PODCAST_PATH } from '../lib/episodes.js'
import { kindPromise } from '../lib/kind.js'
import { stationUrl } from '../lib/routes.js'
import { Waveform } from '../Turntable.js'
import { CardPanel, Carousel } from './AppleCardsCarousel.js'
import { BackgroundLines } from './BackgroundLines.js'
import { BentoCell, BentoGrid } from './BentoGrid.js'
import { ContainerScroll } from './ContainerScroll.js'
import { DraggableCard, DraggableCardStage } from './DraggableCard.js'
import { FeyCards } from './FeyCards.js'
import { FlipWords } from './FlipWords.js'
import { FlipBoard } from './FlipBoard.js'
import { Globe } from './Globe.js'
import { Gramophone } from './Gramophone.js'
import { ResizableNavbar } from './ResizableNavbar.js'
import { Spotlight } from './Spotlight.js'
import { SquigglyText } from './SquigglyText.js'
import { TracingBeam } from './TracingBeam.js'
import { ListenerView } from './ListenerView.js'
import { NextSession } from './NextSession.js'
import { MacbookScroll } from './MacbookScroll.js'
import { MovingColumns } from './MovingColumns.js'
import {
  BEEN_ON,
  clock,
  initial,
  ROOM,
  saidBy,
  SESSION,
  SHEET,
  SLEEVES,
  WISHES,
} from './session.js'
import { type ArchiveCard, useArchive } from './useArchive.js'
import { useOnScreen } from './useOnScreen.js'
import { useStill } from './useStill.js'

/**
 * The page in front of the station.
 *
 * It is a separate document from the station itself (see landing.html) and it
 * knows nothing about a socket, a clock or a listener. Everything on it is
 * fixed, so it renders the same whether the station is on the air, off it, or
 * not deployed yet. That is the point: it has to answer "what is this" for
 * somebody who cannot get in, and a page that needed the station to be up in
 * order to describe the station would be down exactly when it was needed.
 *
 * It is arranged as one question at a time (what is this, why does it exist,
 * how does it work, what else is it, what is it not, who is running it) because
 * a visitor who has to hold six ideas at once puts the page down. The philosophy
 * is meant to arrive by the end rather than in the first screen.
 *
 * The one thing it does not invent is the design. The deck and the level meter
 * here are the station's own components imported unchanged, and every colour
 * comes from tokens.css, so what a visitor sees before tuning in is the thing
 * they get afterwards, not an artist's impression of it.
 *
 * Nothing on it is driven by the scroll any more, and that is a change worth
 * knowing about. The whole document used to be scrubbed through a song: the
 * top of the page was 0:00, the bottom was the last bar, and a chat panel and a
 * transcript filled as you read them. Both of those sections have gone, and
 * what replaced the first of them — the room and the sheet in the session grid
 * — runs on a loop of its own, because a record plays whether or not anybody is
 * reading. So the page has one clock, it is in `Inside`, and scrolling is
 * scrolling.
 */
export function Landing() {
  return (
    <div className="landing">
      {/* One bar that is both: full width at the top of the page, and a floating
          pill once you have started reading. See ResizableNavbar. */}
      <ResizableNavbar items={NAV} action={TUNE_IN_ACTION} aside={DECKS_ASIDE} brand={WORDMARK} />
      <main>
        <Hero />
        {/* The one true thing on this page, and only when there is one. See
            NextSession: everything else here is an invented evening, because
            the page in front of the station cannot ask it anything. This can,
            because a poster is for the people who have not been let in. */}
        <NextSession />
        <Moment />
        <Creed />
        {/* One section where there were two. See `Inside`: `Works` was the
            five steps of an evening and `Guide` was a feature nobody built, and
            what replaced both is the screen a listener actually gets. */}
        <Inside />
        <Talks />
        {/* Straight after the conversations, because it is what becomes of
            them. See `Archive`. */}
        <Archive />
        <Wishes />
        <BeenOn />
        <Dj />
        <Limits />
        <Call />
      </main>
      <Foot />
    </div>
  )
}

/**
 * The ways off this page, named once. See STATION_PATH in lib/routes.ts and
 * PODCAST_PATH in lib/episodes.ts.
 *
 * The archive is the one of the three that is worth something when the station
 * is dark. `TUNE_IN` on an evening with nobody on the decks lands on a page
 * that says so, and the visitor who read this far has nothing to do about it;
 * the podcast is nights that already happened, so it is the destination that
 * always has something behind it. That is why it is in the bar and in the foot
 * rather than only mentioned in the prose.
 */
const TUNE_IN = stationUrl()
const DECKS = stationUrl('admin')
const PODCAST = PODCAST_PATH

/**
 * Where the bar can take you, and all but one of them again in the foot.
 *
 * Four fragments and one address. The fragments are in the order the sections
 * are in, and the podcast is last because it is the only one that leaves: a
 * link that unloads the document sitting between two that scroll it would be
 * the odd one out in the middle of the row rather than at the end of it.
 *
 * Adding this fifth one moved a number in landing.css. See the note on
 * `.navbar__body[data-shrunk='true']`: the pill's floor is measured against the
 * words that are actually in it, and a link added here without moving it puts
 * the first one back on top of the wordmark.
 */
const NAV = [
  { name: 'Conversations', link: '#talks' },
  { name: 'What has been on', link: '#been-on' },
  { name: 'The DJ', link: '#dj' },
  { name: 'The podcast', link: PODCAST },
]

/**
 * The station's name, and the bar's other two props.
 *
 * Built once at the module rather than per render. `Landing` re-renders on every
 * scroll frame (the playhead moves) and a fresh object literal here would
 * re-render the bar with it, throwing away the spring it is in the middle of.
 */
const WORDMARK = (
  <p className="wordmark navbar__brand">
    chunky<span className="wordmark__tld">.fm</span>
  </p>
)
/**
 * The two kinds of night, as the station itself promises them.
 *
 * Built from `kindPromise` rather than written out, so the words on the page in
 * front of the station are the words on the poster and in the console. The
 * order is records first because that is what most evenings are and what
 * somebody arriving already half expects; the surprise goes second.
 *
 * Lowercased and given a full stop, which is a rendering decision rather than a
 * different vocabulary: `kindPromise` writes what a poster says, and a poster
 * says it at the start of a line. Here the same words are the end of a
 * sentence.
 *
 * The full stop is **inside** the flipped word on purpose. The box reserves the
 * width of the longer night so the line never reflows (see FlipWords), which
 * means anything after it sits at the far edge of that box whichever night is
 * showing — a comma stranded a centimetre out in the open on the shorter one.
 * With the punctuation carried by the word and nothing after it, the reserved
 * space is trailing whitespace at the end of a line, which is invisible.
 */
const NIGHTS = (['set', 'talk'] as const).map((kind) => {
  const said = kindPromise(kind)
  return `${said[0]?.toLowerCase() ?? ''}${said.slice(1)}.`
})

const TUNE_IN_ACTION = { name: 'Tune in', link: TUNE_IN }
const DECKS_ASIDE = {
  name: 'Run the decks',
  link: DECKS,
  icon: <img src={slidersIcon} alt="" width={16} height={16} />,
}

/**
 * The top of the page.
 *
 * A claim, the line that backs it, a paragraph, and one thing to press.
 * Everything else that could go here is somewhere below it, and the reason it is
 * almost empty is that the job of this screen is not to explain the station: it
 * is to make somebody want to hear it, and then to get out of the way.
 *
 * The claim is about the alternative rather than about loneliness. "Music wasn't
 * meant to be heard alone" named a feeling the visitor may not have; an
 * algorithm is the thing they are actually being offered everywhere else, and
 * this is the page saying what it is instead of that. What follows is the DJ's
 * own sentence (the same one the section at the bottom of the page opens with,
 * said twice on purpose) and then the mechanism, in the order it happens: the
 * room asks, somebody spends the day on it, and then everybody is in the same
 * second of it together.
 *
 * The gramophone behind the words is inside `aria-hidden` and is not a report on
 * anything: it turns because a gramophone turns, on a page with no station
 * behind it to ask. Shown as an object, in the place a reader takes as a
 * picture, it is honest; shown as a live instrument it would be claiming
 * something the page cannot know. See `Gramophone`: until the model arrives,
 * and forever on a machine that cannot draw it, this is the flat deck instead.
 */
const Hero = memo(function Hero() {
  const stage = useRef<HTMLElement>(null)
  const near = useOnScreen(stage)
  const still = useStill()

  return (
    <section className="hero" ref={stage}>
      <div className="hero__stage" aria-hidden="true">
        <Gramophone />
      </div>

      <div className="hero__copy">
        <h1 className="hero__headline">Music deserves more than an algorithm.</h1>
        <p className="hero__line">Every session begins with a question.</p>
        <p className="hero__blurb">
          The room chooses the theme. I spend the day curating the story. When the broadcast begins,
          everyone hears the same song at the same moment. With the words to it on screen, a room
          talking around them, and the chance to discover something they would never have searched
          for themselves.
        </p>
        {/* The other half of what the station is, said once at the top and
            argued properly further down. See `Talks`: an evening here is not
            always records, and a page that only ever said "music" would be
            describing half of the thing somebody is about to walk into.

            It was a sentence about somebody being on the mic. It is the two
            kinds of night, turning over, which is the same claim in a third of
            the words and is the one thing on this screen that moves.

            The words are the station's own. `kindPromise` is what the poster
            for a night says and what the console offers when one is announced,
            and a page in front of the station promising something in different
            words would read as a third kind of evening. See lib/kind.ts, which
            exists for exactly this. */}
        <p className="hero__also">
          An evening here is{' '}
          {still ? (
            // A word that changes on a timer is content updating by itself.
            // Asked to hold still the page does not slow it down, it stops
            // having one: both nights, in one sentence, nothing moving.
            <>a set of records, or a conversation.</>
          ) : (
            <FlipWords className="hero__night" words={NIGHTS} running={near} />
          )}
        </p>
        {/* Two, where there was one, and they are not the same offer.

            The first is the station, which is dark more often than it is on: a
            visitor who presses it on a Tuesday afternoon gets a page that says
            so, and that is the honest cost of the thing being live. The second
            is the archive, which is never dark. Putting it here rather than
            only in the bar is the page admitting, in the first screen, that
            half of what it is describing already happened and can be heard
            right now. See `Archive`, which is that half argued properly.

            The quiet pill rather than a second white one: they are both worth
            pressing and only one of them is what this screen is about. */}
        <div className="hero__ways">
          <a className="button button--large" href={TUNE_IN}>
            Join tonight’s session
          </a>
          <a className="button button--large button--quiet" href={PODCAST}>
            Listen to the podcast
          </a>
        </div>
      </div>

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
 * are nine records: four sat in a column beside the sentence, and nine want a
 * table.
 *
 * They can be picked up and thrown; see DraggableCard, a port of Aceternity
 * UI's. Which is not decoration: the argument of this whole page is that a
 * station is a person putting records on rather than a queue running, and a
 * pile of sleeves you can shove around says that in a way a rectangle with a
 * progress bar in it does not.
 *
 * Every sleeve is the same sleeve. The one that is on is the one at the front
 * of the pile and nothing else: no badge on it, no clock, no head count. It is
 * a record, and a record does not report anything; the LIVE mark beside the
 * sentence is where this page says what is happening, and saying it twice
 * would be the pile pretending to be an interface rather than a stack of
 * records on a table.
 *
 * The records are `SLEEVES`, the same evening the list further down draws.
 */

/**
 * Where each sleeve lies on the table, and how far it is turned.
 *
 * By hand rather than at random: a random scatter has to be re-rolled until it
 * looks like a pile, and this one is the roll that did. Newest first, so the
 * record that is on is the one on top and nearest the middle, with the rest of
 * the evening spread out under it, which is the only thing on the page that
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
            Globe: nothing arrives until the page is readable, and on a machine
            that cannot draw it the sentence stands on its own. */}
        <Globe />

        <div className="moment__said">
          <p className="moment__lead">Everyone is hearing this exact moment.</p>
          <ul className="moment__nots">
            <li>No skips.</li>
            <li>No shuffle.</li>
            <li>No algorithm.</li>
          </ul>
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
 * What is wrong, and what the station is for. One section, not two.
 *
 * This used to be two consecutive screens: `Why` (the case against the
 * algorithm) and `Creed` (the philosophy), in the same first-person voice and
 * the same setting, arguing the same thing at two different lengths. Read one
 * after the other they were not two halves of an argument, they were the
 * argument and then the argument again, and the second one was better. So the
 * general claim keeps its opening line and the rest of it goes: everything
 * `Why` spent eleven lines arriving at is said here in two, and this half has
 * the only concrete thing either of them had.
 *
 * Between `Moment` and `Works`, which is the order the page argues in: here is
 * the thing, here is why it should exist, and only then here is how an evening
 * runs. Put after `Works` it would be a philosophy appended to a product; put
 * here it is the reason the product is shaped the way the next section shows.
 *
 * It is the first section in the first person, and the only one before the
 * bottom of the page. That is not the DJ introducing himself; see `Dj`, which is
 * deliberately last but one and is a person saying who they are. This is an
 * argument that happens to be told through something that happened to somebody,
 * which is a different thing and can be read by a stranger.
 *
 * The record is not chosen at random. Pink Floyd's Wish You Were Here is the
 * session this whole page is scrubbing through (see SESSION in session.ts)
 * so the album named as the thing somebody once explained is the album playing
 * along the bottom of the screen while you read about it.
 *
 * One thought a line, in groups, with the spacing doing the work. The claim,
 * the thesis, what happened, what was said, what changed, and then the one line
 * that is about the station.
 */
const Creed = memo(function Creed() {
  return (
    <section className="creed">
      <h2 className="section__title section__title--quiet">The philosophy</h2>

      {/* A line drawn down the margin as far as the reader has got. See
          `TracingBeam`. It is here rather than anywhere else on the page because
          this section is the one continuous argument on it: five groups that
          only work read in order, and a line being drawn beside them is that
          said without a word. Anywhere the page is making a list instead, the
          same beam would be claiming a thread that is not there. */}
      <TracingBeam className="creed__beam">
        <p className="creed__claim">
          {/* One word wriggles, and it is the word the section is against: this
              is a page that does not trust `optimizing`, and a word that will
              not hold still is that said before the sentence gets to it.
              Squiggling the whole line would just be a wobbly headline. */}
          We stopped discovering music. We started <SquigglyText>optimizing</SquigglyText> it.
        </p>

        <div className="creed__stack">
          <p className="creed__line">Some songs don’t need better recommendations.</p>
          <p className="creed__line">They need better introductions.</p>
        </div>

        {/* The two statements that are being quoted rather than argued, and the
            only marks of their kind in this section.

            A quotation across two lines opens on the first and closes on the
            second, so the mark is on the line it belongs to rather than a pair
            of them wrapped round each `p`. The opening one hangs — see
            `.creed__said--opens` — because a section set one thought a line has
            its whole shape in the left margin, and a line that starts a third
            of a character in is the one line that looks wrong. */}
        <div className="creed__stack">
          <p className="creed__said creed__said--opens">
            “I didn’t fall in love with Pink Floyd because an algorithm recommended them.
          </p>
          <p className="creed__said">I fell in love because someone explained who they were.”</p>
        </div>

        <div className="creed__stack">
          <p className="creed__said creed__said--quiet">The philosophy behind their albums.</p>
          <p className="creed__said creed__said--quiet">The loss of Syd Barrett.</p>
          <p className="creed__said creed__said--quiet">The choices hidden inside the music.</p>
        </div>

        <div className="creed__stack">
          <p className="creed__said creed__said--opens">
            “When I listened again, I wasn’t hearing different sounds.
          </p>
          <p className="creed__said">I was hearing different meaning.”</p>
        </div>

        <p className="creed__turn">That’s what chunky.fm is built to do.</p>
      </TracingBeam>
    </section>
  )
})

/**
 * How long a line is held before the next one comes up.
 *
 * Not the sheet's own gaps, which are fourteen to twenty-two seconds apart
 * because they are a real song's worth of spacing. At that rate a reader who
 * stopped at this cell would watch one line change and conclude it was a
 * picture. Two seconds is a lie about the record and the truth about the
 * feature, which is the trade every drawing on this page makes.
 */
const A_LINE = 2000

/**
 * How many lines light in place before the sheet starts moving under them.
 *
 * A sheet that scrolled from the first line would be a sheet whose top line is
 * never readable. Two, and it is the *third* line's offset that says how far
 * that is rather than a number of pixels, so a line that wraps on a narrow cell
 * takes its own height with it.
 */
const RESTS_AT = 2

/**
 * The sheet beside the deck, playing.
 *
 * It used to be lit from the page's own playhead — the scroll — which made it
 * one more thing that only moved while somebody was moving, and this is the one
 * cell in the grid where that was wrong: a lyric sheet keeping up with a record
 * is the whole claim, and a sheet that holds still until you scroll is a claim
 * you have to take on trust. So it runs on its own clock now, and the section
 * holds that clock because the meter beside it is on the same one.
 *
 * The sheet lifts so the line being sung stays where the eye already is,
 * measured off the line itself rather than assumed from a line height: three of
 * these wrap at the cell's width and a sheet stepped by a constant would walk
 * further out of true with every one it passed.
 *
 * The seam is a restart rather than a rewind. Scrolling fourteen lines
 * backwards in half a second is the one motion here that would say nothing
 * true; a record reaching the end and starting again is exactly what has
 * happened, so at the top of the loop the lift is taken off with no transition
 * and the sheet comes back up from nothing. See `.sheet[data-again]`.
 */
function Sheet({ sung }: { sung: number }) {
  const lines = useRef<HTMLDivElement>(null)
  const [lift, setLift] = useState(0)

  useEffect(() => {
    const measure = () => {
      const box = lines.current
      const line = box?.children[sung]
      if (!box || !(line instanceof HTMLElement)) return
      // Where the sheet holds the line it is on. The third line's own top,
      // which is two lines down whatever those two lines turned out to be.
      const rest = box.children[RESTS_AT]
      const held = rest instanceof HTMLElement ? rest.offsetTop : 0
      setLift(Math.max(0, line.offsetTop - held))
    }

    measure()
    // A narrower window rewraps the lines and moves every offset under us, and
    // the next tick is up to two seconds away.
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [sung])

  return (
    <div className="sheet" aria-hidden="true" data-again={sung === 0 ? 'true' : 'false'}>
      <div className="sheet__lines" ref={lines} style={{ transform: `translateY(${-lift}px)` }}>
        {SHEET.map((line, index) => (
          <p
            className="sheet__line"
            key={line.at}
            data-lit={index === sung ? 'true' : 'false'}
            data-hum={line.says === '· · ·' ? 'true' : 'false'}
          >
            {line.says}
          </p>
        ))}
      </div>
    </div>
  )
}

/**
 * The room, filling up, on the same clock as the sheet.
 *
 * It was two bubbles, drawn once and never moving, which said the panel existed
 * and nothing else. What a chat window does is *arrive*, and there is no way to
 * show that with a picture of two messages.
 *
 * It runs off the record rather than off a clock of its own. The loop the
 * section holds gives a second of the song — `SHEET[sung].at` — and this asks
 * `saidBy` which of the room's lines have been said by then, the same function
 * the conversation further down the page is drawn from. So a bubble lands at
 * the second of the record it was said at, and the sheet beside it is on that
 * same second, which is the section's whole argument happening in two cells at
 * once rather than being asserted in a caption.
 *
 * A consequence worth knowing: the room is already talking when the loop
 * starts. The sheet's first line is at 0:34 and two of these were said before
 * it, so the panel opens mid-conversation — which is what walking into a
 * station mid-song is like, and is the reason it is not worth waiting for an
 * empty panel to fill from nothing.
 *
 * Only the lines that have been said are rendered, so a new one is a **mount**
 * and gets its arrival animation for free without any state saying which is
 * newest. The box is anchored to the bottom, so the pile grows upward and the
 * oldest go off the top under the mask, which is what a chat window does.
 */
function Said({ at, again }: { at: number; again: boolean }) {
  return (
    <div className="said" aria-hidden="true" data-again={again ? 'true' : 'false'}>
      <div className="said__lines">
        {saidBy(ROOM, at).map((line) => (
          <span className="said__line" key={line.at}>
            <span className="said__face">{initial(line.who)}</span>
            <span className="said__bubble">
              <span className="said__who">{line.who}</span>
              <span className="said__says">{line.says}</span>
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}

/**
 * What is on the screen while a session is on.
 *
 * This replaced two sections, and the reason is that neither of them was
 * describing the station as built.
 *
 * `Works` was five steps of an evening on cards going past, and its last step
 * promised a playlist export, annotations and listener notes — three things
 * that have never existed here. The step was corrected first and the section
 * still had the wrong job: five statements about how a night runs, on a page
 * whose next four sections are about how a night runs.
 *
 * `Guide` was worse. "The Listening Guide" was three notes pinned to seconds of
 * a record — 2:14, listen to how the guitar hesitates — which is the same
 * unbuilt annotation feature the hero and the journal were also claiming, given
 * a section and an example rail of its own. What the station actually puts
 * beside the record is the **words to it**, read through to LRCLIB and lit a
 * line at a time (`GET /api/lyrics/:trackId`, the `#lyrics` view), which is a
 * better thing than the one that was being promised and was going unmentioned.
 *
 * So: one section, five cells, and every cell is a view a listener actually
 * has — the clock everyone shares, the words, the room, the wish book, the
 * evening so far. The cells are deliberately one line and one small drawing
 * each: `Wishes` and `BeenOn` further down are the arguments for two of them,
 * and a grid that argued too would be the page making the same case twice.
 *
 * It carries the room now as well. There used to be a whole section for the
 * talking — a heading, four lines of framing, and a sticky pair holding the
 * join panel and a chat that filled as you read — and the cell here says the
 * same thing in one line and a drawing that fills by itself. The section went;
 * this did not have to change to replace it, which is the argument for a grid
 * of small true things over a screen of argument about one of them.
 *
 * The clock is first and is the only one given the whole width, for both the
 * reason it deserves it and a plainer one: it is the only wide cell, and a wide
 * cell anywhere but the start of a row leaves the column beside it empty. The
 * four that follow pair off underneath it.
 *
 * The playhead reaches two of them. The sheet lights the line the sample
 * session has got to and the clock counts with it, so the two cells that are
 * about time keep it while somebody reads past them.
 */
const Inside = memo(function Inside() {
  const section = useRef<HTMLElement>(null)
  const near = useOnScreen(section)
  const still = useStill()
  /*
   * The record, playing.
   *
   * Held here rather than inside the sheet, because two cells are on it: the
   * line being sung, and the clock over the level meter beside it. Two timers
   * would put the panel a few seconds out with itself within a minute of
   * somebody looking at it, which is the one thing a section about everybody
   * being on the same second cannot afford to be.
   *
   * Parked off screen the way the split-flap board and the mic sequence are,
   * and stopped outright for anybody who asked for less movement. See `Sheet`:
   * stopped, it is a sheet with a line lit rather than a blank one.
   */
  const [sung, setSung] = useState(0)

  useEffect(() => {
    if (still || !near) return
    const round = setInterval(() => setSung((was) => (was + 1) % SHEET.length), A_LINE)
    return () => clearInterval(round)
  }, [still, near])

  return (
    <section className="inside" ref={section}>
      {/* The grid comes up off the page as you reach it, with the words above
          it drifting to meet it. See `ContainerScroll`: the heading and the two
          lines are the part that drifts, the grid is the part that tilts, and
          the turn at the bottom of the section stays outside because it is what
          the section concludes rather than part of the thing being shown. */}
      <ContainerScroll
        className="inside__stage"
        title={
          <>
            {/* The original's heading, which is one sentence broken over two
                sizes: a quiet line, and then the subject of it set as large as
                the column will take. It is the one heading on this page that is
                centred and the one that is bigger than the hero's, and both are
                because of what is under it — a heading set from the left margin
                over a panel that fills the width would be pointing at a corner
                of it. */}
            <h2 className="inside__title">
              <span className="inside__title-small">Nothing here is a feature you switch on.</span>
              <span className="inside__title-big">Inside a session</span>
            </h2>

            <p className="inside__lede">
              It is what the screen is, for as long as the station is up.
            </p>
          </>
        }
      >
        <BentoGrid className="inside__grid">
          {/* The one everything else on this page is downstream of, and the only
              cell given the whole width. The meter is the station's own, and it
              moves because the page says sound is coming out rather than because
              any is — same rule as the one under the pile of records. */}
          <BentoCell
            wide
            says="Everyone on the same second of it."
            shows={
              <div className="tuned" aria-hidden="true">
                <Waveform live />
                <div className="tuned__what">
                  {/* The same playhead the sheet is on, so the number over the
                    meter and the line being sung beside it are the same moment
                    of the same record. */}
                <span className="tuned__where">{clock(SHEET[sung]?.at ?? 0)}</span>
                  <span className="tuned__of">{SESSION.title}</span>
                  <span className="tuned__who">{SESSION.listeners} listening</span>
                </div>
              </div>
            }
          />

          {/* The words. What `Guide` was pointing at without knowing it: not
              somebody's notes about the record, the record's own words, keeping
              up. See `Sheet`. */}
          <BentoCell says="The words to it, keeping up." shows={<Sheet sung={sung} />} />

          {/* The room, filling. See `Said`: it is on the sheet's clock, so what
              the room says arrives at the second of the record it was said at,
              which is the claim the whole section is making. */}
          <BentoCell
            says="The room, talking around it."
            shows={<Said at={SHEET[sung]?.at ?? 0} again={sung === 0} />}
          />

          {/* One of them, not the wall. The wall is its own section, and the
              thing worth saying here is the shape of the sentence. Not
              `aria-hidden`: it is a quotation, and it reads. */}
          <BentoCell
            says="Ask for a feeling, not a song."
            shows={<p className="asked">“{WISHES[0]?.says}”</p>}
          />

          {/* The evening, as the history view lists it. Three of them, because
              the cell is a sample of a list rather than the list. */}
          <BentoCell
            says="And the evening, still there to read backwards."
            shows={
              <ul className="sofar" aria-hidden="true">
                {BEEN_ON.slice(0, 3).map((play) => (
                  <li className="sofar__row" key={play.title}>
                    {play.cover ? (
                      <img className="sofar__art" src={play.cover.src} alt="" loading="lazy" />
                    ) : (
                      <span className="sofar__art sofar__art--blank" />
                    )}
                    <span className="sofar__what">
                      <span className="sofar__title">{play.title}</span>
                      <span className="sofar__artist">{play.artist}</span>
                    </span>
                    <span className="sofar__at">{play.at}</span>
                  </li>
                ))}
              </ul>
            }
          />
        </BentoGrid>
      </ContainerScroll>

      <p className="inside__turn">All of it one mark away, all of it now.</p>
    </section>
  )
})


/**
 * The other kind of session.
 *
 * Straight after `Inside`, where the room is established — one cell of that
 * grid is the talking, arriving at the second of the record it was said at.
 * This is the same claim carried one step further: if a room hearing the same
 * second of a record is worth building, then a room hearing the same second of
 * somebody answering a question is the same thing with the record turned down.
 * Put anywhere earlier it would read as a second product bolted on; put here it
 * reads as what the room was always for.
 *
 * It describes nothing that is not already built. A guest arrives on an invite
 * link like any other listener (see lib/invite.ts), asks for the mic, passes a
 * sound check and is brought up onto the air by whoever is on the decks (see
 * CallIn.tsx and the floor controls in AdminPanel.tsx). So this section is the
 * page finally saying out loud what that machinery is for, rather than a
 * promise about something that might get written later.
 *
 * The note at the end is the only place on the page that says what the whole
 * thing is rather than what it does, and it is deliberately the quietest block
 * in the section. It is also the one honest word about how far along this is.
 * A landing page that opened with "it is still early" would be apologising; one
 * that never said it at all would be overselling. Said here, after somebody has
 * read enough to want it, it is a person telling you where you have arrived.
 *
 * Set like `Why` and `Creed`: one thought a line, in groups, faint for the
 * setup and the reading colour for the line that answers it.
 */
const Talks = memo(function Talks() {
  return (
    <section className="talks" id="talks">
      {/* A light thrown across the section from off the top corner. See
          `Spotlight`. This is the section about somebody being brought up onto
          the air while the room listens in, and a light on whoever is talking
          is what that looks like in every room it has ever happened in. */}
      <Spotlight />

      <h2 className="section__title talks__title">Not only records</h2>

      <div className="talks__stack">
        <p className="talks__line">Some sessions are a record and a room.</p>
        <p className="talks__line talks__line--said">
          Some are a conversation, and the room is still there for it.
        </p>
      </div>

      <div className="talks__stack">
        <p className="talks__line">A guest gets a link and turns up like anybody else.</p>
        <p className="talks__line">I bring them up onto the air.</p>
        <p className="talks__line talks__line--said">
          Then it is two people talking, with the records still to hand.
        </p>
      </div>

      {/* The other way a second voice happens, and it is not the same thing at
          all. A guest is invited for a segment and goes down when the mic
          closes; a co-host arrives holding a key, seats themselves and stays
          the evening. See the table in the README: the two look alike from
          outside and are opposite in every rule that matters.

          The last line is the honest one and is worth its place: the console
          does not merely decline to draw the buttons a co-host may not press.
          The station refuses that credential. */}
      <div className="talks__stack">
        <p className="talks__line">Or somebody takes the second seat for the whole evening.</p>
        <p className="talks__line">They can talk, and say what goes on next.</p>
        <p className="talks__line talks__line--said">
          What they cannot do, the station refuses them — not the page.
        </p>
      </div>

      <div className="talks__stack">
        <p className="talks__line">Anyone listening can ask for the mic.</p>
        <p className="talks__line">If it is the right moment, it gets opened.</p>
        <p className="talks__line talks__line--said">
          The question and the answer land at the same second for everybody.
        </p>
      </div>

      {/* What that last line costs, which is the part nobody expects.

          This used to be a panel: the five steps a hand goes through, running
          on a loop, with the station's level meter beside them dropping to a
          fifth on the last one. It is said in words now, in the register the
          rest of the section is in. */}
      <div className="talks__stack">
        <p className="talks__line">When the mic opens, the music steps back.</p>
        <p className="talks__line talks__line--said">
          Not on a desk in here — in every room at the same instant.
        </p>
      </div>

      <p className="talks__turn">Music, ideas, and the people behind them.</p>

      {/* This used to end with "Some of them are kept", and a link to the
          podcast, because at the time that was the only place on the page
          where the archive was more than a word in the bar. `Archive` is
          directly underneath now and opens by saying the same thing at length,
          so the two of them in a row were the argument and then the argument
          again — which is the fault `Creed` was pulled apart to fix. The link
          went with it; it is in the hero, in the bar, in the section below and
          in the foot. */}

      {/* The plainest words on the page, and set that way on purpose: the rest
          of this section argues, and this one just says what the thing is.

          One line, where there were three. The first of them opened "an
          independent project exploring music, ideas and the people behind
          them", which is the turn directly above it said again in longer words,
          and the other two are one thought that was punctuated as two. */}
      <div className="talks__note">
        <p>
          It’s still early, which is part of the point: a place where interesting conversations can
          happen without everything needing to become content.
        </p>
      </div>
    </section>
  )
})

/**
 * The nights that were kept.
 *
 * The other half of the station, and until this section existed it was one
 * sentence at the end of `Talks` and a word in the bar. Everything else on this
 * page describes an evening somebody has to be present for; this describes the
 * part that is still there afterwards, which is the only part a visitor reading
 * at two on a Tuesday can actually have.
 *
 * Directly after `Talks` on purpose. That section ends by saying an evening
 * here is sometimes a conversation; this one says what becomes of the ones
 * worth keeping. Anywhere earlier it would be a second product announced before
 * the first had been explained.
 *
 * It is the second section on this page that is **true**. See `useArchive`:
 * `GET /api/episodes` is open, because an episode is public by design, so the
 * strip is real episodes with real posters whenever the station can be reached.
 * When it cannot, it is an invented three, drawn inert — see `KeptStrip`.
 *
 * It had a second half: a transcript pane keeping up with a voice, beside two
 * lines about pressing one to jump and about the player remembering where you
 * stopped. Both are still true of an episode page and neither is claimed here
 * any more.
 */
const Archive = memo(function Archive() {
  return (
    <section className="kept" id="archive">
      {/* Quiet, like the head over `Talks` and the one over the wishes. The
          first real line does the arguing; this only says where you are. */}
      <h2 className="kept__title">The podcast</h2>

      <div className="kept__stack">
        <p className="kept__line">A session ends and takes the evening with it.</p>
        <p className="kept__line kept__line--said">
          The conversations worth keeping do not go anywhere.
        </p>
      </div>

      <KeptStrip />

      <p className="kept__turn">Nights you can go back to.</p>

      <a className="button button--large" href={PODCAST}>
        Open the archive
      </a>
    </section>
  )
})

/**
 * The shelf, and what a card opens into.
 *
 * Its own component, and memoised with no props, for a reason that is about
 * this page rather than tidiness: `Landing` re-renders on every frame the
 * playhead moves, and the strip has a scroll position, an open panel and up to
 * six posters in it. None of that has anything to do with what second of the
 * song the reader has scrolled to, and a strip rebuilt once a second is a strip
 * that fights anybody pushing it along.
 *
 * **Real episodes are pressable; invented ones are not.** A fixture card that
 * opened a panel would be a panel of show notes for an episode that does not
 * exist, and one that linked would be a 404 with a poster on it. So the whole
 * shelf goes `inert` when the station could not be reached: the cards are a
 * picture, the arrows cannot be tabbed into, and the way to the archive is the
 * link under it, which works either way. Same call `ListenerView` makes about
 * the station it draws.
 */
const KeptStrip = memo(function KeptStrip() {
  const { cards, real } = useArchive()
  const [opened, setOpened] = useState<string | null>(null)
  const showing = cards.find((card) => card.key === opened) ?? null

  return (
    <div className="kept__shelf" inert={!real}>
      <Carousel
        className="kept__carousel"
        label="episodes"
        items={cards.map((card, index) => ({
          key: card.key,
          node: <KeptCard card={card} eager={index < 2} onOpen={() => setOpened(card.key)} />,
        }))}
      />

      {!real && (
        // Said out loud rather than left to be discovered. The cards above are
        // a drawing, and a reader who took them for the archive and found three
        // other episodes behind the link would rightly wonder which page had
        // lied to them.
        <p className="kept__note">
          A picture of the shelf. The episodes themselves are through the link below.
        </p>
      )}

      <CardPanel
        open={showing !== null}
        onClose={() => setOpened(null)}
        labelledBy="kept-open-title"
        className="kept__panel"
      >
        {showing && (
          <>
            <p className="kept__panel-sub">{showing.sub ?? 'chunky.fm'}</p>
            <h3 className="kept__panel-title" id="kept-open-title">
              {showing.title}
            </h3>
            <p className="kept__panel-facts">
              {showing.when} · {showing.length}
            </p>

            {showing.notes.length > 0 ? (
              <div className="kept__panel-notes">
                {showing.notes.map((block) => (
                  <p key={block}>{block}</p>
                ))}
              </div>
            ) : (
              <p className="kept__panel-notes">No notes for this one.</p>
            )}

            {/* The point of the panel. Everything above it is what the card had
                room to say; this is the page it came from, where the audio, the
                transport and the transcript actually are. */}
            {showing.href && (
              <a className="button button--large" href={showing.href}>
                Listen to this episode
              </a>
            )}
          </>
        )}
      </CardPanel>
    </div>
  )
})

/**
 * One episode on the shelf.
 *
 * A button rather than a link, which is the opposite of the call `EpisodeGrid`
 * makes on the archive's own page, and for the opposite reason: there a card is
 * a navigation and has to be middle-clickable and copyable, here it opens a
 * panel on the page you are already on. The address is inside the panel, as a
 * real anchor, which is where somebody who wants to keep it can get at it.
 *
 * A card with no poster is not a broken card. Every episode is meant to have
 * one and the server refuses an upload without it, but `poster` is nullable on
 * an `Episode` and the invented ones have none by design — so the artwork's
 * absence is a layout, not a fallback: the title, set large, where the picture
 * would be.
 */
function KeptCard({
  card,
  eager,
  onOpen,
}: {
  card: ArchiveCard
  eager: boolean
  onOpen: () => void
}) {
  const face = (
    <>
      <span className="kept__art">
        {card.poster ? (
          // Empty alt: the title is the next thing in the card and in the
          // reading order, and a poster announced by its own title is that
          // title said twice.
          <img
            className="kept__poster"
            src={card.poster}
            alt=""
            width={1080}
            height={1350}
            loading={eager ? 'eager' : 'lazy'}
            decoding="async"
          />
        ) : (
          <span className="kept__art-words">{card.title}</span>
        )}
        {/* A wash off the foot of the poster, so the words underneath have
            something to sit against whatever the artwork is doing down there. */}
        <span className="kept__wash" aria-hidden="true" />
      </span>

      <span className="kept__what">
        {/* The title, unless the card has already had to print it where the
            artwork would be. Said in both places it reads as a mistake — the
            same words twice, six lines apart, in two sizes — and the caption is
            the half that can go: a drawn sleeve with the title on it is still a
            card with a name, and the facts under it are what the caption is
            actually for. */}
        {card.poster && <span className="kept__name">{card.title}</span>}
        <span className="kept__facts">
          {card.sub && <span className="kept__sub">{card.sub}</span>}
          <span className="kept__when">
            {card.when} · {card.length}
          </span>
        </span>
      </span>
    </>
  )

  if (card.href === null) return <span className="kept__card">{face}</span>

  return (
    <button type="button" className="kept__card" onClick={onOpen}>
      {face}
    </button>
  )
}

/**
 * What the room asks for.
 *
 * The section that would be genres on any other music page, and is not one here.
 * These are wishes (free text, straight to whoever is on the decks) and shown
 * as themselves because the shape of the sentences *is* the argument: nobody
 * types "indie folk, 1970s" into a box like this.
 *
 * Nothing is around them. The wall used to stand inside a panel that tilted
 * upright as the reader arrived at it, and every wish sat on its own card; both
 * were the page presenting the sentences: one announcing them, the other
 * putting a surface under each to say it was an item.
 * They are neither. They are things people typed, and the way to show that is to
 * put them on the page and let them go past: no panel, no card, no frame telling
 * the reader how to take them. The section is the same shape as every other one
 * here now, which is the point: the wishes are the surprising thing, not the
 * furniture around them.
 */
const Wishes = memo(function Wishes() {
  return (
    <section className="wishes">
      {/* Threads crossing the section behind the words. See `BackgroundLines`.

          It belongs here rather than anywhere else on the page for the same
          reason the spotlight belongs on `Talks`: this is the section about
          things arriving from a room full of people the station cannot see, and
          twenty lines coming in from off the frame, one at a time, is that
          without a sentence saying it. Anywhere the page is making an argument
          instead, it would be decoration behind prose. */}
      <BackgroundLines />

      {/* Kept in the document and out of the picture, the same idiom as
          `.limits__spoken`. Nothing here reads as this section's heading — the
          wall of quotations is the section — so rather than leave the page's
          outline with a hole in it, the title stays for anything reading
          structure and goes for anything reading by eye. */}
      <h2 className="section__title section__title--quiet">What the room asks for</h2>

      {/* Two stacks said this: "Ask for a feeling. / Not a song." and "Instead
          of searching for tracks… / Describe the moment." They are the same
          instruction twice, and the wall underneath demonstrates it better than
          either. One line, and on to the half that is not obvious. */}
      <div className="wishes__stack">
        <p className="wishes__line wishes__line--said">Ask for a feeling, not a song.</p>
      </div>

      {/* The honest half, and the reason the section exists. The line above is
          about what you may ask; this is about what happens to it, which on any
          other music page is a queue and here is a person reading it. */}
      <div className="wishes__stack">
        <p className="wishes__line">I don’t promise I’ll play your request.</p>
        <p className="wishes__line wishes__line--said">I promise I’ll consider it.</p>
      </div>

      <p className="wishes__turn">That’s the point of having someone behind the decks.</p>

      <WishWall />
    </section>
  )
})

/**
 * The wall, moving.
 *
 * Sentences, going past. Nothing under them: the card they used to sit on was a
 * surface grading into the sheet with graph paper in one corner, which is a
 * good-looking card and was doing the wrong job: it made each wish an entry in
 * something. Set on the page with only the quotation marks around them, they are
 * what they are, and the reader is looking at the words rather than at a wall of
 * tiles that happen to have words on.
 *
 * They go past rather than sit still, and the two columns disagree about which
 * way: the left falls, the right rises. See `MovingColumns`. There is nothing
 * else here: no heading over them and no line under them, because a caption
 * explaining that these are wishes would be the section reading itself out.
 */
function WishWall() {
  return (
    <MovingColumns
      items={WISHES.map((wish) => ({
        key: wish.says,
        node: <p className="wish">“{wish.says}”</p>,
      }))}
    />
  )
}

/**
 * The evening so far.
 *
 * Deliberately not billed as an archive. The station keeps this for as long as
 * it is up and no longer. It is what a person arriving at eleven scrolls to
 * see, not a back catalogue, and the note under the grid says so, because a
 * page implying there are past sessions to browse would be selling one.
 */
/**
 * What the journal holds, in the order the rail lists it.
 *
 * Four marks rather than five things, and each one is a view that exists: the
 * words to what is on (`#lyrics`), the room (`#chat`), what this listener asked
 * for (`#wishes`) and the evening so far (`#history`). `On air` is the deck
 * itself and `Sync` is a clock, so neither is something the evening accumulates.
 * See RAIL in ListenerView.tsx, which draws the same six marks in the same
 * order, and Sidebar.tsx, which is where both of them come from.
 */
const HOLDS = [
  'The words to what is on',
  'What the room said',
  'What you asked for',
  'Everything that has been on',
]

const BeenOn = memo(function BeenOn() {
  return (
    <section className="been" id="been-on">
      <MacbookScroll
        title={
          <>
            <h2 className="section__title">The Listening Journal</h2>
            <p className="section__lede section__lede--mid">
              Arrive at eleven and the evening is still there to read backwards.
            </p>
          </>
        }
        screen={<ListenerView />}
      />

      <p className="section__body been__after">
        That is the whole of it: the deck and the room on the left, the words beside them, and
        everything else (the chat, the wishes, the evening so far) one mark away on the rail.
      </p>

      {/* What the journal holds, as a list rather than a sentence: five things
          named plainly is the difference between a tracklist and a record of an
          evening, and running them together into prose would bury the two that
          are not obvious. */}
      <ul className="been__holds">
        {HOLDS.map((held) => (
          <li className="been__holds-item" key={held}>
            {held}
          </li>
        ))}
      </ul>

      <p className="section__body been__after">
        Not a tracklist. What the evening was, kept in the shape it happened in.
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
 * written, one thought a line. Do not run them together into paragraphs. It is
 * the only section on the page in a voice that is not the product's, and the
 * whole reason it works is that it sounds like a person rather than like the
 * rest of the page.
 *
 * They come in four groups and the spacing in landing.css is what says so: the
 * name, what he thinks music is, what he does about it, and the line the whole
 * page has been walking toward. The group breaks are `nth-child` rules, so
 * adding or reordering a line here silently moves them; they are counted from
 * the top of this list and nothing checks that they still land between thoughts.
 *
 * Line five is long enough to wrap, and that is allowed now where it was not
 * before. It used to be true that the longest of these fitted on one line; at
 * eighty-seven characters this one cannot at any size the section could use, and
 * a measure narrow enough to force the point would just be re-punctuating him.
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

const Dj = memo(function Dj() {
  return (
    <section className="dj" id="dj">
      {/* Him, rather than the gramophone that used to stand here.
          
          The object was the hero's, brought back and stopped, and it was making
          an argument — the station is off more than it is on — in the one place
          on the page where the argument is not the point. This section is a
          person saying who they are in their own words, and the picture beside
          it should be the person. It is also the only photograph on the page,
          which is why it can be small and still be the thing you look at first.

          A real `alt`, unlike every other picture here. The rest are drawings of
          instruments and are `aria-hidden`; this is a photograph of somebody and
          the page names him in the first line beside it. */}
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
 * What it is not.
 *
 * Kept on the page rather than left for somebody to discover after an evening of
 * setting it up. A landing page that hid them would just be selling a different
 * product.
 *
 * These used to be the constraints as a specification would list them: a head
 * count, no uploads, no accounts, no schedule. They are the reasons for those
 * constraints now, which is a different and better claim: `No autoplay` and `No
 * pressure to maximize listening time` are the same decision said as a fact and
 * said as a position, and only the second one tells a stranger why they should
 * care. The last line is not a limit at all. It is what is left when you take
 * all of them away, and it is the one the section is really for.
 *
 * Said on a split-flap board (see `FlipBoard`) one at a time, the way the
 * board at a station tells you what is not running. Each of these used to carry
 * a line of explanation under it and no longer does: eight statements, on the
 * wall, turning over. The reasons are all further up the page anyway, in the
 * sections that spend a screen each on them.
 *
 * The board is 4 rows of 22 and word-wraps, so 88 characters is the ceiling and
 * the longest of these is 55. Anything much longer would be silently cut (see
 * the `slice(0, rows)` in FlipBoard) rather than overflowing where you could
 * see it.
 */
const LIMITS = [
  'Deliberately small.',
  'One station.',
  'One DJ.',
  'No endless feed.',
  'No autoplay.',
  'No algorithm deciding what’s next.',
  'No pressure to maximize listening time.',
  'Just people showing up to hear something worth sharing.',
]

/**
 * How long each one stays up.
 *
 * It was 4200ms, which was long enough to read twice when the longest of these
 * was `Around thirty listeners`. They are sentences now and the last is
 * fifty-five characters over three rows of the board, and none of it is legible
 * until the flaps have finished turning, which is itself most of a second. This
 * is long enough to read the longest one twice and the short ones several times,
 * which is the right way round: nobody minds a short line lingering.
 */
const ON_THE_BOARD = 5600

const Limits = memo(function Limits() {
  const section = useRef<HTMLElement>(null)
  const near = useOnScreen(section)
  const [showing, setShowing] = useState(0)

  /*
   * Round the six of them, while the board is somewhere near the window.
   *
   * Parked rather than merely unticked when it is not: `FlipBoard` empties
   * itself when it stops, so a reader who scrolls back finds a blank board that
   * fills in, which is what a board does. The interval is cleared with it, so
   * nothing is running for the other eleven twelfths of the page.
   */
  useEffect(() => {
    if (!near) return
    const round = setInterval(() => setShowing((index) => (index + 1) % LIMITS.length), ON_THE_BOARD)
    return () => clearInterval(round)
  }, [near])

  return (
    <section className="limits" ref={section}>
      <h2 className="limits__title">What it deliberately is not</h2>

      <FlipBoard className="limits__board" text={LIMITS[showing] ?? ''} running={near} />

      {/* The board spells these one letter to a box, which is a way of writing
          that only exists by eye. Here they are as sentences, for anything not
          reading the page by looking at it. */}
      <ul className="limits__spoken">
        {LIMITS.map((limit) => (
          <li key={limit}>{limit}</li>
        ))}
      </ul>
    </section>
  )
})

/** The last thing on the page, and the only thing on its screen. */
const Call = memo(function Call() {
  return (
    <section className="call">
      <h2 className="call__headline">Join the room.</h2>

      {/* The evening's records, fanned. See FeyCards. The last thing above the
          button is the thing the button gets you: not a picture of a product, a
          hand of sleeves somebody put on. */}
      <FeyCards sleeves={SLEEVES.map((play) => play.cover)} />

      {/* The same pair as the hero, at the other end of the page, and here
          the second one is carrying more weight than it is up there. This is
          the last screen: somebody who has read this far and finds the station
          dark has nowhere to go, and the note directly under these two buttons
          is the page admitting that the first of them often leads to a quiet
          room. The archive is the answer to that sentence, so it stands beside
          it rather than being left in the bar. */}
      <div className="call__ways">
        <a className="button button--large" href={TUNE_IN}>
          Tune in
        </a>
        <a className="button button--large button--quiet" href={PODCAST}>
          Listen to the podcast
        </a>
      </div>
      <p className="call__note">
        The station is on when somebody is running it. If it isn’t, the page will say so. Leave it
        open and it will come back on by itself — or listen to a night that already happened.
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
        <a className="foot__way" href="#talks">
          Conversations
        </a>
        <a className="foot__way" href="#dj">
          The DJ
        </a>
        <a className="foot__way" href={PODCAST}>
          The podcast
        </a>
        <a className="foot__way" href={DECKS}>
          Run the decks
        </a>
      </nav>
    </footer>
  )
})

