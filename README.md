# Chunky.fm

A single, permanent radio station. See [PLAN.md](PLAN.md) for the design.

## Running it

In Docker, the whole station from one command:

```bash
./start.sh
```

It writes a `.env` with a generated `ADMIN_PASSWORD` the first time, builds both
images, and waits until the station answers before telling you where it is —
<http://localhost:18173> to listen, `/#admin` to run it.

```bash
./start.sh --build    # rebuild both images first
./start.sh logs       # follow them
./start.sh status     # what is up, and how healthy
./start.sh stop       # stop, keeping the library
```

The published ports are `18173` (station) and `13000` (API) rather than the
`5173`/`3000` that `npm run dev` uses, so the container stack and a dev server
can be up at the same time without fighting over a port. Change them in `.env`
(`WEB_PORT`, `SERVER_PORT`), or per-run: `WEB_PORT=18080 ./start.sh`. If either
is already taken, `start.sh` says so by name instead of letting Docker fail with
a container id.

### What is actually running

Two containers, not three. chunky.fm's database is SQLite, opened in-process by
the server through `better-sqlite3` — there is no database server to start, and
the thing a `db` container would own is a volume instead:

| | |
|---|---|
| `server` | Fastify — API, `/ws`, and the SQLite file it opens directly. Always :3000 inside the network; published on `SERVER_PORT`. |
| `web` | nginx serving the built client, proxying `/api` and `/ws` to `server` — the same job Vite's dev proxy does, so the client ships unchanged. |
| `chunky-fm_data` | The volume behind `AUDIO_STORAGE_DIR`: `chunky.sqlite`, audio, artwork. |

Those three parts of the volume only mean anything together — the rows name
files, so back it up whole:

```bash
docker run --rm -v chunky-fm_data:/data -v "$PWD:/out" busybox \
  tar czf /out/chunky-backup.tar.gz -C /data .
```

`./start.sh stop` and `--build` both leave it alone. To actually throw the
library away: `docker compose down && docker volume rm chunky-fm_data`.

### Without Docker

Two processes in development — the server, and Vite for the client:

```bash
cd server && npm install && cp .env.example .env && npm run dev   # :3000
cd client && npm install && npm run dev                           # :5173
```

Vite proxies `/api` and `/ws` through to the server, so the client only ever
talks to its own origin.

Then open <http://localhost:5173/#admin> and sign in with `ADMIN_PASSWORD` to
upload tracks and run the station. The browser trades the password for a session
cookie once and never sends it again; a shell has nowhere to keep a cookie, so
the password itself is accepted on any admin request too:

```bash
curl -H "Authorization: Bearer $ADMIN_PASSWORD" -F "file=@track.mp3" \
     http://localhost:3000/api/upload
curl -H "Authorization: Bearer $ADMIN_PASSWORD" -H 'content-type: application/json' \
     -d '{"action":"play","trackId":1}' http://localhost:3000/api/playback
```

Or queue tracks up and let the station run itself — the first one goes straight
on the decks, the rest follow as each track ends:

```bash
curl -H "Authorization: Bearer $ADMIN_PASSWORD" -H 'content-type: application/json' \
     -d '{"trackId":1}' http://localhost:3000/api/queue
```

## Server

```bash
cd server
npm install
cp .env.example .env      # set ADMIN_PASSWORD
npm run dev
```

Scripts: `npm run dev`, `npm run build`, `npm start`, `npm run typecheck`, `npm test`,
`npm run sync-check` (joins two listeners at different times and checks they land
on the same instant of the same song).

### Storage layout

Everything the station owns lives under `AUDIO_STORAGE_DIR` (the Railway volume):

```
audio_storage/
  audio/            <sha256>.mp3     — the uploaded files, named by content hash
  artwork/          <sha256>.jpg     — artwork extracted from tags
  tmp/                               — in-flight uploads, cleaned on completion
  chunky.sqlite
```

The database holds `tracks` (the library), and `sessions` + `messages` +
`wishes` + `plays` (the chat, the requests and what has been on — see below).
Playback, the queue, the roster and the skip tally are not in it: they are true
only while the process (or the socket) is up, by design.

### `POST /api/upload`

Admin-only, one audio file per request as `multipart/form-data`.

```bash
curl -H "Authorization: Bearer $ADMIN_PASSWORD" \
     -F "file=@track.mp3" \
     http://localhost:3000/api/upload
```

The upload streams to `tmp/` first and is only moved into `audio/` once
`music-metadata` confirms it is a container we can serve — so the declared
Content-Type is a hint, never the gate. Files are stored under their SHA-256,
which makes re-uploading the same track a no-op rather than a second copy.

| Status | When |
|---|---|
| `201` | Stored. Body is `{ track }`. |
| `400` | No file part, empty file, or a malformed multipart body. |
| `401` | Missing or refused admin credentials. |
| `409` | Already in the library. Body carries the existing `track`. |
| `413` | Over `MAX_UPLOAD_BYTES` (default 150 MB). |
| `415` | Not audio, or a container we don't serve. |

Supported containers: MP3, FLAC, Ogg/Opus, WAV, MP4/M4A, AIFF.

### Serving the library

