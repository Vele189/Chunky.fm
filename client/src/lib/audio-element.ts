/**
 * Small helpers over HTMLAudioElement. Seeking before metadata has loaded is
 * silently dropped by browsers, which shows up as a listener sitting at 0:00
 * while everyone else is at 2:14 — so every seek goes through here.
 */

export function seekTo(audio: HTMLAudioElement, seconds: number): void {
  if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
    audio.currentTime = seconds
    return
  }
  audio.addEventListener('loadedmetadata', () => {
    audio.currentTime = seconds
  })
}

/** Points the element at a new URL, but only when it actually changed. */
export function setSource(audio: HTMLAudioElement, url: string | null): boolean {
  if (url === null) {
    if (!audio.getAttribute('src')) return false
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
    return true
  }
  if (audio.getAttribute('src') === url) return false
  audio.setAttribute('src', url)
  audio.load()
  return true
}
