# The landing page, rebuilt around what is actually there

The page in front of the station argues well and describes badly. It spends
thirteen sections on an evening of records, names the archive once in a
sentence, and makes its three most concrete promises about features that do not
exist. This is the plan for fixing all three, agreed before any of it was
written.

Design decisions for the station itself are in [PLAN.md](../PLAN.md); how the
system works is in [README.md](../README.md). This is only about the front door.

---

## Contents

1. [What is wrong](#what-is-wrong)
2. [Decisions](#decisions)
3. [The page, section by section](#the-page-section-by-section)
4. [Copy discipline](#copy-discipline)
5. [Components](#components)
6. [Build order](#build-order)
7. [Things that will bite](#things-that-will-bite)

---

## What is wrong

### The page promises three things that are not built

| On the page | Reality |
|---|---|
| Hero: "with context, annotations, and the chance to discover…" (`Landing.tsx:188`) | No annotation feature exists in client or server |
| Step 05: "Export the playlist. / Keep the annotations. / Take your own notes." (`Landing.tsx:455`) | None of the three exist. No export route, no notes store |
| `HOLDS = ['Theme','Songs','Annotations','Listener notes','Playlist export']` (`Landing.tsx:1009`) | Only Theme and Songs are real, from the session and `history.ts` |

This is why the page does not read as vivid. The most concrete-sounding claims
on it are the invented ones, and everything that genuinely works is described
abstractly: "And the room around it", "Not only records".

### The real features are under-shown

All of this is built, tested and running, and none of it is sold:

- **Words that keep up with the record.** `GET /api/lyrics/:trackId`, a
  read-through to LRCLIB memoised in SQLite, the `#lyrics` view, one line lit at
  a time. This is the closest thing the station has to a Listening Guide, and
  the page instead describes a note-at-2:14 feature nobody wrote.
- **The wish book.** Free text straight to whoever is on the decks, marked
  handled, never a queue the room can see.
- **A hand raised, and a listener brought up.** A real sound-check gate
  (`lib/sound-check.ts`), a 60-second invite lease, a floor state machine.
- **A guest on a link, and a co-host at the decks.** A whole second document at
  `/cohost`, its own key, its own seat, its own limits.
- **The music stepping back under a voice, everywhere at the same instant.**
  No mixed stream, no audio through the server.
- **Walking in mid-song and landing where the room is.** Range requests and a
  per-browser clock offset.
- **The evening, readable backwards.** Chat, wishes and history, all kept for
  the session.
- **The next session's poster.** `NextSession` is already the one true live
  thing on the page.

### The podcast is one sentence

It appears in the nav (`Landing.tsx:132`), in one line of `Talks`, and in the
footer. Nothing shows it. Yet it is the half of the product that **always
works**: reads are open even on a private station, the addresses are real and
shareable, and there is something behind them at two on a Tuesday afternoon when
the station is dark.

What is built there and invisible on the landing page: episode pages anyone can
open with no account, posters, show notes, guests, episode numbers, a transport
with 15-back and 30-forward, a position remembered per episode, a transcript
that follows the voice and where **every line is a button that jumps you
there**, a phone layout that hands the transcript the screen, and a blob driven
by the actual audio.

---

## Decisions

Settled before any work started.

| Question | Decision |
|---|---|
| The three unbuilt claims | **Cut them.** Sell what is real. Not deferred, not built first — removed. |
| How much of the page the podcast owns | **A co-equal half.** Named in the hero, its own full screen, its own call to action. |
| Real episodes or invented ones | **Real, with a static fallback.** The `NextSession` pattern. |
| How many new Aceternity ports | **Four.** Flip Words, Bento Grid, Multi Step Loader, Apple Cards Carousel. |
| Poster display | **Apple Cards Carousel.** |

The premise the whole page now hangs on:

> A room listening to the same second of the same record — and the conversations
> worth keeping.

---

## The page, section by section

Thirteen sections before, thirteen after. `Guide` merges into a rewritten
session section; the podcast takes the place it leaves.

| # | Section | State | What it says | What backs it |
|---|---|---|---|---|
| 1 | Hero | rewrite | The claim, then both halves named. Two buttons: *Tune in*, which may be dark, and *Listen to the podcast*, which never is. "Annotations" comes out of the blurb. | the station, `/podcast` |
| 2 | NextSession | keep | — | `GET /api/schedule` |
| 3 | Moment | keep, trim | "Everyone is hearing this exact moment. No skips. No shuffle. No algorithm." | sync, presence |
| 4 | Creed | keep, shorten | the philosophy | — |
| 5 | **Inside a session** | replaces `Works`, absorbs `Guide` | Five real things: the room sets the theme, everyone lands in the same second, the words keep up with the record, the room talks around it, you can ask for a feeling. | `#lyrics`, `#chat`, `#wishes`, `history.ts` |
| 6 | Room | keep | the scrubbed chat panel, still the best demo on the page | — |
| 7 | **Some nights it's a voice** | expands `Talks` | Raise a hand, pass a sound check, you are up. A guest arrives on a link. A co-host stays all evening. When someone speaks the music steps back, everywhere at once. | floor, cohost, mic ducking |
| 8 | **The podcast** | new | Real posters. The words move with the voice, tap a line to jump, it remembers where you stopped, one link, no account, works on a phone. | `GET /api/episodes`, transcript, player |
| 9 | Live (mask) | keep | "Why can't I just play these songs myself tomorrow?" | — |
| 10 | Journal | rewrite `HOLDS` | `Theme`, `The tracklist`, `The room's chat`, `The wish book`, `The words to each record` | history, chat, wishes, lyrics |
| 11 | Limits | keep, fold in | add "No accounts. Nothing kept about you but a nickname you chose." | the doorway |
| 12–13 | DJ, Call, Foot | keep | `Call` gets the second call to action | — |

---

## Copy discipline

The failure mode to avoid is swapping vague poetry for engineering vocabulary.
The rule for every new line: **would a listener notice this?** If it names a
mechanism, rewrite it.

| Do not say | Say |
|---|---|
| Clock offset, ping/pong, drift correction | "Everyone is inside the same second. Nobody is thirty seconds ahead." |
| HTTP Range requests | "Walk in at 2:14 and you land at 2:14, with everyone else." |
| WebRTC, duck gain, a 60-second lease | "When someone speaks, the music steps back — everywhere at once." |
| `activeLineIndex`, transcript parsing | "The words move with the voice. Tap a line to go there." |
| `localStorage` position restore | "It remembers where you stopped." |
| LRCLIB read-through | "The words to what's on, keeping up with it." |
| Open reads, drafts, slugs | "One link. Anyone can open it. No account." |

The mechanism already has a home. `/how-it-works` explains sync, ducking and
session lifetimes properly, and links to it from the sync and podcast claims are
the right place for anybody who wants that. The landing page keeps the feeling.

---

## Components

Nothing here uses Tailwind, so every Aceternity component in this project is a
hand-port to the BEM classes and `tokens.css`, with a provenance comment at the
top naming the original. See `TracingBeam.tsx`, `MacbookScroll.tsx`,
`StickyScroll.tsx`, `podcast/TiltCard.tsx`. "Add a component" always means
"port one", and that is priced in below.

### The order to reach in

1. **A real station or podcast component.** Most honest, no port. This is the
   page's own stated doctrine (`Landing.tsx:44`): the deck and the level meter
   here are the station's own components imported unchanged.
2. **A port already vendored.** `DraggableCard`, `FeyCards`, `FlipBoard`,
   `GlareCard`, `Globe`, `InfiniteMovingCards`, `MacbookScroll`,
   `MaskContainer`, `ResizableNavbar`, `Spotlight`, `SquigglyText`,
   `StickyScroll`, `TracingBeam`, `CardStack`.
3. **A new port.** Four of them, below.
4. **Custom.** Only where nothing above fits.

### What each section gets

| Section | Visual | Source | Rough cost |
|---|---|---|---|
| Hero | **Flip Words** — "Tonight it's a *record* / a *conversation*", the whole music-and-talk balance in one moving line | new port | ~60 lines |
| 5. Inside a session | **Bento Grid** — five unequal cells, each holding a real fragment: `Waveform` and a clock, a lyric line lit, two chat bubbles, one wish, the tracklist rows | new port, mostly CSS grid, plus reuse of `Turntable.tsx`, `ListenerView.tsx`, `session.ts` | ~120 lines |
| 7. Some nights it's a voice | **Multi Step Loader** — hand raised, sound check, invited, on air. It is the floor state machine drawn. Beside it the `Waveform` level visibly dropping when a voice arrives, which is the ducking claim shown rather than stated | new port, plus reuse of `Waveform` | ~140 lines |
| 8. The podcast | **Apple Cards Carousel** — real posters from `/api/episodes`, 4:5, exactly card-shaped, expanding into show notes. Beside it a transcript demo whose lines dim and lift as the page's playhead moves, driven by the `useScrubbedSession` that already exists | new port, plus a custom demo | ~250 lines |
| 10. Journal | An icon row instead of a bare `<ul>`, using icons already imported in `ListenerView.tsx` | reuse | — |
| 11. Limits | `FlipBoard`, unchanged | — | — |
| 12. Call | `FeyCards`, unchanged, plus the second button | — | — |

Optional, if the page wants one more: **Compare**, a drag slider on the episode
mock moving between show notes and transcript, which is what `data-beside`
already switches between.

### What not to add

`Vortex`, `Aurora Background`, `Wavy Background`, `Meteor Effect`, `Sparkles`,
`Background Boxes`, `Shooting Stars`, `Background Beams`. They are decoration
with no referent, and this page's rule is the opposite: every instrument on it
is `aria-hidden` and is a picture of a clock rather than a clock
(`Landing.tsx:1049`). They would also fight a bundle already carrying three.js,
the globe and the gramophone.

### Rules every new port inherits

Because every existing one does them:

- `aria-hidden` on anything that is an instrument rather than content
- the real text present in the DOM even when it is revealed a piece at a time,
  the way `Room` and `Limits` do it
- `prefers-reduced-motion` respected by **stopping**, not slowing, which is the
  rule `Blob.tsx` documents
- a provenance comment at the top with the Aceternity URL
- **no imports from `client/src/podcast/` into the landing bundle.** Copy the
  handful of CSS rules instead. That bundle is deliberately 25 kB and separate.

---

## Build order

| Phase | Work | Visual |
|---|---|---|
| 0 | The truth pass: `Landing.tsx:188`, `:455`, `:1009` | none, pure deletion |
| 1 | The podcast section, the real episode fetch with its fallback, the nav, hero and footer ways into it | Apple Cards Carousel, transcript demo |
| 2 | Inside a session, replacing `Works` and absorbing `Guide` | Bento Grid |
| 3 | The voice section, expanding `Talks` | Multi Step Loader, the ducking meter |
| 4 | Hero and `Call`, the second call to action, and a copy pass over the whole page | Flip Words |

Phase 0 stands on its own: if everything after it were abandoned, the page would
still be honest, which is why it goes first. Phase 1 is next because the podcast
is the actual complaint, and because it is the only new section carrying real
data.

---

## Things that will bite

- **The nav bar.** `Landing.tsx:125` records that adding a link moves a number
  in `landing.css` — see the note on `.navbar__body[data-shrunk='true']`. The
  pill's floor is measured against the words actually in it, and a sixth link
  added without moving it puts the first one back on top of the wordmark.
- **`FlipBoard` is 4 rows of 22.** Eighty-eight characters is the ceiling and
  anything longer is silently `slice`d rather than overflowing where you would
  see it. Any new limit line has to fit.
- **The DJ's lines are grouped by `nth-child`.** Adding or reordering one in
  `DJ` silently moves the spacing, and nothing checks that the breaks still land
  between thoughts.
- **Posters are exactly 1080x1350**, enforced by the server. The landing strip
  has to be a fixed 4:5 box with lazy loading below the first card, or it will
  shift the layout on a slow connection.
- **The landing bundle already carries three.js, the globe and the gramophone.**
  The poster strip must be a fetch and an `<img>`, never an import from the
  podcast bundle.
- **The fallback is not optional.** The podcast section has to render the same
  when `/api/episodes` cannot be reached, or the page breaks the principle it
  was built on: it has to describe the station when the station is down, which
  is exactly when somebody needs it to.
