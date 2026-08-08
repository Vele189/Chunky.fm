# QA notes

Findings from the QA passes on the `QA` branch. Recorded because almost every
one of these passed the unit suite. They are the shape of bug this project is
prone to, and worth remembering when adding features.

- **#1–#5:** the first pass, after merging tasks #1446 through #1450.
- **#6:** the first run of `qa:admin` (#1453).
- **#7:** the second pass, before merging to `master`.
- **#8–#9:** found alongside those.
- **#10–#14:** the third pass, after the join flow, presence and chat landed
  (#1455–#1457), before merging to `master`.

If there is a theme to the third pass, it is that the first two asked "does this
work?" and it did. #10 and #13 came from asking a different question (*what can
someone do repeatedly?*) and #11 from noticing that #7 fixed a property on one
channel and called it done, when the property was about the whole API. #14 is
the one worth rereading: it is a bug in the fix for #13, it was invisible to
every unit test, and it turned up only because the stack was actually brought
up and the logs read.

## 1. The clock handshake silently never completed

**Severity: high. Sync did not work at all in some sessions.**

`useServerClock` fired its five probes as soon as the `StationConnection`
object existed. But `send()` on a socket that is still `CONNECTING` is a silent
no-op, so whenever the socket had not finished opening, all five probes went on
the floor. The next round was 30 seconds later.

An unsynced client never runs alignment or drift correction, so it played from
wherever the join gesture happened to put it and stayed there. Nothing in the
UI said anything was wrong, and every other check still passed: the listener
was audibly playing.

Fixed by gating probing on the socket actually being open, which also gives a
fresh handshake after every reconnect. Sample history is cleared on reconnect,
since a device that was offline may also have slept.

Guarded by an assertion on the RTT readout in `qa:playback` and `qa:reconnect`.

## 2. Reconnection was dead in every browser

**Severity: high. A listener who dropped never came back.**

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

**Severity: medium. An audible glitch, and it undermined the design.**

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
metadata every stale one fired. Ordering usually saved it (the newest
listener ran last) but the latent bug was a listener being dropped at 2:14 of
a song that had just started.

Fixed by tracking at most one pending seek per element and cancelling it when
the source changes.

## 5. `.env` was documented but never loaded

**Severity: low, but it broke first-run setup.**

The README said `cp .env.example .env && npm run dev`, and nothing read the
file, so the server refused to start. Fixed with Node's
`--env-file-if-exists`, which is also correct on Railway where there is no
`.env` and variables come from the platform.

Worth noting the first attempt at this fix put the flag before `tsx`'s `watch`
subcommand, which broke `npm run dev` differently. Running the documented
command is the only way to know.

## 6. The admin panel re-verified its password on every render

**Severity: medium. A request storm, and it broke uploading.**

