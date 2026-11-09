import { useEffect, useState } from 'react'

const POLL_MS = 10_000

/**
 * The stream's address while the DJ is on camera, and null otherwise.
 *
 * Polled rather than pushed because the landing page deliberately has no
 * socket. Any failure reads as "not live", so a page whose station is down
 * looks exactly as it did before there was video.
 */
export function useLiveVideo(): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    const stop = new AbortController()
    const ask = async (): Promise<void> => {
      if (document.hidden) return
      try {
        const response = await fetch('/api/video', { signal: stop.signal })
        if (!response.ok) throw new Error(String(response.status))
        const body = (await response.json()) as { url?: string | null }
        setUrl(body.url ?? null)
      } catch {
        if (!stop.signal.aborted) setUrl(null)
      }
    }
    void ask()
    const timer = setInterval(() => void ask(), POLL_MS)
    document.addEventListener('visibilitychange', ask)
    return () => {
      stop.abort()
      clearInterval(timer)
      document.removeEventListener('visibilitychange', ask)
    }
  }, [])

  return url
}
