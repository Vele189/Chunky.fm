/**
 * The top bar's search field.
 *
 * It is not a library search — there is no library on this page to search. What
 * it does is narrow the two lists that are already in front of the listener:
 * what is coming up, and what has been on. A box that promised more than that
 * and swallowed what was typed would be worse than no box at all.
 */

/** Whitespace-trimmed, case-folded, and empty when there is nothing to match. */
export function normalizeFilter(filter: string): string {
  return filter.trim().toLowerCase()
}

/**
 * Whether a row survives the filter.
 *
 * An empty filter matches everything, so a listener who has not typed anything
 * sees the whole list rather than none of it. Fields are matched separately
 * rather than joined, because joining them would let "chase eloise" match a
 * title and an artist that were never next to each other.
 */
export function matchesFilter(filter: string, ...fields: (string | null | undefined)[]): boolean {
  const needle = normalizeFilter(filter)
  if (needle.length === 0) return true
  return fields.some((field) => (field ?? '').toLowerCase().includes(needle))
}
