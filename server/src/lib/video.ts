import path from 'node:path'
import type { Readable } from 'node:stream'

/**
 * What an episode is made of, and whether a browser can start playing it
 * before it has all of it.
 *
 * The archive used to be audio, and the two questions it asked of an upload
 * were "is this audio?" and "how small can ffmpeg make it?". Neither survives
 * the move to video. The first is a different list of containers. The second is
 * a different trade entirely: an hour of talk re-encodes from a gigabyte of WAV
 * to forty megabytes and everybody wins, where an hour of video re-encodes over
 * hours of CPU on a box that is also running a live radio station, for a saving
 * that whoever exported the file has usually already taken.
 *
 * So nothing here re-encodes. What is left is the one thing an export can get
 * wrong that the browser cannot work around: **where the index is**. An MP4
 * carries its table of contents in a `moov` box, and a file with `moov` at the
 * end cannot be played until it has been fetched to the end. On an hour of
 * video that is the difference between pressing play and waiting for a
 * gigabyte. `-movflags +faststart` moves it to the front, and it is a copy
 * rather than an encode: seconds, and not one frame is touched.
 *
 * Which makes the interesting question "does this file need that doing to it?",
 * and the answer is in the first few hundred bytes. See `streamable`.
 */

/**
 * Containers a browser will play, mapped to what we store them under.
 *
 * Short on purpose. This is not a list of everything ffmpeg can open — it is
 * the list of things `<video>` plays across the browsers people arrive with,
 * and everything else is something the uploader should export again rather than
 * something this station should quietly re-encode at three in the morning.
 */
const ACCEPTED_UPLOAD_EXTENSIONS = new Set([
  '.mp4',
  '.m4v',
  '.mov',
  '.webm',
  // Not playable in a browser, and accepted anyway: a Matroska file is almost
  // always H.264 or VP9 in the wrong wrapper, which is exactly what the remux
  // below fixes. If the streams inside are something a browser cannot decode,
  // ffmpeg will say so and the console will show what it said.
  '.mkv',
])

/**
 * Cheap pre-flight, before an upload is begun.
 *
 * Deliberately loose, the same way the library's audio check is: browsers
 * disagree about video MIME types (`video/quicktime`, `video/x-matroska`,
 * `application/octet-stream` from a drag out of a file manager), so a file that
 * passes here still has to survive being looked at properly.
 */
export function looksLikeVideoUpload(filename: string, mimetype: string): boolean {
  if (mimetype.startsWith('video/')) return true
  return ACCEPTED_UPLOAD_EXTENSIONS.has(path.extname(filename).toLowerCase())
}

/**
 * How much of a file it takes to answer the question below.
 *
 * 64 KB. An MP4's `ftyp` is under a hundred bytes and whatever follows it
 * announces its own type in the first eight, so the answer is usually settled
 * inside the first sixteen bytes; the rest is room for the `free` and `skip`
 * boxes some tools leave lying about between them.
 */
export const HEAD_BYTES = 64 * 1024

/** The four bytes every Matroska and WebM file begins with. */
const EBML_MAGIC = Buffer.from([0x1a, 0x45, 0xdf, 0xa3])

/**
 * Can a browser start this file without fetching the end of it?
 *
 * Answered from the head of the file, because it is the only part worth
 * fetching to find out: on R2 the alternative is pulling a gigabyte back
 * through this server to learn something the first sixteen bytes already say.
 *
 * MP4 and MOV are a flat sequence of boxes, each `[4 bytes of length][4 bytes
 * of type]`, so this walks them until it finds the one that settles it:
 *
 *   `moov` first  the index is at the front. Plays immediately. Leave it alone.
 *   `mdat` first  the index is behind an hour of video. Needs the remux.
 *
 * WebM and Matroska are taken at their word. Their cues can be at either end
 * too, but a browser handles a webm without them by estimating, which is a
 * slightly imprecise scrub rather than a file that will not start — and remuxing
 * one into MP4 would be a container change rather than the reordering this is.
 *
 * Anything this cannot read — a wrapper we do not know, a file that is not what
 * it claimed — comes back false, which routes it through ffmpeg. That is the
 * safe direction to be wrong in: the cost of remuxing a file that did not need
 * it is some seconds and some bandwidth, and the cost of *not* remuxing one
 * that did is an episode nobody can play.
 */
export function streamable(head: Buffer): boolean {
  if (head.length >= 4 && head.subarray(0, 4).equals(EBML_MAGIC)) return true

  let at = 0
  // Eight bytes is the smallest a box can be: its own length and its type.
  while (at + 8 <= head.length) {
    const size = head.readUInt32BE(at)
    const type = head.toString('latin1', at + 4, at + 8)

    if (type === 'moov') return true
    if (type === 'mdat') return false

    /*
     * A box that says it is zero long is one that runs to the end of the file,
     * and a box that says it is one is a 64-bit length in the eight bytes after
     * the type. Neither can be walked past usefully here — the first has nothing
     * after it, and the second is only ever `mdat`, which is caught above. Both
     * mean this file has not answered, so it takes the remux.
     */
    if (size < 8) return false
    at += size
  }

  return false
}

/**
 * The first `bytes` of a stream, and then let go of it.
 *
 * Written here rather than in `lib/store.ts` because it exists for the question
 * above and is only ever asked in service of it. The stream is destroyed as
 * soon as enough has arrived, which on R2 aborts the transfer: this is how the
 * check costs a request and a handful of kilobytes rather than an episode.
 *
 * A file shorter than `bytes` simply comes back shorter. `streamable` reads
 * what it was given and answers false if that was not enough, which is the safe
 * direction — see the note there.
 */
export async function head(stream: Readable, bytes: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let held = 0

  try {
    for await (const chunk of stream) {
      const buffer = chunk as Buffer
      chunks.push(buffer)
      held += buffer.length
      if (held >= bytes) break
    }
  } finally {
    stream.destroy()
  }

  return Buffer.concat(chunks).subarray(0, bytes)
}
