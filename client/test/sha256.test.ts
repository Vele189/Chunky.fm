import { describe, expect, it } from 'vitest'
import { sha256Of } from '../src/lib/episodes.js'

/**
 * The incremental SHA-256, against the platform's own.
 *
 * `lib/episodes.ts` carries a hand-written SHA-256 because `crypto.subtle` is
 * one-shot and the alternative is holding a gigabyte in memory to hash it. That
 * is exactly the kind of code that is either right or quietly, catastrophically
 * wrong, so every case here compares it against `crypto.subtle.digest` over the
 * same bytes rather than against a value typed in by hand.
 *
 * The sizes are chosen to land on and around the places a block-based hash goes
 * wrong: an exact multiple of the 64-byte block, one either side of it, and one
 * either side of the 56-byte mark where the length padding no longer fits in
 * the final block and a second one has to be emitted.
 */

/** What the platform says, for the same bytes. */
async function reference(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Deterministic filler, so a failure is reproducible. */
function bytesOf(length: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(length))
  for (let i = 0; i < length; i++) out[i] = (i * 31 + 7) & 0xff
  return out
}

/** A File over those bytes, which is what the uploader is handed. */
function fileOf(bytes: Uint8Array<ArrayBuffer>): File {
  return new File([bytes], 'master.wav', { type: 'audio/wav' })
}

describe('sha256Of', () => {
  it('matches the platform on the small path', async () => {
    // Under `partSize * 4`, where it defers to `crypto.subtle` wholesale.
    const bytes = bytesOf(1000)
    expect(await sha256Of(fileOf(bytes), 4096)).toBe(await reference(bytes))
  })

  it('matches the platform on the incremental path', async () => {
    // Over the threshold, so the hand-written implementation is what runs. This
    // is the assertion the whole class exists to earn.
    const bytes = bytesOf(200_000)
    expect(await sha256Of(fileOf(bytes), 4096)).toBe(await reference(bytes))
  })

  it('matches at every awkward length', async () => {
    // Around the 64-byte block and the 56-byte padding boundary, plus a couple
    // of exact multiples of the slice size — the four places this goes wrong.
    const partSize = 64
    for (const length of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 128, 256, 257, 1023, 1024]) {
      const bytes = bytesOf(length)
      expect(await sha256Of(fileOf(bytes), partSize), `length ${length}`).toBe(
        await reference(bytes),
      )
    }
  })

  it('does not care where the slice boundaries fall', async () => {
    // The same bytes hashed in different-sized slices must agree, or the hash
    // an episode is keyed on would depend on the part size — and changing
    // PART_SIZE would silently make every existing episode a duplicate of
    // nothing.
    const bytes = bytesOf(50_000)
    const expected = await reference(bytes)
    for (const partSize of [64, 100, 512, 4096, 7777]) {
      expect(await sha256Of(fileOf(bytes), partSize), `slices of ${partSize}`).toBe(expected)
    }
  })

  it('walks the file once, in slices', async () => {
    const bytes = bytesOf(10_000)
    let slices = 0
    await sha256Of(fileOf(bytes), 1000, () => slices++)
    expect(slices).toBe(10)
  })
})