| Route | What |
|---|---|
| `GET /api/tracks` | The library, as JSON. |
| `GET /api/audio/:filename` | The audio, with `Range` support. |
| `GET /api/artwork/:filename` | Artwork extracted at upload time. |

Range support is load-bearing: a listener joining at 2:14 has to fetch that byte
range before it can play, and without it the browser pulls the file from 0:00
first. URLs are content hashes, so responses are `immutable`.

### `GET /ws` — the station clock

The server owns playback and holds it entirely in memory:

```ts
{ track, startedAt, pausedAt }
```

Position is `pausedAt ?? (serverNow - startedAt)`. Nothing is streamed and there
is no per-listener state — listeners are handed the tuple and align themselves
to it. Because `startedAt` is a point in the past, joining at 2:14 is the same
code path as joining at 0:00.

**Server → client**

| Message | When |
|---|---|
| `{ type: 'state', track, startedAt, pausedAt, serverTime }` | On connect, and on every playback change. |
| `{ type: 'queue', entries }` | On connect, and on every queue change. |
| `{ type: 'presence', listeners }` | On connect, and whenever someone joins, leaves or renames. |
| `{ type: 'chat', messages }` | On connect (the tail of the conversation), and one per new message. |
| `{ type: 'wished', wish }` | To the socket that made a wish, and to nobody else. |
| `{ type: 'history', plays }` | On connect (the evening so far), and one per track going on. |
| `{ type: 'skips', trackId, votes, voted }` | On connect, on every skip vote, and whenever a track change clears the tally. |
| `{ type: 'pong', t0, t1 }` | In reply to a clock probe. |
| `{ type: 'error', code, message, about? }` | Anything the socket refused; the connection stays open. |

`code` is machine-readable and `message` is prose, the same split as the `error`
field on every HTTP refusal — a client telling `slow_down` from `not_joined`
switches on the code rather than matching on English. The codes are
`unrecognised_message`, `nickname_required`, `message_too_long`,
`empty_message`, `command_over_http`, `not_joined`, `no_chat`, `wish_too_long`,
`empty_wish`, `no_wishes`, `nothing_playing` and `slow_down`. `about` names the
frame a refusal was for — `'join'`, `'say'`, `'wish'` or `'vote'` — and is absent
only when the frame was too malformed to say what it was trying to do; a page
with two composers and a vote button needs it to put "not sent" under the right
one.

`wished` is the only message here that is not a broadcast. See **Wishes**.
`skips` is the only one sent socket by socket rather than serialised once, since
`voted` is a different answer for each listener. See **Skip votes**.

The queue and the roster are separate messages rather than fields on `state`:
playback changes several times a track and neither of the others does, so
folding them together would ship both on every seek.

**Client → server**

| Message | Purpose |
|---|---|
| `{ type: 'ping', t0 }` | Clock offset probe. |
| `{ type: 'join', nickname }` | "Here is what to call me." |
| `{ type: 'say', text }` | "Say this to the room." |
| `{ type: 'wish', text }` | "I'd love to hear this." Goes to the admin, not the room. |
| `{ type: 'vote_skip', voted }` | "I'd rather hear something else." Counts; skips nothing. |

Every frame a listener can repeat is paced per socket, with a bucket of its own:
five messages back to back (one earned back every 2s), five *roster-changing*
joins (one every 5s), three wishes (one every 30s), and five *tally-changing*
skip votes (one every 5s). Separate buckets, so being refused a wish never costs
a listener their voice. A join that renames a
socket to what it is already called broadcasts nothing and so costs nothing,
which is what keeps a reconnect's rejoin free. Over the limit is a `slow_down`
refusal, not a dropped connection. Chat and wishes are paced because the server
writes them down; `join` because a roster goes out to every listener each time
one changes, which is otherwise the cheapest way for one anonymous socket to
make the station shout at the whole room.

Browser clocks are wrong by seconds, so a client measures the offset NTP-style:
send `t0`, receive `t1`, note `t2` on arrival, then
`rtt = t2 - t0` and `offset = t1 - (t0 + rtt / 2)`. Run ~5 probes and keep **the
sample with the lowest RTT** — the fastest round trip is the least contaminated
by queueing delay. `t1` and `startedAt` are stamped from the same server clock,
so the measured offset applies directly.

Connections are read-only: nothing anyone can send over the socket changes
playback. That is also the socket's half of the admin gate — a socket
carrying a valid admin cookie gets no more than one carrying nothing, and frames
that look like commands (`play`, `skip`, `enqueue`, …) are refused *by name*, so
a client that tries is told where the controls actually are rather than left
guessing. There is no privileged frame here to authenticate, because every
mutation lives behind `requireAdmin` on an HTTP route.

**Commands go over HTTP, not the socket** — deliberately. The socket carries
state outward, and inward only what has nowhere else to go: a clock probe, which
is meaningless anywhere but on the connection it is measuring; a nickname, which
lives exactly as long as the socket does; a chat message, which has to reach
everyone in the room the moment it is sent; a wish, which has to be signed with
the name its own socket is listed under — a `POST` would have to be told who was
asking, and a request that names its own author can name someone else; and a
skip vote, which is that same signature problem plus a tally that has to reach
the room live. None of the five drives the station. An admin action wants
exactly what HTTP already gives it: a request/response pair, a status code that
says whether it worked, and — for upload — a body measured in megabytes. Adding
a second, authenticated command channel over the socket would duplicate that
surface and add an auth gate to get wrong, in exchange for nothing a `POST`
doesn't already do. A socket that cannot mutate anything is a socket that cannot
be abused into mutating something.

