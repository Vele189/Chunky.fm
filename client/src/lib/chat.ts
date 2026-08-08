import type { ChatMessage, SocketErrorCode } from './protocol.js'

/**
 * The client's half of chat: what to keep, and what is worth sending.
 *
 * Mirrors `server/src/chat.ts`; keep the two in step. The cap here is the
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

/** One line, trimmed and capped: the same shape the server will store. */
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

/**
 * What to tell a listener whose message the room would not take.
 *
 * Keyed on the code rather than shown as the server's own words: `message` is
 * written for whoever is holding the API wrong, and "slow down" on its own next
 * to an empty composer does not say the thing that actually matters: that what
 * they typed was not sent.
 *
 * Null for anything that is not about a message they tried to send. A refusal
 * for a malformed frame is a bug in this client, not news for the person using
 * it, and putting it on screen would be blaming them for it.
 */
export function chatRefusal(code: SocketErrorCode): string | null {
  switch (code) {
    case 'slow_down':
      return 'Not sent. You are saying things faster than the room will take them.'
    case 'not_joined':
      return 'Not sent. The station has not finished putting you in the room yet.'
    case 'no_chat':
      return 'Not sent. This station has no chat.'
    case 'message_too_long':
      return 'Not sent. That message is too long.'
    case 'empty_message':
      return 'Not sent. There was nothing in that message.'
    case 'off_air':
      return 'Not sent. The station is not on air.'
    case 'muted':
      // Told rather than swallowed. A message that vanished quietly would read
      // exactly like one that was sent, and somebody would spend the evening
      // talking to a room that cannot hear them.
      return 'Not sent. Whoever runs the decks has muted you.'
    default:
      return null
  }
}

/**
 * What the composer should hold after a refusal.
 *
 * A refused message is not a sent message, so the text goes back rather than
 * being lost. The composer is cleared optimistically the moment something is
 * sent, and without this a message the server declined simply vanishes, which
 * on screen is indistinguishable from having said it.
 *
 * Never over the top of something newer: whatever the listener has started
 * typing since is the one thing here that cannot be recovered from anywhere.
 */
export function draftAfterRefusal(current: string, unanswered: string | null): string {
  if (unanswered === null) return current
  return current === '' ? unanswered : current
}
