/**
 * Chat QA in real browsers: three listeners talk to each other, a fourth walks
 * in late and finds the conversation already there, and one of them survives
 * the station being restarted underneath them with the history intact.
 *
 * That last part is the acceptance criterion (chat persists for the session)
 * and the only honest way to check it is to make the client fetch it again
 * rather than to read the database.
 *
 * Needs a running Vite dev server and a built server (`cd server && npm run
 * build`), and the restart phase owns the server process. See README.
 */
import type { ChildProcess } from 'node:child_process'
import { type Browser, type Page, chromium } from 'playwright-core'
import {
  CHROME_PATH,
  STATION_URL,
  Checks,
  STATUS,
  TRACK_ID,
  health,
  playbackCommand,
  startServer,
  stopServer,
  tuneIn,
  visit,
  wait,
} from './qa-env.js'

const checks = new Checks()
const SETTLE_MS = 3_000
const RECONNECT_MS = 30_000

/** The conversation as this page renders it: "nick: text", in order. */
const transcript = (page: Page): Promise<string[]> =>
  page.$$eval('[data-testid="chat-list"] li', (rows) =>
    rows.map((row) => {
      const nick = row.querySelector('.chat__nick')?.textContent ?? ''
      const text = row.querySelector('.chat__text')?.textContent ?? ''
      return `${nick}: ${text}`
    }),
  )

async function expectTranscript(
  page: Page,
  who: string,
  expected: string[],
  budgetMs = SETTLE_MS,
): Promise<void> {
  const same = (seen: string[]) =>
    seen.length === expected.length && seen.every((line, i) => line === expected[i])

  const deadline = Date.now() + budgetMs
  let seen: string[] = []
  while (Date.now() < deadline) {
    seen = await transcript(page)
    if (same(seen)) break
    await wait(100)
  }
  checks.run(`${who} sees ${expected.length} line(s)`, same(seen), `showing ${JSON.stringify(seen)}`)
}

async function say(page: Page, text: string): Promise<void> {
  await page.fill('[data-testid="chat-input"]', text)
  await page.getByRole('button', { name: 'Send' }).click()
}

async function join(browser: Browser, nickname: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage()
  await page.goto(STATION_URL, { waitUntil: 'domcontentloaded' })
  await tuneIn(page, nickname)
  // The room lives behind its rail mark now; the aside beside the deck is
  // the lyrics' alone.
  await visit(page, '#chat')
  console.log(`${nickname}: tuned in`)
  return page
}

async function waitForStatus(page: Page, text: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await page.evaluate<string>(STATUS)).includes(text)) return true
    await wait(500)
  }
  return false
}

let restarted: ChildProcess | null = null
const browser = await chromium.launch({
  executablePath: CHROME_PATH,
  args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
})

try {
  await playbackCommand({ action: 'play', trackId: TRACK_ID })

  const ana = await join(browser, 'ana')
  const ben = await join(browser, 'ben')

  await say(ana, 'evening')
  // The sender sees their own line come back from the server, like everyone
  // else's; there is no optimistic copy rendered locally.
  await expectTranscript(ana, 'ana after her own message', ['ana: evening'])
  await expectTranscript(ben, 'ben after ana speaks', ['ana: evening'])

  await say(ben, 'evening yourself')
  const both = ['ana: evening', 'ben: evening yourself']
  await expectTranscript(ana, 'ana after ben replies', both)
  await expectTranscript(ben, 'ben after his own reply', both)

  // Ordering is the server's, not each client's arrival order.
  await say(ana, 'one')
  await say(ana, 'two')
  const four = [...both, 'ana: one', 'ana: two']
  await expectTranscript(ben, 'ben sees them in the order they were said', four)

  console.log('\ncleo joins late…')
  const cleo = await join(browser, 'cleo')
  await expectTranscript(cleo, 'cleo walks into a conversation', four)

  // A message signed with someone else's name is signed with the sender's.
  console.log('ben tries to speak as ana…')
  await ben.evaluate(`(() => {
    const socket = new WebSocket(location.origin.replace(/^http/, 'ws') + '/ws')
    socket.onopen = function () {
      socket.send(JSON.stringify({ type: 'join', nickname: 'impostor' }))
      socket.send(JSON.stringify({ type: 'say', text: 'ana here, definitely', nickname: 'ana' }))
    }
    return true
  })()`)
  await wait(1_500)
  const afterImpostor = await transcript(ana)
  checks.run(
    'a message carries the name of the socket that sent it',
    afterImpostor.at(-1) === 'impostor: ana here, definitely',
    `last line "${afterImpostor.at(-1)}"`,
  )

  // Trailing state for the persistence check below.
  const beforeRestart = await transcript(ana)

  console.log('\nreloading cleo’s page…')
  await cleo.reload({ waitUntil: 'domcontentloaded' })
  await tuneIn(cleo, 'cleo')
  await expectTranscript(cleo, 'cleo after a reload', beforeRestart)

  console.log('\ntaking the station down under them…')
  await stopServer()
  await health(false)
  checks.run(
    'listeners notice the station is gone',
    await waitForStatus(ana, 'reconnecting', 10_000),
    `ana's status`,
  )

  console.log('putting it back up…')
  restarted = startServer()
  checks.run('station came back', await health(true), 'health')
  checks.run(
    'ana reconnects on her own',
    await waitForStatus(ana, 'on air', RECONNECT_MS),
    `ana's status`,
  )

  // The session ended with the process, so the new one is an empty room. A page
  // that stayed open keeps the scrollback it already had, which is what it saw,
  // and chat has to go on working on the socket that came back.
  await say(ana, 'new session, same station')
  await expectTranscript(ana, 'ana talking after the restart', [
    ...beforeRestart,
    'ana: new session, same station',
  ])

  // And a page loaded into the new session sees only the new session.
  const late = await join(browser, 'late')
  await expectTranscript(late, 'a page loaded into the new session', [
    'ana: new session, same station',
  ])
} finally {
  await browser.close()
  restarted?.unref()
}

checks.finish('CHAT QA')
