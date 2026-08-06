import { motion } from 'motion/react'
import { type CSSProperties, memo, useEffect, useMemo, useRef, useState } from 'react'

/**
 * A split-flap board, of the kind a station used to have on the wall.
 *
 * A port of Aceternity UI's Text Flipping Board
 * (<https://ui.aceternity.com/components/text-flipping-board>). The mechanism is
 * the original's exactly: every cell is two static halves with the character on
 * them, and a flip is two more halves on top — the old character's top half
 * falling forward on `rotateX`, the new one's bottom half swinging up to meet
 * it. Changing a cell runs it through twenty-five to forty random characters
 * first, each a flip of its own, and the delay before a cell starts is its
 * column plus its row, which is what makes the message arrive as a wave across
 * the board rather than all at once.
 *
 * Three departures:
 *
 *  - **No coloured flaps.** The original flashes a random flap red, orange,
 *    yellow, green, blue or violet on the way past. The first of those is the
 *    one colour this site does not lend out: red means the station is on the air
 *    right now, and a board flickering it while scrambling would be the page
 *    saying something it does not mean. The flaps are the page's own greys.
 *  - **It stops when nobody is looking.** Eighty-eight cells with two timers
 *    each is not a thing to run six screens above the reader. See `useOnScreen`,
 *    which the globe and the gramophone are already on for the same reason.
 *  - **The board is a picture of the words, not the words.** Every cell is a
 *    `div` with one letter in it, which is a way of spelling something that only
 *    works by eye. The board is `aria-hidden` and whatever is put on it should
 *    be somewhere in the document as a sentence — see `Limits`.
 *
 * The size is fixed in cells rather than in pixels: the flaps are square-ish and
 * the grid gives them the width it has, so the board is the same board on a
 * phone, drawn smaller.
 */

/** What a flap can be turned to. Anything else lands as a blank. */
const FLAPS = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$()-+&=;:'\"%,./?°"

/**
 * The characters the page is written in, and the ones a board can spell.
 *
 * Everything else on this site is set with proper typography — curly quotes, em
 * dashes, a real ellipsis — because it is type. A split-flap board is not type:
 * it is a physical thing with a fixed set of flaps on it, and the set above is
 * the one the original ships. A curly apostrophe is not on it, so `what’s` was
 * landing on the board as `WHAT S` with a hole where the flap could not turn.
 *
 * Mapped rather than added to `FLAPS`, because a board that could spell a curly
 * apostrophe would be a board pretending to be a font. This is what a real one
 * does with a character it does not have: turn up the nearest flap it owns.
 */
const PLAIN: Record<string, string> = {
  '’': "'",
  '‘': "'",
  '“': '"',
  '”': '"',
  '—': '-',
  '–': '-',
  '…': '.',
}

const flatten = (text: string) => text.replace(/[’‘“”—–…]/g, (mark) => PLAIN[mark] ?? mark)

/** The original's timings, in milliseconds and seconds respectively. */
const COL_DELAY = 30
const ROW_DELAY = 20
const STEP = 55
const FLIP = 0.35

/** How many random characters a cell turns through before it lands. */
const SCRAMBLE = { least: 25, spread: 15 }
/** Fewer on the way to a blank: it is emptying, not spelling something. */
const SCRAMBLE_BLANK = { least: 8, spread: 8 }

export interface FlipBoardProps {
  /** What the board should read. Newlines break lines; the rest wraps. */
  text: string
  rows?: number
  cols?: number
  /** False parks the board — see the note above about eighty-eight timers. */
  running?: boolean
  className?: string
}

export function FlipBoard({
  text,
  rows = 4,
  cols = 22,
  running = true,
  className = '',
}: FlipBoardProps) {
  const still = useStillness()

  // Laid out once per message: the lines wrapped to the board's width, then
  // centred in both directions, the way a board with one short sentence on it
  // is set. Blank everywhere else, which is most of it.
  const board = useMemo(() => {
    const grid: string[][] = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => ' '),
    )

    // Flattened before it is wrapped, so what the wrap measures is what the
    // board will actually be asked to spell.
    const lines = wrap(flatten(text), cols).slice(0, rows)
    const top = Math.max(0, Math.floor((rows - lines.length) / 2))

    lines.forEach((line, index) => {
      const row = top + index
      if (row >= rows) return
      const left = Math.max(0, Math.floor((cols - line.length) / 2))
      for (let column = 0; column < line.length && left + column < cols; column += 1) {
        grid[row]![left + column] = line[column]!
      }
    })

    return grid
  }, [text, rows, cols])

  return (
    <div className={`board ${className}`} aria-hidden="true">
      <div
        className="board__grid"
        style={
          { gridTemplateColumns: `repeat(${cols}, 1fr)`, '--cols': cols } as CSSProperties
        }
      >
        {board.map((row, r) =>
          row.map((character, c) => (
            <Flap
              key={`${r}-${c}`}
              target={running ? character : ' '}
              delay={still ? 0 : c * COL_DELAY + r * ROW_DELAY}
              still={still}
            />
          )),
        )}
      </div>
    </div>
  )
}

