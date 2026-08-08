/**
 * What a listener sees when the room will not take what they said.
 *
 * The socket answers a refused `say` with an error frame and nothing else. The
 * client used to drop that frame: the composer had already been cleared the
 * moment the message went out, so a refusal left an empty box and an unchanged
 * conversation, which on screen is exactly what saying something successfully
 * looks like. The listener's only clue was that their line never appeared, and
 * a line that has not appeared *yet* looks the same.
 *
 * Chat is rate-limited, so this is reachable by anyone who types quickly, not
 * only by a broken client. Needs a running Vite dev server and a station.
 */
import { chromium } from 'playwright-core'
import { CHROME_PATH, STATION_URL, Checks, tuneIn, visit, wait } from './qa-env.js'

const checks = new Checks()

/** More than the station's burst, so the last few are certain to be refused. */
const BURST = 5
const MESSAGES = 9

/**
 * Chat is kept for the life of a session, so a second run of this script walks
 * into the conversation the first one left behind, and counting "the lines on
 * screen" would count those too. Everything below is scoped to this run's tag.
 */
const TAG = `run-${Date.now().toString(36).slice(-5)}`
const mine = (lines: string[]) => lines.filter((line) => line.includes(TAG))

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME_PATH })
  const page = await browser.newPage()
  await page.goto(STATION_URL)
  await tuneIn(page, 'fast talker')
  // The composer lives on the chat view now, not beside the deck.
  await visit(page, '#chat')
  await wait(2_000)

  const input = page.getByTestId('chat-input')

  // Typed and sent the way a person does it, one after another, with no pause
  // long enough to earn a token back.
  for (let i = 0; i < MESSAGES; i++) {
    await input.fill(`${TAG} message ${i}`)
    await input.press('Enter')
  }
  await wait(1_500)

  const notice = await page.getByTestId('chat-refusal').textContent().catch(() => null)
  checks.run(
    'a refused message says so',
    Boolean(notice && /not sent/i.test(notice)),
    notice === null ? 'nothing on screen' : `"${notice}"`,
  )

  const draft = await input.inputValue()
  checks.run(
    'the refused text is handed back rather than lost',
    draft.startsWith(`${TAG} message `),
    draft === '' ? 'composer left empty' : `composer holds "${draft}"`,
  )

  const shown = mine(await page.locator('.chat__text').allTextContents())
  // Not an exact count: the bucket refills while these are being typed, so how
  // many get through depends on how long the browser took. The property is that
  // some were taken and some were not; pinning the number would be a check
  // that passes on a fast machine for reasons that have nothing to do with it.
  checks.run(
    'the room only shows what it actually took',
    shown.length >= BURST && shown.length < MESSAGES,
    `${shown.length} line(s) of ${MESSAGES} sent, burst is ${BURST}`,
  )
  // The one that came back into the box is not also in the conversation: a
  // listener must never be shown their own message twice, or once when it was
  // never said at all.
  checks.run(
    'nothing is both refused and displayed',
    !shown.includes(draft),
    `"${draft}" is not in the list`,
  )

  // Once the bucket refills, the same text sends normally. The refusal was
  // about pace, and nothing about the composer is left in a stuck state.
  await wait(4_000)
  await input.press('Enter')
  await wait(1_500)
  const after = mine(await page.locator('.chat__text').allTextContents())
  checks.run(
    'the handed-back message sends once the room will take it',
    after.includes(draft),
    `last line "${after.at(-1)}"`,
  )
  const cleared = await page.getByTestId('chat-refusal').count()
  checks.run('and the notice goes away with it', cleared === 0, `${cleared} notice(s) left`)

  await browser.close()
  checks.finish('CHAT REFUSAL QA')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
