/**
 * Admin QA in a real browser: sign in, upload, queue, reorder, and drive the
 * decks, then check a plain listener sees none of it but hears all of it.
 *
 * Needs a running server and a running Vite dev server. The file it uploads
 * comes from QA_UPLOAD_FILE; use something a few minutes long, or the track
 * will end in the middle of the run. See README.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Browser, type Page, chromium } from 'playwright-core'
import {
  ADMIN_PASSWORD,
  API_URL,
  AUDIO,
  type AudioState,
  CHROME_PATH,
  STATION_URL,
  Checks,
  tuneIn,
  wait,
} from './qa-env.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const UPLOAD_FILE =
  process.env.QA_UPLOAD_FILE ?? path.resolve(HERE, '../../server/test/fixtures/tagged.mp3')
const ADMIN_URL = `${STATION_URL}#admin`

const checks = new Checks()

const present = (page: Page, testId: string) =>
  page.locator(`[data-testid="${testId}"]`).count().then((n) => n > 0)

/** The queue as the admin sees it: entry ids, top to bottom. */
const queueIds = (page: Page): Promise<string[]> =>
  page.$$eval('[data-testid="admin-queue"] li', (rows) =>
    rows.map((row) => row.getAttribute('data-entry') ?? ''),
  )

const nowPlaying = (page: Page) =>
  page.locator('[data-testid="admin-now"]').textContent().then((text) => text ?? '')

async function serverQueue(): Promise<{ id: number; track: { title: string } }[]> {
  const res = await fetch(`${API_URL}/api/queue`)
  return (await res.json()).entries
}

