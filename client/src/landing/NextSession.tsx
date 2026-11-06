import { useEffect, useState } from 'react'
import { kindPromise } from '../lib/kind.js'
import { isUpcoming, nextSessionLabel } from '../lib/schedule.js'
import { posterUrl, type ScheduledSession } from '../lib/protocol.js'
import { stationUrl } from '../lib/routes.js'

/**
 * The next session, on the page in front of the station.
 *
 * This is the only thing on the landing page that is *true*. Everything else
 * here is an invented evening: a sample session, nine sleeves the station has
 * never played, a room saying things nobody said. That is deliberate and
 * documented, because the page in front of the station cannot ask the station
 * anything.
 *
 * Except this. A poster is an advertisement, which means the people it is for
 * are exactly the people who have not been let in yet, so `GET /api/schedule`
 * is open where every other read on this API is gated. See `scheduleRoutes` for
 * why that is safe: a time and a picture, and no track, nickname or word
 * anybody said.
 *
 * **It renders nothing when nothing is announced**, and nothing when the ask
 * fails. A landing page whose job is to work on the days the station does not
 * must not grow a section that can break: no station, no error, no empty box,
 * just the page it was before.
 */

/** What this page knows about the schedule. Empty until it hears otherwise. */
export interface Announced {
  /** The soonest session still worth showing, or null. */
  next: ScheduledSession | null
  /** Every announced session still worth showing, soonest first. */
  upcoming: ScheduledSession[]
}

const NOTHING: Announced = { next: null, upcoming: [] }

/** The one fetch this page makes. Anything other than an answer is silence. */
async function fetchSchedule(signal: AbortSignal): Promise<ScheduledSession[]> {
  try {
    const response = await fetch('/api/schedule', { signal })
    if (!response.ok) return []
    const body = (await response.json()) as {
      schedule?: ScheduledSession | null
      upcoming?: ScheduledSession[]
    }
    // A station from before the list sends the next session alone.
    return body.upcoming ?? (body.schedule ? [body.schedule] : [])
  } catch {
    return []
  }
}

/**
 * The announced sessions, and which of them is next.
 *
 * A hook rather than only a section because the poster page says it in four
 * places: the ticker, the next-session band, the list of upcoming sessions and
 * the bar at the foot. Four fetches of the same open read would be four
 * chances to disagree, so they share one.
 *
 * Filtered here as well as at the station, by the same six hours, so a page
 * left open past a night stops promising it without asking again.
 */
export function useSchedule(): Announced {
  const [upcoming, setUpcoming] = useState<ScheduledSession[]>([])

  useEffect(() => {
    const stop = new AbortController()
    void fetchSchedule(stop.signal).then(setUpcoming)
    return () => stop.abort()
  }, [])

  const now = Date.now()
  const live = upcoming.filter((session) => isUpcoming(session, now))
  return live.length > 0 ? { next: live[0] ?? null, upcoming: live } : NOTHING
}

/**
 * What is being promised, in one line: "A conversation, with Sipho".
 *
 * Both halves come from the announcement rather than from this page, which is
 * the point of them being on it at all: everything else in this section is a
 * time and a picture, and a stranger deciding whether to turn up on Saturday
 * is deciding between an evening of records and an evening of somebody
 * talking. Before these fields existed the page could only ever imply the
 * first, whichever one it was.
 */
export function promiseOf(next: ScheduledSession): string {
  return next.title ? `${kindPromise(next.kind)}, ${next.title}` : kindPromise(next.kind)
}

export function NextSession({ next }: { next: ScheduledSession | null }) {
  if (next === null) return null

  const art = posterUrl(next)
  const when = nextSessionLabel(next.startsAt, Date.now())
  const promise = promiseOf(next)

  return (
    <section className="band band--press upcoming" id="next-session">
      <div className="upcoming__words">
        <p className="kicker">The next one</p>
        <h2 className="upcoming__when">
          <time dateTime={new Date(next.startsAt).toISOString()}>{when}</time>
        </h2>
        <p className="upcoming__what" data-testid="upcoming-what">
          {promise}
        </p>
        {/* Not "tune in now": the station is not on, and a button that opened a
            dark room would be the page overselling. Somebody who presses this is
            deciding to come back, and the listener page will tell them the same
            thing this section just did. */}
        <p className="upcoming__after">
          Nothing is playing yet. Keep the evening free.
        </p>
        <a className="button button--ink" href={stationUrl()}>
          Take me there
        </a>
      </div>

      {/* The one image on this page that is carrying information rather than
          decorating: it is the announcement, drawn by whoever is running the
          session, and it is often the only place the theme is written down. The
          date is repeated in the alt because the poster is what a sighted reader
          reads first, and the alt has to stand where the picture does. */}
      {art && (
        <img
          className="upcoming__poster"
          src={art}
          alt={`Poster for the next session. ${promise}, ${when}`}
        />
      )}
    </section>
  )
}
