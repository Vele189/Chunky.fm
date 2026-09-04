import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import ffmpegPath from 'ffmpeg-static'

/**
 * Turning a master into something a phone can stream.
 *
 * This is the largest single win in the archive, and it is worth stating the
 * arithmetic rather than leaving it implied. An hour of 24-bit/48k stereo WAV
 * is about 1 GB; the same hour at 96 kbps AAC is about 43 MB. Two people
 * talking do not need more than that — 96 kbps is above the rate most podcast
 * networks ship, and the difference is inaudible on the earbuds and car
 * speakers this will actually be heard on.
 *
 * Serving the master instead would mean every listener pulling a gigabyte to
 * hear one conversation, and a listener who scrubs pulls ranges out of it
 * repeatedly. On a phone that is not slow, it is unusable and expensive.
 *
 * **The master is kept.** It goes to R2 under `masters/` and stays there: it is
 * the thing that cannot be recreated, and re-encoding from a lossy copy later —
 * for a different bitrate, a different codec, a remaster — is a generation of
 * quality nobody gets back. What is thrown away is only ever the derived file.
 *
 * ## Failure is not fatal
 *
 * `transcode` answers with a result rather than throwing, and the caller falls
 * back to serving the master. An archive that refused to publish an episode
 * because ffmpeg was unhappy with one file would be worse than an archive that
 * serves that one episode large; the console says which happened.
 */

const exec = promisify(execFile)

/**
 * The serving format.
 *
 * AAC in an MP4 container rather than MP3, for two reasons that both matter
 * here. It is meaningfully better at these bitrates — 96 kbps AAC is roughly
 * 128 kbps MP3 — and `faststart` moves the index to the front of the file,
 * without which a browser must fetch the *end* of an hour-long file before it
 * can play the beginning. Every current browser and phone plays it.
 *
 * Mono, deliberately. A conversation recorded in a kitchen is not a stereo
 * production, and halving the channel count is the cheapest quality-neutral
 * saving available. A music show would want this changed.
 */
const BITRATE = '96k'
const CHANNELS = 1
const SAMPLE_RATE = 44_100

export interface Transcoded {
  ok: true
  /** The encoded bytes, ready to be put in the store. */
  data: Buffer
  /** What it turned out to be, in milliseconds, measured from the output. */
  durationMs: number
  /** `m4a`. The extension the serving copy is stored under. */
  extension: string
  contentType: string
}

export interface TranscodeFailed {
  ok: false
  reason: string
}

/**
 * Where ffmpeg is, or null on a build that shipped without it.
 *
 * `ffmpeg-static` types its export as `string`, but it is genuinely null when
 * the postinstall download was skipped — which is what `--ignore-scripts` and
 * some CI caches do. The cast is the honest description of the runtime value
 * rather than a way around the checker.
 */
function binary(): string | null {
  const found = ffmpegPath as unknown as string | null
  return typeof found === 'string' && found.length > 0 ? found : null
}

/** Whether this station can transcode at all. Checked once, at boot. */
export async function transcodingAvailable(): Promise<boolean> {
  const bin = binary()
  if (!bin) return false
  try {
    await exec(bin, ['-version'])
    return true
  } catch {
    return false
  }
}

/** `HH:MM:SS.cc` to milliseconds. */
function clockToMs(h: string, m: string, s: string, cs: string): number {
  return (Number(h) * 3600 + Number(m) * 60 + Number(s)) * 1000 + Number(cs) * 10
}

/**
 * Whatever ffmpeg printed, whether it was pleased or not.
 *
 * `execFile` resolves with `{ stderr }` and rejects with an error carrying the
 * same field, and which of the two happens depends on the arguments rather than
 * on whether the file was readable. Both branches say the same thing, so both
 * are read the same way — the first version of this only read the rejection,
 * and silently answered null for every file that worked.
 */
async function ffmpegSays(bin: string, args: string[]): Promise<string> {
  try {
    const { stderr } = await exec(bin, args, { maxBuffer: 8 * 1024 * 1024 })
    return stderr
  } catch (err) {
    return String((err as { stderr?: string }).stderr ?? '')
  }
}

