/**
 * Skip voting in real browsers: three listeners, one tally, and the count
 * starting again with the next song.
 *
 * The properties worth driving browsers for are the ones about the *room*. A
 * vote is not a message to the server — it is a number three separate pages
 * have to agree on, live, while each of them shows a different answer to "is my
 * own vote in?". And the one that no unit test can show at all: a unanimous
 * room does not skip anything. The track keeps playing until whoever runs the
 * decks decides otherwise.
 *
 * Needs a running server and a running Vite dev server. See README.
 */
import { type Browser, type Page, chromium } from 'playwright-core'
import {
  ADMIN_PASSWORD,
  API_URL,
  CHROME_PATH,
  CLIENT_URL,
  Checks,
  OTHER_TRACK_ID,
  TRACK_ID,
  playbackCommand,
  tuneIn,
  wait,
} from './qa-env.js'

const checks = new Checks()
/** A vote is one broadcast, but CI machines are not fast. */
const SETTLE_MS = 3_000

/** The tally as this page renders it — the number, not the prose around it. */
const votes = (page: Page): Promise<number> =>
  page
    .getByTestId('skips-tally')
    .getAttribute('data-votes')
    .then((value) => Number(value ?? -1))

/** Whether this page's own vote is in, as its button reports it. */
const mine = (page: Page): Promise<boolean> =>
  page
    .getByTestId('skips-vote')
    .getAttribute('aria-pressed')
    .then((value) => value === 'true')

/** Waits for a page's own tally to reach a number, then reports what it says. */
async function expectVotes(page: Page, who: string, expected: number): Promise<void> {
  const deadline = Date.now() + SETTLE_MS
  let seen = -1
  while (Date.now() < deadline) {
    seen = await votes(page)
    if (seen === expected) break
    await wait(100)
  }
  checks.run(`${who} sees ${expected} vote(s)`, seen === expected, `showing ${seen}`)
}

async function join(browser: Browser, nickname: string): Promise<Page> {
  // A context each: separate localStorage, separate sockets — three listeners
  // as far as the station is concerned.
  const page = await (await browser.newContext()).newPage()
  await page.goto(CLIENT_URL, { waitUntil: 'domcontentloaded' })
  await tuneIn(page, nickname)
  return page
}

/** What the station itself says is on, read without touching the decks. */
const nowPlaying = async (): Promise<number | null> => {
  const state = await fetch(`${API_URL}/api/playback`).then((res) => res.json())
  return state.track?.id ?? null
}

const browser = await chromium.launch({
  executablePath: CHROME_PATH,
  args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
})

try {
  await playbackCommand({ action: 'play', trackId: TRACK_ID })

  const ana = await join(browser, 'ana')
  const ben = await join(browser, 'ben')
  const cleo = await join(browser, 'cleo')
  await wait(1_000)

  // --- one vote, three pages ---------------------------------------------------
  await expectVotes(ana, 'ana before anyone votes', 0)

  await ana.getByTestId('skips-vote').click()
  await expectVotes(ana, 'ana after voting', 1)
  await expectVotes(ben, 'ben after ana votes', 1)
  await expectVotes(cleo, 'cleo after ana votes', 1)

  // The count is the room's; whose vote it is, is each listener's own. A page
  // that showed everyone as having voted would be the easy bug here.
  checks.run(
    'the listener who voted is the only one whose button says so',
    (await mine(ana)) && !(await mine(ben)) && !(await mine(cleo)),
    `ana ${await mine(ana)}, ben ${await mine(ben)}, cleo ${await mine(cleo)}`,
  )

  // --- changing your mind --------------------------------------------------------
  await ana.getByTestId('skips-vote').click()
  await expectVotes(ana, 'ana after taking it back', 0)
  await expectVotes(ben, 'ben after ana takes it back', 0)

  // --- the room agrees -----------------------------------------------------------
  await ana.getByTestId('skips-vote').click()
  await ben.getByTestId('skips-vote').click()
  await cleo.getByTestId('skips-vote').click()
  await expectVotes(cleo, 'cleo with the room agreeing', 3)

  // --- and the station keeps playing ---------------------------------------------
  const playing = await nowPlaying()
  checks.run(
    'a unanimous room does not skip anything — the decks are the admin’s',
    playing === TRACK_ID,
    `track ${playing} still on`,
  )

  // --- a vote lives on the socket that cast it -----------------------------------
  //
  // A reload is a new socket, so the station drops the old vote — and the page
  // has to agree, which it only does because `voted` comes back from the
  // station rather than being something the page remembered.
  await ana.reload({ waitUntil: 'domcontentloaded' })
  await tuneIn(ana, 'ana')
  await expectVotes(ana, 'ana after reloading', 2)
  checks.run(
    'and the reloaded page does not claim a vote the station let go',
    !(await mine(ana)),
    `ana's button says ${await mine(ana)}`,
  )
  await expectVotes(ben, 'ben after ana reloads', 2)

  // --- a listener leaves ---------------------------------------------------------
  await cleo.close()
  await expectVotes(ana, 'ana after cleo closes the tab', 1)

  // --- the next track starts from nothing ----------------------------------------
  await playbackCommand({ action: 'play', trackId: OTHER_TRACK_ID })
  await expectVotes(ana, 'ana on the next track', 0)
  await expectVotes(ben, 'ben on the next track', 0)
  checks.run(
    'and nobody is left holding a vote they cast against the last one',
    !(await mine(ana)) && !(await mine(ben)),
    `ana ${await mine(ana)}, ben ${await mine(ben)}`,
  )

  // --- what the panel sees --------------------------------------------------------
  await ana.getByTestId('skips-vote').click()
  await wait(1_000)

  const admin = await (await browser.newContext()).newPage()
  await admin.goto(`${CLIENT_URL}/#admin`, { waitUntil: 'domcontentloaded' })
  await tuneIn(admin, 'the dj')
  await admin.fill('[data-testid="admin-password"]', ADMIN_PASSWORD)
  await admin.getByRole('button', { name: 'Sign in' }).click()
  await wait(1_500)

  const shown = await admin.getByTestId('admin-skip-votes').getAttribute('data-votes')
  checks.run(
    'the tally reaches whoever runs the decks, next to the button it is about',
    shown === '1',
    `the panel says ${shown}`,
  )
} finally {
  await browser.close()
}

checks.finish('SKIP VOTES QA')