So the loop is: admin `POST`s, the server changes its state, and the change goes
out to every client — including the admin's own page — on the socket they all
already have open.

### Presence

The server keeps a socket → nickname map and broadcasts the whole roster
whenever it changes. `listeners` is `[{id, nickname}]`, in join order.

A socket is not a listener. A tab holds one open from the moment the page loads,
which is before anyone has typed a name, so the roster is who has *said* who
they are — `join` is what puts a listener on it, and the socket closing is what
takes them off. There is no leave frame: closing is the only signal that also
covers a tab closed, a laptop shut, and a network that simply stopped. A socket
that vanishes without a close is dropped by the heartbeat, so a listener whose
network died lingers for up to one heartbeat interval (30s) and no longer.

The id is the socket's, which has two consequences worth knowing. Two listeners
may pick the same nickname and are still two rows — the id is what keeps them
apart, and what a client should key its list on. And a listener who reconnects
comes back as a new row rather than reclaiming the old one: identity that a
client could assert is identity a client could assert about *someone else*, and
the roster is not worth an eviction primitive. Rosters go out whole rather than
as joins and leaves, so a client renders the last frame and has nothing to
reconcile.

A `join` buys a row and nothing else. Nicknames are re-normalised server-side —
collapsed, stripped of control characters, capped at 24 characters, and refused
when what's left is empty — because the client's own normalising is a courtesy
to the listener, not a guarantee to the server. Re-sending the name a socket
already has costs no broadcast; sending a different one is a rename, and keeps
the listener's place in the list.

### Chat

Unlike playback, the queue and the roster, this one is written down:

```sql
sessions  (id, started_at, ended_at)
messages  (id, session_id, nick, text, created_at)
```

A message is `{id, nickname, text, at}` on the wire, and frames carry a *batch*
of them: the tail of the conversation on connect, and a batch of one for each
new message. One frame type, one code path on the client — and because messages
carry ids, a client that merges on id gets two properties for free. A reconnect
replays history without duplicating a line, and whatever was said while it was
away arrives in that replay instead of being a hole in the conversation.

**Who said it is the server's answer, not the client's.** A `say` frame carries
text and nothing else; the author is the nickname the sending socket is listed
under on the roster. A frame that could name its own sender could sign someone
else's name to a message. That also makes the roster the gate: a socket that has
not joined has no name to sign with, and is told to name itself rather than
being quietly ignored. A rename applies from then on — what was already said
keeps the name it was said under, because `nick` is a copy, not a reference.

**Sessions.** PLAN.md's availability story is session-based — you go live, you
end it — and chat is scoped to a session, so "the chat" means this time on air
rather than everything ever said. The admin controls for starting and ending one
are a later task; for now a run of the process is a session, opened at startup
and closed on shutdown. A restarted station is a new session with an empty room,
and only the line that opens the session has to change when the admin can do it
by hand.

**Pacing.** Chat is the first thing a listener can send that the server writes
down, so each socket gets a token bucket: five messages back to back, one earned
back every two seconds. Without it, one client in a loop is an unbounded row
count and a broadcast storm to everyone else. Buckets are per socket rather than
per listener, so one listener talking never spends another's, and there is
nothing to clean up after a socket that never comes back. Over-length messages
are refused rather than truncated — the composer caps what can be typed, so
anything longer came from something hand-written, and quietly publishing half of
what it said would be worse than saying no.

### Wishes

PLAN.md's requests decision — *free-text wishes, no library browsing for
listeners* — written down next to the chat:

```sql
wishes  (id, session_id, nick, text, created_at, status)
```

A listener sends `{type: 'wish', text}` over the socket and gets back
`{type: 'wished', wish}`, where a wish is `{id, nickname, text, at, status}` and
`status` is `new` or `handled`. There is nothing to pick from and no `trackId`:
a listener asks in their own words, for something the station may not even have,
and whoever runs the decks reads it and decides. Nothing here touches the queue.

**A wish is not broadcast.** It reaches exactly two places — the admin, and back
to the socket that made it. That is the one thing on this socket that is not
sent to the room, and it is why `GET /api/wishes` is the one read in the API
behind the admin gate: everything else a listener could fetch they were already
sent, so gating it would protect nothing, while a public book would turn asking
for a song into asking in front of everyone. It is also why the frame comes back
at all — with no broadcast to see their wish arrive in, a listener would be left
guessing whether it went anywhere.

Who asked is the server's answer, exactly as it is for chat: the frame carries
no author, and the name written down is the one the sending socket is listed
under on the roster. So the roster is the gate here too — a socket that has not
joined has no name to sign with and is told to name itself.

| Route | What |
|---|---|
| `GET /api/wishes` | Admin. `{wishes, outstanding}` — this session's, oldest first, and how many are still waiting. |
| `POST /api/wishes/:wishId` | Admin. `{status: 'new'\|'handled'}` → the wish and the book as it now stands. `404 unknown_wish` otherwise. |

