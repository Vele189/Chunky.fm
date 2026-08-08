/**
 * Two independent listeners join at different times and must compute the same
 * playback position. This is the thing PLAN.md says decides whether the project
 * feels magic or broken.
 */
import type { AddressInfo } from 'node:net'
import { WebSocket } from 'ws'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { openDb } from '../src/db.js'

// Opened on purpose: an unset STATION_KEY now means the house key, and this
// script's listeners join anonymously. The door has its own tests; this one is
// about whether two strangers hear the same instant.
const config = loadConfig({
  ADMIN_PASSWORD: 'x',
  STATION_OPEN: 'true',
  AUDIO_STORAGE_DIR: '/tmp/claude-1000/sync-check',
})
const app = await buildApp({ config, db: openDb(':memory:'), logger: false })
await app.listen({ host: '127.0.0.1', port: 0 })
const { port } = app.server.address() as AddressInfo
const url = `ws://127.0.0.1:${port}/ws`

const track = {
  id: 1,
  title: 'Smoke Test Tone',
  artist: 'Nobody',
  album: null,
  durationMs: 240_000,
  filename: 'x.mp3',
  artworkPath: null,
  contentHash: 'x',
  gainDb: 0,
  uploadedAt: Date.now(),
}

interface Listener {
  name: string
  offset: number
  startedAt: number
  pausedAt: number | null
  title: string | null
}

async function join(name: string): Promise<Listener> {
  const socket = new WebSocket(url)
  const listener: Listener = { name, offset: 0, startedAt: 0, pausedAt: null, title: null }

  // Attached before 'open' — a state frame can land the instant we connect.
  const pending: ((t1: number) => void)[] = []
  let gotState: (() => void) | null = null
  const firstState = new Promise<void>((resolve) => {
    gotState = resolve
  })

  socket.on('message', (raw) => {
    const msg = JSON.parse(raw.toString())
    if (msg.type === 'state') {
      listener.startedAt = msg.startedAt
      listener.pausedAt = msg.pausedAt
      listener.title = msg.track?.title ?? null
      gotState?.()
    } else if (msg.type === 'pong') {
      pending.shift()?.(msg.t1)
    }
  })

  await new Promise<void>((resolve) => socket.once('open', () => resolve()))
  await firstState

  // NTP-style handshake: 5 probes, keep the lowest-RTT sample.
  let bestRtt = Number.POSITIVE_INFINITY
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now()
    const t1 = await new Promise<number>((resolve) => {
      pending.push(resolve)
      socket.send(JSON.stringify({ type: 'ping', t0 }))
    })
    const rtt = Date.now() - t0
    if (rtt < bestRtt) {
      bestRtt = rtt
      listener.offset = t1 - (t0 + rtt / 2)
    }
  }

  console.log(`${name}: offset ${listener.offset}ms (best rtt ${bestRtt}ms)`)
  return listener
}

const position = (l: Listener) => l.pausedAt ?? Date.now() + l.offset - l.startedAt

const a = await join('A (joins before the track)')
app.playback.play(track)
await new Promise((r) => setTimeout(r, 1500))

const b = await join('B (joins 1.5s into the track)')

const posA = position(a)
const posB = position(b)
console.log(`\nA hears "${a.title}" at ${posA}ms`)
console.log(`B hears "${b.title}" at ${posB}ms`)
console.log(`startedAt agrees: ${a.startedAt === b.startedAt}`)
console.log(`drift: ${Math.abs(posA - posB)}ms`)

app.playback.pause()
await new Promise((r) => setTimeout(r, 200))
console.log(`\nafter pause  — A ${position(a)}ms, B ${position(b)}ms`)

app.playback.seek(90_000)
app.playback.resume()
await new Promise((r) => setTimeout(r, 200))
console.log(`after seek   — A ${position(a)}ms, B ${position(b)}ms`)

const drift = Math.abs(posA - posB)
const ok = drift < 50 && a.startedAt === b.startedAt
console.log(ok ? '\nPASS — listeners are locked together' : `\nFAIL — drift ${drift}ms`)

await app.close()
process.exit(ok ? 0 : 1)
