import heartIcon from './assets/icons/heart-outline.svg'
import onAirIcon from './assets/icons/on-air.svg'
import volumeIcon from './assets/icons/volume.svg'

/**
 * The deck.
 *
 * A record that turns while the station is playing and stops when it is not —
 * which is the whole point of drawing one. Everything on it is the station's:
 * the label in the middle is the track's own artwork, the clock under the title
 * is where this listener actually is in the song, and the platter stops the
 * moment the decks pause. Nothing here animates on its own to look busy.
 */

/**
 * The bars, at the heights the design draws them. Fixed rather than sampled:
 * there is no analyser on this audio element, and a waveform invented from a
 * random number would be a lie about the sound. What it does say truthfully is
 * whether anything is coming out at all — it moves while the station plays and
 * lies flat when it doesn't.
 */
const BARS = [
  8, 14, 20, 12, 26, 18, 30, 22, 16, 28, 12, 20, 24, 14, 30, 18, 10, 22, 16, 26, 14, 20, 12, 28,
  18, 24, 10, 16, 22, 14,
]

export interface DeckProps {
  /** The record's label, or null for a deck with nothing on it. */
  artwork: string | null
  /** True while the audio is actually running — the platter turns on this. */
  spinning: boolean
}

/** The platter, the record and the arm. Nothing here reads any other state. */
export function Deck({ artwork, spinning }: DeckProps) {
  return (
    <div className="deck" data-spinning={spinning}>
      <div className="deck__well">
        <div className="deck__record">
          {artwork ? (
            <img className="deck__label" src={artwork} alt="" />
          ) : (
            <div className="deck__label deck__label--blank" aria-hidden="true" />
          )}
          <div className="deck__spindle" aria-hidden="true" />
        </div>
        <div className="deck__pivot" aria-hidden="true">
          <div className="deck__arm">
            <div className="deck__arm-bar" />
          </div>
        </div>
      </div>
    </div>
  )
}

export interface OnAirProps {
  /** False when the decks are paused, or when there is nothing on them. */
  live: boolean
  /** What the badge says instead of LIVE when the station isn't playing. */
  idleLabel: string
}

/** The LIVE badge and the line beside it. */
export function OnAir({ live, idleLabel }: OnAirProps) {
  return (
    <div className="onair">
      <span className={`onair__badge${live ? '' : ' onair__badge--off'}`}>
        <span className="onair__dot" aria-hidden="true" />
        {live ? 'LIVE' : idleLabel}
      </span>
      <span className="onair__where">
        <img src={onAirIcon} alt="" width={14} height={14} />
        {live ? 'On air now' : 'Off air'}
      </span>
    </div>
  )
}

export interface WaveformProps {
  /** Bars move while this is true and lie flat while it is false. */
  live: boolean
}

/** The level meter beside the LIVE mark. */
export function Waveform({ live }: WaveformProps) {
  return (
    <div className="levels" data-live={live}>
      <span className={`levels__mark${live ? '' : ' levels__mark--off'}`}>
        ● {live ? 'LIVE' : 'IDLE'}
      </span>
      <div className="levels__bars" aria-hidden="true">
        {BARS.map((height, index) => (
          <span
            // Position is the identity here: these are 30 fixed slots in a
            // meter, not a list of anything that can be reordered.
            key={index}
            className="levels__bar"
            style={{ height: `${height}px`, animationDelay: `${(index % 10) * 90}ms` }}
          />
        ))}
      </div>
    </div>
  )
}

export interface MuteProps {
  muted: boolean
  onToggle(): void
  /** False while there is nothing to mute — no track, or not tuned in. */
  enabled: boolean
}

/** The round button under the deck, and the line that says what it does. */
export function Mute({ muted, onToggle, enabled }: MuteProps) {
  return (
    <div className="mute">
      <button
        type="button"
        className={`mute__button${muted ? ' mute__button--off' : ''}`}
        data-testid="mute"
        onClick={onToggle}
        disabled={!enabled}
        aria-pressed={muted}
        aria-label={muted ? 'Unmute' : 'Mute'}
      >
        <img src={volumeIcon} alt="" width={20} height={20} />
      </button>
      <span className="mute__hint">
        {!enabled
          ? 'Nothing to hear yet'
          : muted
            ? 'Muted here — the station plays on'
            : 'Streaming live — tap to mute'}
      </span>
    </div>
  )
}

export interface WishShortcutProps {
  onPress(): void
}

/**
 * The round button beside the title.
 *
 * A heart, and it does the one thing a heart can honestly do on a station with
 * no library and no favourites: it takes you to the composer where you ask for
 * something. Nothing is saved by pressing it.
 */
export function WishShortcut({ onPress }: WishShortcutProps) {
  return (
    <button
      type="button"
      className="stage__wish"
      onClick={onPress}
      title="Ask for something"
      aria-label="Ask for something"
    >
      <img src={heartIcon} alt="" width={16} height={16} />
    </button>
  )
}
