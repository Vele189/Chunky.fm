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

Put something on the decks (there is no admin UI yet — task #1453):

```bash
curl -H "Authorization: Bearer $ADMIN_PASSWORD" -F "file=@track.mp3" \
     http://localhost:3000/api/upload
curl -H "Authorization: Bearer $ADMIN_PASSWORD" -H 'content-type: application/json' \
     -d '{"action":"play","trackId":1}' http://localhost:3000/api/playback
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
| `401` | Missing or wrong admin password. |
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
| `{ type: 'pong', t0, t1 }` | In reply to a clock probe. |
| `{ type: 'error', message }` | Unrecognised frame; the connection stays open. |

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

Connections are anonymous and read-only: nothing a listener can send changes
playback. Admin control over the socket will need its own gate.

### `POST /api/playback` — admin

The minimum needed to drive the decks: `{action: 'play'|'pause'|'resume'|'seek'
|'stop', trackId?, positionMs?}`, admin-only, returns the new state. Every
command broadcasts over `/ws` before the HTTP response returns. The queue and
the full admin surface are tasks #1451 and #1454.

## Client

React + Vite, one page. The listener taps **Tune in** — which is also the user
gesture browsers require before audio may start — and from then on the page
follows the station.

- `lib/position.ts` — where the needle should be, given the tuple and a server time.
- `lib/station.ts` — the websocket, with reconnect and backoff.
- `lib/clock.ts` — clock offset estimation from ping/pong samples.
- `lib/drift.ts` — what to do about an error of a given size.
- `hooks/useServerClock.ts` — runs the handshake, exposes `serverNow()`.
- `hooks/useSyncedAudio.ts` — aligns on every broadcast, and every 2s in between.

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

Sync is the one thing unit tests genuinely cannot judge, so there are three
scripts that drive real Chrome. Each needs a running server, a running Vite dev
server, and at least two uploaded tracks (one of them a few minutes long).

```bash
cd client
npm run verify:sync    # two listeners joining at different times stay together
npm run qa:playback    # seeks, pause/resume/seek/stop, track changes
npm run qa:reconnect   # kills the server underneath a listener and restarts it
```

They read `CLIENT_URL`, `API_URL`, `ADMIN_PASSWORD`, `TRACK_ID`,
`OTHER_TRACK_ID` and `CHROME_PATH` from the environment. `qa:reconnect` also
starts and stops the server itself, so build it first (`cd server && npm run
build`).

Between them these caught four bugs that every unit test passed straight
through — see `docs/qa-notes.md`.
