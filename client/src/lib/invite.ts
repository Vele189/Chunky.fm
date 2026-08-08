/**
 * The invite in the link.
 *
 * A private station hands out `https://…/listen?k=<key>`. The browser presents that
 * key once, gets a signed cookie back, and the key comes straight out of the
 * address bar, because a secret that stays in the URL is a secret in every
 * screenshot, every "share this tab", every `Referer` header and every entry in
 * the browser's own history.
 *
 * Pure, so what the address bar is doing is testable without one.
 */

import { STATION_PATH } from './routes.js'

/** The query parameter an invite link carries. */
export const INVITE_PARAM = 'k'

/** The key in a link, or null if it carries none. */
export function inviteFrom(search: string): string | null {
  const key = new URLSearchParams(search).get(INVITE_PARAM)
  if (key === null) return null
  const trimmed = key.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * The same address with the invite taken out of it.
 *
 * Everything else is left exactly as it was (other query parameters, the
 * fragment, the path) because this runs on whatever address the listener
 * actually arrived on, and quietly dropping the rest of it would break a
 * `#chat` link or anything else somebody was sent.
 *
 * Returns null when there was nothing to strip, so a caller can tell "already
 * clean" from "cleaned" without comparing strings.
 */
export function withoutInvite(href: string): string | null {
  // A base for the relative case; a URL that is already absolute ignores it.
  const url = new URL(href, 'http://station.invalid')
  if (!url.searchParams.has(INVITE_PARAM)) return null

  url.searchParams.delete(INVITE_PARAM)
  // `?` with nothing after it is what URLSearchParams leaves behind, and it
  // would sit in the address bar looking like a truncated link.
  const query = url.searchParams.toString()
  return `${url.pathname}${query ? `?${query}` : ''}${url.hash}`
}

/**
 * The link to hand out.
 *
 * Built in the browser rather than by the station, because the station does not
 * reliably know what address it is being reached on (behind nginx, behind
 * Railway, on a LAN IP) and the console's own address bar does.
 *
 * It points at the station rather than at the origin, because the origin is the
 * page in front of the station now; see `STATION_PATH`. Links already handed
 * out that say `/?k=<key>` are not broken by that: nginx sends a request for `/`
 * carrying a key on to the station, key and all. But what is handed out from
 * here on should be the address it will end up at anyway.
 *
 * A null key is an open station: the bare address is already a working invite,
 * and appending an empty `?k=` would only make it look like a broken one.
 */
export function inviteLink(origin: string, key: string | null): string {
  const base = `${origin.replace(/\/+$/, '')}${STATION_PATH}`
  return key === null ? base : `${base}?${INVITE_PARAM}=${encodeURIComponent(key)}`
}
