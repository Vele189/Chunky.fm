import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import ffmpegPath from 'ffmpeg-static'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { durationOf, remux, transcodingAvailable } from '../src/lib/transcode.js'
import { HEAD_BYTES, head, looksLikeVideoUpload, streamable } from '../src/lib/video.js'

/**
 * The remux, on real video.
 *
 * This is the piece the archive's start time rests on, and it is not something
 * a unit test can fake: either ffmpeg moves the index to the front of a real
 * MP4 without touching the streams or it does not. So this makes two files that
 * differ in exactly one way — where the `moov` box is — and checks that the
 * check can tell them apart, that the remux turns the first into the second,
 * and that nothing was re-encoded on the way.
 *
 * A short clip rather than a long one, because none of the three claims is a
 * claim about length: the work is proportional to the file, and asserting on
 * two seconds costs a second of CI instead of a minute.
 */

const exec = promisify(execFile)
const bin = ffmpegPath as unknown as string

const SECONDS = 2

let workDir = ''
/** The ordinary export: `mdat` first, index at the end. Needs the remux. */
let latePath = ''

beforeAll(async () => {
  if (!(await transcodingAvailable())) return
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chunky-remux-'))
  latePath = path.join(workDir, 'master.mp4')
  await exec(bin, [
    '-f', 'lavfi',
    '-i', `testsrc=size=160x90:rate=10:duration=${SECONDS}`,
    '-f', 'lavfi',
    '-i', `sine=frequency=440:duration=${SECONDS}`,
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-shortest',
    '-y', latePath,
  ])
})

afterAll(async () => {
  if (workDir) await fs.rm(workDir, { recursive: true, force: true })
})

/** The first boxes of a file on disk, as `streamable` would be handed them. */
async function headOf(filePath: string): Promise<Buffer> {
  const handle = await fs.open(filePath)
  try {
    const buffer = Buffer.alloc(HEAD_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

describe('what a browser can start', () => {
  it('knows video by its type, and by its extension when the type is useless', () => {
    expect(looksLikeVideoUpload('talk.mp4', 'video/mp4')).toBe(true)
    expect(looksLikeVideoUpload('talk.mov', 'video/quicktime')).toBe(true)
    // What a drag out of a file manager sends, which is why the extension is
    // consulted at all.
    expect(looksLikeVideoUpload('talk.mkv', 'application/octet-stream')).toBe(true)
    expect(looksLikeVideoUpload('talk.webm', '')).toBe(true)

    expect(looksLikeVideoUpload('talk.mp3', 'audio/mpeg')).toBe(false)
    expect(looksLikeVideoUpload('notes.txt', 'text/plain')).toBe(false)
    expect(looksLikeVideoUpload('', '')).toBe(false)
  })

  it('reads a webm as ready without walking any boxes', () => {
    // EBML's magic, and then nothing that means anything. The point is that a
    // Matroska file is answered from its first four bytes rather than being
    // walked as if it were an MP4.
    expect(streamable(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00, 0x00, 0x00]))).toBe(true)
  })

  it('says no to anything it cannot read, which is the safe way round', () => {
    expect(streamable(Buffer.alloc(0))).toBe(false)
    expect(streamable(Buffer.alloc(64, 9))).toBe(false)
    // A box claiming to be shorter than a box can be: a file this cannot walk,
    // which is routed through ffmpeg rather than assumed to be fine.
    const nonsense = Buffer.alloc(16)
    nonsense.writeUInt32BE(2, 0)
    nonsense.write('ftyp', 4, 'latin1')
    expect(streamable(nonsense)).toBe(false)
  })

  it('takes only as much of a stream as it needs and lets go of the rest', async () => {
    const { Readable } = await import('node:stream')
    let pulled = 0
    const long = Readable.from(
      (function* () {
        for (let i = 0; i < 1000; i++) {
          pulled += 1
          yield Buffer.alloc(1024, 7)
        }
      })(),
    )

    const first = await head(long, 4096)
    expect(first).toHaveLength(4096)
    // Four chunks, not a thousand: on R2 this is the difference between a
    // handful of kilobytes and an episode.
    expect(pulled).toBeLessThan(10)
    expect(long.destroyed).toBe(true)
  })
})

describe.skipIf(!(await transcodingAvailable()))('moving the index to the front', () => {
  it('can tell a file that needs it from one that does not', async () => {
    expect(streamable(await headOf(latePath))).toBe(false)

    const result = await remux(latePath, workDir)
    expect(result.ok, result.ok ? '' : result.reason).toBe(true)
    if (!result.ok) return

    expect(streamable(await headOf(result.path))).toBe(true)
  })

  it('copies the streams rather than encoding them', async () => {
    const master = await fs.stat(latePath)
    const result = await remux(latePath, workDir)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // The same video, rewritten: within a few per cent of the size it was, not
    // a fraction of it. A re-encode would show up here as a much smaller file,
    // which is exactly the thing this is not allowed to be doing.
    expect(result.bytes).toBeGreaterThan(master.size * 0.9)

    // ffmpeg's own reading of the output: still H.264, still with its audio.
    const { stderr } = await exec(bin, ['-i', result.path, '-f', 'null', '-']).catch(
      (err: { stderr: string }) => err,
    )
    expect(stderr).toMatch(/Video: h264/)
    expect(stderr).toMatch(/Audio: aac/)

    // Within a quarter second of the source. A file that came out the right
    // size and the wrong length is the failure that reaches somebody as an
    // episode that stops halfway.
    expect(Math.abs(result.durationMs - SECONDS * 1000)).toBeLessThan(250)

    expect(result.extension).toBe('mp4')
    expect(result.contentType).toBe('video/mp4')
  })

  it('reads the length of a file it did not make', async () => {
    // The path used when there is nothing to remux — an episode whose master
    // arrived ready, or a station with no ffmpeg at all.
    const ms = await durationOf(latePath)
    expect(ms).not.toBeNull()
    expect(Math.abs((ms as number) - SECONDS * 1000)).toBeLessThan(250)
  })

  it('answers with a reason rather than throwing, for a file that is not video', async () => {
    // The property the publisher depends on: an episode ffmpeg refuses is still
    // an episode, served from its master. A throw here would take the whole
    // background job down instead.
    const junk = path.join(workDir, 'not-video.bin')
    await fs.writeFile(junk, Buffer.alloc(4096, 9))

    const result = await remux(junk, workDir)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason.length).toBeGreaterThan(0)
    // Bounded: this ends up in a console beside an episode, not in a log.
    expect(result.reason.length).toBeLessThanOrEqual(300)
  })
})
