import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CONSOLE_HASH,
  type Episode,
  EpisodeApi,
  PODCAST_PATH,
  type PodcastRoute,
  episodePath,
  routeFrom,
} from '../lib/episodes.js'
import { Console } from './Console.js'
import { EpisodeGrid } from './EpisodeGrid.js'
import { Player } from './Player.js'

/**
 * The podcast archive: the grid, one episode, or the console.
 *
 * One document deciding what to draw from its own address bar, the same shape
 * the station has — and with one difference that is the whole reason this is a
 * separate document. The station reads a *fragment*, because it is a private
 * application behind a door and its views are not addresses anybody shares. An
 * episode is the opposite: it is public, it is meant to be pasted into a
 * message, and it is the one thing here a crawler should read. So these are
 * paths, and all four front doors know about them (see `lib/doorway.ts`).
 *
 * Paths mean the History API rather than `location.hash`, which brings the one
 * genuine obligation of client-side routing with it: **the back button has to
 * work**. `popstate` is handled below, and every navigation goes through
 * `go()`, so the browser's history and what is on screen cannot disagree.
 */

/** What the archive is doing while it finds out what is in it. */
type Loading =
  | { state: 'loading' }
  | { state: 'ready'; episodes: Episode[] }
  | { state: 'failed'; message: string }

