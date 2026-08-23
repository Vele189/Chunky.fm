/**
 * What a picture actually is, read off its first bytes.
 *
 * Two questions, and the same handful of bytes answers both: what format is
 * this, and how big is it. Neither can be taken from the request. A declared
 * `Content-Type` is a hint from whoever is uploading and a filename is worse,
 * so both are checked against the file rather than believed — and a poster is
 * required to be an exact size, which nothing outside the file itself can say.
 *
 * Hand-rolled rather than reached for from a library, and that is a deliberate
 * trade. `sharp` would answer both questions and it is 30 MB of platform
 * binaries in the server image to read twenty bytes; `image-size` is closer to
 * the mark and is still a dependency for a job that is three header layouts.
 * The formats here are the three a poster may be, and none of their headers has
 * changed since the 1990s.
 *
 * The `sniff` half was in `routes/schedule.ts`, which is the other thing in
 * this station that takes a poster; it is here now so both read the same bytes
 * the same way, and so a fourth format is added once.
 */

/**
 * The most a poster may weigh.
 *
 * A 1080x1350 JPEG is a few hundred kilobytes and the same thing as a PNG
 * exported from a design tool is a couple of megabytes, so this is that with a
 * lot of room rather than a number anybody should meet. Shared by the session
 * poster and the episode poster: they disagree about dimensions, deliberately
 * (see `routes/podcast.ts`), and there is no reason for them to disagree about
 * weight.
 */
export const POSTER_MAX_BYTES = 8 * 1024 * 1024

/** What a poster may be, and the extension it is stored under. */
export const POSTER_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/**
 * The format a file's first bytes say it is, or null for anything else.
 *
 * Twelve bytes is enough for all three, which is what lets the schedule route
 * peek at a stream and put the bytes back. See its use of `unshift`.
 */
export function sniff(head: Buffer): string | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpg'
  if (head.length >= 8 && head.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'png'
  if (
    head.length >= 12 &&
    head.subarray(0, 4).toString('ascii') === 'RIFF' &&
    head.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp'
  }
  return null
}

export interface Dimensions {
  width: number
  height: number
}

/**
 * A PNG says so in its first chunk, which is required to be IHDR.
 *
 * Eight bytes of signature, then a chunk: four of length, four of type, then
 * the data. Width and height are the first two fields of it, big-endian.
 */
function png(buffer: Buffer): Dimensions | null {
  if (buffer.length < 24) return null
  if (buffer.subarray(12, 16).toString('ascii') !== 'IHDR') return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

/**
 * The markers a JPEG's size can be written in.
 *
 * A "start of frame", and there are more of them than anybody expects: the
 * baseline one (C0), the progressive one (C2), and the arithmetic-coded and
 * hierarchical variants nobody uses but a phone camera occasionally emits.
 * C4, C8 and CC sit in the same range and are *not* frames — Huffman tables,
 * an extension, arithmetic tables — which is why this is a set rather than a
 * range check.
 */
const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

/**
 * A JPEG says so somewhere in the middle, so its segments have to be walked.
 *
 * Unlike the other two there is no fixed offset: the size lives in the frame
 * header, and an arbitrary amount of metadata (EXIF, a colour profile, a
 * thumbnail) can sit in front of it. Each segment carries its own length, so
 * walking is cheap — a handful of jumps rather than a scan.
 *
 * Height comes before width, which is the one thing about this header that
 * catches people out.
 */
function jpeg(buffer: Buffer): Dimensions | null {
  // Past the two-byte SOI.
  let offset = 2
  while (offset + 9 < buffer.length) {
    // Segments are introduced by 0xff. Padding of repeated 0xff is legal
    // between them, so this walks forward rather than giving up.
    if (buffer[offset] !== 0xff) {
      offset++
      continue
    }
    const marker = buffer[offset + 1]!
    if (marker === 0xff) {
      offset++
      continue
    }
    // Standalone markers: no length field, so there is nothing to skip past.
    // 0xd8 is SOI, 0x01 is TEM, and 0xd0-0xd7 are the restart markers.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    const length = buffer.readUInt16BE(offset + 2)
    if (SOF_MARKERS.has(marker)) {
      // Two of length, one of sample precision, then height and then width.
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) }
    }
    // A length under two would not advance, and a file claiming one is a file
    // designed to make this loop forever.
    if (length < 2) return null
    offset += 2 + length
  }
  return null
}

/**
 * WebP, which is three formats wearing one extension.
 *
 * The RIFF header names a chunk, and the chunk decides where the size is:
 * `VP8 ` is lossy, `VP8L` is lossless, `VP8X` is the extended form that a file
 * with animation, transparency or metadata uses. All three write the size
 * little-endian and two of them store it minus one, which is the sort of detail
 * that makes a poster come out a pixel short if it is missed.
 */
function webp(buffer: Buffer): Dimensions | null {
  if (buffer.length < 30) return null
  const chunk = buffer.subarray(12, 16).toString('ascii')

  if (chunk === 'VP8 ') {
    // Frame tag (3), then the start code 0x9d 0x01 0x2a, then the two sizes.
    // The top two bits of each are a scaling hint rather than part of the size.
    if (buffer.subarray(23, 26).toString('hex') !== '9d012a') return null
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    }
  }

  if (chunk === 'VP8L') {
    if (buffer[20] !== 0x2f) return null
    // Fourteen bits each, minus one, packed across four bytes.
    const bits = buffer.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }

  if (chunk === 'VP8X') {
    // Four bytes of flags, then the canvas size as two 24-bit values, minus one.
    return {
      width: (buffer[24]! | (buffer[25]! << 8) | (buffer[26]! << 16)) + 1,
      height: (buffer[27]! | (buffer[28]! << 8) | (buffer[29]! << 16)) + 1,
    }
  }

  return null
}

/**
 * How big a picture is, or null if these bytes do not say.
 *
 * Null rather than a throw, and it covers two different situations that the
 * caller treats the same way: a format this does not read, and a file that
 * claims a format and then does not have the header for it. Both mean "this is
 * not a poster I can vouch for", and a route that cannot confirm the size of
 * something required to be an exact size has to refuse it either way.
 */
export function dimensions(buffer: Buffer): Dimensions | null {
  const format = sniff(buffer)
  const read = format === 'png' ? png : format === 'jpg' ? jpeg : format === 'webp' ? webp : null
  const size = read?.(buffer) ?? null
  // A zero in either axis is a header that parsed and is still nonsense, and
  // it would otherwise reach the size check as a number and be refused there
  // with a message about the wrong thing.
  if (!size || size.width <= 0 || size.height <= 0) return null
  return size
}
