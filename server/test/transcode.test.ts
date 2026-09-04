import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import ffmpegPath from 'ffmpeg-static'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { durationOf, transcode, transcodingAvailable } from '../src/lib/transcode.js'

/**
 * The encode, on real audio.
 *
 * This is the piece the whole size story rests on, and it is not something a
 * unit test can fake: either ffmpeg produces a small, playable, correctly-timed
 * file from a large one or it does not. So this makes a real WAV, encodes it,
 * and checks the three things that matter — that it got much smaller, that it
 * is the length it should be, and that what came out is actually AAC in an MP4
 * rather than a renamed copy of the input.
 */

const exec = promisify(execFile)
const bin = ffmpegPath as unknown as string

/** Seconds of tone. Long enough that the size ratio means something. */
const SECONDS = 30

let workDir = ''
let wavPath = ''
let available = false

beforeAll(async () => {
  available = await transcodingAvailable()
  if (!available) return
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chunky-encode-'))
  wavPath = path.join(workDir, 'master.wav')
  // 24-bit/48k stereo, which is what a podcast master actually is and is the
  // thing that makes an hour 500 MB.
  await exec(bin, [
    '-f', 'lavfi',
    '-i', `sine=frequency=220:duration=${SECONDS}:sample_rate=48000`,
    '-ac', '2',
    '-c:a', 'pcm_s24le',
    '-y', wavPath,
  ])
})

afterAll(async () => {
  if (workDir) await fs.rm(workDir, { recursive: true, force: true })
})

describe.skipIf(!(await transcodingAvailable()))('encoding a master', () => {
  it('is the whole reason this exists: much smaller, and still an hour', async () => {
    const master = await fs.stat(wavPath)
    const result = await transcode(wavPath, workDir)

    expect(result.ok, result.ok ? '' : result.reason).toBe(true)
    if (!result.ok) return

    // 24-bit/48k stereo is 288 kB per second; 96 kbps mono is 12. The ratio in
    // practice is around 20x, and asserting "at least 10x" leaves room for
    // ffmpeg's own choices without letting a regression through that silently
    // stopped compressing.
    expect(result.data.length).toBeLessThan(master.size / 10)

    // Within a second of the source. A file that encoded to the right size and
    // the wrong length is the failure that would otherwise reach a listener as
    // an episode that stops halfway.
    expect(Math.abs(result.durationMs - SECONDS * 1000)).toBeLessThan(1000)

    expect(result.extension).toBe('m4a')
    expect(result.contentType).toBe('audio/mp4')
  })

  it('produces something a browser will actually play', async () => {
    const result = await transcode(wavPath, workDir)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const outPath = path.join(workDir, 'check.m4a')
    await fs.writeFile(outPath, result.data)

    // ffmpeg's own reading of the file: an MP4 container holding AAC. A
    // renamed WAV, or a file truncated by a botched buffer read, fails here.
    const { stderr } = await exec(bin, ['-i', outPath, '-f', 'null', '-']).catch(
      (err: { stderr: string }) => err,
    )
    expect(stderr).toMatch(/Audio: aac/)
    expect(stderr).toMatch(/mov,mp4|Input #0, mov/)

    // `faststart`: the index has to be at the *front*, or a browser must fetch
    // the end of an hour-long file before it can play the beginning. `moov`
    // appearing early in the bytes is what that looks like on disk.
    const head = result.data.subarray(0, 2048).toString('latin1')
    expect(head).toContain('moov')
  })

  it('reads the length of a file it did not make', async () => {
    // The path used when there is no encode to measure — a station serving the
    // master because ffmpeg refused it, or because it has none.
    const ms = await durationOf(wavPath)
    expect(ms).not.toBeNull()
    expect(Math.abs((ms as number) - SECONDS * 1000)).toBeLessThan(1000)
  })

  it('answers with a reason rather than throwing, for a file that is not audio', async () => {
    // The property the publisher depends on: an episode whose encode fails is
    // still an episode, served from its master. A throw here would take the
    // whole background job down instead.
    const junk = path.join(workDir, 'not-audio.bin')
    await fs.writeFile(junk, Buffer.alloc(4096, 9))

    const result = await transcode(junk, workDir)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason.length).toBeGreaterThan(0)
    // Bounded: this ends up in a console beside an episode, not in a log.
    expect(result.reason.length).toBeLessThanOrEqual(300)
  })
})
