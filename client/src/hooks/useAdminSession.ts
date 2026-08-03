import { useCallback, useEffect, useMemo, useState } from 'react'
import { AdminApi } from '../lib/admin.js'

export type AdminStatus = 'signed-out' | 'checking' | 'signed-in'

export interface AdminSession {
  status: AdminStatus
  /** Null until the password has been accepted — nothing to call before that. */
  api: AdminApi | null
  error: string | null
  signIn(password: string): Promise<boolean>
  signOut(): void
}

export interface AdminSessionOptions {
  storage?: Storage | null
  createApi?: (password: string) => AdminApi
}

/**
 * sessionStorage, not localStorage: the admin password is a shared secret, and
 * a station left running on a laptop shouldn't leave it on disk for whoever
 * opens the browser next. It survives a reload, which is what a long session
 * actually needs.
 */
export const ADMIN_STORAGE_KEY = 'chunky.admin'

function defaultStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    // Storage can throw outright when cookies are blocked.
    return null
  }
}

/**
 * Module scope on purpose. As a default argument this would be a new function
 * every render, and the effect below — which depends on it — would re-verify
 * the password on every render it caused. That is a request per render, for as
 * long as the panel is open.
 */
const defaultCreateApi = (password: string): AdminApi => new AdminApi(password)

/** Holds the admin's credentials, and re-checks them against the server. */
export function useAdminSession({
  storage = defaultStorage(),
  createApi = defaultCreateApi,
}: AdminSessionOptions = {}): AdminSession {
  const [password, setPassword] = useState<string | null>(null)
  const [status, setStatus] = useState<AdminStatus>('signed-out')
  const [error, setError] = useState<string | null>(null)

  const api = useMemo(
    () => (password === null ? null : createApi(password)),
    [password, createApi],
  )

  // A remembered password is not a signed-in admin: the server may have
  // restarted with a different one, so it is re-checked before any control is
  // shown. Until it answers, the page shows neither the form nor the controls.
  useEffect(() => {
    const remembered = storage?.getItem(ADMIN_STORAGE_KEY)
    if (!remembered) return

    let cancelled = false
    setStatus('checking')
    void createApi(remembered)
      .verify()
      .then((ok) => {
        if (cancelled) return
        if (!ok) {
          storage?.removeItem(ADMIN_STORAGE_KEY)
          setStatus('signed-out')
          return
        }
        setPassword(remembered)
        setStatus('signed-in')
      })
      .catch(() => {
        if (cancelled) return
        // The server is unreachable, not the password wrong — keep it stored so
        // a reconnect doesn't cost the admin their credentials.
        setStatus('signed-out')
        setError('could not reach the station')
      })
    return () => {
      cancelled = true
    }
  }, [storage, createApi])

  const signIn = useCallback(
    async (candidate: string): Promise<boolean> => {
      setStatus('checking')
      setError(null)
      try {
        const accepted = await createApi(candidate).verify()
        if (!accepted) {
          setStatus('signed-out')
          setError('wrong password')
          return false
        }
        storage?.setItem(ADMIN_STORAGE_KEY, candidate)
        setPassword(candidate)
        setStatus('signed-in')
        return true
      } catch {
        setStatus('signed-out')
        setError('could not reach the station')
        return false
      }
    },
    [storage, createApi],
  )

  const signOut = useCallback(() => {
    storage?.removeItem(ADMIN_STORAGE_KEY)
    setPassword(null)
    setStatus('signed-out')
  }, [storage])

  return { status, api, error, signIn, signOut }
}
