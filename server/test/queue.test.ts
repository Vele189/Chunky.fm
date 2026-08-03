import { beforeEach, describe, expect, it } from 'vitest'
import { type QueueEntry, TrackQueue } from '../src/queue.js'
import { makeTrack } from './helpers.js'

let queue: TrackQueue
let changes: QueueEntry[][]

const a = makeTrack({ id: 10, title: 'A' })
const b = makeTrack({ id: 11, title: 'B' })
const c = makeTrack({ id: 12, title: 'C' })

const titles = (entries: QueueEntry[]) => entries.map((entry) => entry.track.title)

beforeEach(() => {
  queue = new TrackQueue()
  changes = []
  queue.on('change', (entries) => changes.push(entries))
})

describe('TrackQueue', () => {
  it('starts empty', () => {
    expect(queue.list()).toEqual([])
    expect(queue.size).toBe(0)
    expect(queue.take()).toBeNull()
  })

  it('keeps insertion order', () => {
    for (const track of [a, b, c]) queue.add(track)

    expect(titles(queue.list())).toEqual(['A', 'B', 'C'])
  })

  it('gives every entry its own id, even for the same track twice', () => {
    const first = queue.add(a)
    const second = queue.add(a)

    expect(first.id).not.toBe(second.id)

    queue.remove(first.id)
    expect(queue.list()).toHaveLength(1)
    expect(queue.list()[0]!.id).toBe(second.id)
  })

  it('takes from the head', () => {
    for (const track of [a, b]) queue.add(track)

    expect(queue.take()?.track.title).toBe('A')
    expect(titles(queue.list())).toEqual(['B'])
  })

  it('hands out copies, so a caller cannot reorder it by accident', () => {
    queue.add(a)
    queue.add(b)

    queue.list().reverse()

    expect(titles(queue.list())).toEqual(['A', 'B'])
  })

  it('removes by entry id, not by position', () => {
    const entries = [a, b, c].map((track) => queue.add(track))

    expect(queue.remove(entries[1]!.id)?.track.title).toBe('B')
    expect(titles(queue.list())).toEqual(['A', 'C'])
    expect(queue.remove(entries[1]!.id)).toBeNull()
  })

  it('moves an entry to a new position', () => {
    const entries = [a, b, c].map((track) => queue.add(track))

    queue.move(entries[2]!.id, 0)
    expect(titles(queue.list())).toEqual(['C', 'A', 'B'])

    queue.move(entries[2]!.id, 1)
    expect(titles(queue.list())).toEqual(['A', 'C', 'B'])
  })

  it('clamps a move past either end instead of dropping the entry', () => {
    const entries = [a, b, c].map((track) => queue.add(track))

    queue.move(entries[0]!.id, 99)
    expect(titles(queue.list())).toEqual(['B', 'C', 'A'])

    queue.move(entries[0]!.id, -5)
    expect(titles(queue.list())).toEqual(['A', 'B', 'C'])
  })

  it('reports an unknown entry rather than guessing', () => {
    queue.add(a)

    expect(queue.move(999, 0)).toBeNull()
    expect(queue.remove(999)).toBeNull()
    expect(titles(queue.list())).toEqual(['A'])
  })

  it('empties on clear', () => {
    queue.add(a)
    queue.clear()

    expect(queue.list()).toEqual([])
    expect(queue.size).toBe(0)
  })
})

describe('TrackQueue change events', () => {
  it('emits the new queue on every mutation', () => {
    const entry = queue.add(a)
    queue.add(b)
    queue.move(entry.id, 1)
    queue.remove(entry.id)
    queue.take()
    queue.clear() // already empty — not a change

    expect(changes.map(titles)).toEqual([['A'], ['A', 'B'], ['B', 'A'], ['B'], []])
  })

  it('stays quiet when nothing changed', () => {
    queue.take() // empty
    queue.clear() // empty
    queue.remove(1) // unknown
    queue.move(1, 0) // unknown

    expect(changes).toHaveLength(0)
  })
})