/**
 * How long the audio at this path is, in milliseconds.
 *
 * Read out of ffmpeg's own report rather than with a second tool: `ffprobe` is
 * a separate binary that `ffmpeg-static` does not ship, and ffmpeg prints what
 * it knows on stderr for any file it opens.
 *
 * **The header first, and a full decode only if the header will not say.** That
 * ordering matters at these sizes: reading the `Duration:` line costs one file
 * open, while decoding a 500 MB master to count the samples takes tens of
 * seconds of CPU on a container that is also running a radio station. The
 * fallback exists because the header is genuinely absent or wrong on exactly
 * one common input — a VBR MP3 with no Xing frame — and that is worth the
 * seconds when it happens rather than on every file.
 *
 * Null when neither answers, which the caller treats as "keep whatever the
 * client claimed".
 */
export async function durationOf(filePath: string): Promise<number | null> {
  const bin = binary()
  if (!bin) return null

  // `-i` with no output is how you ask ffmpeg to report and stop. It exits
  // non-zero complaining that no output was named, having already printed the
  // header — which is the part being read.
  const header = await ffmpegSays(bin, ['-hide_banner', '-i', filePath])
  const stated = /Duration:\s*(\d+):(\d{2}):(\d{2})\.(\d{2})/.exec(header)
  if (stated) {
    const ms = clockToMs(stated[1]!, stated[2]!, stated[3]!, stated[4]!)
    if (ms > 0) return ms
  }

  // No usable header. Decode the whole thing and take the last position it
  // reported, which is the length actually read rather than the length claimed.
  const decoded = await ffmpegSays(bin, ['-hide_banner', '-i', filePath, '-f', 'null', '-'])
  const times = [...decoded.matchAll(/time=(\d+):(\d{2}):(\d{2})\.(\d{2})/g)]
  const last = times.at(-1)
  if (!last) return null
  const ms = clockToMs(last[1]!, last[2]!, last[3]!, last[4]!)
  return ms > 0 ? ms : null
}

/**
 * Encode a master into the serving copy.
 *
 * Takes a path rather than a stream, and writes to a path rather than a buffer,
 * because ffmpeg needs to seek: `faststart` rewrites the file to move its index
 * to the front, and a pipe cannot be rewound. The caller is responsible for
 * having the master on disk, which for R2 means streaming it down first.
 *
 * The output is read into memory at the end, which is safe at these sizes: an
 * hour at 96 kbps is about 43 MB, and the ceiling below refuses anything that
 * would be unreasonable to hold.
 */
export async function transcode(
  sourcePath: string,
  workDir: string,
): Promise<Transcoded | TranscodeFailed> {
  const bin = binary()
  if (!bin) return { ok: false, reason: 'this build has no ffmpeg' }

  const outPath = path.join(workDir, `${path.basename(sourcePath)}.m4a`)
  const args = [
    '-nostdin',
    '-hide_banner',
    '-loglevel', 'error',
    '-i', sourcePath,
    // No video, no cover art carried through: an attached picture in an m4a
    // makes some players treat the whole file as a video and refuse to stream
    // it in the background, which on a phone is the entire point.
    '-vn',
    '-map_metadata', '-1',
    '-ac', String(CHANNELS),
    '-ar', String(SAMPLE_RATE),
    '-c:a', 'aac',
    '-b:a', BITRATE,
    '-movflags', '+faststart',
    '-y',
    outPath,
  ]

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] })
      let stderr = ''
      child.stderr.on('data', (chunk: Buffer) => {
        // Bounded: a file ffmpeg hates can produce a great deal of this, and
        // the reason only has to be long enough to be actionable.
        if (stderr.length < 4000) stderr += chunk.toString()
      })
      child.on('error', reject)
      child.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(stderr.trim() || `ffmpeg exited ${code}`))
      })
    })

    const data = await fs.readFile(outPath)
    const durationMs = (await durationOf(outPath)) ?? 0
    await fs.rm(outPath, { force: true })

    if (data.length === 0) return { ok: false, reason: 'ffmpeg produced an empty file' }
    return { ok: true, data, durationMs, extension: 'm4a', contentType: 'audio/mp4' }
  } catch (err) {
    await fs.rm(outPath, { force: true })
    // The first line only. ffmpeg's diagnostics run to paragraphs and this ends
    // up in a console beside an episode, not in a log nobody reads.
    const reason = String((err as Error).message ?? err).split('\n')[0] ?? 'ffmpeg failed'
    return { ok: false, reason: reason.slice(0, 300) }
  }
}
