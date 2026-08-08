/**
 * What the station says on a lock screen.
 *
 * Three lines and a picture, decided here rather than by the browser, because
 * the browser's own answer for a media element is a song and a scrubber and
 * this is a radio station. The hook that hands these to the OS is a handful of
 * assignments to `navigator.mediaSession`; the decisions are all in here.
 */
import { describe, expect, it } from 'vitest'
import { LIVE, nowPlaying, STATION, UNKNOWN_ARTIST } from '../src/lib/now-playing.js'
import type { Track } from '../src/lib/protocol.js'

function track(overrides: Partial<Track> = {}): Track {
  return {
    id: 1,
    title: 'Wish You Were Here',
    artist: 'Pink Floyd',
    album: 'Wish You Were Here',
    durationMs: 334_000,
    filename: 'abc123.mp3',
    artworkPath: 'abc123.jpg',
    contentHash: 'abc123',
    gainDb: 0,
    uploadedAt: 0,
    ...overrides,
  }
}

describe('nowPlaying', () => {
  it('answers the three questions a lock screen has room for', () => {
    expect(nowPlaying(track())).toEqual({
      title: 'Wish You Were Here',
      artist: 'Pink Floyd',
      album: `${STATION} · ${LIVE}`,
      artwork: [{ src: '/api/artwork/abc123.jpg', type: 'image/jpeg' }],
    })
  })

  it('names the station and says live on the line an album would have had', () => {
    const sheet = nowPlaying(track())
    expect(sheet?.album).toContain(STATION)
    expect(sheet?.album).toContain(LIVE)
  })

  it('says the same thing about an untagged artist that the deck does', () => {
    expect(nowPlaying(track({ artist: null }))?.artist).toBe(UNKNOWN_ARTIST)
  })

  it('carries no artwork rather than a stand-in for a track that has none', () => {
    expect(nowPlaying(track({ artworkPath: null }))?.artwork).toEqual([])
  })

  it('types the picture from what the server stored it as', () => {
    const type = (path: string) => nowPlaying(track({ artworkPath: path }))?.artwork[0]?.type
    expect(type('a.jpg')).toBe('image/jpeg')
    expect(type('a.png')).toBe('image/png')
    expect(type('a.webp')).toBe('image/webp')
    expect(type('a.gif')).toBe('image/gif')
  })

  it('drops a picture it cannot type rather than guessing at one', () => {
    // A wrong `type` is worse than an absent picture: it is a phone declining
    // to draw something it could have drawn.
    expect(nowPlaying(track({ artworkPath: 'a.tiff' }))?.artwork).toEqual([])
  })

  it('is nothing at all with nothing on the decks', () => {
    // Not a station-shaped placeholder: with no sound there is no notification
    // to fill in, and a card advertising an idle station would outlive it.
    expect(nowPlaying(null)).toBeNull()
  })
})
