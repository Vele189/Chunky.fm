# Reverse brainstorm board — chunky.fm

How to fill the FigJam "Reverse brainstorming" template with this project, and
what to change about the template itself.

---

## 1. The header

| Template says | Replace with |
|---|---|
| Title: "Improving customer retention" | **"Getting a room of friends into the same song"** |
| Avatar chip | The chunky.fm mark, or your own avatar — this board goes in the case study, so it should look owned |

Delete the two instruction sections ("About this template", "Quick tips") once
you have read them. They are Figma's copy, and a recruiter scrolling your board
should not meet Figma's onboarding first.

---

## 2. Column 1 — Define the problem

One sticky:

> Friends who want to listen to music together online end up with something
> broken: private queues, drifting audio, and nobody in charge of the records.

---

## 3. Column 2 — Reverse the problem

One sticky. Reverse it as a *goal to sabotage*, which is what makes the next
column easy to fill:

> How would we guarantee that a group of friends NEVER hears the same song at
> the same time — and that the session never even starts?

---

## 4. Column 3 — Collect ideas (how to guarantee failure)

Ten stickies. Write them as instructions to yourself, in the worst possible
voice — the tone is what makes the exercise work.

1. Make everyone install an app and create an account before they hear anything.
2. Require all of them to hold the same paid subscription.
3. Start every listener at 0:00, so whoever arrives late hears a different part
   of the song.
4. Let the audio drift apart and never correct it.
5. Hide who else is in the room, so nobody knows anyone came.
6. Make the host stand up an encoder and a streaming server before playing one
   record.
7. Charge more for every extra listener who joins.
8. Leave nobody responsible for choosing, so the group debates and nothing
   plays.
9. Cut the music dead the moment anyone speaks.
10. When the host is not around, show a dead page that says nothing.

---

## 5. Column 4 — Reverse the ideas

Ten stickies, **aligned row by row** with column 3. Keep one idea per row so a
reader can trace a single line left to right across the whole board. This
alignment is the single biggest improvement you can make to the template.

1. Open with one link. A nickname is the whole sign-up.
2. Free to join, no platform to belong to.
3. A latecomer lands exactly where the room already is, mid-song.
4. Correct the drift continuously, without anyone noticing.
5. Show the room as names, because thirty people fit on a list.
6. The host uploads a file and presses play. That is the whole set-up.
7. Adding a listener costs nothing extra.
8. One host picks, in public, and that is the point rather than a burden.
9. Voice sits on top of the record instead of replacing it.
10. Off air still feels like somewhere, and says when the next session is.

---

## 6. Column 5 — Find solutions

Ten stickies, same rows again. This column is where the case study earns its
keep, because each one is a real design decision rather than a wish.

1. An invite link of the form `/?k=…` that redeems itself and lands on a single
   nickname field.
2. No account system at all. Identity is a nickname held on the device.
3. Position is derived from a start time in the past, so joining at 2:14 and
   joining at 0:00 are the same code path.
4. A clock handshake on connect and every thirty seconds after, correcting drift
   by nudging playback speed rather than jumping the track.
5. A presence rail of nicknames, sized for a room of about thirty.
6. An admin surface: drag and drop the files, build the queue, go live.
7. The server broadcasts a small piece of state, not audio, so a listener costs
   nothing to add.
8. Decks, a now-playing card and a visible host — the person is part of the
   interface.
9. A talk-over that ducks the music under the voice, plus a raised hand and a
   co-host seat.
10. An off-air state carrying the next session time and the archive of past
    ones.

---

## 7. Changes to make to the template itself

**Recolour to the product.** The template ships lilac, pink, orange and mint.
chunky.fm is near-black with a red accent — the palette in
`client/src/brand/brand.css` is `#101010` and `#171717` for surfaces, `#d4d4d4`
and `#a1a1a1` for text, and `#fb2c36` / `#ff6467` for the accent.

> Correction to the earlier FigJam prompts in
> [figjam-prompts.md](figjam-prompts.md): those say amber. The brand accent is
> red. Use `#fb2c36` wherever those prompts say amber.

Keep the four column tints distinct but muted, and reserve the red for one
thing only — the row you decide is the most important. On this board that is
row 3, the latecomer landing mid-song.

**Add a fifth column: "Already true".** The template assumes the solutions are
hypothetical. Yours are built. Add a narrow final column and tick the rows that
already exist in the product, so the board doubles as a scope map rather than a
wish list.

**Add a row-number gutter.** Number the rows 1 to 10 down the left edge. It
costs nothing and it is what lets someone read one idea across five columns
without losing their place.

**Lock the header and the column frames.** Select each section and lock the
background only, so stickies stay draggable while the layout cannot be knocked
out of alignment.

**Set a timer per column** if you run this with anyone else: eight minutes on
column 3, five on column 4. The sabotage column should feel rushed, because
speed is what stops people self-censoring.

**Take the screenshot before you tidy.** A board with slightly uneven stickies
reads as work. A perfectly aligned one reads as a diagram made afterwards, and
loses the thing you want it to prove.

---

## 8. Where this lands in the case study

This board belongs in **Step 4 — Ideate**, not Step 1. It is evidence of method.
Pair the screenshot with two sentences naming the row that changed the product
most, and link the full board so anyone can zoom in.