Marking is reversible, and a handled wish stays in the book: the mark is a note
to whoever is reading the list, and a misclick should not be the end of
somebody's request. The status is constrained in the schema as well as in the
type — the column outlives the process that wrote it, and a wish in a state
nothing can render is a wish nobody will ever see.

**Pacing.** Three wishes back to back, one earned back every 30 seconds —
tighter than chat, because a wish is not conversation. Every one of them is a
row somebody has to read, and a book nobody can get through is the same as no
book. The bucket is separate from the chat's, so being refused a wish never
costs a listener their voice. Over-length wishes are refused rather than
truncated, for the reason messages are: the admin would otherwise read out an
album title cut in half.

**Refusals say which composer they are about.** `slow_down` and `not_joined` are
reachable from both the chat and the wishes, and the page has a box for each, so
every socket refusal that is about something a listener typed carries
`about: 'say' | 'wish' | 'join'` alongside the code. Without it, a wish refused
for pace also puts "not sent" under the chat — telling someone a message they
never sent went nowhere.

### Skip votes

The room's opinion of what is on, and PLAN.md's line for it in full: *tally skip
votes as a set of socket IDs; clear it on every track change.* A listener sends
`{type: 'vote_skip', voted}` and everyone gets back
`{type: 'skips', trackId, votes, voted}`.

**A vote skips nothing.** No threshold here advances the station, and that is a
decision rather than an unfinished half: the socket carries nothing that drives
the decks, and a quorum that did would be exactly such a frame wearing a vote as
a disguise. PLAN.md puts *see skip tallies* on the admin surface — the tally is
the room telling whoever runs the decks something, and what happens next is a
person pressing Skip. A unanimous room is still a room.

**The votes are a set of listeners, not a counter.** One listener counts once
however many times they press it, and the frame carries where they now stand
rather than "toggle" — so a retry after a refusal, or a second tap on a slow
connection, leaves one vote instead of cancelling itself. A vote that changes
nothing broadcasts nothing and so costs nothing, exactly as a re-join under an
unchanged nickname does.

**A vote lives on the socket that cast it.** It is dropped when that socket
closes, which keeps a tally from counting people who left the room it is a
fraction of — otherwise "4 of 3 want the next one". That is also why `voted` is
the station's answer rather than something the page remembers: a client that kept
its own flag would show a vote across a reconnect that the station let go with
the old socket. It is the one field that differs per listener, and the reason
this frame is the only one sent socket by socket instead of serialised once.
Under thirty listeners, a stringify each is cheaper than a lie.

**Cleared on every track change, and only on a track change.** A pause, a seek
and a resume all leave the same song on, so the tally survives them — a count
that a seek could wipe would let the person the room is voting at clear it by
nudging the needle. The tally goes out *after* the state that cleared it, so no
client blanks the count against the song that just ended.

The roster is the gate, as it is for chat and wishes: a socket that has not said
who it is cannot vote, or the count would stop being a fraction of the room —
a script could open sockets and vote from each without ever appearing in it.
Voting with nothing on the decks is refused by code (`nothing_playing`) rather
than counted against whatever comes on next.

### Now-playing history

The other thing PLAN.md puts in SQLite, and the second list that outlives a
socket:

```sql
plays  (id, session_id, track_id, played_at)
```

A play is `{id, track, at}` on the wire, in batches like the chat: the evening
so far on connect, and a batch of one each time a track starts. Ids are the
play's, not the track's — the same track twice in an evening is two plays — so a
client that merges on id replays a reconnect without duplicating a line and
fills in whatever went on while it was away.

**A play is written when a track starts, and only then.** The history hangs off
the same `change` event the state broadcast does, because that is the one place
that sees every way a track can go on: the end-of-track timer, the admin
pressing play, a queue advancing by itself. But most of those changes are not a
track starting — a pause, a seek and a resume all leave the same song on — so
the track id is compared against what the log last saw, and only a different one
is a play. Unfiltered, an evening of one song would be forty rows. Going off air
writes nothing and resets that memory, so the same track starting after a stop
is a new play of it.

`played_at` is stamped from the station clock, not `Date.now()` — a play and the
`startedAt` of the same track describe one instant, and two timebases would
disagree about it.

**The row stores a track id, not a copy of the title** — the opposite of what a
message does with a nickname. A nickname is copied because a person can rename
themselves and what they said keeps the name it was said under; a track that
gets retagged was mislabelled all along, so the history should read correctly
rather than preserve the typo. It is *not* a foreign key even so, which is the
one place this table is looser than the others: the insert happens inside the
playback change event, so a constraint that could refuse it would throw into
whatever put the track on — an admin command answering 500 after the track
already changed, or the end-of-track timer dying mid-set. A note about what
happened must not be able to break the thing it is a note about. The read is an
inner join, so a play it cannot name is left out rather than rendered blank.

Scoped to a session, like the chat and the wishes: a restarted station starts a
new list, and the old rows stay where they are.

### `POST /api/playback` — admin

Driving the decks by hand: `{action: 'play'|'pause'|'resume'|'seek'|'stop'
|'skip', trackId?, positionMs?}`, admin-only, returns the new state. Every
command broadcasts over `/ws` before the HTTP response returns. `skip` is the
same advance the end-of-track timer performs — next queued track, or off air.

### `/api/admin/session` — the admin session

