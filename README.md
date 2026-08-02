# Chunky.fm

A single, permanent radio station. See [PLAN.md](PLAN.md) for the design.

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
