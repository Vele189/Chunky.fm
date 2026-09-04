import { activeLineIndex } from './lyrics.js'

/**
 * What was said, and when it was said.
 *
 * The archive keeps a transcript as the text that was uploaded and nothing
 * more — see the `transcript` column, and the note there about why the server
 * does not chew it first. This file is the other half: it turns that text into
 * something the player can draw, and it answers the one question the page asks
 * four times a second while an episode plays — which line is being spoken now?
 *
 * The shape it reads is what a transcription tool actually writes:
 *
 *     Untitled - August 23, 2026
 *
 *     00:00:00 Speaker 1: All right, there we go.
 *
 *     00:04:31 Speaker 2: So for anyone who is listening but isn't familiar…
 *
 * It is deliberately forgiving around that, because "the transcript format" is
 * not a standard and the next tool will write it slightly differently: the hour
 * is optional (`04:31`), the timestamp may be bracketed the way an LRC line is
 * (`[00:04:31]`), a fraction of a second is allowed and ignored, the speaker is
 * optional, and a line with no timestamp on it at all is treated as more of
 * whatever was being said above it rather than thrown away.
 *
 * A transcript with no timestamps anywhere is not a failure either. It parses
 * to nothing, and the player reads that as "words to read rather than words to
 * follow" and lays it out as paragraphs — the same fallback the station's lyric
 * sheet makes when all it has is an untimed sheet. See `Transcript.tsx`.
 */

/** One thing somebody said, with the moment they started saying it. */
export interface TranscriptCue {
  /** Milliseconds into the episode. */
  timeMs: number
  /** Who was speaking, when the line says so. Null when it does not. */
  speaker: string | null
  text: string
}

/**
 * `[hh:]mm:ss`, optionally bracketed, optionally with a fraction.
 *
 * Three digits of hours because it costs nothing, and the fraction is captured
 * and then ignored: an episode is an hour of talk and nothing in this player
 * can act on a hundredth of a second, but a timestamp that carries one must
 * still be read rather than refused.
 */
const AT = /^(\[)?(?:(\d{1,3}):)?(\d{1,2}):(\d{2})(?:[.,]\d{1,3})?\]?/

/**
 * `Speaker 2:`, and the guard against a colon in the middle of a sentence.
 *
 * The problem this solves: "So here is the thing: it was fine." would otherwise
 * be a line spoken by somebody called "So here is the thing". The rule is that
 * a speaker's name is short, is a handful of words, and does not carry sentence
 * punctuation — which is true of `Speaker 3`, of `Thabo`, and of `Dr. Naledi M`,
 * and false of nearly every clause that happens to end in a colon.
 *
 * It cannot be perfect and does not need to be. The cost of a false positive is
 * a stray label above one paragraph; the cost of not doing this is a page of
 * conversation with the first clause of every sentence set as a name.
 */
const SPEAKER = /^([^:\n]{1,32}):\s/
/* A comma, a question, a full stop at the end, or one in the middle followed by
   a new sentence. A full stop followed by a capital is left alone on purpose:
   that is `Dr. Naledi`, not two sentences. */
const SENTENCE = /[,?!;]|\.\s+[a-z]|\.$/

/** Whether the text before a colon reads like somebody's name. */
function looksLikeSpeaker(candidate: string): boolean {
  if (SENTENCE.test(candidate)) return false
  return candidate.trim().split(/\s+/).length <= 4
}

/**
 * A transcript into cues, in time order.
 *
 * Lines that open with a timestamp start a cue. Lines that do not are appended
 * to the cue above them, joined with a space, which is what makes a transcript
 * whose paragraphs are hard-wrapped read as paragraphs rather than as a column
 * of fragments — and lines *before* the first timestamp (the title line every
 * one of these files opens with) are dropped, the way `parseLrc` drops an
 * `[ar:…]` header, because they belong to no moment and could only ever be
 * shown at the wrong one.
 *
 * Sorted at the end rather than trusted, and `sort` is stable, so a file that
 * is already in order — every real one — comes back exactly as it was written.
 */
export function parseTranscript(text: string): TranscriptCue[] {
  const cues: TranscriptCue[] = []

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '') continue

    const at = AT.exec(line)
    if (!at) {
      // More of what was being said above. Before the first cue this is the
      // file's own title line, which belongs to nobody.
      const last = cues[cues.length - 1]
      if (last) last.text = last.text === '' ? line : `${last.text} ${line}`
      continue
    }

    let rest = line.slice(at[0].length)
    // A bare `12:30` has to be followed by something that separates it from the
    // words, or it is a time somebody was talking *about* rather than the time
    // at which they said it. A bracketed one has already separated itself.
    if (at[1] === undefined && rest !== '' && !/^[\s–—-]/.test(rest)) {
      const last = cues[cues.length - 1]
      if (last) last.text = last.text === '' ? line : `${last.text} ${line}`
      continue
    }
    rest = rest.replace(/^[\s–—-]+/, '')

    const hours = at[2] === undefined ? 0 : Number(at[2])
    const timeMs = (hours * 3600 + Number(at[3]) * 60 + Number(at[4])) * 1000

    let speaker: string | null = null
    const named = SPEAKER.exec(rest)
    if (named && looksLikeSpeaker(named[1] as string)) {
      speaker = (named[1] as string).trim()
      rest = rest.slice(named[0].length)
    }

    cues.push({ timeMs, speaker, text: rest.trim() })
  }

  return cues.sort((a, b) => a.timeMs - b.timeMs)
}

/**
 * Which cue is being spoken: the last one whose moment has arrived, or -1
 * before the first.
 *
 * The station's own function, unchanged and deliberately not copied. A lyric
 * line and a spoken line are the same problem — a list in time order and a
 * playhead — and the answer the station gives for a song is the answer this
 * page wants for a conversation. See `lib/lyrics.ts`.
 */
export function activeCueIndex(cues: TranscriptCue[], positionMs: number): number {
  return activeLineIndex(cues, positionMs)
}

/**
 * The transcript of one episode, or null when there is none.
 *
 * A 404 is the archive's considered answer rather than an error — most episodes
 * have no transcript, and an episode that does not is not broken — so it comes
 * back as null. Network trouble is null too: the player draws no transcript
 * rather than a broken panel, and the reader can press the tab again.
 *
 * A plain function rather than a method on `EpisodeApi`, for the reason
 * `fetchLyrics` is one: this is asked for by the component that draws it, deep
 * inside the player, and threading the API object down to it in order to make
 * one open GET would be ceremony around a fetch.
 */
export async function fetchTranscript(
  slug: string,
  fetchFn: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const response = await fetchFn(`/api/episodes/${encodeURIComponent(slug)}/transcript`, {
      credentials: 'same-origin',
    })
    if (!response.ok) return null
    const body = (await response.json()) as { transcript?: unknown }
    return typeof body.transcript === 'string' ? body.transcript : null
  } catch {
    return null
  }
}
