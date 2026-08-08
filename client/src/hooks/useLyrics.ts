import { useEffect, useMemo, useState } from 'react'
import { fetchLyrics, type LyricLine, type Lyrics, parseLrc } from '../lib/lyrics.js'

/**
 * How long to wait before asking again, and how many times to bother. The
 * server looks the words up the moment a track is uploaded, so by the time
 * anything plays the answer is almost always already written down — a retry
 * here only covers the track that went on air seconds after landing, while
 * the station's own errand to the archive is still in flight.
 */
const RETRY_MS = 12_000
const RETRIES = 2

export interface LyricSheet {
  /** The synced sheet in time order. Empty when only plain words exist. */
  lines: LyricLine[]
  /** The words with no clock on them — the fallback sheet. */
  plain: string | null
  /** 'looking' until the station has answered; then 'found' or 'none'. */
  status: 'looking' | 'found' | 'none'
}

const EMPTY: LyricSheet = { lines: [], plain: null, status: 'none' }

/**
 * The words for the track on the deck.
 *
 * Asks once per track, not per render, and forgets everything the moment the
 * track changes — the words to the last song bright on screen over the intro
 * of this one would be worse than no words at all.
 */
export function useLyrics(trackId: number | null): LyricSheet {
  const [found, setFound] = useState<Lyrics | null>(null)
  const [settled, setSettled] = useState(false)

  useEffect(() => {
    setFound(null)
    setSettled(trackId === null)
    if (trackId === null) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempt = 0
    const ask = async () => {
      const lyrics = await fetchLyrics(trackId)
      if (cancelled) return
      if (lyrics) {
        setFound(lyrics)
        setSettled(true)
      } else if (attempt < RETRIES) {
        attempt += 1
        timer = setTimeout(() => void ask(), RETRY_MS)
      } else {
        setSettled(true)
      }
    }
    void ask()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [trackId])

  const lines = useMemo(() => (found?.synced ? parseLrc(found.synced) : []), [found])

  if (trackId === null) return EMPTY
  return {
    lines,
    plain: found?.plain ?? null,
    status: found ? 'found' : settled ? 'none' : 'looking',
  }
}
