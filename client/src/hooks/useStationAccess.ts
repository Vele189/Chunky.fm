import { useEffect, useRef, useState } from 'react'
import { inviteFrom, withoutInvite } from '../lib/invite.js'

/** How long to wait before asking a station that did not answer at all. */
const RETRY_MS = 3_000

/**
 * What one answer means.
 *
 * `401` is the gate speaking, and the only status that means refused. Anything
 * else in the 4xx/5xx range is not the gate at all: with the station down, the
 * thing in front of it answers — Vite's dev proxy with a 500, nginx with a 502 —
 * and reading either as "you are not invited" would tell a listener their link
 * was bad every time the station restarted under them.
 */
export function readAnswer(status: number, ok: boolean): Access {
  if (ok) return 'admitted'
  return status === 401 ? 'refused' : 'unreachable'
}

export type Access =
  /** Asked, not yet answered. Nothing is rendered on this. */
  | 'checking'
  /** This browser may hear the station. */
  | 'admitted'
  /** Private station, and this browser has no invite for it. */
  | 'refused'
  /** The station did not answer at all — which is not the same as being shut out. */
  | 'unreachable'

/**
 * Whether this browser is allowed to hear the station at all.
 *
 * Asked once, before anything opens a socket. A page that connected first would
 * spend its life reconnecting into a refusal, and the listener would be told
 * the station had gone away when in fact it is there and simply not theirs.
 *
 * On an open station — no `STATION_KEY` set — every answer here is `admitted`,
 * so this costs one request and changes nothing else.
 */
export function useStationAccess(): Access {
  const [access, setAccess] = useState<Access>('checking')

  /**
   * The key, read during the first render and kept.
   *
   * It cannot be read inside the effect: the effect is what takes it back out
   * of the address bar, and React runs effects twice in development. The second
   * pass would find a bar that the first had already cleaned, conclude there
   * was never an invite, and ask as a stranger — which is a browser holding a
   * perfectly good cookie being told the station is private. Reading it before
   * anything can strip it makes both passes see the same link.
   */
  const invite = useRef<string | null | undefined>(undefined)
  if (invite.current === undefined) {
    invite.current = typeof window === 'undefined' ? null : inviteFrom(window.location.search)
  }

  useEffect(() => {
    let cancelled = false
    let retry: number | undefined
    const settle = (next: Access) => {
      if (!cancelled) setAccess(next)
    }

    /**
     * Out of the address bar — but only once the station has answered. A secret
     * left in the URL ends up in the history, in a screenshot, in `Referer` and
     * in whatever "share this tab" does; a secret removed before the request
     * that spends it is a listener who cannot retry by reloading.
     */
    const stripInvite = () => {
      const cleaned = withoutInvite(window.location.href)
      if (cleaned !== null) window.history.replaceState(null, '', cleaned)
    }

    const ask = async () => {
      const key = invite.current
      try {
        if (key !== null && key !== undefined) {
          const redeemed = await fetch('/api/listen', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ key }),
          })
          // Only once the station has actually answered: a 502 from whatever is
          // in front of a stopped server is not a spent key, and the listener
          // has to be able to retry by reloading.
          const answer = readAnswer(redeemed.status, redeemed.ok)
          if (answer !== 'unreachable') stripInvite()
          settle(answer)
          if (answer === 'unreachable' && !cancelled) {
            retry = window.setTimeout(() => void ask(), RETRY_MS)
          }
          return
        }

        // No key in the link: this browser either already holds an invite from
        // last time, or the station is open, or it is not for them.
        const asked = await fetch('/api/listen')
        const answer = readAnswer(asked.status, asked.ok)
        settle(answer)
        if (answer === 'unreachable' && !cancelled) {
          retry = window.setTimeout(() => void ask(), RETRY_MS)
        }
      } catch {
        // Nothing answered. Being unable to reach the station is not being shut
        // out of it, and telling somebody their link is bad when the server is
        // simply down would send them asking for a new one that works exactly
        // as badly. So this does not decide anything — it asks again, and the
        // page carries on to the station's own offline screen in the meantime.
        settle('unreachable')
        if (!cancelled) retry = window.setTimeout(() => void ask(), RETRY_MS)
      }
    }

    void ask()

    return () => {
      cancelled = true
      if (retry !== undefined) window.clearTimeout(retry)
    }
  }, [])

  return access
}
