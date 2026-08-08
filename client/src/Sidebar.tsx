import broadcastIcon from './assets/icons/broadcast.svg'
import chatIcon from './assets/icons/chat.svg'
import clockIcon from './assets/icons/clock.svg'
import heartIcon from './assets/icons/heart.svg'
import lyricsIcon from './assets/icons/lyrics.svg'
import settingsIcon from './assets/icons/settings.svg'
import slidersIcon from './assets/icons/sliders.svg'
import { hashFor, needsJoin, type Route } from './lib/routes.js'

/**
 * The rail down the left-hand side.
 *
 * Six marks and the way to the decks, and every one of them goes somewhere.
 * The design's queue mark is gone on purpose: what is coming is the admin's
 * worksheet, not the room's, and the history already answers the question a
 * listener actually has. The landing view is the design's listener
 * page whole; the other five give one of the things on it the entire screen,
 * which is what a rail full of destinations is for.
 *
 * Before tuning in they are dimmed and inert, because there is genuinely
 * nothing behind them: the station has not told this browser who is in the
 * room, what is queued or what has been on. A mark that led to an empty page
 * would be the dead end this rail exists to avoid.
 */

interface Destination {
  route: Route
  icon: string
  /** What a screen reader and a tooltip both say — the icons carry no words. */
  label: string
}

const DESTINATIONS: Destination[] = [
  { route: 'on-air', icon: broadcastIcon, label: 'On air' },
  { route: 'lyrics', icon: lyricsIcon, label: 'Lyrics' },
  { route: 'sync', icon: slidersIcon, label: 'Sync' },
  { route: 'chat', icon: chatIcon, label: 'Chat' },
  { route: 'wishes', icon: heartIcon, label: 'Wishes' },
  { route: 'history', icon: clockIcon, label: 'History' },
]

export interface SidebarProps {
  /** Where the page is now. */
  active: Route
  /** False until this listener has tuned in — see the note above. */
  joined: boolean
  /**
   * Whether this browser is already signed in to the console. The mark at the
   * foot is the other door into it, so it is hidden on the same terms as the
   * chip in the top bar — otherwise hiding one of the two would achieve
   * nothing at all.
   */
  showConsole: boolean
}

export function Sidebar({ active, joined, showConsole }: SidebarProps) {
  return (
    <nav className="rail" aria-label="Station">
      <ul className="rail__group">
        {DESTINATIONS.map((destination) => {
          const reachable = joined || !needsJoin(destination.route)
          const icon = (
            <img className="rail__icon" src={destination.icon} alt="" width={18} height={18} />
          )
          return (
            <li key={destination.route}>
              {/* A real disabled control rather than a link with nowhere to go:
                  an anchor without an href is not focusable and announces
                  nothing, so somebody on a keyboard would never find out the
                  mark exists or why it is not working yet. */}
              {reachable ? (
                <a
                  className={`rail__mark${active === destination.route ? ' rail__mark--on' : ''}`}
                  href={hashFor(destination.route) || '#'}
                  title={destination.label}
                  aria-label={destination.label}
                  aria-current={active === destination.route ? 'page' : undefined}
                >
                  {icon}
                </a>
              ) : (
                <button
                  type="button"
                  className="rail__mark rail__mark--shut"
                  disabled
                  title={`${destination.label} — join the room first`}
                  aria-label={`${destination.label} — join the room first`}
                >
                  {icon}
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {/* Kept apart at the foot, as the design keeps it: not a view of what is
          on screen, but the other side of the station. Shown at the gate as
          well as once signed in, so somebody who typed the address by hand
          still has a way back to listening. */}
      {(showConsole || active === 'admin') && (
      <a
        className={`rail__mark${active === 'admin' ? ' rail__mark--on' : ''}`}
        href={active === 'admin' ? '#' : hashFor('admin')}
        title={active === 'admin' ? 'Back to listening' : 'The decks'}
        aria-label={active === 'admin' ? 'Back to listening' : 'The decks'}
        aria-current={active === 'admin' ? 'page' : undefined}
      >
        <img className="rail__icon" src={settingsIcon} alt="" width={18} height={18} />
      </a>
      )}
    </nav>
  )
}
