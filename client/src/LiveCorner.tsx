import { useEffect, useState } from 'react'
import { LiveVideo } from './LiveVideo.js'
import { stationUrl } from './lib/routes.js'

/**
 * The stream while the DJ is on camera: small in the corner, so the page keeps
 * saying what it says, and full size when somebody asks for it.
 *
 * One element in both states, restyled rather than swapped, so opening the full
 * view neither restarts the video nor loses the sound.
 */
export function LiveCorner({ url, inRoom = false }: { url: string; inRoom?: boolean }) {
  const [open, setOpen] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (dismissed) return null

  return (
    <aside className="live-corner" data-open={open} data-testid="live-corner" aria-label="Live now">
      <div className="live-corner__frame">
        <LiveVideo url={url} title="chunky.fm, live from the decks" controls={open} />
        {!open && (
          <button
            type="button"
            className="live-corner__expand"
            aria-label="Open the full view of the live stream"
            onClick={() => setOpen(true)}
          />
        )}
        {!open && (
          <button
            type="button"
            className="live-corner__dismiss"
            aria-label="Hide the live stream"
            onClick={() => setDismissed(true)}
          >
            ×
          </button>
        )}
      </div>
      {open && (
        <div className="live-corner__bar">
          {!inRoom && (
            <a className="button button--press" href={stationUrl()}>
              Join the room
            </a>
          )}
          <button
            type="button"
            className="button live-corner__close"
            onClick={() => setOpen(false)}
            autoFocus
          >
            Close
          </button>
        </div>
      )}
    </aside>
  )
}
