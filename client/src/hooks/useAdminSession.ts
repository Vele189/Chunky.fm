import { useCallback, useEffect, useMemo, useState } from 'react'
import { AdminApi, refusalMessage } from '../lib/admin.js'

export type AdminStatus = 'signed-out' | 'checking' | 'signed-in'

export interface AdminSession {
  status: AdminStatus
  /** Null until the station has accepted the session; nothing to call before. */
  api: AdminApi | null
  error: string | null
  signIn(password: string): Promise<boolean>
  signOut(): void
}

export interface AdminSessionOptions {
  createApi?: () => AdminApi
}

/**
 * Module scope on purpose. As a default argument this would be a new function
 * every render, and the effect below, which depends on it, would re-check the
 * session on every render it caused. That is a request per render, for as long
 * as the panel is open.
 */
const defaultCreateApi = (): AdminApi => new AdminApi()

/**
 * Whether this browser is signed in, according to the station.
 *
 * There is nothing to remember here, and deliberately so: the session is an
 * HttpOnly cookie, which page script cannot read and does not need to: the
 * browser attaches it, and the only way to know whether it is still good is to
 * ask. So a reload asks once, and the answer decides between the form and the
 * controls. The password itself is never held after sign-in, which is the whole
 * point of exchanging it.
 */
export function useAdminSession({
  createApi = defaultCreateApi,
}: AdminSessionOptions = {}): AdminSession {
  const [status, setStatus] = useState<AdminStatus>('checking')
  const [error, setError] = useState<string | null>(null)

  const api = useMemo(() => createApi(), [createApi])

  // Asked once on mount, and the panel shows neither form nor controls until it
  // answers: a cookie left over from a station that has since restarted with a
  // different password is not a signed-in admin.
  useEffect(() => {
    let cancelled = false
    setStatus('checking')
    void api
      .verify()
      .then((ok) => {
        if (!cancelled) setStatus(ok ? 'signed-in' : 'signed-out')
      })
      .catch(() => {
        if (cancelled) return
        // The station being unreachable is not the same as being signed out,
        // but there is nothing to show except the form until it answers.
        setStatus('signed-out')
        setError('could not reach the station')
      })
    return () => {
      cancelled = true
    }
  }, [api])

  const signIn = useCallback(
    async (candidate: string): Promise<boolean> => {
      setStatus('checking')
      setError(null)
      try {
        const accepted = await api.signIn(candidate)
        setStatus(accepted ? 'signed-in' : 'signed-out')
        // Names which of the two it wanted. The station has a door code as well
        // now, and they are different secrets for different things, and somebody
        // who was let in to listen and then typed that same code here is the
        // ordinary way to arrive at this message, not an unlikely one.
        if (!accepted) setError('wrong admin password: this is not the station door code')
        return accepted
      } catch (err) {
        setStatus('signed-out')
        // A refusal the station wrote is worth repeating. Sign-in is throttled,
        // and "could not reach the station" is the wrong thing to tell someone
        // who reached it and was told to wait. It sends them looking for a
        // network problem that isn't there. 4xx messages are written to be
        // shown; anything else is ours to summarise.
        setError(refusalMessage(err) ?? 'could not reach the station')
        return false
      }
    },
    [api],
  )

  // The controls go away immediately, but the form only comes back once the
  // station has actually dropped the cookie; otherwise "signed out" would mean
  // nothing more than "this tab stopped showing buttons", and a reload a second
  // later would walk straight back in.
  const signOut = useCallback(() => {
    setStatus('checking')
    setError(null)
    void api.signOut().then(() => setStatus('signed-out'))
  }, [api])

  return { status, api: status === 'signed-in' ? api : null, error, signIn, signOut }
}
