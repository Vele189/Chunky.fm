/**
 * Offline QA: take the station away and confirm the page says so, in the two
 * places it has to say two different things.
 *
 * A page loaded against a dead server has never had a station, so it offers no
 * Tune in button and says the station is off the air. A page that was listening
 * when the server went away still has the last thing it heard on it, keeps
 * showing it, and runs a line above it saying so. Those are different screens
 * from different states, and this drives both, plus the third case that reads
 * like a broken page if nothing explains it: a station that is up and answering
 * with nothing on the decks.
 *
 * This script owns the server process, so the server must be built first
 * (`cd server && npm run build`). Everything else, including starting and
 * stopping the station, comes from qa-env.
 */
import type { ChildProcess } from 'node:child_process'
import { type Page, chromium } from 'playwright-core'
import {
  CHROME_PATH,
  STATION_URL,
  Checks,
  PLAYING,
  STATUS,
  TRACK_ID,
  health,
  playbackCommand,
  startServer,
  stopServer,
  tuneIn,
  wait,
} from './qa-env.js'

const text = (testid: string) =>
  `(document.querySelector('[data-testid=${testid}]') || {}).textContent || ''`

const OUTAGE = text('outage')
const STALE = text('stale-notice')
const OFF_AIR = text('off-air')
const JOIN_FORM = `!!document.querySelector('.join__form')`
const NOW_PLAYING = `(document.querySelector('.now-playing__title') || {}).textContent || ''`

/** Polls the page until `expression` is truthy, so waits are as short as they can be. */
async function until(page: Page, expression: string, seconds: number): Promise<boolean> {
  for (let i = 0; i < seconds * 2; i++) {
    if (await page.evaluate<boolean>(`!!(${expression})`)) return true
    await wait(500)
  }
  return false
}

const checks = new Checks()

let server: ChildProcess | null = null
const browser = await chromium.launch({
  executablePath: CHROME_PATH,
  args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
})