PLAN.md's password-for-a-signed-cookie exchange. The password crosses the wire
once, at sign-in, and what comes back is an HMAC-signed token in a cookie the
browser presents from then on.

| Route | What |
|---|---|
| `POST /api/admin/session` | `{password}` → `200 {ok, expiresAt}` and the cookie, `401`, or `429` once guesses are coming too fast. |
| `GET /api/admin/session` | `{ok: true}` while the session holds, `401` once it doesn't. |
| `DELETE /api/admin/session` | Signs out. Needs no credentials — dropping a cookie you hold isn't an attack. |

Sign-in is paced per caller: five wrong passwords, then one earned back a
minute, answered `429` with a `Retry-After`. The password is the whole admin
gate, so the rate at which a stranger can test guesses is part of how strong it
is — unpaced, a passphrase that would take centuries offline is a few hours of
HTTP. Only *wrong* attempts are charged, and getting it right clears the count,
so an admin who fumbles their own password twice is not then locked out of
their own station. Nothing else is throttled: a session already issued is a
credential its holder has proved.

```bash
curl -c jar -X POST -H 'content-type: application/json' \
     -d "{\"password\":\"$ADMIN_PASSWORD\"}" http://localhost:3000/api/admin/session
curl -b jar -H 'content-type: application/json' \
     -d '{"action":"skip"}' http://localhost:3000/api/playback
```

The cookie is `HttpOnly` (page script can't read the token, so an XSS can't
carry it off), `SameSite=Strict` (nothing the admin clicks elsewhere can drive
the station), and `Secure` whenever the request arrived over TLS — following the
scheme rather than hardcoding it, or development over plain HTTP would never get
the cookie back.

There is no session store. The token is `<expiresAt>.<nonce>.<signature>`, and
the expiry is *inside* the signed payload, so a client that keeps the cookie
past `Max-Age` still finds it refused. The signing key is derived from
`ADMIN_PASSWORD` (through an HMAC, so a signature is never an oracle for the
password itself), which means a restart leaves sessions intact and a **password
change ends every one of them at once**. Sessions last 12 hours — an evening,
not a week. Revoking one session in particular is not something a station with
one admin has any use for.

`GET` exists because every other admin route *does* something: there is no
harmless one to probe with, and the panel has to ask whether it is still signed
in before it shows a single control.

**The password is still accepted directly**, as `Authorization: Bearer …` or
`x-admin-password`, on every admin route — that is what the curl examples and
the QA scripts use. The browser is the thing that shouldn't be holding a shared
secret for hours; a one-liner in a terminal has nowhere else to put it.

### The queue

What's coming up lives in memory, not the DB: it's session-scoped and dies with
the process along with the rest of playback state. Entries are addressed by
**entry id, not position** — the queue shifts by itself every time a track ends,
so "remove the third one" races with auto-advance and removes the wrong track.
The same track may be queued more than once, and each sitting is its own entry.

| Route | What |
|---|---|
| `GET /api/queue` | `{ entries }`. Open, like `GET /api/playback`. |
| `POST /api/queue` | Admin. `{trackId}` → `201 {entry, entries}`. |
| `POST /api/queue/move` | Admin. `{entryId, toIndex}`, clamped to the queue. |
| `DELETE /api/queue/:entryId` | Admin. Drops one entry. |
| `DELETE /api/queue` | Admin. Empties the queue; leaves the current track playing. |

Queueing onto an **idle** station starts that track immediately — with nothing
on the decks there is nothing to wait for. A *paused* station stays paused;
that's the admin's decision, not an empty deck.

### Advancing

When a track ends the server moves to the next one on its own, so a station left
alone keeps playing. The mechanism is a `setTimeout` for the time remaining,
rescheduled from PlaybackState's `change` event — so a pause, a resume, a seek
or a hand-picked track all re-arm it correctly.

Behind that is a slower sweep (every 2s) that advances any track whose time is
up. A `setTimeout` fires late under load, and if the event loop stalls long
enough it may as well not have fired at all; the failure mode is dead air until
someone notices. The station clock, not the timer, decides whether a track is
over — a timer that fires early goes back to sleep for what's actually left.
Overrun isn't carried over: the next track always starts at 0:00.

## Client

React + Vite, one page. The listener names themselves and taps **Tune in** —
which is also the user gesture browsers require before audio may start — and
from then on the page follows the station.

- `lib/position.ts` — where the needle should be, given the tuple and a server time.
- `lib/nickname.ts` — the nickname: normalising it, and keeping it in localStorage.
- `lib/chat.ts` — what is worth sending, and folding a batch into what is shown.
- `lib/wishes.ts` — what is worth asking for, and what a refused wish should say.
- `lib/skips.ts` — the skip tally: what it is about, and how it reads.
- `lib/history.ts` — folding in what has been on, and what counts as *earlier*.
- `lib/station.ts` — the websocket, with reconnect and backoff.
- `lib/availability.ts` — whether there is a station there, and what to say when there isn't.
- `lib/admin.ts` — the admin's side of the HTTP API, and where `#admin` lives.
- `hooks/useAdminSession.ts` — signs in, and asks the station whether it still counts.
- `lib/clock.ts` — clock offset estimation from ping/pong samples.
- `lib/drift.ts` — what to do about an error of a given size.
- `hooks/useServerClock.ts` — runs the handshake, exposes `serverNow()`.
- `hooks/usePresence.ts` — says who this listener is, and says it again on reconnect.
- `hooks/useSyncedAudio.ts` — aligns on every broadcast, and every 2s in between.
- `AdminPanel.tsx` — the decks, for whoever runs the station.

