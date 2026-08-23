import {
  type Episode,
  episodePath,
  episodePosterUrl,
  formatDate,
  formatLength,
  subtitleFor,
} from '../lib/episodes.js'
import { TiltCard, TiltItem, TiltPoster } from './TiltCard.js'

/**
 * The archive, as a wall of posters.
 *
 * Each card is Aceternity's 3D Card Effect (see `TiltCard.tsx`) wrapped around
 * one episode: the poster on the card's own surface, the title and the meta
 * line lifted in front of it, so pointing at a card pushes its words toward the
 * reader while the artwork stays put.
 *
 * The whole card is one link. The original component makes a title inside the
 * card clickable and leaves the artwork inert, which on a page that is mostly
 * artwork means most of the target is dead — and the poster is the thing
 * somebody is actually aiming at.
 */

/**
 * How many cards load their poster eagerly.
 *
 * The first row and a bit, which is roughly what fits above the fold on a
 * laptop. Everything below waits for the scroll. Guessed rather than measured,
 * and it is the right kind of guess: too high costs a few requests on a fast
 * connection, too low costs a visible pop-in on the row somebody is looking at.
 */
const EAGER_CARDS = 4

export interface EpisodeGridProps {
  episodes: Episode[]
  /** Called instead of a navigation, so the page can swap views without a load. */
  onOpen: (episode: Episode) => void
}

export function EpisodeGrid({ episodes, onOpen }: EpisodeGridProps) {
  return (
    <ul className="grid">
      {episodes.map((episode, index) => (
        <li className="grid__cell" key={episode.id}>
          <TiltCard>
            {/*
              A real anchor with a real href, not a div with a click handler.
              This is the one page here a crawler reads and the one address
              people paste, so the link has to exist in the markup — and
              middle-click, "open in new tab" and "copy link address" all have
              to work, which they only do for an anchor with an href.

              The click is intercepted so the common case is a view swap rather
              than a full document load; anything with a modifier held is left
              entirely alone, because that is somebody deliberately asking the
              browser to do its own thing.
            */}
            <a
              className="card"
              href={episodePath(episode.slug)}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
                if (event.button !== 0) return
                event.preventDefault()
                onOpen(episode)
              }}
            >
              <TiltItem className="card__art" z={0}>
                <TiltPoster
                  src={episodePosterUrl(episode)}
                  alt={episode.title}
                  eager={index < EAGER_CARDS}
                />
                {/* A wash from the foot of the poster, so the words below it
                    have something to sit against whatever the artwork does
                    down there. Inside the card so it tilts with it. */}
                <span className="card__wash" aria-hidden="true" />
              </TiltItem>

              <TiltItem className="card__title" z={60} as="h2">
                {episode.title}
              </TiltItem>

              <TiltItem className="card__meta" z={40}>
                {/* The three facts a card has room for, in the order somebody
                    scanning a wall of them actually uses: which one is this,
                    when was it, how long is it. */}
                <span className="card__sub">{subtitleFor(episode) ?? 'chunky.fm'}</span>
                <span className="card__facts">
                  <time dateTime={new Date(episode.publishedAt).toISOString()}>
                    {formatDate(episode.publishedAt)}
                  </time>
                  <span aria-hidden="true"> · </span>
                  <span>{formatLength(episode.durationMs)}</span>
                </span>
              </TiltItem>
            </a>
          </TiltCard>
        </li>
      ))}
    </ul>
  )
}