try {
  /* --- a page that has never had a station --------------------------------- */

  console.log('taking the station down before anyone loads the page…')
  await stopServer()
  await health(false)

  const page = await (await browser.newContext()).newPage()
  await page.goto(STATION_URL, { waitUntil: 'domcontentloaded' })
  // Long enough for the first attempt to fail and a retry or two to follow it,
  // which is the window the old build spent flickering between two messages.
  await wait(4_000)

  const outage = await page.evaluate<string>(OUTAGE)
  checks.run('says the station is off the air', outage.includes('off the air'), `"${outage.trim()}"`)
  checks.run(
    'says the page keeps trying, so nobody reloads',
    outage.includes('keeps trying'),
    `"${outage.trim().slice(0, 80)}"`,
  )

  const noSignal = await page.evaluate<string>(STATUS)
  checks.run('header says no signal', noSignal.includes('no signal'), `status "${noSignal}"`)

  // The point of holding the button back: a browser starts audio from inside a
  // gesture and nowhere else, so a click spent on an absent station is silence
  // when it comes back.
  checks.run(
    'offers nothing to tune in with',
    !(await page.evaluate<boolean>(JOIN_FORM)),
    'no join form',
  )

  // Guards the regression the fold is there to prevent: the backoff opens a new
  // socket every few seconds, and a page that read each status on its own said
  // "no signal", then "tuning in…", then "no signal", once per retry.
  await page.evaluate(`(() => {
    window.__seen = []
    new MutationObserver(function () {
      const s = (document.querySelector('.status') || {}).textContent || ''
      if (window.__seen[window.__seen.length - 1] !== s) window.__seen.push(s)
    }).observe(document.body, { subtree: true, childList: true, characterData: true })
    return true
  })()`)
  await wait(8_000) // several backoff attempts
  const flicker = await page.evaluate<string[]>(`window.__seen || []`)
  checks.run(
    'the message holds still while it retries',
    flicker.length === 0,
    flicker.length === 0 ? 'no change in 8s' : `changed to ${JSON.stringify(flicker)}`,
  )

  /* --- the station comes back ---------------------------------------------- */

  console.log('\nstarting the station…')
  server = startServer()
  checks.run('server came back', await health(true), 'health')

  // Backoff climbs to 10s, so give reconnection room.
  const back = await until(page, JOIN_FORM, 40)
  checks.run('the page tunes itself in without a reload', back, `join form ${back ? 'is' : 'is not'} back`)
  checks.run(
    'the offline screen goes away with it',
    (await page.evaluate<string>(OUTAGE)) === '',
    'no outage screen',
  )

  /* --- a station that is up with nothing on -------------------------------- */

  await tuneIn(page, 'offline qa')
  const quiet = await until(page, OFF_AIR, 10)
  const quietText = await page.evaluate<string>(OFF_AIR)
  checks.run('says nothing is on the decks', quiet, `"${quietText.trim().slice(0, 60)}"`)
  // The half that stops it reading like a page that failed to load: the
  // listener is in, and nothing is required of them.
  checks.run(
    'says the listener is tuned in anyway',
    quietText.includes("You're tuned in"),
    `"${quietText.trim().slice(0, 90)}"`,
  )
  checks.run(
    'does not call a quiet station an outage',
    (await page.evaluate<string>(OUTAGE)) === '',
    'no outage screen',
  )

  /* --- losing a station this listener had ---------------------------------- */

  console.log('\nputting a track on and taking the server away underneath it…')
  await playbackCommand({ action: 'play', trackId: TRACK_ID })
  await page.waitForFunction(PLAYING, null, { timeout: 15_000 })
  const playing = await page.evaluate<string>(NOW_PLAYING)
  console.log(`   listener is playing "${playing}"`)

  await stopServer()
  await health(false)

  const stale = await until(page, STALE, 15)
  const staleText = await page.evaluate<string>(STALE)
  checks.run('says the connection went, once it has one to lose', stale, `"${staleText.trim()}"`)
  checks.run(
    'says what is on screen is from before',
    staleText.includes('before'),
    `"${staleText.trim()}"`,
  )

  const dropped = await page.evaluate<string>(STATUS)
  checks.run(
    'header says reconnecting, not no signal',
    dropped.includes('reconnecting'),
    `status "${dropped}"`,
  )

  // The reason this is a line above the page rather than a screen instead of
  // it: the audio usually plays straight through a short drop out of the
  // buffer, and blanking a track the listener can still hear would be worse
  // than the outage.
  checks.run(
    'keeps showing the track rather than blanking it',
    (await page.evaluate<string>(NOW_PLAYING)) === playing,
    `still "${playing}"`,
  )
  checks.run(
    'does not fall back to the never-had-a-station screen',
    (await page.evaluate<string>(OUTAGE)) === '',
    'no outage screen',
  )

  /* --- and back again ------------------------------------------------------ */

  console.log('restarting the station…')
  server = startServer()
  await health(true)

  const live = await until(page, `${STATUS}.indexOf('on air') >= 0`, 40)
  checks.run('the listener reconnects on its own', live, `status "${await page.evaluate<string>(STATUS)}"`)
  // Waited for rather than read once: the first attempt after a restart can
  // land on a server that is answering /health but not yet upgrading sockets,
  // which costs one more turn of the backoff. Recovering from that is the
  // behaviour under test, so a single instantaneous read would fail the run for
  // the very thing it is meant to prove.
  checks.run(
    'the stale line goes away with the outage',
    await until(page, `${STALE} === ''`, 20),
    'no stale line',
  )
  // Playback state is in memory by design, so a restarted station is off air,
  // and that is the quiet screen again, not an error.
  checks.run(
    'a restarted station reads as quiet, not broken',
    await until(page, OFF_AIR, 10),
    `"${(await page.evaluate<string>(OFF_AIR)).trim().slice(0, 60)}"`,
  )
} finally {
  await browser.close()
  server?.unref()
}

checks.finish('OFFLINE QA')
