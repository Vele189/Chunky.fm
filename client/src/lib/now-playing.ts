import { artworkUrl, type Track } from './protocol.js'

/**
 * What the station says about itself on a lock screen.
 *
 * The page can afford to be a page: a wordmark in the corner, a badge under the
 * record, a title and an artist in the middle of the deck. A notification gets
 * three lines and an image, drawn by the phone rather than by us, and whoever
 * is looking at it has their phone in their hand and the screen off. So the
 * three lines have to answer three different questions: what is playing, who it
 * is by, and where it is coming from.
 *
 * The third line is the one a music player would spend on an album. This is not
 * a music player, and the album is on the page for anyone who wants it, so the
 * line names the station instead and says that it is live. That last word is
 * the whole reason this module exists: see `useMediaSession`, which stops the
 * phone from drawing a scrubber over a song nobody can seek in.
 *
 * Kept separate from the hook, and free of `MediaMetadata` and every other DOM
 * type, because what goes on those three lines is a decision worth testing and
 * the API that carries it is not.
 */

/** The station, as it introduces itself where the wordmark cannot go. */
export const STATION = 'chunky.fm'

/**
 * The word that stands where a song would carry its length.
 *
 * Uppercase to match the badge under the record, which is the same claim made
 * in the same word in the one other place the page makes it.
 */
export const LIVE = 'LIVE'

/**
 * The same phrase the deck uses for a track whose tags never said.
 *
 * Deliberately the string on screen rather than a nicer one invented here: a
 * listener who glances at the lock screen and then at the page should not have
 * to work out whether they are looking at the same song.
 */
export const UNKNOWN_ARTIST = 'Unknown artist'

/** One image, as the notification wants it. `MediaImage` without the DOM. */
export interface NowPlayingArt {
  src: string
  /**
   * The type the server will answer with, so the phone does not have to fetch
   * the bytes to find out whether it can draw them.
   */
  type: string
}

/** The three lines and the picture. */
export interface NowPlaying {
  title: string
  artist: string
  album: string
  /** Empty for a track that carried no artwork; never a stand-in image. */
  artwork: NowPlayingArt[]
}

/**
 * Mirrors the extensions `pickArtwork` stores in `server/src/lib/audio.ts`;
 * keep the two in step. An extension this does not know is left untyped rather
 * than guessed at, since a wrong `type` is worse than an absent one: it is a
 * phone declining to draw a picture it could have drawn.
 */
const ARTWORK_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
}

function artworkType(src: string): string | null {
  const extension = src.slice(src.lastIndexOf('.') + 1).toLowerCase()
  return ARTWORK_TYPES[extension] ?? null
}

/**
 * What the phone should say, or null when there is nothing on the decks.
 *
 * Null rather than a station-shaped placeholder, because with nothing playing
 * there is no notification to fill in: the phone shows one while a page is
 * making sound and takes it away when the sound stops, and a card advertising
 * an idle station would outlive the reason it was there.
 *
 * No `sizes` on the artwork. The station never learns how big the picture it
 * pulled out of a tag is, and a declared size that turns out to be wrong is how
 * a phone ends up picking the worst of several images. With one image and no
 * claim about it, there is nothing to pick wrongly.
 */
export function nowPlaying(track: Track | null): NowPlaying | null {
  if (!track) return null

  const src = artworkUrl(track)
  const type = src ? artworkType(src) : null

  return {
    title: track.title,
    artist: track.artist ?? UNKNOWN_ARTIST,
    album: `${STATION} · ${LIVE}`,
    artwork: src && type ? [{ src, type }] : [],
  }
}