### Joining

The join screen asks for a nickname, and the station will not take a listener
without one: the button stays disabled until the field has something in it, and
pressing Enter on an empty field is refused the same way. What comes back is
stored under `chunky.fm:nickname` in localStorage — PLAN.md's identity story in
full, with no account and nothing held server-side.

The nickname and the join are deliberately the *same* gesture. Browsers only
start audio from inside a user gesture, so the form's submit handler is where
`play()` has to be called; a nickname step before a separate Tune in button
would leave the audio starting outside any gesture at all.

A returning listener finds the field already filled and joins without retyping,
but still has to press the button — a name in localStorage is not a gesture, and
a page that tried to start playing on load would be refused by the browser.
Nicknames are normalised on the way in *and* on the way out: whitespace runs
collapse, control characters go, and the result is capped at 24 characters, so
what a listener finds when they come back is a name rather than whatever pasting
went wrong. A browser that refuses storage — Safari's private mode throws on
write, and blocked cookies throw on even touching `localStorage` — costs the
listener a retype next visit and nothing else.

### Who's listening

Once tuned in, the page shows the room: everyone currently listening, by
nickname, updating as people arrive and leave. It is the roster the socket
broadcasts, rendered whole each time — rows keyed on the listener id, so two
people called "sam" are two chips rather than one.

The nickname reaches the server as a `join` frame sent *after* tuning in, not on
connect: a socket opens with the page, and a name typed into the field is not
yet someone in the room. `usePresence` waits for the connection to be open
rather than merely to exist — a send on a socket that is still opening is thrown
away in silence, and a join lost there would be a listener nobody can see, with
nothing to retry it. It is the same trap the clock handshake fell into once,
which is why both hooks are written against `connected` rather than `connection`.

Hanging the join off `connected` is also what makes reconnection work: presence
lives with the socket, a reconnect is a new socket, and the effect re-runs each
time the connection comes back. So a listener who drops during an outage is put
back on the roster by the same line that put them there in the first place, and
a station that restarts finds its room refilling on its own. `npm run
qa:presence` is that whole story, in three browsers.

### Talking

The chat sits under the roster, and nothing in it is rendered optimistically:
what was typed goes out, and appears when it comes back with the id and
timestamp the server gave it. On a station where everyone is already connected
to the same server that costs a round trip, and it buys a list that is the same
list for everyone in the room — rather than a local-only line that a refused
message would leave sitting there looking sent.

The composer is disabled while the socket is down, for the reason the join frame
waits for `connected`: a send on a closed socket is thrown away in silence, and
a message that vanished would be worse than one that could not be typed. What
arrives is merged by id, so a reconnect fills in what was missed without
duplicating what is already on screen — `lib/chat.ts` is that merge, and it is
the piece worth reading if the chat ever looks doubled or out of order.

### Wishing

Under the roster, above the chat: one field, no library to browse, and a list of
what this listener has asked for. Nothing is rendered until the station answers
— the line that appears is the wish as it was written down, with the station's
own timestamp and the name from the roster.

The list is only ever this listener's own, because that is all the station tells
them. It survives a reconnect (the connection is remade under the same hook) and
starts empty after a reload, while the wishes themselves are still in the book
the admin reads. Nothing tells a listener their wish was played, either — a
station that said "played" about a track that never went on would be worse than
one that says nothing, so the row reads *asked* until the page is reloaded away.

The two composers share one socket, so each is handed only the refusals that
carry its own `about` — `refusalAbout` in `lib/protocol.ts` is that filter, and
it is what to look at if a refusal ever appears under the wrong box.

### What was that?

Under the queue, an **Earlier** list: what has been on this session, newest
first, so somebody who walked in on the end of something can see what it was.

The station writes a play down when the track *starts*, which makes the newest
row whatever is on right now — already shown in full at the top of the page — so
the page drops that one row and shows only what was missed (`playedEarlier` in
`lib/history.ts`). Only that row, and only while it names the track that is on: a
track played earlier in the evening and again now is two plays, and the earlier
one belongs in the list.

This is the one social list that survives a reload. The roster and the skip
tally are true only while a socket is open, so a refresh starts them again; the
history is in the database, so a listener who reloads at 10 still sees the
evening, and one who arrives then sees what they missed — including whatever
went on while they were reconnecting, merged by id.

### Voting on what's on

Under the track, a line saying how much of the room wants the next one and a
button to join them — `3 of 4 want the next one`, as a fraction of the roster
rendered below it, because a bare count means nothing. Three out of four is the
room; three out of thirty is three people.

Nothing here is optimistic. Both the count *and* whether this listener's own vote
is in come back from the station, so the button never claims a vote the station
does not hold — including after a reconnect, which drops it. The tally is
rendered only against the track it names (`tallyFor` in `lib/skips.ts`), so the
moment between a `state` frame and the `skips` frame that follows it shows no
count rather than the last song's.

