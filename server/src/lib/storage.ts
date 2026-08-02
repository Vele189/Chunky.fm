import fs from 'node:fs/promises'
import path from 'node:path'
import type { Config } from '../config.js'

export async function ensureStorageDirs(config: Config): Promise<void> {
  await Promise.all(
    [config.audioDir, config.artworkDir, config.tmpDir].map((dir) =>
      fs.mkdir(dir, { recursive: true }),
    ),
  )
}

export function trackFilePath(config: Config, filename: string): string {
  return path.join(config.audioDir, path.basename(filename))
}

export function artworkFilePath(config: Config, artworkPath: string): string {
  return path.join(config.artworkDir, path.basename(artworkPath))
}

/** Unlink without caring whether the file was ever created. */
export async function discard(filePath: string): Promise<void> {
  await fs.rm(filePath, { force: true })
}
