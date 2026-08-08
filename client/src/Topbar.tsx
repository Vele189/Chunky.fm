import bellIcon from './assets/icons/bell.svg'
import broadcastSmallIcon from './assets/icons/broadcast-sm.svg'
import slidersSmallIcon from './assets/icons/sliders-sm.svg'
import usersIcon from './assets/icons/users.svg'
import type { Standing } from './lib/availability.js'
import { statusLabel } from './lib/availability.js'

export interface TopbarProps {
  /** What the page can see of the station — see lib/availability.ts. */
  reach: Standing
  /** Null before the first roster frame: a count nobody has sent is not zero. */
  listeners: number | null
  /** True on the decks, which is what the segmented control is switching. */
  admin: boolean
  /**
   * Whether this browser is already signed in to the console.
   *
   * The way in is shown only to somebody who has been through it. That is not
   * a lock — every route that does anything is gated on the server, and typing
   * the address still reaches the sign-in form — it is the page declining to
   * advertise a door to the hundred per cent of visitors it would refuse.
   */
  showConsole: boolean
}

/**
 * The bar across the top: who this is, who else is here, and whether there is
 * a station on the other end.
 *
 * There is no search field, on either side of the station. The listener page
 * carried one over the queue, the evening, the wishes and the room — four short
 * lists already on the screen — and the console carried the same one over its
 * library. Neither was narrowing a haystack: a station is one evening's worth
 * of records, and a field that saves you a dozen rows of scrolling is not worth
 * the width it takes across the top of a phone. What is on the page is the
 * whole of what there is, so the page just shows it.
 */
export function Topbar({ reach, listeners, admin, showConsole }: TopbarProps) {
  return (
    <header className="topbar">
      <div className="topbar__left">
        {/* Still the page's heading — and a link, because the wordmark is what
            everyone tries first to get back to the deck. */}
        <h1 className="wordmark">
          <a href="#" aria-label="chunky.fm — on air">
            chunky<span className="wordmark__tld">.fm</span>
          </a>
        </h1>
      </div>

      <div className="topbar__right">
        {/* Two links rather than a toggle with state of its own: which side you
            are on is the address, and the address is the only thing that
            decides what renders. */}
        {showConsole && (
        <div className="segmented" role="group" aria-label="Which side of the station">
          <a
            className={`segmented__side${admin ? '' : ' segmented__side--on'}`}
            href="#"
            aria-current={admin ? undefined : 'page'}
          >
            <img src={broadcastSmallIcon} alt="" width={14} height={14} />
            Listener
          </a>
          <a
            className={`segmented__side${admin ? ' segmented__side--on' : ''}`}
            href="#admin"
            aria-current={admin ? 'page' : undefined}
          >
            <img src={slidersSmallIcon} alt="" width={14} height={14} />
            Admin
          </a>
        </div>
        )}

        <p className="headcount">
          <img src={usersIcon} alt="" width={16} height={16} />
          <span className="headcount__number" data-testid="listener-count">
            {listeners === null ? '—' : listeners.toLocaleString()}
          </span>
          <span className="headcount__word">listening</span>
        </p>

        {/* Not a notification tray — there are no notifications. The bell is
            where the design puts the one thing that is worth an alert on this
            page, which is whether there is a station on the other end at all. */}
        <p
          className={`signal status status--${reach}`}
          title={statusLabel(reach)}
          aria-label={statusLabel(reach)}
          role="status"
        >
          <img src={bellIcon} alt="" width={18} height={18} />
          <span className="signal__dot" aria-hidden="true" />
          <span className="signal__label">{statusLabel(reach)}</span>
        </p>
      </div>
    </header>
  )
}
