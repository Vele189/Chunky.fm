/**
 * The M1 acceptance test, for real: two independent browser contexts join the
 * station at different times and must end up at the same instant of the song.
 *
 * Needs the server and the Vite dev server running, and a track uploaded.
 * See README — or just run `npm run verify:sync` from the repo root.
 */
import { chromium, type Page } from 'playwright-core'

// The station, not the origin: `/` is the page in front of it. Kept in step
// with STATION_PATH in src/lib/routes.ts.
const CLIENT_URL = `${(process.env.CLIENT_URL ?? 'http://localhost:5173').replace(/\/+$/, '')}/listen`
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome'
const TOLERANCE_MS = 150

// Evaluate bodies are strings on purpose: the TypeScript runner rewrites inline
// functions with helpers that don't exist inside the page.
const PLAYING = `(() => { const a = document.querySelector('audio'); return !!a && !a.paused && a.currentTime > 0 })()`

const AUDIO_STATE = `(() => {
  const a = document.querySelector('audio')
  return {
    currentTime: a ? a.currentTime : -1,
    playbackRate: a ? a.playbackRate : -1,
    paused: a ? a.paused : true,
    src: a ? a.getAttribute('src') : null,
  }
})()`

const SYNC_READOUT = `(() => {
  const read = function (id) {
    const el = document.querySelector('[data-testid="' + id + '"]')
    return el ? el.textContent : '-'
  }
  return {
    offset: read('sync-offset'),
    rtt: read('sync-rtt'),
    drift: read('sync-drift'),
    correction: read('sync-correction'),
  }
})()`

interface AudioState {
  currentTime: number
  playbackRate: number
  paused: boolean
  src: string | null
}

interface SyncReadout {
  offset: string
  rtt: string
  drift: string
  correction: string
}

async function tuneIn(page: Page, label: string): Promise<void> {
  await page.goto(CLIENT_URL, { waitUntil: 'domcontentloaded' })
  // A nickname is required before joining, and the button stays disabled
  // without one — so the label doubles as this listener's name.
  await page.getByLabel('What should everyone call you?').fill(label)
  await page.getByRole('button', { name: 'Tune in' }).click()
  await page.waitForFunction(PLAYING, null, { timeout: 15_000 })
  console.log(`${label}: playing`)
}

const readAudio = (page: Page) => page.evaluate<AudioState>(AUDIO_STATE)
const readSync = (page: Page) => page.evaluate<SyncReadout>(SYNC_READOUT)

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
})

let failures = 0
const check = (label: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — ${detail}`)
  if (!ok) failures++
}

try {
  // Separate contexts, so nothing is shared between the two listeners.
  const earlyPage = await (await browser.newContext()).newPage()
  await tuneIn(earlyPage, 'listener A')

  console.log('waiting 5s before the second listener joins…')
  await earlyPage.waitForTimeout(5_000)

  const latePage = await (await browser.newContext()).newPage()
  await tuneIn(latePage, 'listener B (mid-song)')

  // Let both settle through at least two drift-correction ticks.
  await latePage.waitForTimeout(5_000)

  const [a, b] = await Promise.all([readAudio(earlyPage), readAudio(latePage)])
  const [syncA, syncB] = await Promise.all([readSync(earlyPage), readSync(latePage)])

  console.log(`\nA: ${a.currentTime.toFixed(3)}s  rate ${a.playbackRate}  ${JSON.stringify(syncA)}`)
  console.log(`B: ${b.currentTime.toFixed(3)}s  rate ${b.playbackRate}  ${JSON.stringify(syncB)}`)

  const driftMs = Math.abs(a.currentTime - b.currentTime) * 1000
  console.log(`\nposition gap: ${driftMs.toFixed(1)}ms`)

  check('both listeners are playing', !a.paused && !b.paused, `A paused=${a.paused} B paused=${b.paused}`)
  check('both on the same file', a.src === b.src, `${a.src} vs ${b.src}`)
  check('B joined mid-song, not at 0:00', b.currentTime > 4, `B at ${b.currentTime.toFixed(2)}s`)
  check(`positions within ${TOLERANCE_MS}ms`, driftMs < TOLERANCE_MS, `${driftMs.toFixed(1)}ms apart`)

  // Drift correction should have settled both back to normal speed.
  const rates = [a.playbackRate, b.playbackRate]
  check(
    'playback rates are sane',
    rates.every((rate) => Math.abs(rate - 1) <= 0.021),
    `rates ${rates.join(', ')}`,
  )

  // --- drift correction, provoked rather than waited for ---

  console.log('\nknocking listener B 0.4s ahead…')
  await latePage.evaluate(`document.querySelector('audio').currentTime += 0.4`)
  await latePage.waitForTimeout(2_500) // one drift tick

  const nudged = await readAudio(latePage)
  const nudgedReadout = await readSync(latePage)
  console.log(`B rate ${nudged.playbackRate}  ${JSON.stringify(nudgedReadout)}`)
  check(
    'a small error is corrected by rate, not by seeking',
    nudged.playbackRate < 1 && nudged.playbackRate >= 0.979,
    `rate ${nudged.playbackRate}`,
  )

  console.log('letting it converge…')
  await latePage.waitForTimeout(25_000)
  const settled = await readAudio(latePage)
  const settledGap = Math.abs(settled.currentTime - (await readAudio(earlyPage)).currentTime) * 1000
  console.log(`B rate ${settled.playbackRate}, gap to A ${settledGap.toFixed(1)}ms`)
  check('rate nudge converges and resets to 1×', settled.playbackRate === 1, `rate ${settled.playbackRate}`)
  check(`converged back within ${TOLERANCE_MS}ms`, settledGap < TOLERANCE_MS, `${settledGap.toFixed(1)}ms`)

  console.log('\nknocking listener B 3s ahead (past the seek threshold)…')
  const beforeSeek = await readAudio(latePage)
  await latePage.evaluate(`document.querySelector('audio').currentTime += 3`)
  await latePage.waitForTimeout(2_500)

  const reseeked = await readAudio(latePage)
  const gapAfterSeek = Math.abs(reseeked.currentTime - (await readAudio(earlyPage)).currentTime) * 1000
  console.log(
    `B was ${beforeSeek.currentTime.toFixed(2)}s, jumped, now ${reseeked.currentTime.toFixed(2)}s`,
  )
  check(`a large error is hard-seeked back`, gapAfterSeek < TOLERANCE_MS, `${gapAfterSeek.toFixed(1)}ms from A`)
  check('rate is left alone after a seek', reseeked.playbackRate === 1, `rate ${reseeked.playbackRate}`)
} finally {
  await browser.close()
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
