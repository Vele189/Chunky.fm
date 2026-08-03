# Chunky.fm

A single, permanent radio station. See [PLAN.md](PLAN.md) for the design.

## Running it

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
| `{ type: 'pong', t0, t1 }` | In reply to a clock probe. |
| `{ type: 'error', message }` | Unrecognised frame; the connection stays open. |

The queue is a separate message rather than a field on `state`: playback changes
several times a track and the queue rarely does, so folding them together would
ship the whole queue on every seek.

**Client → server**

| Message | Purpose |
|---|---|
| `{ type: 'ping', t0 }` | Clock offset probe. |

Browser clocks are wrong by seconds, so a client measures the offset NTP-style:
send `t0`, receive `t1`, note `t2` on arrival, then
`rtt = t2 - t0` and `offset = t1 - (t0 + rtt / 2)`. Run ~5 probes and keep **the
sample with the lowest RTT** — the fastest round trip is the least contaminated
by queueing delay. `t1` and `startedAt` are stamped from the same server clock,
so the measured offset applies directly.

Connections are anonymous and read-only: nothing anyone can send over the socket
changes playback. That is also the socket's half of the admin gate — a socket
carrying a valid admin cookie gets no more than one carrying nothing, and frames
that look like commands (`play`, `skip`, `enqueue`, …) are refused *by name*, so
a client that tries is told where the controls actually are rather than left
guessing. There is no privileged frame here to authenticate, because every
mutation lives behind `requireAdmin` on an HTTP route.

**Commands go over HTTP, not the socket** — deliberately. The socket carries
state outward and clock probes inward, and nothing else. An admin action wants
exactly what HTTP already gives it: a request/response pair, a status code that
says whether it worked, and — for upload — a body measured in megabytes. Adding
a second, authenticated command channel over the socket would duplicate that
surface and add an auth gate to get wrong, in exchange for nothing a `POST`
doesn't already do. A socket that cannot mutate anything is a socket that cannot
be abused into mutating something.

So the loop is: admin `POST`s, the server changes its state, and the change goes
out to every client — including the admin's own page — on the socket they all
already have open.

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
| `POST /api/admin/session` | `{password}` → `200 {ok, expiresAt}` and the cookie, or `401`. |
| `GET /api/admin/session` | `{ok: true}` while the session holds, `401` once it doesn't. |
| `DELETE /api/admin/session` | Signs out. Needs no credentials — dropping a cookie you hold isn't an attack. |

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

React + Vite, one page. The listener taps **Tune in** — which is also the user
gesture browsers require before audio may start — and from then on the page
follows the station.

- `lib/position.ts` — where the needle should be, given the tuple and a server time.
- `lib/station.ts` — the websocket, with reconnect and backoff.
- `lib/admin.ts` — the admin's side of the HTTP API, and where `#admin` lives.
- `hooks/useAdminSession.ts` — signs in, and asks the station whether it still counts.
- `lib/clock.ts` — clock offset estimation from ping/pong samples.
- `lib/drift.ts` — what to do about an error of a given size.
- `hooks/useServerClock.ts` — runs the handshake, exposes `serverNow()`.
- `hooks/useSyncedAudio.ts` — aligns on every broadcast, and every 2s in between.
- `AdminPanel.tsx` — the decks, for whoever runs the station.

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
tests cannot judge, so there are four scripts that drive real Chrome. Each needs
a running server, a running Vite dev server, and at least two uploaded tracks
(one of them a few minutes long).

```bash
cd client
npm run verify:sync    # two listeners joining at different times stay together
npm run qa:playback    # seeks, pause/resume/seek/stop, track changes
npm run qa:reconnect   # kills the server underneath a listener and restarts it
npm run qa:admin       # sign in, upload, queue, reorder, drive the decks
```

They read `CLIENT_URL`, `API_URL`, `ADMIN_PASSWORD`, `TRACK_ID`,
`OTHER_TRACK_ID` and `CHROME_PATH` from the environment. `qa:reconnect` also
starts and stops the server itself, so build it first (`cd server && npm run
build`). `qa:admin` uploads `QA_UPLOAD_FILE` (default: the short test fixture —
point it at something a few minutes long) and drives three tabs at once: an
admin, a listener, and a second listener that joins after the queue was built.
It checks that both listeners hear every command, show the same queue as the
admin without a reload, and never grow a control.

Between them these caught five bugs that every unit test passed straight
through — see `docs/qa-notes.md`.
