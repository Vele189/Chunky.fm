# chunky.fm — UX case study

> Working draft. Step 1 (Context & Problem) is written. Later steps are
> outlined so the document keeps one shape as it grows.

---

## Step 1 — Context & the problem

### The 30-second version

Streaming made music infinite and private. Everyone has their own queue, their
own algorithm, and no one to hear it with. When friends do try to listen
together online, they end up on a video call with a screen share: the audio
drifts, it cuts out when someone talks, and nobody is really in charge of the
music.

**chunky.fm is one link that drops a room of friends into the same second of
the same record, with a host at the decks.** Arriving twenty minutes late puts
you where everyone else already is, mid-song, the way walking into a bar does.

I designed and built it end to end, solo.

---

### The problem statement

Listening together online is either private or broken.

**For the listener.** Every major service is built around one pair of
headphones. Shared-session features exist, but they require every person to
hold a paid account on the same platform, so the group is only ever as wide as
its narrowest subscription. The fallbacks — a screen-shared tab, a Discord
music bot — lose sync, duck the music every time someone speaks, and offer no
sense of who else is in the room. Nothing tells you that the song you are on is
the song your friend is on.

**For the host.** Running a real internet station has always been an
infrastructure problem before it is a taste problem. An encoder, an Icecast or
Shoutcast server, a bitrate decision, and a listener count that costs money per
head. The result is that the person with the record collection and the ear for
a set never gets to play it to their friends, because the cost of entry is
sysadmin work, not curation.

**The gap.** Between the private algorithm and the professional broadcast
stack, there is no small, warm, shared room: a host, thirty friends, and one
moment that everybody is inside of at the same time.

---

### The goal

> Design a station where one host plays records to about thirty friends, and
> every person hears the same instant of the same track — reachable from a
> single pasted link, with no account, no install, and no setup on the
> listener's side.

Success criteria I designed against:

| Criterion | Target |
|---|---|
| Time from tapping the link to hearing music | Under 10 seconds, no sign-up step |
| Drift between any two listeners | Imperceptible — under a quarter of a second |
| Joining mid-song | Lands at the live position, never at 0:00 |
| Host set-up before going live | Upload, press play — no encoder, no config |
| Concurrent listeners | Around 30, the size of a room, not a broadcast |

---

### My role

**End-to-end product designer and front-end developer. Solo project.**

I owned every stage: the research and competitive teardown, the information
architecture, the user flows for both listener and host, wireframes, the visual
language and design system, the interactive prototype, and the production
front-end build in React.

Because I designed and shipped it, one loop stayed tight throughout: every
interface decision had to survive real playback on a real phone, which killed
several ideas that tested well as a static mockup.

---

### The constraints

**Timeline.** <!-- REPLACE: e.g. 3 weeks of design, N weeks of build --> weeks.

**Tools.** Figma for wireframes, UI and the prototype. Miro (or FigJam) for the
competitive teardown and the flows. <!-- REPLACE with the tools you actually used -->

**Self-imposed product constraints.** These shaped the interface more than any
style decision, so they belong in the brief rather than in a footnote:

| Constraint | What it forced in the design |
|---|---|
| No audio streaming from the server — the server broadcasts a small piece of state and each browser plays the file, aligned to a shared clock | The interface has to earn the listener's trust that they are live, because there is no buffering spinner to hide behind. Presence, the shared clock and the now-playing state carry that job. |
| Nickname only, stored on the device — no accounts, no passwords | Onboarding is one field. Identity is social, not administrative, so the design leans on nicknames and presence rather than profiles. |
| Session-based — the station exists only while the host is live | The product needs an honest off-air state that still feels like somewhere, instead of a dead page. |
| One station, one permanent link | No browsing, no discovery layer, no directory. The whole IA is a single room, which removes navigation as a design problem and puts all the weight on the one screen. |
| Around 30 concurrent listeners | Presence can be a readable list of names rather than a count. The room can afford to feel personal. |
| Listeners request music as free text, not from a library | The request surface is a message, not a search interface. |
| Mobile first | The station is used one-handed, often alongside something else. Primary controls sit in thumb reach, and the desktop layout is the adaptation, not the origin. |

---

## Step 2 — Research & insights

> Run the interviews before filling this in. The kit — recruiting, script,
> hypotheses, synthesis and the persona card — is in
> [research-kit.md](research-kit.md). Placeholders below are marked `REPLACE`.

### What I did

Four thirty-minute interviews with people who had tried to listen to music with
remote friends in the past year: REPLACE — one improviser who screen-shares on
calls, one would-be host, one person who has actually run a listening night, one
habitual joiner.

I asked about the last real occurrence rather than about habits, and I did not
describe chunky.fm until the final five minutes, so that the conversation stayed
about their evening rather than about my product.

### What I expected to hear

That the core frustration was technical: audio that drifts out of sync between
listeners, and the setup cost of hosting anything.

### What I found instead

REPLACE — the insight, stated with its count. Example shape:

> Three of four never mentioned sync unprompted. The session failing was not the
> problem; the session never starting was. Nobody wanted to be the person who
> asked everyone to show up at the same hour and then chose what everyone heard.

**The quote that changed the design.**

> REPLACE — one verbatim line. — First name, role

### Supporting findings

| Finding | What the design must do |
|---|---|
| REPLACE | REPLACE |
| REPLACE | REPLACE |

### What it changed

REPLACE — name the specific screen or behaviour that exists because of this
research, not a general principle.

### The persona

**Primary: the host.** Without a host there is no station, and every hard
design problem in the product belongs to them — going live, working the decks,
talking over a record, ending the session.

| | |
|---|---|
| **Name and identity** | REPLACE |
| **Context of use** | REPLACE |
| **Goal** | REPLACE |
| **Frustration** | REPLACE |
| **Uses today** | REPLACE |
| **In their words** | REPLACE |

**Secondary: the listener.** REPLACE — three lines, no more.

---

## Steps 3–6 — outline

- **Step 3 — Define.** Personas for the host and the listener, the two journey
  maps, and the problem reframed as "how might we" statements.
- **Step 4 — Ideate & wireframe.** Information architecture, low-fidelity
  flows, and the decisions that were cut.
- **Step 5 — Design & prototype.** The visual system, the components, and the
  interactive prototype.
- **Step 6 — Test & iterate.** Usability sessions, what broke, what changed,
  and the measured outcome.