export function Podcast() {
  // One API object for the life of the page. As a default argument it would be
  // a new object every render, and every effect depending on it would re-run —
  // the mistake `useAdminSession` documents at length.
  const api = useMemo(() => new EpisodeApi(), [])

  const [route, setRoute] = useState<PodcastRoute>(() => routeFrom(window.location))
  const [archive, setArchive] = useState<Loading>({ state: 'loading' })

  /**
   * The episode being listened to, held separately from the archive list.
   *
   * Two reasons, and the second is the load-bearing one. A card in the grid
   * carries everything the player needs, so opening one can draw immediately
   * rather than waiting for a second request — that is the first. The second is
   * that somebody may arrive *directly* at `/podcast/leaving-johannesburg`,
   * from a link in a message, in which case there is no grid to have come from
   * and the episode has to be fetched on its own. Both paths end here.
   */
  const [episode, setEpisode] = useState<Episode | null>(null)
  const [missing, setMissing] = useState(false)

  /** Every published episode. Asked for once; the archive does not change under a reader. */
  useEffect(() => {
    let cancelled = false
    void api
      .list()
      .then((episodes) => {
        if (!cancelled) setArchive({ state: 'ready', episodes })
      })
      .catch(() => {
        if (!cancelled) {
          setArchive({ state: 'failed', message: 'could not reach the station' })
        }
      })
    return () => {
      cancelled = true
    }
  }, [api])

  /**
   * The episode named in the address, when the grid has not already supplied it.
   *
   * Runs on the slug rather than on the route object, which is rebuilt on every
   * navigation: keying on the object would re-fetch an episode already in hand
   * every time somebody opened and closed the console.
   */
  const slug = route.kind === 'episode' ? route.slug : null
  useEffect(() => {
    if (slug === null) {
      setMissing(false)
      return
    }
    // Already holding the right one, handed over by the grid.
    if (episode?.slug === slug) return

    let cancelled = false
    setMissing(false)
    void api
      .get(slug)
      .then((found) => {
        if (cancelled) return
        if (found) setEpisode(found)
        else setMissing(true)
      })
      .catch(() => {
        if (!cancelled) setMissing(true)
      })
    return () => {
      cancelled = true
    }
  }, [api, slug, episode?.slug])

  /** The back button, and anything else that moves history without us. */
  useEffect(() => {
    const onPop = () => setRoute(routeFrom(window.location))
    window.addEventListener('popstate', onPop)
    // The console is a fragment, and a fragment change is a `hashchange` rather
    // than a `popstate` in some browsers. Both, so `#admin` typed by hand into
    // the address bar arrives as well as `#admin` clicked.
    window.addEventListener('hashchange', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('hashchange', onPop)
    }
  }, [])

  /** Move, and tell the browser we did, so back and forward both work. */
  const go = useCallback((url: string) => {
    window.history.pushState(null, '', url)
    setRoute(routeFrom(window.location))
  }, [])

  const openEpisode = useCallback(
    (chosen: Episode) => {
      // Handed over rather than re-fetched: the card already holds everything
      // the player needs, and a spinner between a click and a page that was
      // already in memory is a spinner for its own sake.
      setEpisode(chosen)
      go(episodePath(chosen.slug))
    },
    [go],
  )

  const openArchive = useCallback(() => go(PODCAST_PATH), [go])

  /** The document's title follows the view, because these are real addresses. */
  useEffect(() => {
    const name =
      route.kind === 'episode' && episode
        ? `${episode.title} · chunky.fm`
        : route.kind === 'console'
          ? 'The archive · chunky.fm'
          : 'The podcast · chunky.fm'
    document.title = name
  }, [route, episode])

  if (route.kind === 'console') {
    return (
      <main className="page">
        <Console api={api} onBack={openArchive} />
      </main>
    )
  }

  if (route.kind === 'episode') {
    if (missing) {
      return (
        <main className="page page--centred">
          <section className="empty">
            <h1 className="empty__heading">No episode at that address</h1>
            <p className="empty__line">
              It may have been taken down, or the link may have picked up a stray character on its
              way to you.
            </p>
            <button type="button" className="empty__back" onClick={openArchive}>
              All episodes
            </button>
          </section>
        </main>
      )
    }
    if (!episode || episode.slug !== slug) {
      return (
        <main className="page page--centred">
          <p className="page__waiting">Finding it&hellip;</p>
        </main>
      )
    }
    return (
      <main className="page">
        <Player episode={episode} onBack={openArchive} />
      </main>
    )
  }

  return (
    <main className="page">
      {/*
        Two panes on a desk, stacked on a phone, and the page itself never
        scrolls in either case. The aside is what the second column is *for*:
        the words that introduce the archive have somewhere to sit other than
        on top of the cards, so the cards get the whole of the other column and
        a reader sees more of them at once. See `.shell` in podcast.css.
      */}
      <div className="shell">
        <aside className="shell__aside">
          <header className="masthead">
            <a className="masthead__home" href="/">
              chunky.fm
            </a>
            <h1 className="masthead__heading">The podcast</h1>
            <p className="masthead__line">
              Conversations from the station, kept. A session ends and takes its tracklist and its
              chat with it; these are the nights that were worth holding on to.
            </p>
            {archive.state === 'ready' && archive.episodes.length > 0 && (
              <p className="masthead__count">
                {archive.episodes.length} {archive.episodes.length === 1 ? 'episode' : 'episodes'}
              </p>
            )}
          </header>

          <footer className="foot">
            <a href="/">The station</a>
            <a href="/how-it-works">How it works</a>
            {/*
              Deliberately a plain fragment link rather than a button. It is the
              only way into the console, it is not a secret (the password is),
              and a link is the thing a browser can bookmark.
            */}
            <a href={`${PODCAST_PATH}${CONSOLE_HASH}`}>Admin</a>
          </footer>
        </aside>

        {/* The one thing on this page that scrolls. */}
        <div className="shell__main">
          {archive.state === 'loading' && (
            <p className="page__waiting">Opening the archive&hellip;</p>
          )}

          {archive.state === 'failed' && (
            <p className="page__waiting" role="alert">
              {archive.message}.
            </p>
          )}

          {archive.state === 'ready' &&
            (archive.episodes.length === 0 ? (
              <section className="empty">
                <h2 className="empty__heading">Nothing here yet</h2>
                <p className="empty__line">
                  The first episode goes up after the next conversation. The station itself is at{' '}
                  <a href="/listen">/listen</a>.
                </p>
              </section>
            ) : (
              <EpisodeGrid episodes={archive.episodes} onOpen={openEpisode} />
            ))}
        </div>
      </div>
    </main>
  )
}
