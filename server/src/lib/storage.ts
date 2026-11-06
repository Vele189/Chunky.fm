import fs from 'node:fs/promises'
import path from 'node:path'
import type { Config } from '../config.js'

export async function ensureStorageDirs(config: Config): Promise<void> {
  await Promise.all(
    [
      config.audioDir,
      config.artworkDir,
      config.posterDir,
      config.episodeVideoDir,
      config.episodePosterDir,
      config.tmpDir,
    ].map((dir) => fs.mkdir(dir, { recursive: true })),
  )
}

export function trackFilePath(config: Config, filename: string): string {
  return path.join(config.audioDir, path.basename(filename))
}

export function artworkFilePath(config: Config, artworkPath: string): string {
  return path.join(config.artworkDir, path.basename(artworkPath))
}

export function posterFilePath(config: Config, poster: string): string {
  return path.join(config.posterDir, path.basename(poster))
}

/**
 * An episode's audio, in the archive.
 *
 * `path.basename` for the reason the three above use it, and it matters more
 * here than for a track: a track's filename is a content hash this server
 * chose, while an episode is reached by a slug somebody typed into a form. The
 * name on disk is still server-chosen (see `routes/podcast.ts`), and this is
 * the second lock on that rather than the first.
 */
export function episodeAudioFilePath(config: Config, filename: string): string {
  return path.join(config.episodeVideoDir, path.basename(filename))
}

/** An episode's poster. See `episodeAudioFilePath`. */
export function episodePosterFilePath(config: Config, poster: string): string {
  return path.join(config.episodePosterDir, path.basename(poster))
}

/** Unlink without caring whether the file was ever created. */
export async function discard(filePath: string): Promise<void> {
  await fs.rm(filePath, { force: true })
}