The vote button is the listener page's alone: the admin panel has a Skip button,
and voting for something you can simply do is theatre. The tally still reaches
the panel, next to that button — which is the only thing in the system that acts
on it.

### When there is no station

PLAN.md's offline screen. Everything above assumes a socket; without one the
page is a column of empty boxes and a small grey word in the corner, which reads
like something that broke rather than a station that went away.

The page distinguishes three of those, because they call for three different
things being said:

- **Never reached it** — nothing has ever answered. The panel says *chunky.fm is
  off the air*, and there is no Tune in button at all.
- **Had it and lost it** — the socket dropped. Whatever the station last said
  stays on screen, with a line above it saying it is from before the drop.
- **There, and quiet** — the station is answering with nothing on the decks. The
  page says both halves: nothing is on, and you are tuned in for whatever is.

The distinction that costs something is the first two, and `lib/availability.ts`
is where it lives. `StationStatus` is about one socket, which is the wrong grain
for a screen: a page loaded against a dead server cycles `connecting → offline →
connecting` forever as the backoff runs, so anything keyed on the raw status
alternates between two messages once per retry while the truth — nothing has
ever answered — never changes. So availability is a *fold* over the statuses
rather than a mapping of them: `connecting` is not news, and leaves whatever the
page had already concluded standing until the attempt resolves.

Two things it deliberately does not do. There is no Retry button, because the
connection is already retrying on a backoff and the only thing a button could do
is what is happening anyway, while implying the page had given up and was
waiting to be asked. And a drop does not blank the track: a short outage is the
common one and the audio usually plays through it out of the buffer, so a page
that cleared a song the listener can still hear would be worse than the outage —
the line above it is what stops the frozen roster and dead tally from still
reading as live.

Tuning in is refused while the station is unreachable, and not only because the
join frame would go on the floor. Browsers start audio from inside a user
gesture and nowhere else, so a listener who spends their click on an absent
station gets a page that says a track is on and no sound when it comes back:
`play()` would be called from a broadcast handler rather than a click, and
refused. Better to hold the button back and hand it over when there is a station
to hand it to — which the page does on its own, without a reload.

### Admin mode

The controls live at **`/#admin`** (`/admin` works too, wherever the page is
served with an SPA fallback). Off that route nothing admin renders, and the
route alone reveals nothing: the panel shows a password form until the server
has accepted a session at `/api/admin/session`. A wrong password gets the form
back, and so does a `401` mid-session — which is what happens when the session
lapses, or the station restarts with a different password.

**The client keeps no secret at all.** The password is typed, posted once, and
gone; what remains is the `HttpOnly` cookie, which page script cannot read and
does not need to, because the browser attaches it. So there is nothing to store,
nothing to remember across a reload, and nothing an XSS could carry off. A
reload asks `GET /api/admin/session` once — the only way to know whether a
cookie is still good is to ask — and the answer decides between the form and the
controls.

Signing out waits for the server to drop the cookie before the form comes back,
so "signed out" means the session is over rather than that this tab stopped
drawing buttons.

The panel keeps no playback or queue state of its own. Both arrive on the
websocket the listener already has open, so a track ending by itself — or a
command issued from another tab — moves the panel too.

