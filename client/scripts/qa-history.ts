/**
 * Now-playing history in real browsers: what has been on appears as it happens,
 * survives a reload, and is waiting for whoever turns up later.
 *
 * The two properties worth driving a browser for are the two halves of the
 * acceptance. *In real time* — a listener who is already sitting there watches
 * the line appear the moment the next track starts, without touching anything.
 * And *persists* — this is the one social list that is written down rather than
 * held on a socket, so a reload and a late arrival both get the evening back,
 * which is exactly what the roster cannot do.
 *
 * Needs a running server and a running Vite dev server, and two uploaded
 * tracks. See README.
 */
import { type Browser, type Page, chromium } from 'playwright-core'
import {
  CHROME_PATH,
  STATION_URL,
  Checks,
  OTHER_TRACK_ID,
  TRACK_ID,
  playbackCommand,
  tuneIn,
  visit,
  wait,
} from './qa-env.js'

const checks = new Checks()
const SETTLE_MS = 3_000

/** The history as this page renders it, newest first. */
const earlier = (page: Page): Promise<string[]> =>
  page.$$eval('[data-testid="earlier"] .earlier__title', (rows) =>
    rows.map((row) => row.textContent ?? ''),
  )

/** Which tracks the history names, by id — stable across retagging. */
const earlierIds = (page: Page): Promise<number[]> =>
  page.$$eval('[data-testid="earlier"] li', (rows) =>
    rows.map((row) => Number(row.getAttribute('data-track'))),
  )

/** Waits for a page's own list to name exactly these tracks, then reports it. */
async function expectEarlier(page: Page, who: string, expected: number[]): Promise<void> {
  const same = (seen: number[]) =>
    seen.length === expected.length && seen.every((id, i) => id === expected[i])

  const deadline = Date.now() + SETTLE_MS
  let seen: number[] = []
  while (Date.now() < deadline) {
    seen = await earlierIds(page)
    if (same(seen)) break
    await wait(100)
  }
  checks.run(`${who} sees [${expected.join(', ')}]`, same(seen), `showing [${seen.join(', ')}]`)
}

async function join(browser: Browser, nickname: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage()
  await page.goto(STATION_URL, { waitUntil: 'domcontentloaded' })
  await tuneIn(page, nickname)
  // The evening lives behind its rail mark now — the aside beside the deck is
  // the lyrics' alone.
  await visit(page, '#history')
  return page
}

const browser = await chromium.launch({
  executablePath: CHROME_PATH,
  args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
})

try {
  // A clean slate for this run: the history is the session's, and a station that
  // has been up a while has an evening behind it already. Everything below is
  // asserted as "what happened after this point", so the run starts off air.
  await playbackCommand({ action: 'stop' })

  const ana = await join(browser, 'ana')
  await wait(1_000)

  // --- the first track ----------------------------------------------------------
  await playbackCommand({ action: 'play', trackId: TRACK_ID })
  await wait(1_000)

  const whileFirstPlaying = await earlierIds(ana)
  checks.run(
    'what is on now is not repeated underneath itself',
    !whileFirstPlaying.includes(TRACK_ID),
    whileFirstPlaying.length === 0 ? 'nothing listed' : `showing [${whileFirstPlaying.join(', ')}]`,
  )

  // --- the next one, without anybody touching the page ---------------------------
  await playbackCommand({ action: 'play', trackId: OTHER_TRACK_ID })
  await expectEarlier(ana, 'ana after the next track starts', [TRACK_ID])

  const named = await earlier(ana)
  checks.run(
    'the line names the track that was on, not just a time',
    named.length === 1 && named[0]!.trim().length > 0,
    named.length === 0 ? 'no line' : `"${named[0]}"`,
  )

  // --- somebody who was not here for any of it -----------------------------------
  const ben = await join(browser, 'ben')
  await expectEarlier(ben, 'ben, who arrived after both', [TRACK_ID])

  // --- and it is written down ------------------------------------------------------
  //
  // The roster lives on a socket and starts again with a new
  // one. This does not: it is in the database, so a reload gets it back.
  await ana.reload({ waitUntil: 'domcontentloaded' })
  await tuneIn(ana, 'ana')
  await expectEarlier(ana, 'ana after reloading the page', [TRACK_ID])

  // --- a track that comes back on is a second play ---------------------------------
  await playbackCommand({ action: 'play', trackId: TRACK_ID })
  // The row for *this* play drops off, because it is what is on and the page is
  // already showing it in full. The earlier play of the same track stays: it is
  // part of what happened, and the rows are keyed on the play, not the track.
  // See `playedEarlier`, and the unit test named for exactly this case.
  await expectEarlier(ana, 'ana when the first track comes back on', [
    OTHER_TRACK_ID,
    TRACK_ID,
  ])

  await playbackCommand({ action: 'play', trackId: OTHER_TRACK_ID })
  const evening = [TRACK_ID, OTHER_TRACK_ID, TRACK_ID]
  await expectEarlier(ana, 'ana with all three plays behind her', evening)
  await expectEarlier(ben, 'ben, watching the same evening', evening)

  // --- a pause is not a play --------------------------------------------------------
  const before = await earlierIds(ana)
  await playbackCommand({ action: 'pause' })
  await playbackCommand({ action: 'seek', positionMs: 30_000 })
  await playbackCommand({ action: 'resume' })
  await wait(1_500)

  const after = await earlierIds(ana)
  checks.run(
    'working the decks on one track does not write a row for each nudge',
    after.length === before.length && after.every((id, i) => id === before[i]),
    `[${before.join(', ')}] → [${after.join(', ')}]`,
  )
} finally {
  await browser.close()
}

checks.finish('HISTORY QA')