/**
 * One cell.
 *
 * `target` is where it should end up; everything else in here is the business of
 * getting there noisily. The two timers are the original's: one to wait its turn
 * in the wave, one to step through the scramble.
 */
const Flap = memo(function Flap({
  target,
  delay,
  still,
}: {
  target: string
  delay: number
  still: boolean
}) {
  const [shown, setShown] = useState(' ')
  const [before, setBefore] = useState(' ')
  // Bumped on every step, and used as the key that restarts the two flapping
  // halves — a flip is a fresh element rather than an animation replayed.
  const [flip, setFlip] = useState(0)

  const at = useRef(' ')
  const bound = useRef<string | null>(null)

  useEffect(() => {
    let waiting: ReturnType<typeof setTimeout> | undefined
    let stepping: ReturnType<typeof setTimeout> | undefined

    const wanted = FLAPS.includes(target.toUpperCase()) ? target.toUpperCase() : ' '
    if (wanted === bound.current) return
    bound.current = wanted
    if (wanted === ' ' && at.current === ' ') return

    /*
     * Asked not to animate, a cell simply reads what it reads.
     *
     * The board still turns over — a board that stopped would be six statements
     * of which a reader saw one — but there is no scramble and nothing swings:
     * the words change, which is the content doing what content does, and the
     * forty flips it took to say them were the part that was motion.
     */
    if (still) {
      at.current = wanted
      setShown(wanted)
      return
    }

    const through = wanted === ' ' ? SCRAMBLE_BLANK : SCRAMBLE
    const count = through.least + Math.floor(Math.random() * through.spread)

    const step = (index: number) => {
      const last = index === count
      const character = last ? wanted : FLAPS[1 + Math.floor(Math.random() * (FLAPS.length - 1))]!

      setBefore(at.current)
      at.current = character
      setShown(character)
      setFlip((n) => n + 1)

      if (!last) stepping = setTimeout(() => step(index + 1), STEP)
    }

    waiting = setTimeout(() => step(1), delay)

    return () => {
      clearTimeout(waiting)
      clearTimeout(stepping)
      // Left unbound rather than at `wanted`: this cell is being taken apart, and
      // whatever mounts next has to be free to run the same character again.
      bound.current = null
    }
  }, [target, delay, still])

  // A space would collapse the line box and leave the halves half-height.
  const face = shown === ' ' ? ' ' : shown
  const gone = before === ' ' ? ' ' : before

  return (
    <div className="flap">
      <div className="flap__face">
        <span className="flap__half flap__half--top">
          <span className="flap__char">{face}</span>
        </span>
        <span className="flap__half flap__half--bottom">
          <span className="flap__char">{face}</span>
        </span>

        {flip === 0 || still ? null : (
          <>
            {/* The old character's top half, falling forward. */}
            <motion.span
              className="flap__leaf flap__leaf--top"
              key={flip}
              initial={{ rotateX: 0 }}
              animate={{ rotateX: -100 }}
              transition={{ duration: FLIP, ease: [0.55, 0.055, 0.675, 0.19] }}
            >
              <span className="flap__char">{gone}</span>
              <motion.span
                className="flap__shade"
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.6 }}
                transition={{ duration: FLIP }}
              />
            </motion.span>

            {/* The new character's bottom half, swinging up to meet it. */}
            <motion.span
              className="flap__leaf flap__leaf--bottom"
              key={`up-${flip}`}
              initial={{ rotateX: 90 }}
              animate={{ rotateX: 0 }}
              transition={{ duration: FLIP * 0.85, delay: FLIP * 0.5, ease: [0.33, 1.55, 0.64, 1] }}
            >
              <span className="flap__char">{face}</span>
            </motion.span>
          </>
        )}

        <span className="flap__seam" />
      </div>

      <span className="flap__ribs" />
    </div>
  )
})

/** Whether the reader has asked for no animation. Watched, not read once. */
function useStillness(): boolean {
  const [still, setStill] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const read = () => setStill(query.matches)

    read()
    query.addEventListener('change', read)
    return () => query.removeEventListener('change', read)
  }, [])

  return still
}

/** Words onto lines of at most `cols`, breaking where the text says to. */
function wrap(text: string, cols: number): string[] {
  return text.split('\n').flatMap((paragraph) => {
    const words = paragraph.split(/[ \t]+/).filter(Boolean)
    const lines: string[] = []
    let line = ''

    for (const word of words) {
      if (word.length > cols) {
        if (line) lines.push(line)
        lines.push(word.slice(0, cols))
        line = ''
      } else if (!line) {
        line = word
      } else if (line.length + 1 + word.length <= cols) {
        line += ` ${word}`
      } else {
        lines.push(line)
        line = word
      }
    }

    if (line) lines.push(line)
    return lines.length === 0 ? [''] : lines
  })
}
