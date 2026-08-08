import { useEffect, useState } from 'react'
import { scrubbed } from './session.js'

/**
 * The page, read as a song.
 *
 * Scrolling moves a playhead: the top of the document is 0:00 and the bottom is
 * the last bar. Everything the page does with that — the bar along the bottom,
 * the room filling in as the playhead reaches each line — is downstream of this
 * one number, so the reader ends up having moved through a song with the room
 * talking around them rather than having read a description of it.
 *
 * A scroll listener rather than a scroll-linked animation because the value is
 * needed as *state*: React has to re-render the room when the playhead passes
 * 2:04, and CSS `animation-timeline` can move a bar but cannot say a sentence.
 * Reads are coalesced into one frame, and the listener is passive, so scrolling
 * is never waiting on this.
 */
export function useScrubbedSession(duration: number): number {
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    let frame = 0

    const read = () => {
      frame = 0
      const doc = document.documentElement
      setSeconds(scrubbed(window.scrollY, doc.scrollHeight - window.innerHeight, duration))
    }

    const onScroll = () => {
      // One read per frame however many events arrive in it. Scroll fires far
      // faster than the page can usefully redraw, and the number only changes
      // once a second's worth of page has gone by anyway.
      if (frame === 0) frame = window.requestAnimationFrame(read)
    }

    // Once up front: a reload part-way down the page, or a browser restoring a
    // scroll position, should not start the session at 0:00 and jump.
    read()
    window.addEventListener('scroll', onScroll, { passive: true })
    // The divisor is the window's height, so a resize moves the playhead even
    // when nothing has scrolled.
    window.addEventListener('resize', onScroll, { passive: true })

    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [duration])

  return seconds
}
