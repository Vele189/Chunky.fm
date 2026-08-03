import path from 'node:path'
import { parseFile, type IAudioMetadata, type IPicture } from 'music-metadata'

/**
 * Containers we are willing to serve, mapped to the extension we store them
 * under. The container reported by music-metadata is the authority — the
 * client's filename and Content-Type are both trivially forged.
 */
const CONTAINER_EXTENSIONS: Record<string, string> = {
  MPEG: 'mp3',
  FLAC: 'flac',
  Ogg: 'ogg',
  WAVE: 'wav',
  'MPEG-4': 'm4a',
  AIFF: 'aiff',
  'AIFF-C': 'aiff',
}

const PICTURE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/**
 * Cheap pre-flight so we can reject obvious junk before writing it to disk.
 * Deliberately loose: browsers disagree about audio MIME types, so a file that
 * passes here still has to survive the real parse.
 */
const ACCEPTED_UPLOAD_EXTENSIONS = new Set([
  '.mp3',
  '.flac',
  '.ogg',
  '.oga',
  '.opus',
  '.wav',
  '.wave',
  '.m4a',
  '.m4b',
  '.mp4',
  '.aac',
  '.aif',
  '.aiff',
  '.aifc',
])

export function looksLikeAudioUpload(filename: string, mimetype: string): boolean {
  if (mimetype.startsWith('audio/')) return true
  // Firefox sends application/octet-stream for some drag-and-drop sources.
  return ACCEPTED_UPLOAD_EXTENSIONS.has(path.extname(filename).toLowerCase())
}

export interface ExtractedMetadata {
  title: string
  artist: string | null
  album: string | null
  durationMs: number
  /** Storage extension, without the leading dot. */
  extension: string
  artwork: { data: Uint8Array; extension: string } | null
}

export class UnsupportedAudioError extends Error {}

function cleanTag(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function pickArtwork(pictures: IPicture[] | undefined): ExtractedMetadata['artwork'] {
  const picture = pictures?.find((p) => PICTURE_EXTENSIONS[p.format.toLowerCase()])
  if (!picture) return null
  return { data: picture.data, extension: PICTURE_EXTENSIONS[picture.format.toLowerCase()]! }
}

function fromMetadata(metadata: IAudioMetadata, originalFilename: string): ExtractedMetadata {
  const { format, common } = metadata

  const extension = format.container ? CONTAINER_EXTENSIONS[format.container] : undefined
  if (!extension) {
    throw new UnsupportedAudioError(
      `unsupported audio container: ${format.container ?? 'unknown'}`,
    )
  }
  // Ogg is a container, not a codec — keep Opus distinguishable for the client.
  const storageExtension =
    extension === 'ogg' && format.codec?.toLowerCase().includes('opus') ? 'opus' : extension

  if (!format.duration || !Number.isFinite(format.duration) || format.duration <= 0) {
    throw new UnsupportedAudioError('could not determine track duration')
  }

  const fallbackTitle = path.basename(originalFilename, path.extname(originalFilename)).trim()

  return {
    title: cleanTag(common.title) ?? (fallbackTitle || 'Untitled'),
    artist: cleanTag(common.artist),
    album: cleanTag(common.album),
    durationMs: Math.round(format.duration * 1000),
    extension: storageExtension,
    artwork: pickArtwork(common.picture),
  }
}

/**
 * Reads tags and embedded artwork off a file already on disk.
 * Throws {@link UnsupportedAudioError} for anything we can't serve — including
 * files that aren't audio at all, which is what makes this the real gatekeeper.
 */
export async function extractMetadata(
  filePath: string,
  originalFilename: string,
): Promise<ExtractedMetadata> {
  let metadata: IAudioMetadata
  try {
    metadata = await parseFile(filePath, { duration: true })
  } catch (err) {
    // The underlying message embeds the server-side temp path — keep it in the
    // cause for the log, not in what we hand back to the client.
    throw new UnsupportedAudioError('file could not be read as audio', { cause: err })
  }
  return fromMetadata(metadata, originalFilename)
}