A command's own response carries the state it produced, which is the same thing
the broadcast is about to say, so the panel folds it in immediately
(`useStation`'s `applyState` / `applyQueue`) rather than sitting unchanged for a
round trip. If the socket happens to be reconnecting, the command still lands —
it went over HTTP — and the panel says so instead of quietly showing a queue
that has moved on.

Listeners see the queue too, as a read-only **Up next** list. It is the same
frame the panel reorders, seen from the other side.

| Control | What it does |
|---|---|
| Upload | One request per file; reports stored / already in the library / why not. |
| Pause / Resume, Skip, Stop | `POST /api/playback`. Skip advances the queue. |
| Queue ↑ ↓ ✕ | `POST /api/queue/move`, `DELETE /api/queue/:entryId`. |
| Library **Queue** / **Play now** | Queue behind what's playing, or take the decks. |
| Wishes **Mark handled** / **Undo** | `POST /api/wishes/:wishId`. A note to yourself, and reversible. |
| Skip votes | Read-only, next to Skip. What the room wants; pressing it is still yours. |

The wish book sits above the library, because a wish is read and then answered
by queueing something from the list below it. It is the one part of the panel
that is *polled* rather than pushed — every ten seconds, and after every mark.
A wish arrives over a socket that carries no privileged frames at all: the
station deliberately tells a socket holding an admin cookie nothing it would not
tell a stranger, so the panel asks rather than the station pushing. Ten seconds
is well inside the length of a track, which is the pace anyone is working at.

Reordering sends the *entry id* and the position it should land at. The row
positions come from a render, and the queue can advance underneath it, which is
exactly why the server addresses entries by id and clamps the index it is given.

### Staying in sync

Two separate problems, solved separately.

**The browser's clock is wrong.** Every decision is made against `startedAt`, a
server timestamp, so the client first measures how far its own clock sits from
the server's: send `t0`, get back `t1`, note `t2`, then `rtt = t2 - t0` and
`offset = t1 - (t0 + rtt/2)`. Five probes, 150ms apart — spaced rather than
fired in one burst, because five packets sent at once share a queueing delay,
which is exactly the contamination that taking the lowest RTT is meant to
avoid. Samples live in a rolling window, so one slow round trip can never
briefly become the estimate; a bad offset would be audible as a hard seek.
Re-measured every 30s.

**Audio clocks drift from system clocks.** Being aligned once is not staying
aligned, so every 2s:

| Error | Response |
|---|---|
| > 1s | Seek. A nudge would take a minute to close that. |
| > 50ms | Nudge `playbackRate` by up to ±2%. |
| ≤ 50ms | Leave it alone. |

Correcting with rate rather than seeking is the whole trick: a seek is an
audible glitch, a 2% rate change is not. `preservesPitch` defaults to true, so
it time-stretches instead of pitch-shifting.

One note on the constants, which come from PLAN.md: since the smallest error
that escapes the 50ms dead zone already exceeds the ±2% cap once multiplied by
the 0.5 gain, the clamp always binds and correction is effectively bang-bang.
That converges from the worst non-seeking case in under a minute and is
inaudible, so it is left as specified — but the proportional term only starts
doing anything if the dead zone drops below 40ms.

### Verifying it

Sync — and anything else that only happens in a real browser — is what unit
tests cannot judge, so there are eleven scripts that drive real Chrome. Each
needs a running server, a running Vite dev server, and at least two uploaded
tracks (one of them a few minutes long). `qa:offline` is the exception on the
first count: it starts by taking the server away, and needs one only to put it
back.

```bash
cd client
npm run verify:sync    # two listeners joining at different times stay together
npm run qa:playback    # seeks, pause/resume/seek/stop, track changes
npm run qa:reconnect   # kills the server underneath a listener and restarts it
npm run qa:offline     # loads the page against a dead station, then takes one away
npm run qa:presence    # three listeners watch each other arrive and leave
npm run qa:chat        # they talk, one joins late, one tries to speak as another
npm run qa:chat-refusal # types faster than the room will take, and checks what it says
npm run qa:wishes      # one listener asks, the room hears nothing, the admin marks it off
npm run qa:skips       # three listeners vote, the room agrees, the next track starts fresh
npm run qa:history     # tracks appear in Earlier as they change, and survive a reload
npm run qa:admin       # sign in, upload, queue, reorder, drive the decks
```

They read `CLIENT_URL`, `API_URL`, `ADMIN_PASSWORD`, `TRACK_ID`,
`OTHER_TRACK_ID` and `CHROME_PATH` from the environment. `qa:reconnect`,
`qa:offline`, `qa:presence` and `qa:chat` also start and stop the server itself,
so build it first (`cd server && npm run build`) — telling a browser it is offline does *not* drop an
established WebSocket, so taking the station away is the only way to test a
disconnection for real. `qa:admin` uploads `QA_UPLOAD_FILE` (default: the short test fixture —
point it at something a few minutes long) and drives three tabs at once: an
admin, a listener, and a second listener that joins after the queue was built.
It checks that both listeners hear every command, show the same queue as the
admin without a reload, and never grow a control. `qa:wishes` drives three tabs
for the property no unit test can see: that a wish reaches the person who asked
and the admin, and nobody else — with a chat message sent the same second as the
control, so "the other listener saw nothing" means something. `qa:skips` drives
three for the properties that are about the room: one number three pages agree
on live, each of them with its own answer to "is my vote in?", a vote that leaves
with the tab that cast it, and a unanimous room that skips nothing. `qa:history`
is the two halves of that acceptance: a line appearing the moment a track
changes without anyone touching the page, and the same list still there after a
reload and for someone who only just arrived. `qa:offline` is the only one that
starts with no station at all: it loads the page against a dead server, watches
the message hold still through several backoff attempts rather than flickering
once per retry, waits for the page to tune itself in when the server appears,
and then takes it away again underneath a playing listener — which has to read
as a drop rather than as never having found it, and must not blank the track.

Between them these caught five bugs that every unit test passed straight
through — see `docs/qa-notes.md`.

## Continuous integration

`.github/workflows/ci.yml` runs on every push to `master` and every pull
request, in three jobs:

- **checks** — typecheck, unit tests and build, for both workspaces, on Node 20
  and Node 22. Two versions because `server/package.json` claims `>=20.12` while
  the containers ship 22; testing only one of those leaves the other a guess.
- **sync check** — `server/npm run sync-check`, the headless version of
  `verify:sync`. Two listeners join a real server over real websockets at
  different times and must compute the same playback position. It takes about
  two seconds and it is the thing that must never regress.
- **docker compose stack** — builds both images, brings the stack up with
  `--wait` so the Dockerfile healthchecks have to pass, then drives it over the
  published ports: `/health` through nginx and direct, the page plus its hashed
  bundle, `/api/tracks`, and an admin sign-in that has to refuse the wrong
  password before it accepts the right one. This is the only job that sees
  nginx, the native `better-sqlite3` build and the volume.

What CI does not run is the browser QA above — it needs a real Chrome and a
library with a few minutes of audio in it, neither of which a runner has. Those
stay manual, which is worth remembering when a change touches seeking or
reconnection: the suite that would catch it is the one nobody is running for
you.

Dependency updates come in through `.github/dependabot.yml` — weekly for both
lockfiles with minor and patch bumps grouped into a single PR, monthly for the
action versions pinned in the workflow.
