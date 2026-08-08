/**
 * The words, and when to say them.
 *
 * The server hands over lyrics exactly as LRCLIB stores them: `synced` is LRC
 * text — `[mm:ss.xx] line` per line — and `plain` is the same words with no
 * clock on them. This file turns the LRC text into something a component can
 * hold, and answers the one question the page asks thirty times a minute:
 * which line is the song on *now*?
 *
 * "Now" is the same now the audio runs on — `expectedPositionSeconds` off the
 * server clock — which is what makes the bright line land on the ear's line
 * without any machinery of its own. The lyrics don't sync to anything; they
 * read the position everything else already agrees on.
 */

/** The words over the wire — the body of `GET /api/lyrics/:trackId`. */
export interface Lyrics {
  synced: string | null
  plain: string | null
}

/** One line of a synced sheet. Empty text is a real line: a stretch with no words. */
export interface LyricLine {
  timeMs: number
  text: string
}

/**
 * `[mm:ss.xx]`, with room for what the wild actually contains: minutes beyond
 * one digit, a fraction in centiseconds or milliseconds, or no fraction at
 * all. A line may open with several of these — a chorus tagged with every time
 * it comes around — and each one is its own entry.
 */
const TIMESTAMP = /^\[(\d+):(\d{1,2}(?:\.\d{1,3})?)\]/

/**
 * LRC text into lines in time order.
 *
 * Anything that doesn't open with a timestamp — `[ar:…]` headers, blank lines,
 * stray prose — is dropped rather than guessed at: a line with no time is a
 * line the page could only ever show at the wrong moment.
 */
export function parseLrc(text: string): LyricLine[] {
  const lines: LyricLine[] = []
  for (const raw of text.split('\n')) {
    let rest = raw
    const times: number[] = []
    for (;;) {
      const match = TIMESTAMP.exec(rest)
      if (!match) break
      times.push(Math.round((Number(match[1]) * 60 + Number(match[2])) * 1000))
      rest = rest.slice(match[0].length)
    }
    if (times.length === 0) continue
    const lineText = rest.trim()
    for (const timeMs of times) {
      lines.push({ timeMs, text: lineText })
    }
  }
  return lines.sort((a, b) => a.timeMs - b.timeMs)
}

/**
 * Which line the song is on: the last one whose moment has arrived, or -1
 * before the first — an intro is nobody's line, and highlighting the opening
 * lyric through eight bars of guitar would be the page singing early.
 */
export function activeLineIndex(lines: LyricLine[], positionMs: number): number {
  let active = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.timeMs > positionMs) break
    active = i
  }
  return active
}

/**
 * The words for one track, or null when the station has none. A 404 is the
 * server's considered answer, not an error — see the route — so it comes back
 * as null rather than a throw. Network trouble is also null: the page shows
 * no words rather than a broken panel, and the hook asks again shortly.
 */
export async function fetchLyrics(
  trackId: number,
  fetchFn: typeof fetch = fetch,
): Promise<Lyrics | null> {
  try {
    const response = await fetchFn(`/api/lyrics/${trackId}`, { credentials: 'same-origin' })
    if (!response.ok) return null
    const body = (await response.json()) as { lyrics?: Lyrics }
    return body.lyrics ?? null
  } catch {
    return null
  }
}
