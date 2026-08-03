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

## 6. The admin panel re-verified its password on every render

**Severity: medium — a request storm, and it broke uploading.**

Found by the first run of `qa:admin` (#1453).

`useAdminSession` took `createApi` as an options argument defaulting to an
inline arrow. A default argument is evaluated per call, so the function had a
new identity on every render — and the effect that verifies the stored password
depends on it. Verify → set state → render → new identity → verify, for as long
as the panel was open. The server log showed `/api/admin/session` and
`/api/tracks` being hit in a loop.

The visible symptom was not the traffic, though: picking a file never uploaded
anything. The panel was re-rendering continuously while the `change` event was
being dispatched, and the upload never ran — no request reached the server at
all. Every unit test passed, because the API client was fine; the bug was in
when React called it.

Fixed by hoisting the default factory to module scope, where its identity is
stable. Worth remembering for any hook here that takes an injectable: the
default has to be defined once, not per call.

## 7. Half the API's errors were not machine-readable

**Severity: medium — a documented contract that only held on some paths.**

Found by the second QA pass, on the `QA` branch before merging to `master`.

Every refusal written by hand answers `{error, message}`, where `error` is a
code the client switches on — `AdminError.code`, with a test pinning
`unknown_track`. Fastify's own refusals did not. A schema rejection, an
unparseable body, a route that does not exist and a body over the limit all
came back as `{statusCode, error: "Bad Request", message}`, where `error` is
prose about the *status*. So `AdminError.code` was `"Bad Request"` for every
failure the framework caught rather than the handler, and no client could tell
the two apart.

Nothing was visibly broken, because the panel only ever displays `message` —
which is why it survived 149 tests and a full first QA pass. The contract was
wrong, not the screen.

Fixed with `setErrorHandler` and `setNotFoundHandler` in `lib/errors.ts`,
mapping status to a code and leaving 4xx messages alone. 5xx messages are
replaced rather than repeated: those can carry a path, a SQL fragment or a
stack.

Guarded by `test/contract.test.ts`, which asserts every refusal in the API —
whoever wrote it — carries a snake_case code and a message.

## 8. The clock handshake leaked for as long as anyone listened

**Severity: low — unbounded growth, no visible symptom.**

`useServerClock` pushed `probeCount` timer ids into an array on every resync
round and never removed them, and probes that were never answered stayed in
the in-flight set forever. Both are cleared on reconnect and unmount, so
neither shows up in a short session; a listener who leaves the tab open for an
evening accumulates ten dead entries a minute in each.

Fixed by having each round supersede the one before it — pending timeouts
cancelled, unanswered probes dropped. A probe that has not been answered by the
next round never will be.

## 9. The join gesture seeked without going through `seekTo`

**Severity: low — the safety net caught it.**

`audio-element.ts` exists because assigning `currentTime` before metadata has
loaded is silently dropped by browsers, which is a listener sitting at 0:00
while everyone else is at 2:14. `tuneIn` assigned `currentTime` directly. With
`preload="auto"` metadata is usually there by the time anyone clicks, and the
alignment effect re-runs on `joined` and seeks properly — so the bug was
covered twice over and never observed.

Fixed anyway, because "every seek goes through here" is only true if it is.

## Verified, and not a problem

- **Telling a browser it is offline does not drop an established WebSocket.**
  The first `qa:presence` used `context.setOffline(true)` to make a listener
  vanish, and the roster kept showing them — not a presence bug: the socket was
  never disconnected. Chrome keeps an open WebSocket alive under offline
  emulation and goes on answering pings at the protocol level, so the server
  correctly saw a live, responsive listener and the client never reconnected.
  The check passed on the way back too, for the same reason — the stale row it
  was waiting for had never left. Taking the server away, the way `qa:reconnect`
  already did, is the only way to test a disconnection for real; both scripts
  now share those helpers. Worth remembering: a QA check that produces the right
  answer for the wrong reason is worse than no check.
- **Encoded traversal under `/api/audio/` returns the SPA shell, not a 404.**
  nginx decodes `%2f` and normalises the path *before* it matches a location,
  so `/api/audio/..%2f..%2fchunky.sqlite` is `/chunky.sqlite` by the time
  routing happens and falls through `try_files` to `index.html`. Nothing
  escapes — checked against the database and `/etc/passwd`, through both nginx
  and the server port directly. Unencoded traversal is refused by
  fastify-static as expected.

## Things deliberately left alone

- **The proportional term in drift correction is inert.** With PLAN.md's
  constants the smallest error escaping the 50ms dead zone already exceeds the
  ±2% cap, so correction is bang-bang. It converges from the worst
  non-seeking case in well under a minute and is inaudible. Changing it means
  changing numbers the plan specifies.
- **Admin commands go over HTTP, not the websocket**, even though #1454 is
  phrased as "via WebSocket/API". The socket carries state outward and clock
  probes inward. A command wants a status code and, for upload, a body in
  megabytes; a second authenticated channel over the socket would duplicate the
  surface and add a gate to get wrong for no gain. A socket that cannot mutate
  anything cannot be abused into mutating something.
- **Admin auth is a shared secret, not the signed cookie** PLAN.md describes.
  The client holds the password and presents it on every request. That is task
  #1452, and nothing above `AdminApi` knows the difference.
- **The admin bundle ships to listeners.** Nothing admin *renders* off the
  `#admin` route, and the server would refuse the requests anyway, but the code
  is in the same chunk. Splitting it is worth doing when there is a build step
  that cares.
