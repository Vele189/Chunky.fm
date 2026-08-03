/** Shared config and helpers for the browser QA scripts. */

import type { Page } from 'playwright-core'

export const CLIENT_URL = process.env.CLIENT_URL ?? 'http://localhost:5173'
export const API_URL = process.env.API_URL ?? 'http://localhost:3000'
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'change-me'
export const CHROME_PATH = process.env.CHROME_PATH ?? '/usr/bin/google-chrome'
/** Which track these scripts put on the decks. Needs to be a few minutes long. */
export const TRACK_ID = Number(process.env.TRACK_ID ?? 1)
export const OTHER_TRACK_ID = Number(process.env.OTHER_TRACK_ID ?? 2)

/**
 * Evaluate bodies are strings on purpose: the TypeScript runner rewrites inline
 * functions with helpers (`__name`) that do not exist inside the page.
 */
export const PLAYING = `(() => {
  const a = document.querySelector('audio')
  return !!a && !a.paused && a.currentTime > 0
})()`

export const AUDIO = `(() => {
  const a = document.querySelector('audio')
  return {
    currentTime: a ? a.currentTime : -1,
    paused: a ? a.paused : true,
    rate: a ? a.playbackRate : -1,
    src: a ? a.getAttribute('src') : null,
  }
})()`

export const STATUS = `(document.querySelector('.status') || {}).textContent || ''`

/** Records every seek, so an otherwise invisible audio glitch becomes countable. */
export const INSTRUMENT_SEEKS = `(() => {
  const a = document.querySelector('audio')
  window.__seeks = []
  a.addEventListener('seeking', function () {
    window.__seeks.push({ at: Date.now(), to: a.currentTime })
  })
  return true
})()`

export const SEEKS = `window.__seeks || []`
export const RESET_SEEKS = `(window.__seeks = [], true)`

export interface AudioState {
  currentTime: number
  paused: boolean
  rate: number
  src: string | null
}

/**
 * Joins the station: name yourself, then tune in.
 *
 * The button is disabled until the field has something in it, so every script
 * that used to click straight through now has to type first. Each page gets its
 * own nickname so a run with several listeners is readable at a glance.
 */
export async function tuneIn(page: Page, nickname = 'qa'): Promise<void> {
  await page.getByLabel('What should everyone call you?').fill(nickname)
  await page.getByRole('button', { name: 'Tune in' }).click()
}

export function playbackCommand(body: unknown): Promise<unknown> {
  return fetch(`${API_URL}/api/playback`, {
    method: 'POST',
    headers: { authorization: `Bearer ${ADMIN_PASSWORD}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((res) => res.json())
}

export const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export class Checks {
  #failures = 0

  run(label: string, ok: boolean, detail: string): void {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — ${detail}`)
    if (!ok) this.#failures++
  }

  get failures(): number {
    return this.#failures
  }

  finish(name: string): never {
    console.log(this.#failures === 0 ? `\n${name} PASSED` : `\n${this.#failures} ${name} CHECK(S) FAILED`)
    process.exit(this.#failures === 0 ? 0 : 1)
  }
}
