# FigJam prompts — chunky.fm case study

Paste these into FigJam's AI ("Generate"), Figma Make, or any assistant with
Figma write access. Prompt 1 builds the working board. Prompt 2 builds the
problem-to-solution diagram that goes into the portfolio.

---

## Prompt 1 — Case study board template

> Create a FigJam board titled **"chunky.fm — UX case study"**, laid out left to
> right as six titled sections with generous space between them. Use a dark
> neutral background with one warm amber accent for headings.
>
> **Section 1 — Context & Problem.** Three columns of sticky notes, headed
> "Problem", "Goal", "Role & Constraints". Under Problem, place these stickies:
> "Streaming is built for one pair of headphones"; "Shared-session features need
> everyone on the same paid plan"; "Screen share and music bots drift out of
> sync"; "Music ducks every time someone speaks"; "You cannot see who else is in
> the room"; "Hosting a real station needs an encoder and a server"; "Bandwidth
> cost scales per listener"; "The person with the taste never gets to play it".
> Under Goal: "One host, about thirty friends, the same second of the same
> record"; "One pasted link, no account, no install"; "Join mid-song and land
> where everyone else is". Under Role & Constraints: "End-to-end product
> designer, solo"; "Mobile first"; "Nickname only, no accounts"; "Session-based
> — the station exists while the host is live"; "One station, one permanent
> link"; "Server broadcasts state, not audio".
>
> **Section 2 — Research.** Two empty areas headed "Competitive teardown" and
> "Interview notes", each with a 3-column, 5-row grid of empty stickies.
>
> **Section 3 — Define.** Two person-shaped placeholder cards headed "The Host"
> and "The Listener", each with empty stickies labelled "Goals", "Frustrations",
> "Context of use". Below them, a row of five empty stickies headed "How might
> we…".
>
> **Section 4 — Ideate & wireframe.** An empty 4-by-3 grid of frames sized for
> mobile wireframes, headed "Low-fidelity screens".
>
> **Section 5 — Design.** Empty placeholder frames headed "Design system",
> "Key screens", "Prototype".
>
> **Section 6 — Test & iterate.** A three-column table headed "What we tested",
> "What broke", "What changed".
>
> Number each section heading 1 to 6 and connect the sections left to right with
> thin arrows so the board reads as one process.

---

## Prompt 2 — Problem-to-solution diagram

> Create a FigJam diagram titled **"chunky.fm — from problem to solution"**.
> Dark background, one warm amber accent, everything else neutral grey and off-
> white. Lay it out in four vertical bands, top to bottom, each band labelled on
> the left.
>
> **Band 1 — The world today.** Two grouped clusters side by side. Left cluster
> headed "The listener", containing four boxes: "Private algorithmic queue",
> "Shared listening needs the same paid plan", "Screen share drifts out of
> sync", "No sense of who else is here". Right cluster headed "The host",
> containing three boxes: "Encoder and streaming server", "Cost scales per
> listener", "Taste is blocked behind setup". Colour every box in this band a
> muted, desaturated grey.
>
> **Band 2 — The gap.** One wide box across the full width, in the amber accent,
> reading: "No small, shared room — a host, thirty friends, and one moment
> everybody is inside of at the same time." Draw arrows from every box in Band 1
> down into this box.
>
> **Band 3 — The insight.** One box, outlined in amber but not filled, reading:
> "Do not stream the audio. Broadcast the moment." Underneath it, one line of
> smaller text: "The server holds a track, a start time and a pause point. Every
> browser plays the file and aligns itself to a shared clock."
>
> **Band 4 — The design response.** Five boxes in a row, each with a short title
> and one line of supporting text:
> 1. "One link" / "Paste it anywhere. No account, no install."
> 2. "Land live" / "Join at 2:14 and hear 2:14. Never the start."
> 3. "A visible room" / "Nicknames and presence, not a listener count."
> 4. "A host at the decks" / "One person picks the records, in public."
> 5. "Honest off-air" / "When the station sleeps, the page still feels like
>    somewhere."
> Draw an arrow from Band 3 down into this row, then a bracket under the row
> labelled "chunky.fm".
>
> Keep the type hierarchy strict: band labels smallest, box titles bold, support
> text lightest. No icons, no emoji, no drop shadows.

---

## Prompt 3 — User flow (optional, Step 4)

> Create a FigJam flowchart titled **"chunky.fm — listener and host flows"**,
> with two swimlanes.
>
> **Listener lane:** "Receives link" → "Opens /?k=key" → "Redeems invite" →
> "Enters nickname" → decision "Is the station live?" → yes: "Lands at the live
> position, mid-song" → "Sees presence, now playing, chat" → "Sends a wish" →
> "Raises a hand to speak"; no: "Off-air page with the next session time" →
> "Leaves or waits".
>
> **Host lane:** "Opens /admin" → "Uploads tracks" → "Builds the queue" → "Goes
> live" → "Plays, crossfades, talks over the record" → "Invites a listener to
> speak" → "Ends the session" → "Session is archived as a podcast episode".
>
> Use diamonds for decisions, rounded rectangles for steps, and one amber
> highlight on "Lands at the live position, mid-song" because that is the moment
> the whole product exists for.
