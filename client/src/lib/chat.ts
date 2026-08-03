import type { ChatMessage } from './protocol.js'

/**
 * The client's half of chat: what to keep, and what is worth sending.
 *
 * Mirrors `server/src/chat.ts` — keep the two in step. The cap here is the
 * composer's; the server enforces its own, and refuses rather than truncates.
 */

export const MESSAGE_MAX_LENGTH = 500

/**
 * How much of the conversation is kept in memory.
 *
 * The server only ever sends the tail, but a long session's worth of live
 * messages accumulates on top of it, and a listener who leaves a tab open for
 * an afternoon should not end up rendering thousands of rows.
 */
export const MAX_KEPT_MESSAGES = 200

/** One line, trimmed and capped — the same shape the server will store. */
export function normalizeMessageText(raw: string): string {
  const collapsed = raw
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return [...collapsed].slice(0, MESSAGE_MAX_LENGTH).join('').trim()
}

/** Is this worth sending? The send button asks exactly this. */
export function isSendableMessage(raw: string): boolean {
  return normalizeMessageText(raw).length > 0
}

/**
 * Folds a batch into what is already shown.
 *
 * Messages are identified by id and ordered by it, so this is idempotent: the
 * history a reconnect replays merges into what the listener was already looking
 * at without duplicating a line, and anything said during the outage lands in
 * its right place rather than at the end. That property is the whole reason the
 * server sends batches with ids instead of one-off appends.
 *
 * Returns the original array when nothing was new, so React can skip the render.
 */
export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const seen = new Set(current.map((message) => message.id))
  const fresh = incoming.filter((message) => !seen.has(message.id))
  if (fresh.length === 0) return current

  const merged = [...current, ...fresh].sort((a, b) => a.id - b.id)
  return merged.length > MAX_KEPT_MESSAGES ? merged.slice(-MAX_KEPT_MESSAGES) : merged
}

/** Wall-clock time of a message, for the listener reading it. */
export function formatTime(at: number, locale?: string): string {
  return new Date(at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
}
