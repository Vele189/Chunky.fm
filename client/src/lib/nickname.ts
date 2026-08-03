/**
 * The listener's name for themselves.
 *
 * PLAN.md's identity story in full: a nickname, kept in localStorage, and
 * nothing else — no account, no server-side record, nothing to sign out of. So
 * this module is the whole of it: normalise what was typed, keep it, hand it
 * back on the next visit.
 *
 * Storage is injected rather than reached for directly, both because the unit
 * tests run without a DOM and because a browser can refuse it: Safari's private
 * mode throws on write, and a browser with cookies blocked throws on merely
 * *touching* `window.localStorage`. Every access here is guarded, and a refusal
 * costs the listener a retype rather than the page.
 */

export const NICKNAME_KEY = 'chunky.fm:nickname'

/**
 * Long enough for a real name, short enough to sit in a who's-listening list
 * without wrapping — presence is the next thing to be built on this.
 */
export const NICKNAME_MAX_LENGTH = 24

/** The part of `Storage` this needs. Fakes in tests, `localStorage` in a browser. */
export interface NicknameStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/**
 * `window.localStorage` when it can be had, and null when it can't. Reading the
 * property is itself what throws when storage is blocked, so the try wraps the
 * access rather than the call.
 */
function defaultStore(): NicknameStore | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/**
 * One line of printable text, trimmed and capped.
 *
 * Whitespace runs collapse and control characters go, so a name pasted out of a
 * chat window with a newline in it becomes the name rather than being refused.
 * The cap is applied last, after collapsing, and a trailing space left by the
 * cut is trimmed again — otherwise "a<20 spaces>b" would store as padding.
 */
export function normalizeNickname(raw: string): string {
  return raw
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NICKNAME_MAX_LENGTH)
    .trim()
}

/** Is this something we can join with? The join button asks exactly this. */
export function isValidNickname(raw: string): boolean {
  return normalizeNickname(raw).length > 0
}

/**
 * The stored nickname, or null if there isn't a usable one.
 *
 * What comes back out is normalised again rather than trusted: the value has
 * been sitting somewhere the listener can edit, and a stored empty string or a
 * line of control characters should read as "no nickname yet", not as a name.
 */
export function loadNickname(store: NicknameStore | null = defaultStore()): string | null {
  if (!store) return null
  let stored: string | null = null
  try {
    stored = store.getItem(NICKNAME_KEY)
  } catch {
    return null
  }
  if (stored === null) return null
  const nickname = normalizeNickname(stored)
  return nickname.length > 0 ? nickname : null
}

/**
 * Keeps the nickname for next time. Returns the normalised value that was
 * stored, or null if there was nothing worth storing.
 *
 * A failed write is not an error the listener needs to see — they are joining
 * either way, and the only consequence is typing the name again next visit — so
 * the return value reports what the *nickname* is, not whether the disk took it.
 */
export function saveNickname(
  raw: string,
  store: NicknameStore | null = defaultStore(),
): string | null {
  const nickname = normalizeNickname(raw)
  if (nickname.length === 0) return null
  try {
    store?.setItem(NICKNAME_KEY, nickname)
  } catch {
    // Private mode, or a full quota. The session still has the nickname.
  }
  return nickname
}

/** Forgets the nickname — the closest thing this station has to signing out. */
export function clearNickname(store: NicknameStore | null = defaultStore()): void {
  try {
    store?.removeItem(NICKNAME_KEY)
  } catch {
    // Nothing to do about it, and nothing depends on it having worked.
  }
}
