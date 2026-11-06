# Research kit — chunky.fm

Everything needed to run Step 2 of the case study: who to recruit, what to ask,
how to turn the answers into one insight and one persona.

Run this before writing the Step 2 section. Four conversations of thirty
minutes is enough. The write-up is stronger with four real ones than with
forty invented ones, and interviewers do ask follow-up questions about the
quotes on your slides.

---

## 1. Who to recruit

You need people who have already tried to listen to music with other people
remotely — whether or not it worked. Aim for four, with at least one from each
group.

| Group | Why they matter | Where to find them |
|---|---|---|
| The improviser | Screen-shares YouTube or Spotify on a call so friends can hear it. Lives with the broken version daily. | Any group chat. Ask: "has anyone ever played music for the rest of us on a call?" |
| The would-be host | Has a record collection, makes playlists for people, has thought about DJing and not done it. | Music-nerd friends, record shop regulars, anyone who sends you songs unprompted. |
| The actual host | Has streamed a set on Twitch, run a Discord listening night, or hosted a radio show, even once. | Discord music servers, community radio, campus radio. |
| The joiner | Turns up to other people's listening sessions, never hosts. | The quiet ones in the same servers. |

**Screener questions** — three yes/no, ask before booking:

1. In the last year, have you listened to music at the same time as friends who
   were not in the room with you?
2. Have you ever been the person choosing the music for a group online?
3. Do you use any paid music service?

Anyone answering yes to 1 or 2 is worth thirty minutes.

---

## 2. Interview script

Thirty minutes. Do not describe chunky.fm until the very end — once they know
what you built, you stop hearing about their life and start hearing about your
product.

**Warm-up (3 min)**

- Tell me about the last time you listened to music with other people.
- Were they in the room with you, or somewhere else?

**The last real attempt (10 min) — the most valuable block**

- Walk me through the last time you listened to music with someone who was not
  in the room. Start from how it was arranged.
- Who decided what was played?
- What did you use to do it? Why that and not something else?
- What did you do when it went wrong?
- Did you finish the session, or did it fizzle out? What happened at the end?

**Hosting (7 min)**

- Have you ever been the one picking? What was that like?
- If not, what has stopped you?
- What would make you nervous about playing music to a group of friends?
- Who would you want in the room? Who would you not want?

**Value and alternatives (5 min)**

- What do you get from listening together that you do not get from listening
  alone?
- Have you ever tried a tool built for this? What happened to it?
- When was the last time you heard a song and immediately wanted someone
  specific to hear it too?

**Close (5 min)**

- If it worked perfectly, what would that evening look like?
- Only now: describe chunky.fm in one sentence and ask what they expect it to
  do. Note the gap between their expectation and the real thing — that gap is a
  design brief.

**Rules while running it.** Ask about the last actual occurrence, not about
habits in general. People report habits inaccurately and occurrences
accurately. Never ask "would you use", it has no predictive value. When someone
says something surprising, stop and ask "why?" three times.

---

## 3. Hypotheses to test

Write these down before the interviews. The case study gets its "aha" moment
from a hypothesis that turns out to be wrong, so the value is in recording what
you expected first.

| What I expect to hear | What might actually be true |
|---|---|
| Sync is the core frustration | Sync is barely noticed. The real failure is social: nobody agrees to start, so the session never happens. |
| People want the technology to be better | People want permission to be the host, and a room small enough that playing a bad record is safe. |
| Cost is a barrier | Coordination is the barrier. Getting five people in the same hour is harder than any setup step. |
| Listeners want control over the queue | Listeners want to be off the hook — the pleasure is in someone else deciding. |
| Joining late is a minor detail | Joining late is the whole anxiety. People skip the session rather than walk in halfway. |
| Voice on top of music is a nice extra | Voice is what makes it a room rather than a playlist, and its absence is why screen-share calls still win. |

---

## 4. Synthesis method

1. After each interview, write the three most surprising sentences on three
   stickies, in the participant's own words. Do this within an hour.
2. Once all four are done, put every sticky on one FigJam board. There should
   be about twelve.
3. Group by what the sticky is about, not by who said it. Name each group with
   a full sentence, not a label. "Nobody wants to be the one who starts it" is a
   finding. "Coordination" is a filing cabinet.
4. Count: a group holding stickies from three of four participants is a
   pattern. One participant is a quote, not a finding.
5. For each pattern, write the line that follows it: **"Because of this, the
   design must ___."** A pattern that changes nothing about the design does not
   belong in the case study.

---

## 5. Write-up template

Fill this and paste it into `case-study.md` under Step 2. Keep it to one screen.

> **What I did.** Four thirty-minute interviews with people who had tried to
> listen to music with remote friends in the last year: <!-- who -->.
>
> **What I expected.** <!-- one sentence, the hypothesis you wrote down first -->
>
> **What I found instead.** <!-- the insight, with the count: "3 of 4 said…" -->
>
> **The quote that changed the design.** <!-- one verbatim line, attributed to a
> first name and a role -->
>
> **Two supporting findings.** <!-- one line each, each ending in what the
> design must do -->
>
> **What it changed.** <!-- name the specific screen or behaviour that exists
> because of this research -->

Three findings is the correct number for a portfolio. More reads as a data
dump, and a recruiter with thirty seconds will not reach the fourth.

---

## 6. Persona

Make one, not five. chunky.fm has two sides, so the choice matters:

**Make the host the primary persona.** Without a host there is no station, and
every hard design problem in the product — going live, the decks, talking over
a record, ending a session — is theirs. The listener is the secondary persona
and can be half a card.

Keep the card to six fields. Anything more is decoration:

| Field | What goes in it |
|---|---|
| Name and one-line identity | A real first name and a role, not a stock photo caption |
| Context of use | Where and when they would actually run a session |
| Goal | The one thing they are trying to achieve, in their words |
| Frustration | The one thing that stops them today, taken from an interview |
| What they already use | The tool they improvise with now |
| The sentence they said | One verbatim quote, which is what makes the card believable |

Every field must be traceable to something a real person said. A persona
containing a fact no participant gave you is fiction, and it is the first thing
a design lead will test in an interview.
