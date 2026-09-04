import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import ffmpegPath from 'ffmpeg-static'

/**
 * Making a master streamable, without touching a frame of it.
 *
 * This was an encoder. The archive was audio, and an hour of 24-bit WAV at a
 * gigabyte went to forty megabytes of AAC with nothing audible lost: the
 * largest single win the archive had, and worth minutes of CPU every time.
 *
 * Video does not offer that trade. An hour of it re-encodes over *hours* on the
 * single small container that is also running a live radio station — the one
 * thing this project cannot spend — and the saving is one whoever exported the
 * file has usually already taken. So nothing here re-encodes. `-c copy` moves
 * the streams across untouched, which is why this is fast enough to do on
 * upload and lossless enough that the result is not a second generation of
 * anything.
 *
 * What it is for is the index. An MP4 keeps its table of contents in a `moov`
 * box, and a great many tools write that box *after* the video data: such a
 * file cannot be played at all until it has been fetched to its end, which on
 * an hour of video is a listener staring at a spinner while a gigabyte comes
 * down a phone connection. `+faststart` rewrites the file with the index at the
 * front. That is the whole job.
 *
 * Most files do not need it. `lib/video.ts` answers that from the first
 * sixty-four kilobytes, and this only runs on the ones that do.
 *
 * ## Failure is not fatal
 *
 * `remux` answers with a result rather than throwing, and the caller falls back
 * to serving the master as it arrived. An archive that refused to publish an
 * episode because ffmpeg was unhappy with one file would be worse than an
 * archive that serves that one episode with a slow start; the console says
 * which happened.
 */

const exec = promisify(execFile)

/**
 * The serving container.
 *
 * MP4 out, whatever went in. It is the one container every browser and every
 * phone plays, and a `.mov` or a `.mkv` holding H.264 becomes one by being
 * rewrapped rather than re-encoded — the streams are already what an MP4 wants,
 * they are merely in the wrong box.
 *
 * The streams are taken one each, and the audio only if there is one. `-map 0`
 * would carry across whatever else the file happened to hold — timecode tracks,
 * chapter data, the data streams a phone camera writes — and MP4 refuses some
 * of them, which fails the whole remux over something nobody was going to
 * watch.
 */
const STREAMS = ['-map', '0:v:0', '-map', '0:a:0?']

export interface Remuxed {
  ok: true
  /**
   * Where the rewritten file is, on disk.
   *
   * A path rather than the bytes, which is the one change the move to video
   * forces on every caller of this. The audio encoder handed back a Buffer
   * because forty megabytes is nothing; a remuxed hour of video is the same
   * size as the master it came from, and holding a gigabyte of it in memory on
   * a container this small is how a station gets killed by its own archive.
   *
   * It lives in the `workDir` it was given and is the caller's to clean up,
   * which the caller was already doing for the master it downloaded.
   */
  path: string
  bytes: number
  /** What it turned out to be, in milliseconds, measured from the output. */
  durationMs: number
  /** `mp4`. The extension the serving copy is stored under. */
  extension: string
  contentType: string
}

export interface RemuxFailed {
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
 * How long the file at this path runs, in milliseconds.
 *
 * Read out of ffmpeg's own report rather than with a second tool: `ffprobe` is
 * a separate binary that `ffmpeg-static` does not ship, and ffmpeg prints what
 * it knows on stderr for any file it opens.
 *
 * **The header first, and a full decode only if the header will not say.** That
 * ordering matters at these sizes: reading the `Duration:` line costs one file
 * open, while decoding a 500 MB master to count the samples takes tens of
 * seconds of CPU on a container that is also running a radio station, and on
 * video it is minutes. The fallback exists because the header is genuinely
 * absent or wrong on a file whose recording was interrupted — a screen capture
 * that was killed rather than stopped is the common one — and that is worth the
 * wait when it happens rather than on every file.
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
 * Rewrite a master with its index at the front.
 *
 * Takes a path and writes a path, because both ends of this are too big to hold
 * and because ffmpeg needs to seek: `+faststart` works by writing the file and
 * then rewriting it with the index moved, and a pipe cannot be rewound. The
 * caller is responsible for having the master on disk, which for R2 means
 * streaming it down first.
 *
 * The output is left where it was written and handed back as a path. Nothing is
 * read into memory here — see `Remuxed.path`.
 */
export async function remux(
  sourcePath: string,
  workDir: string,
): Promise<Remuxed | RemuxFailed> {
  const bin = binary()
  if (!bin) return { ok: false, reason: 'this build has no ffmpeg' }

  const outPath = path.join(workDir, `${path.basename(sourcePath)}.mp4`)
  const args = [
    '-nostdin',
    '-hide_banner',
    '-loglevel', 'error',
    '-i', sourcePath,
    ...STREAMS,
    // The whole point, and the whole of the work: copy the streams, put the
    // index at the front.
    '-c', 'copy',
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

    const { size } = await fs.stat(outPath)
    if (size === 0) {
      await fs.rm(outPath, { force: true })
      return { ok: false, reason: 'ffmpeg produced an empty file' }
    }

    const durationMs = (await durationOf(outPath)) ?? 0
    return { ok: true, path: outPath, bytes: size, durationMs, extension: 'mp4', contentType: 'video/mp4' }
  } catch (err) {
    await fs.rm(outPath, { force: true })
    // The first line only. ffmpeg's diagnostics run to paragraphs and this ends
    // up in a console beside an episode, not in a log nobody reads.
    const reason = String((err as Error).message ?? err).split('\n')[0] ?? 'ffmpeg failed'
    return { ok: false, reason: reason.slice(0, 300) }
  }
}