async function signIn(page: Page, password: string): Promise<void> {
  await page.fill('[data-testid="admin-password"]', password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

async function openPage(browser: Browser, url: string): Promise<Page> {
  // A context each, so the two tabs don't share cookies; otherwise the
  // "listener" would inherit the admin's session and prove nothing.
  const page = await (await browser.newContext()).newPage()
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  return page
}

const browser = await chromium.launch({
  executablePath: CHROME_PATH,
  args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
})

try {
  // --- the listener page ships no controls -----------------------------------
  const listener = await openPage(browser, STATION_URL)
  await tuneIn(listener, 'listener')
  await wait(1_000)

  checks.run(
    'listener page has no admin panel',
    !(await present(listener, 'admin-panel')),
    'no panel',
  )
  checks.run(
    'listener page has no sign-in form either',
    !(await present(listener, 'admin-signin')),
    'no form',
  )

  // --- signing in ------------------------------------------------------------
  const admin = await openPage(browser, ADMIN_URL)
  await admin.waitForSelector('[data-testid="admin-signin"]', { timeout: 10_000 })

  checks.run(
    'admin route shows the form, not the controls',
    !(await present(admin, 'admin-panel')),
    'controls hidden until signed in',
  )

  await signIn(admin, 'definitely-not-the-password')
  await admin.waitForSelector('[data-testid="admin-error"]', { timeout: 10_000 })
  checks.run(
    'a wrong password is refused and reveals nothing',
    !(await present(admin, 'admin-panel')),
    await admin.locator('[data-testid="admin-error"]').textContent().then((t) => `"${t}"`),
  )

  await signIn(admin, ADMIN_PASSWORD)
  await admin.waitForSelector('[data-testid="admin-panel"]', { timeout: 10_000 })
  checks.run('the right password reveals the controls', true, 'panel visible')

  // The session survives a reload: a station is run over hours, and a stray
  // refresh should not mean typing the password again.
  await admin.reload({ waitUntil: 'domcontentloaded' })
  await admin.waitForSelector('[data-testid="admin-panel"]', { timeout: 10_000 })
  checks.run('still signed in after a reload', true, 'panel restored')

  // --- upload ----------------------------------------------------------------
  await admin.setInputFiles('[data-testid="admin-upload"]', UPLOAD_FILE)
  await admin.waitForSelector('[data-testid="admin-uploads"]', { timeout: 30_000 })
  const uploadReport = await admin.locator('[data-testid="admin-uploads"]').textContent()
  checks.run(
    'upload reports back',
    /uploaded|already in the library/.test(uploadReport ?? ''),
    `"${uploadReport}"`,
  )

  const library = await admin.$$eval('[data-testid="admin-library"] li', (rows) => rows.length)
  checks.run('library lists the uploaded track', library > 0, `${library} track(s)`)

  // --- queueing --------------------------------------------------------------
  // Off air first, so the first queued track goes straight onto the decks and
  // the run starts from a known place.
  await admin.click('[data-testid="admin-stop"]').catch(() => undefined)
  await wait(500)

  const queueButtons = admin.getByRole('button', { name: 'Queue' })
  const libraryCount = await queueButtons.count()
  for (let i = 0; i < 3; i++) {
    await queueButtons.nth(i % libraryCount).click()
    await wait(400)
  }

  await wait(700)
  const queued = await queueIds(admin)
  checks.run(
    'queueing fills the queue and starts the station',
    queued.length === 2 && !(await nowPlaying(admin)).includes('off air'),
    `${queued.length} queued, now playing "${await nowPlaying(admin)}"`,
  )

  // --- reorder ---------------------------------------------------------------
  const before = await queueIds(admin)
  await admin.locator('[data-testid="admin-queue"] li').first().getByText('↓').click()
  await wait(700)
  const after = await queueIds(admin)
  checks.run(
    'moving an entry down reorders the queue',
    after[0] === before[1] && after[1] === before[0],
    `${before.join(',')} → ${after.join(',')}`,
  )

  const server = await serverQueue()
  checks.run(
    'the order the admin sees is the order the server holds',
    server.map((entry) => String(entry.id)).join(',') === after.join(','),
    `server ${server.map((e) => e.id).join(',')}`,
  )

  // --- remove ----------------------------------------------------------------
  await admin.locator('[data-testid="admin-queue"] li').first().getByText('✕').click()
  await wait(700)
  const remaining = await queueIds(admin)
  checks.run(
    'removing an entry drops exactly that one',
    remaining.length === after.length - 1 && !remaining.includes(after[0]!),
    `${after.join(',')} → ${remaining.join(',')}`,
  )

  // --- a second listener, for the transport checks below ----------------------
  // Listeners no longer render the queue (what is coming is the admin's
  // worksheet alone) so whether the frame reached them is checked the way a
  // listener would notice: both ears end up on the same file at the skip.
  const latecomer = await openPage(browser, STATION_URL)
  await tuneIn(latecomer, 'latecomer')
  await wait(1_500)

  // Queue one more behind the current track, so the skip below has somewhere
  // to land.
  await admin.getByRole('button', { name: 'Queue' }).first().click()
  await wait(1_200)

  // --- transport -------------------------------------------------------------
  const audioOf = (page: Page) => page.evaluate<AudioState>(AUDIO)

  await admin.click('[data-testid="admin-playpause"]')
  await wait(1_200)
  checks.run('pause reaches the listener', (await audioOf(listener)).paused, 'listener paused')
  checks.run(
    'the button offers to resume once paused',
    (await admin.locator('[data-testid="admin-playpause"]').textContent()) === 'Resume',
    'labelled Resume',
  )

  await admin.click('[data-testid="admin-playpause"]')
  await wait(1_500)
  checks.run('resume restarts the listener', !(await audioOf(listener)).paused, 'listener playing')

  const playingBefore = await nowPlaying(admin)
  const srcBefore = (await audioOf(listener)).src
  const queuedBefore = await queueIds(admin)
  await admin.click('[data-testid="admin-skip"]')
  await wait(2_000)
  const playingAfter = await nowPlaying(admin)
  checks.run(
    'skip moves the station to the next queued track',
    playingAfter !== playingBefore || (await audioOf(listener)).src !== srcBefore,
    `"${playingBefore}" → "${playingAfter}"`,
  )
  checks.run(
    'the queue shrinks by one on skip',
    (await queueIds(admin)).length === queuedBefore.length - 1,
    `${(await queueIds(admin)).length} left`,
  )
  checks.run(
    'both listeners land on the same track as each other',
    (await audioOf(listener)).src === (await audioOf(latecomer)).src,
    (await audioOf(listener)).src ?? 'no source',
  )

  // --- the listeners still see nothing they shouldn't ------------------------
  for (const [name, page] of [
    ['listener', listener],
    ['late listener', latecomer],
  ] as const) {
    checks.run(
      `${name} never grew admin controls`,
      !(await present(page, 'admin-panel')) && !(await present(page, 'admin-signin')),
      'still just a listener',
    )
  }

  // --- signing out -----------------------------------------------------------
  await admin.getByRole('button', { name: 'Sign out' }).click()
  await admin.waitForSelector('[data-testid="admin-signin"]', { timeout: 10_000 })
  checks.run('signing out puts the controls away', !(await present(admin, 'admin-panel')), 'hidden')

  await admin.reload({ waitUntil: 'domcontentloaded' })
  await wait(1_000)
  checks.run(
    'and the session is gone at the station, not just in the tab',
    !(await present(admin, 'admin-panel')),
    'still signed out',
  )
} finally {
  await browser.close()
}

checks.finish('ADMIN QA')
