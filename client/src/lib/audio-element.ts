/**
 * Small helpers over HTMLAudioElement. Seeking before metadata has loaded is
 * silently dropped by browsers, which shows up as a listener sitting at 0:00
 * while everyone else is at 2:14, so every seek goes through here.
 */

/**
 * Seeks pending on metadata, per element. Without this a deferred seek for a
 * track we've since moved on from would fire against the *new* track's
 * metadata and drop the listener at a position from the previous song.
 */
const pendingSeeks = new WeakMap<HTMLAudioElement, () => void>()

function cancelPendingSeek(audio: HTMLAudioElement): void {
  const pending = pendingSeeks.get(audio)
  if (pending) {
    audio.removeEventListener('loadedmetadata', pending)
    pendingSeeks.delete(audio)
  }
}

/**
 * Pass a function rather than a number when the target is a moving clock.
 *
 * A deferred seek can wait a second or more for metadata on a slow link. A
 * number captured when the seek was asked for is that far stale when it
 * finally lands, and the drift loop then has to correct the gap with a second
 * seek. A function is read at the moment the seek actually happens.
 */
export function seekTo(audio: HTMLAudioElement, target: number | (() => number)): void {
  cancelPendingSeek(audio)
  const resolve = typeof target === 'function' ? target : () => target

  if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
    audio.currentTime = resolve()
    return
  }

  const onLoaded = () => {
    pendingSeeks.delete(audio)
    audio.currentTime = resolve()
  }
  pendingSeeks.set(audio, onLoaded)
  audio.addEventListener('loadedmetadata', onLoaded, { once: true })
}

/** Points the element at a new URL, but only when it actually changed. */
export function setSource(audio: HTMLAudioElement, url: string | null): boolean {
  if (url === null) {
    if (!audio.getAttribute('src')) return false
    cancelPendingSeek(audio)
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
    return true
  }
  if (audio.getAttribute('src') === url) return false
  cancelPendingSeek(audio)
  audio.setAttribute('src', url)
  audio.load()
  return true
}
