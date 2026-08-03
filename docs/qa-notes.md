# QA notes

Findings from the first full QA pass on the `QA` branch, after merging tasks
#1446 through #1450. Recorded because every one of these passed the unit
suite — they are the shape of bug this project is prone to, and worth
remembering when adding features.

## 1. The clock handshake silently never completed

**Severity: high — sync did not work at all in some sessions.**

`useServerClock` fired its five probes as soon as the `StationConnection`
object existed. But `send()` on a socket that is still `CONNECTING` is a silent
no-op, so whenever the socket had not finished opening, all five probes went on
the floor. The next round was 30 seconds later.

An unsynced client never runs alignment or drift correction, so it played from
wherever the join gesture happened to put it and stayed there. Nothing in the
UI said anything was wrong, and every other check still passed — the listener
was audibly playing.

Fixed by gating probing on the socket actually being open, which also gives a
fresh handshake after every reconnect. Sample history is cleared on reconnect,
since a device that was offline may also have slept.

Guarded by an assertion on the RTT readout in `qa:playback` and `qa:reconnect`.

## 2. Reconnection was dead in every browser

**Severity: high — a listener who dropped never came back.**

`StationConnection` stored `setTimeout` as an instance field and called it as
`this.#setTimeout(...)`. In a browser that loses the `window` receiver and
throws `Illegal invocation`; the throw happened inside `onclose`, so the retry
was never scheduled and the connection stayed dead forever.

Node does not care what receiver `setTimeout` gets, so all nine reconnect unit
tests passed while the feature did not work anywhere real.

Fixed by calling the timer globals directly. Fake timers still work because the
global is resolved at call time.

A connect timeout was added at the same time: a proxy in front of a dead
backend can leave an upgrade hanging with neither `error` nor `close`, which
would stall the retry loop just as permanently.

## 3. Improving the clock offset hard-seeked the audio

**Severity: medium — audible glitch, and it undermined the design.**

The alignment effect listed `serverNow` in its dependencies. That callback's
identity changes every time the offset estimate improves, so every refinement
re-ran alignment and issued a hard seek. The entire point of correcting with
`playbackRate` is that seeking is audible and nudging is not.

On localhost the RTT is stable enough that it only fired at join. On a real
network a better sample arrives regularly, so it would have glitched
mid-song.

Fixed by reading the clock through a ref. Offset refinements are the drift
loop's job, and it corrects them gently.

Guarded by counting `seeking` events across 40 seconds of steady playback,
which spans a resync.

## 4. Deferred seeks leaked across track changes

**Severity: low, but the failure is ugly.**

A seek issued before metadata loads has to wait for `loadedmetadata`. Those
listeners were never removed, so they accumulated, and on the next track's
metadata every stale one fired. Ordering usually saved it — the newest
listener ran last — but the latent bug was a listener being dropped at 2:14 of
a song that had just started.

Fixed by tracking at most one pending seek per element and cancelling it when
the source changes.

## 5. `.env` was documented but never loaded

**Severity: low, but it broke first-run setup.**

The README said `cp .env.example .env && npm run dev`, and nothing read the
file — the server refused to start. Fixed with Node's
`--env-file-if-exists`, which is also correct on Railway where there is no
`.env` and variables come from the platform.

Worth noting the first attempt at this fix put the flag before `tsx`'s `watch`
subcommand, which broke `npm run dev` differently. Running the documented
command is the only way to know.

## Things deliberately left alone

- **The proportional term in drift correction is inert.** With PLAN.md's
  constants the smallest error escaping the 50ms dead zone already exceeds the
  ±2% cap, so correction is bang-bang. It converges from the worst
  non-seeking case in well under a minute and is inaudible. Changing it means
  changing numbers the plan specifies.
- **No auto-advance when a track ends.** That is task #1451.
- **Admin auth is a shared secret, not the signed cookie** PLAN.md describes.
  That is task #1452.
