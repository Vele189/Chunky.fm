import bellIcon from './assets/icons/bell.svg'
import broadcastSmallIcon from './assets/icons/broadcast-sm.svg'
import searchIcon from './assets/icons/search.svg'
import slidersSmallIcon from './assets/icons/sliders-sm.svg'
import usersIcon from './assets/icons/users.svg'
import type { Availability } from './lib/availability.js'
import { statusLabel } from './lib/availability.js'

export interface TopbarProps {
  /** What the page can see of the station — see lib/availability.ts. */
  reach: Availability
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
  /** What is typed into the search field, and how to change it. */
  filter: string
  onFilterChange(filter: string): void
  /**
   * False on the one view with nothing on it to narrow. The field is then not
   * rendered at all rather than sitting there taking what you type and doing
   * nothing with it.
   */
  searchable: boolean
  /** What the field says it will narrow, which differs by view. */
  searchHint: string
}

/**
 * The bar across the top: who this is, what you are looking for, and who else
 * is here.
 *
 * The search field filters the two lists on the page — what is coming and what
 * has been on — and nothing else. It is not a library search: there is no
 * library to search, and a box that swallowed what you typed would be worse
 * than no box. What it narrows is what is already in front of you.
 */
export function Topbar({
  reach,
  listeners,
  admin,
  showConsole,
  filter,
  onFilterChange,
  searchable,
  searchHint,
}: TopbarProps) {
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
        {searchable && (
          <div className="search">
            <img className="search__icon" src={searchIcon} alt="" width={16} height={16} />
            <input
              className="search__input"
              type="search"
              value={filter}
              onChange={(event) => onFilterChange(event.target.value)}
              placeholder={searchHint}
              aria-label={searchHint}
              autoComplete="off"
            />
          </div>
        )}
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