Found by the first run of `qa:admin` (#1453).

`useAdminSession` took `createApi` as an options argument defaulting to an
inline arrow. A default argument is evaluated per call, so the function had a
new identity on every render, and the effect that verifies the stored password
depends on it. Verify → set state → render → new identity → verify, for as long
as the panel was open. The server log showed `/api/admin/session` and
`/api/tracks` being hit in a loop.

The visible symptom was not the traffic, though: picking a file never uploaded
anything. The panel was re-rendering continuously while the `change` event was
being dispatched, and the upload never ran: no request reached the server at
all. Every unit test passed, because the API client was fine; the bug was in
when React called it.

Fixed by hoisting the default factory to module scope, where its identity is
stable. Worth remembering for any hook here that takes an injectable: the
default has to be defined once, not per call.

## 7. Half the API's errors were not machine-readable

**Severity: medium. A documented contract that only held on some paths.**

Found by the second QA pass, on the `QA` branch before merging to `master`.

Every refusal written by hand answers `{error, message}`, where `error` is a
code the client switches on: `AdminError.code`, with a test pinning
`unknown_track`. Fastify's own refusals did not. A schema rejection, an
unparseable body, a route that does not exist and a body over the limit all
came back as `{statusCode, error: "Bad Request", message}`, where `error` is
prose about the *status*. So `AdminError.code` was `"Bad Request"` for every
failure the framework caught rather than the handler, and no client could tell
the two apart.

Nothing was visibly broken, because the panel only ever displays `message`,
which is why it survived 149 tests and a full first QA pass. The contract was
wrong, not the screen.

Fixed with `setErrorHandler` and `setNotFoundHandler` in `lib/errors.ts`,
mapping status to a code and leaving 4xx messages alone. 5xx messages are
replaced rather than repeated: those can carry a path, a SQL fragment or a
stack.

Guarded by `test/contract.test.ts`, which asserts every refusal in the API,
whoever wrote it, carries a snake_case code and a message.

## 8. The clock handshake leaked for as long as anyone listened

**Severity: low. Unbounded growth, no visible symptom.**

`useServerClock` pushed `probeCount` timer ids into an array on every resync
round and never removed them, and probes that were never answered stayed in
the in-flight set forever. Both are cleared on reconnect and unmount, so
neither shows up in a short session; a listener who leaves the tab open for an
evening accumulates ten dead entries a minute in each.

Fixed by having each round supersede the one before it: pending timeouts
cancelled, unanswered probes dropped. A probe that has not been answered by the
next round never will be.

## 9. The join gesture seeked without going through `seekTo`

**Severity: low. The safety net caught it.**

`audio-element.ts` exists because assigning `currentTime` before metadata has
loaded is silently dropped by browsers, which is a listener sitting at 0:00
while everyone else is at 2:14. `tuneIn` assigned `currentTime` directly. With
`preload="auto"` metadata is usually there by the time anyone clicks, and the
alignment effect re-runs on `joined` and seeks properly, so the bug was
covered twice over and never observed.

Fixed anyway, because "every seek goes through here" is only true if it is.

## 10. One socket could make the station shout at the whole room

**Severity: high. An unauthenticated amplifier, reachable by anyone with the
link.**

Found by the third QA pass, on the `QA` branch before merging to `master`.

Chat is rate-limited because the server writes it down. `join` was not, and it
is the more expensive frame: a roster goes out to *every* listener each time one
changes. So a socket alternating between two nicknames turned one inbound frame
into N outbound ones, for as long as it cared to keep going: no nickname worth
having, no password, no chat, nothing to authenticate. Measured before the fix:
200 join frames from one socket produced 200 full roster broadcasts to every
other listener. After: 5.

The failure mode is not a crash. It is thirty listeners' clients re-rendering
the roster a few hundred times a second while the audio they came for competes
for the same main thread, with the station degrading for everyone and nothing in
the logs that looks unusual.

Fixed with the same token bucket chat already used, per socket, spending a token
only on a join that actually *changes* the roster. That carve-out matters: a
client re-sending the name it already has broadcasts nothing, and a reconnect's
rejoin must stay free or the reconnect path pays for the abuse path.

Guarded by `test/socket-contract.test.ts`, which counts the roster frames one
socket can cause and asserts a refused join leaves the roster as it was. Three
of those four tests fail against the old code.

## 11. Half the *socket's* errors were not machine-readable either

**Severity: medium. The same defect as #7, on the channel it was never applied
to.**

#7 made every HTTP refusal answer `{error, message}` with `error` a code, and
pinned it with `test/contract.test.ts`. The socket was left alone. Its refusals
were `{type: 'error', message}`, prose only, so a client wanting to tell "you
are going too fast" from "say who you are" had to match on English, and any
rewording of a message was a silent break in something no test was watching.

Worth noting how it survived: #7 was written as a fix to Fastify's error
handler, so it was scoped to Fastify. The property it was actually about,
*every refusal in the API is machine-readable*, is not a property of Fastify,
and the half of the API that does not go through Fastify never got it.

Fixed by giving `ErrorMessage` a `code` alongside the prose, mirrored in
`client/src/lib/protocol.ts`. Guarded by `test/socket-contract.test.ts`, which
asserts every socket refusal carries a snake_case code and a message: the
socket's version of the test #7 left behind.

## 12. A refused message vanished, and looked exactly like a sent one

**Severity: medium. Silent data loss, in the feature most likely to hit it.**

The consequence of #11 on the client, and the reason it was worth fixing rather
than noting. `useStation` handled `state`, `queue`, `presence` and `chat`, and
dropped `error` on the floor. The composer clears itself the moment something is
sent, so a refused message left an empty box and an unchanged conversation,
which on screen is *identical* to having said something successfully. The
listener's only clue was that their line never appeared, and a line that has not
appeared yet looks the same.

Not a hypothetical: chat is rate-limited at five back to back, so this is
reachable by anyone who types quickly. What they lost was the thing they had
just written.

Fixed by keeping the refusal, telling the listener the message was not sent, and
handing the text back to the composer, but only into an empty one, since
whatever they have started typing since is the one thing on screen that cannot
be recovered from anywhere else. The refusal is carried with a sequence number,
so two identical refusals in a row are still two events.

Guarded twice: `client/test/chat.test.ts` covers the decisions as pure functions
(`chatRefusal`, `draftAfterRefusal`), and `npm run qa:chat-refusal` types nine
messages into a real browser faster than the room will take them and checks what
the listener is actually looking at afterwards, including that the handed-back
message is not *also* in the conversation, and that it sends normally once the
bucket refills.

## 13. Nothing slowed down guessing the admin password

**Severity: medium-high. The whole admin gate is one shared secret.**

Found in the same pass, by asking what a stranger can do repeatedly. Fifty wrong
passwords in a row: fifty `401`s, no throttling, nothing in the logs to
distinguish it from one wrong attempt. The password guards every upload, the
queue and the decks, and it is the *only* thing that does, so the rate at which
it can be tested is part of how strong it is. Unpaced, a passphrase that would
take centuries offline is a few hours of HTTP requests.

Fixed with a per-caller token bucket on `POST /api/admin/session`: five wrong
passwords, one earned back a minute, then `429` with a `Retry-After` in the
API's standard error shape.

Three things that are easy to get wrong here, and are what the tests are about:

- The bucket is checked *before* the password comparison. A throttle that still
  compared would still be letting the guessing happen.
- Only wrong attempts are charged, and a correct one clears the count. An admin
  who fumbles their own password twice should not spend the evening one typo
  from being locked out of their own station.
- Nothing else is throttled. A session already issued is a credential its holder
  has proved, and pacing the panel's own polling would break the admin surface
  to protect a password nobody is guessing.

The bucket map is keyed on the caller's address, which is to say on something
the caller chooses, so it is capped, and evicts fully-refilled buckets before
live ones. A caller who keeps knocking stays the most recently used and is the
last thing dropped, so filling the map with fresh keys is not a way to buy your
own tokens back. `test/rate-limit.test.ts` pins that.

## 14. The throttle in #13 paced the proxy, not the caller

**Severity: high. The fix for #13, as first written, was a denial of service on
the admin.**

Found by running the compose stack, which is the only place it exists.

`request.ip` is the socket's peer address, and nothing reaches this station
directly: nginx is in front of it under compose, the platform edge is in
production. So every caller alive shared one bucket. Five wrong passwords a
minute from anyone on the internet and the admin could never sign in, and
because the gate is checked *before* the password comparison (which is the one
thing about #13 that must not change), the correct password was refused right
along with the guesses.

Every unit test passed, because `app.inject` gives each call the same loopback
address and the tests were written asserting one caller. The direct-port check
passed too. It only shows up with a proxy in the path, and the only way to see
it was to bring the stack up and read the `ip` the server logged: `172.26.0.3`,
the web container, on every request.

Fixed with `trustProxy` on the Fastify instance, configurable via `TRUST_PROXY`
and defaulting to true because both supported deployments sit behind a proxy:
the codebase already trusts that proxy for `X-Forwarded-Proto` when deciding
whether the session cookie gets `Secure`, so this is the same trust, written
down. Verified through nginx: an attacker's address is throttled while a
different address behind the same proxy signs in untouched, and the logs now
carry real client addresses.

The trade this makes, deliberately: anything that can reach the origin directly
can claim to be any address it likes, and so can rotate past the throttle. That
is why the origin port must not be published to the internet. It is published
in `docker-compose.yml` for curl and the QA scripts, on a host port that is not
meant to be exposed. `TRUST_PROXY=false` is the setting for a station with
nothing in front of it.

Worth remembering: a limiter is only as good as its key, and the key was the one
part of it no test could see.

## Verified, and not a problem

- **Telling a browser it is offline does not drop an established WebSocket.**
  The first `qa:presence` used `context.setOffline(true)` to make a listener
  vanish, and the roster kept showing them. Not a presence bug: the socket was
  never disconnected. Chrome keeps an open WebSocket alive under offline
  emulation and goes on answering pings at the protocol level, so the server
  correctly saw a live, responsive listener and the client never reconnected.
  The check passed on the way back too, for the same reason: the stale row it
  was waiting for had never left. Taking the server away, the way `qa:reconnect`
  already did, is the only way to test a disconnection for real; both scripts
  now share those helpers. Worth remembering: a QA check that produces the right
  answer for the wrong reason is worse than no check.
- **Encoded traversal under `/api/audio/` returns the SPA shell, not a 404.**
  nginx decodes `%2f` and normalises the path *before* it matches a location,
  so `/api/audio/..%2f..%2fchunky.sqlite` is `/chunky.sqlite` by the time
  routing happens and falls through `try_files` to `index.html`. Nothing
  escapes, checked against the database and `/etc/passwd`, through both nginx
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
