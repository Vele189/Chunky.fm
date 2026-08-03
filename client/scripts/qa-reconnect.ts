/**
 * Reconnect QA: kill the server underneath a playing listener and confirm the
 * page notices, recovers on its own, and resyncs when the station returns.
 *
 * This script owns the server process, so the server must be built first
 * (`cd server && npm run build`). Everything else — including starting and
 * stopping the station — comes from qa-env.
 */
import type { ChildProcess } from 'node:child_process'
import { chromium } from 'playwright-core'
import {
  AUDIO,
  type AudioState,
  CHROME_PATH,
  CLIENT_URL,
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

const checks = new Checks()

let restarted: ChildProcess | null = null
const browser = await chromium.launch({
  executablePath: CHROME_PATH,
  args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
})

try {
  await playbackCommand({ action: 'play', trackId: TRACK_ID })

  const page = await (await browser.newContext()).newPage()
  await page.goto(CLIENT_URL, { waitUntil: 'domcontentloaded' })
  await tuneIn(page, 'reconnect qa')
  await page.waitForFunction(PLAYING, null, { timeout: 15_000 })
  console.log('listener playing')

  // Record every status transition so the reconnect sequence is visible.
  await page.evaluate(`(() => {
    window.__statuses = [{ t: Date.now(), s: document.querySelector('.status').textContent }]
    new MutationObserver(function () {
      const s = document.querySelector('.status').textContent
      const last = window.__statuses[window.__statuses.length - 1]
      if (!last || last.s !== s) window.__statuses.push({ t: Date.now(), s: s })
    }).observe(document.body, { subtree: true, childList: true, characterData: true })
    return true
  })()`)

  const initial = await page.evaluate<string>(STATUS)
  checks.run('shows on air while connected', initial.includes('on air'), `status "${initial}"`)

  // Guards the regression where probes were fired at a socket that had not
  // finished opening: every packet was dropped and the listener stayed
  // unsynced, which nothing else here would have caught.
  const rtt = await page.evaluate<string>(
    `(document.querySelector('[data-testid=sync-rtt]') || {}).textContent || 'absent'`,
  )
  checks.run('clock handshake completed on connect', /^\d+ms$/.test(rtt), `rtt readout "${rtt}"`)

  console.log('\nkilling the server…')
  await stopServer()
  await health(false)
  await wait(2_000)

  const offline = await page.evaluate<string>(STATUS)
  checks.run(
    'listener notices the station is gone',
    offline.includes('reconnecting'),
    `status "${offline}"`,
  )

  console.log('restarting the server…')
  restarted = startServer()
  checks.run('server came back', await health(true), 'health')

  // Backoff climbs to 10s, so give reconnection room.
  let reconnected = false
  for (let i = 0; i < 30 && !reconnected; i++) {
    await wait(1_000)
    reconnected = (await page.evaluate<string>(STATUS)).includes('on air')
  }
  checks.run(
    'listener reconnects on its own',
    reconnected,
    `status "${await page.evaluate<string>(STATUS)}"`,
  )

  const transitions = await page.evaluate<{ t: number; s: string }[]>(`window.__statuses || []`)
  const start = transitions[0]?.t ?? 0
  console.log('status transitions:')
  for (const entry of transitions) console.log(`   +${entry.t - start}ms  ${entry.s}`)

  // Playback state is in memory by design, so a restarted station is off air.
  await wait(1_000)
  const afterRestart = await page.evaluate<AudioState>(AUDIO)
  checks.run(
    'goes quiet because the restarted station is off air',
    afterRestart.paused,
    `paused=${afterRestart.paused}`,
  )

  console.log('putting a track back on the decks…')
  const commanded = await playbackCommand({ action: 'play', trackId: TRACK_ID })
  console.log(`   server replied: ${JSON.stringify(commanded).slice(0, 160)}`)
  await wait(3_000)
  console.log(
    `   client: ${await page.evaluate<string>(`JSON.stringify((() => {
      const a = document.querySelector('audio')
      return { src: a.getAttribute('src'), paused: a.paused, readyState: a.readyState,
               err: a.error ? a.error.message : null,
               ui: document.querySelector('.station').textContent.slice(0, 90) }
    })())`)}`,
  )
  const resumed = await page.evaluate<AudioState>(AUDIO)
  checks.run(
    'resumes playing without a page reload',
    !resumed.paused && resumed.currentTime > 0,
    `paused=${resumed.paused} at ${resumed.currentTime.toFixed(2)}s`,
  )
} finally {
  await browser.close()
  restarted?.unref()
}

checks.finish('RECONNECT QA')
