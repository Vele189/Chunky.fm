import { beforeEach, describe, expect, it, vi } from 'vitest'
import { seekTo, setSource } from '../src/lib/audio-element.js'

/**
 * A stand-in for HTMLAudioElement with just enough behaviour to exercise the
 * deferred-seek path: readyState we control, and real listener bookkeeping.
 */
class FakeAudio {
  currentTime = 0
  readyState = 0
  private listeners = new Map<string, Set<() => void>>()
  src: string | null = null
  loads = 0
  paused = true

  addEventListener(event: string, handler: () => void, options?: { once?: boolean }) {
    const wrapped = options?.once
      ? () => {
          this.removeEventListener(event, wrapped)
          handler()
        }
      : handler
    // Keep the original addressable so removeEventListener(handler) works.
    ;(wrapped as { original?: () => void }).original = handler
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(wrapped)
  }

  removeEventListener(event: string, handler: () => void) {
    const set = this.listeners.get(event)
    if (!set) return
    for (const registered of set) {
      if (registered === handler || (registered as { original?: () => void }).original === handler) {
        set.delete(registered)
      }
    }
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0
  }

  emit(event: string) {
    for (const handler of [...(this.listeners.get(event) ?? [])]) handler()
  }

  getAttribute(name: string): string | null {
    return name === 'src' ? this.src : null
  }

  setAttribute(name: string, value: string) {
    if (name === 'src') this.src = value
  }

  removeAttribute(name: string) {
    if (name === 'src') this.src = null
  }

  load() {
    this.loads++
    this.readyState = 0
  }

  pause() {
    this.paused = true
  }
}

const asAudio = (fake: FakeAudio) => fake as unknown as HTMLAudioElement

let audio: FakeAudio

beforeEach(() => {
  audio = new FakeAudio()
  vi.stubGlobal('HTMLMediaElement', { HAVE_METADATA: 1 })
})

describe('seekTo', () => {
  it('seeks straight away once metadata is available', () => {
    audio.readyState = 4

    seekTo(asAudio(audio), 134)

    expect(audio.currentTime).toBe(134)
    expect(audio.listenerCount('loadedmetadata')).toBe(0)
  })

  it('defers the seek until metadata arrives', () => {
    audio.readyState = 0

    seekTo(asAudio(audio), 134)
    expect(audio.currentTime).toBe(0) // a seek now would be silently dropped

    audio.readyState = 1
    audio.emit('loadedmetadata')
    expect(audio.currentTime).toBe(134)
  })

  it('does not leave the listener attached after it fires', () => {
    seekTo(asAudio(audio), 10)
    audio.emit('loadedmetadata')

    expect(audio.listenerCount('loadedmetadata')).toBe(0)
  })

  it('replaces a pending seek rather than stacking another on top', () => {
    seekTo(asAudio(audio), 10)
    seekTo(asAudio(audio), 20)
    seekTo(asAudio(audio), 30)

    expect(audio.listenerCount('loadedmetadata')).toBe(1)

    audio.emit('loadedmetadata')
    expect(audio.currentTime).toBe(30)
  })

  it('drops a pending seek when the source changes', () => {
    // The regression: a deferred seek for the previous track firing against
    // the new track's metadata would drop the listener at 2:14 of a song that
    // just started.
    audio.src = '/api/audio/old.mp3'
    audio.readyState = 0
    seekTo(asAudio(audio), 134)

    setSource(asAudio(audio), '/api/audio/new.mp3')
    expect(audio.listenerCount('loadedmetadata')).toBe(0)

    audio.emit('loadedmetadata')
    expect(audio.currentTime).toBe(0)
  })

  it('drops a pending seek when the station goes off air', () => {
    audio.src = '/api/audio/old.mp3'
    seekTo(asAudio(audio), 134)

    setSource(asAudio(audio), null)
    audio.emit('loadedmetadata')

    expect(audio.currentTime).toBe(0)
  })
})

describe('setSource', () => {
  it('loads a new url', () => {
    expect(setSource(asAudio(audio), '/api/audio/a.mp3')).toBe(true)
    expect(audio.src).toBe('/api/audio/a.mp3')
    expect(audio.loads).toBe(1)
  })

  it('leaves an unchanged url alone', () => {
    setSource(asAudio(audio), '/api/audio/a.mp3')

    // Reloading here would restart the track on every unrelated broadcast.
    expect(setSource(asAudio(audio), '/api/audio/a.mp3')).toBe(false)
    expect(audio.loads).toBe(1)
  })

  it('clears the source when the station goes off air', () => {
    setSource(asAudio(audio), '/api/audio/a.mp3')

    expect(setSource(asAudio(audio), null)).toBe(true)
    expect(audio.src).toBeNull()
    expect(audio.paused).toBe(true)
  })

  it('does nothing when already off air', () => {
    expect(setSource(asAudio(audio), null)).toBe(false)
    expect(audio.loads).toBe(0)
  })
})
