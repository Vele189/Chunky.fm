/**
 * Playback QA in a real browser. Covers what unit tests cannot see: seeks the
 * page performs on its own, and whether server commands actually land.
 *
 * Needs a running server, a running Vite dev server, and two uploaded tracks.
 * See README.
 */
import { chromium, type Page } from 'playwright-core'
import {
  AUDIO,
  type AudioState,
  CHROME_PATH,
  CLIENT_URL,
  Checks,
  INSTRUMENT_SEEKS,
  OTHER_TRACK_ID,
  PLAYING,
  RESET_SEEKS,
  SEEKS,
  STATUS,
  TRACK_ID,
  playbackCommand,
  wait,
} from './qa-env.js'

const checks = new Checks()

const browser = await chromium.launch({
  executablePath: CHROME_PATH,
  args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
})

const audioOf = (page: Page) => page.evaluate<AudioState>(AUDIO)

try {
  await playbackCommand({ action: 'play', trackId: TRACK_ID })

  const page = await (await browser.newContext()).newPage()
  await page.goto(CLIENT_URL, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Tune in' }).click()
  await page.waitForFunction(PLAYING, null, { timeout: 15_000 })
  await page.evaluate(INSTRUMENT_SEEKS)
  console.log('listener playing and instrumented\n')

  // --- seeks the page performs unprompted ------------------------------------
  // One seek at join is expected: it is the first alignment once the clock
  // handshake lands. What must never happen is a seek later, when nothing
  // changed — the 30s clock resync must not yank the element mid-song.
  console.log('letting startup settle…')
  await wait(3_000)

  // The handshake must land promptly. When it silently failed, the client sat
  // unsynced — no alignment, no drift correction — until the 30s resync, and
  // every other check here still passed.
  const rtt = await page.evaluate<string>(
    `(document.querySelector('[data-testid=sync-rtt]') || {}).textContent || 'absent'`,
  )
  checks.run('clock handshake completes on connect', /^\d+ms$/.test(rtt), `rtt readout "${rtt}"`)

  const startupSeeks = (await page.evaluate<{ to: number }[]>(SEEKS)).length
  checks.run('at most one alignment seek at join', startupSeeks <= 1, `${startupSeeks} seek(s)`)

  await page.evaluate(RESET_SEEKS)
  console.log('watching 40s of steady playback (spans a 30s clock resync)…')
  await wait(40_000)

  const seeks = await page.evaluate<{ to: number }[]>(SEEKS)
  for (const seek of seeks) console.log(`   → unexpected seek to ${seek.to.toFixed(3)}s`)
  checks.run(
    'no unprompted seeks while playing steadily',
    seeks.length === 0,
    `${seeks.length} seek(s)`,
  )
  checks.run('playback rate steady at 1x', (await audioOf(page)).rate === 1, 'rate')

  // --- server commands reach the listener ------------------------------------
  await playbackCommand({ action: 'pause' })
  await wait(1_000)
  checks.run('server pause stops the listener', (await audioOf(page)).paused, 'paused')

  await playbackCommand({ action: 'resume' })
  await wait(1_500)
  checks.run('server resume restarts the listener', !(await audioOf(page)).paused, 'playing')

  await playbackCommand({ action: 'seek', positionMs: 120_000 })
  await wait(2_000)
  const sought = await audioOf(page)
  checks.run(
    'server seek moves the listener',
    Math.abs(sought.currentTime - 120) < 2,
    `at ${sought.currentTime.toFixed(2)}s, expected ~120s`,
  )

  // --- switching tracks mid-playback -----------------------------------------
  const before = await audioOf(page)
  await playbackCommand({ action: 'play', trackId: OTHER_TRACK_ID })
  await wait(3_000)
  const after = await audioOf(page)
  checks.run('track change swaps the source', before.src !== after.src, 'src changed')
  // The regression this guards: a deferred seek from the previous track firing
  // against the new track's metadata, dropping the listener at 2:00 of a song
  // that just started.
  checks.run(
    'new track starts near the top, not at the old position',
    after.currentTime < 6,
    `at ${after.currentTime.toFixed(2)}s`,
  )
  checks.run('new track is actually playing', !after.paused, 'playing')

  await playbackCommand({ action: 'stop' })
  await wait(1_500)
  const stopped = await audioOf(page)
  checks.run('stop takes the listener off air', stopped.paused && stopped.src === null, 'off air')

  const status = await page.evaluate<string>(STATUS)
  checks.run('still shows as connected', status.includes('on air'), `status "${status}"`)
} finally {
  await browser.close()
}

checks.finish('PLAYBACK QA')
