import { useCallback, useEffect, useRef, useState } from 'react'
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

/**
 * What to say about a code that was typed in and did not work.
 *
 * Only ever about a *hand-typed* try. A link that fails is the page's problem
 * to explain, and it explains it with the refused screen; this is the sentence
 * that goes under an input somebody just pressed enter on, so it has to be
 * about what they did rather than about the station in general.
 */
export function codeRefusal(status: number): string {
  if (status === 401) return 'That is not the code for this station.'
  if (status === 429) return 'Too many tries. Wait a minute and try again.'
  return 'The station did not answer. Try again in a moment.'
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

/** The doorway's whole state: where this browser stands, and how to knock. */
export interface StationAccess {
  access: Access
  /**
   * Try a code somebody typed at the door.
   *
   * The same key the `?k=` on a link carries and the same endpoint that
   * redeems it — a code said over the phone and a code pasted into an address
   * bar are the same secret, and giving them two paths through the gate would
   * be two chances to get one of them wrong.
   */
  submit(code: string): Promise<void>
  /** What the station said about the last hand-typed try. Null before any. */
  error: string | null
  /** A try is in flight. The form disables itself rather than queueing them. */
  submitting: boolean
}

/**
 * Whether this browser is allowed to hear the station at all.
 *
 * Asked once, before anything opens a socket. A page that connected first would
 * spend its life reconnecting into a refusal, and the listener would be told
 * the station had gone away when in fact it is there and simply not theirs.
 *
 * On an open station — one opened deliberately with `STATION_OPEN` — every
 * answer here is `admitted`, so this costs one request and changes nothing
 * else. Otherwise a browser with no cookie and no invite is `refused`, and the
 * doorway offers it somewhere to type the code.
 */
export function useStationAccess(): StationAccess {
  const [access, setAccess] = useState<Access>('checking')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

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

  const submit = useCallback(async (code: string) => {
    const key = code.trim()
    if (key.length === 0) return
    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch('/api/listen', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key }),
      })
      if (response.ok) {
        // The cookie is set; this browser is in. Nothing to strip from the
        // address bar — the code was typed, so it was never in the URL, which
        // is the one thing a typed code has over a link.
        setAccess('admitted')
        return
      }
      setError(codeRefusal(response.status))
    } catch {
      // Nothing answered. Not a wrong code, and it must not be reported as one:
      // somebody retyping a code that was right all along because the server
      // was restarting is the worst version of this screen.
      setError(codeRefusal(0))
    } finally {
      setSubmitting(false)
    }
  }, [])

  return { access, submit, error, submitting }
}
