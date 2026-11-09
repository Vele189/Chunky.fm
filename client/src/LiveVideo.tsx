import { useEffect, useRef, useState } from 'react'
import './live-video.css'

/**
 * The DJ on camera.
 *
 * It starts muted because no browser lets a page start sound on its own, and
 * the button is what turns a silent picture into the set. hls.js is imported
 * only here and only when there is a stream, so a page on a dark night does not
 * pay for it; iPhones have no use for it and play the playlist natively.
 */
export function LiveVideo({ url, title }: { url: string; title: string }) {
  const video = useRef<HTMLVideoElement>(null)
  const [muted, setMuted] = useState(true)

  useEffect(() => {
    const element = video.current
    if (element === null) return
    let gone = false
    let teardown = (): void => {}

    void import('hls.js')
      .then(({ default: Hls }) => {
        if (gone) return
        if (!Hls.isSupported()) {
          element.src = url
          teardown = () => element.removeAttribute('src')
          return
        }
        const hls = new Hls({ liveDurationInfinity: true })
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError()
          else hls.startLoad()
        })
        hls.loadSource(url)
        hls.attachMedia(element)
        teardown = () => hls.destroy()
      })
      .catch(() => {
        // The chunk did not load: Safari can still play this without it.
        if (!gone) element.src = url
      })

    return () => {
      gone = true
      teardown()
    }
  }, [url])

  const unmute = (): void => {
    const element = video.current
    if (element === null) return
    element.muted = false
    setMuted(false)
    void element.play().catch(() => {})
  }

  return (
    <div className="live-video" data-testid="live-video">
      {/* biome-ignore lint/a11y/useMediaCaption: a live DJ set has no captions */}
      <video
        ref={video}
        className="live-video__picture"
        title={title}
        autoPlay
        muted
        playsInline
        controls
        onVolumeChange={(event) => setMuted(event.currentTarget.muted)}
      />
      <p className="live-video__badge">Live</p>
      {muted && (
        <button type="button" className="live-video__sound" onClick={unmute}>
          Tap for sound
        </button>
      )}
    </div>
  )
}
