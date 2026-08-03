import type { StateMessage } from './protocol.js'

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * Where the needle should be, in seconds, given the server's tuple and the
 * current server time.
 *
 * `startedAt` is a point in the past, so this is the same calculation whether
 * you joined at 0:00 or 2:14 — there is no mid-song special case.
 */
export function expectedPositionSeconds(state: StateMessage, serverNow: number): number {
  if (!state.track) return 0
  const positionMs = state.pausedAt ?? serverNow - state.startedAt
  return clamp(positionMs, 0, state.track.durationMs) / 1000
}

export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(whole / 60)
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`
}
