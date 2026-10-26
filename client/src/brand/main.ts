import './brand.css'

/**
 * The brand page's entry, and the only interesting thing about it.
 *
 * A reference page listing colours is a copy of the palette, and a copy drifts:
 * somebody changes `--live` for a reason, nothing on this page moves, and from
 * that morning on the page is wrong in the one way nothing catches — wrong with
 * authority, and identical in appearance to right. The usual answer is a test
 * asserting that the two agree, which is a third copy.
 *
 * So nothing is copied. Every hex, every ratio and every pixel value printed
 * below is read off the computed styles at load, out of the same `tokens.css`
 * the station imports. Change a token and this page says the new thing on the
 * next reload, including the contrast ratios, including the flattened values
 * for email. There is nothing here to keep in step.
 *
 * The one thing that cannot work this way is the type scale, which lives in the
 * rules of `styles.css` rather than in variables. The page says so where it
 * prints it.
 */

/** A colour, once the browser has been asked what it actually means. */
interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

const root = document.documentElement
const styles = getComputedStyle(root)

/**
 * The raw text of a custom property, exactly as `tokens.css` wrote it.
 *
 * Custom properties are not resolved by the cascade — `getPropertyValue`
 * returns the token's source text, so `--panel` comes back as the string
 * `rgb(23 23 23 / 70%)` and not as a colour. That is useful for the sizes,
 * which are printed as written, and useless for the colours, which is what
 * `resolve` below is for.
 */
function token(name: string): string {
  return styles.getPropertyValue(name).trim()
}

/**
 * A probe, so the browser does the colour parsing rather than this file.
 *
 * Setting a value as `color` and reading it back gets it normalised to `rgb()`
 * or `rgba()` whatever syntax it was written in. That matters more than it
 * sounds: the tokens are a mix of `#rrggbb` and space-separated `rgb() / %`
 * today, and hand-rolled parsing here would be a second implementation of CSS
 * colour that starts failing the first time somebody writes `oklch()`.
 *
 * Hidden rather than off-screen, and appended once. `aria-hidden` because it is
 * an implementation detail with no text in it.
 */
const probe = document.createElement('span')
probe.setAttribute('aria-hidden', 'true')
probe.style.display = 'none'
document.body.append(probe)

function resolve(value: string): Rgba | null {
  // Cleared first, so a value the browser refuses leaves an empty string here
  // rather than whatever the previous call set. Without this, an unparseable
  // token would silently print the colour above it in the list.
  probe.style.color = ''
  probe.style.color = value
  if (probe.style.color === '') return null

  const [r, g, b, a] = (getComputedStyle(probe).color.match(/-?[\d.]+/g) ?? []).map(Number)
  if (r === undefined || g === undefined || b === undefined) return null

  return { r, g, b, a: a ?? 1 }
}

/**
 * What a translucent token becomes on a medium that has no alpha.
 *
 * Email clients composite nothing: a fill is a fill. Every panel in this design
 * is a translucency over the sheet, so the value a designer actually needs in
 * their layout tool is this one — the colour the browser is already showing
 * them, spelled as something they can type.
 */
function flatten(colour: Rgba, over: Rgba): Rgba {
  return {
    r: colour.r * colour.a + over.r * (1 - colour.a),
    g: colour.g * colour.a + over.g * (1 - colour.a),
    b: colour.b * colour.a + over.b * (1 - colour.a),
    a: 1,
  }
}

function hex({ r, g, b }: Rgba): string {
  const pair = (n: number): string =>
    Math.round(Math.min(255, Math.max(0, n)))
      .toString(16)
      .padStart(2, '0')
  return `#${pair(r)}${pair(g)}${pair(b)}`
}

/** WCAG relative luminance. The magic numbers are the specification's. */
function luminance({ r, g, b }: Rgba): number {
  const channel = (v: number): number => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrast(a: Rgba, b: Rgba): number {
  const one = luminance(a)
  const other = luminance(b)
  return (Math.max(one, other) + 0.05) / (Math.min(one, other) + 0.05)
}

const SHEET = resolve(token('--bg')) ?? { r: 10, g: 10, b: 10, a: 1 }

/* --- the swatches ---------------------------------------------------------
 *
 * The markup carries the token's name and one sentence about what it is for,
 * which is the only part of a swatch that cannot be measured. Everything else
 * is written here.
 */

for (const swatch of document.querySelectorAll<HTMLElement>('[data-token]')) {
  const name = swatch.dataset.token
  if (name === undefined) continue

  const raw = token(name)
  const colour = resolve(raw)
  if (colour === null) continue

  const flat = flatten(colour, SHEET)
  // The value the button copies. For a translucent token that is deliberately
  // the flattened one: somebody clicking a swatch is taking it somewhere that
  // has no idea what is behind it, or the click was pointless.
  const copied = hex(flat)

  const chip = document.createElement('span')
  chip.className = 'swatch__chip'
  chip.style.setProperty('--swatch', raw)

  const body = document.createElement('span')
  body.className = 'swatch__body'

  const value = document.createElement('span')
  value.className = 'swatch__hex'
  value.textContent = colour.a < 1 ? `${hex(colour)} · ${Math.round(colour.a * 100)}%` : hex(colour)
  body.append(value)

  // Only where there is something to say. A swatch that printed "flattens to
  // #ffffff" under #ffffff would be noise on nine rows out of eleven.
  if (colour.a < 1) {
    const asFlat = document.createElement('span')
    asFlat.className = 'swatch__flat'
    asFlat.textContent = `flat ${copied}`
    body.append(asFlat)
  }

  const label = document.createElement('span')
  label.className = 'swatch__var'
  label.textContent = name
  body.append(label)

  // The sentence was already in the markup. Moved rather than re-created,
  // because it is content and content belongs in the document.
  const use = swatch.querySelector('.swatch__use')
  if (use) body.append(use)

  swatch.prepend(chip, body)

  swatch.addEventListener('click', () => {
    void navigator.clipboard?.writeText(copied).then(
      () => {
        swatch.dataset.copied = 'true'
        window.setTimeout(() => {
          delete swatch.dataset.copied
        }, 1200)
      },
      () => {
        // A browser that refuses the clipboard is a browser where nothing
        // should claim a copy happened. The hex is on the page to be read.
      },
    )
  })
}

/* --- the contrast table ---------------------------------------------------
 *
 * Measured rather than remembered, for the reason the swatches are: a ratio
 * typed into a table is right on the day it is typed. The thresholds are
 * WCAG 2.1 — 4.5:1 for normal text, 3:1 for large — and the point of printing
 * them is the one row that does not clear the first.
 */

const MEASURED: readonly string[] = [
  '--fg',
  '--fg-soft',
  '--fg-dim',
  '--ok',
  '--muted',
  '--live-text',
  '--live',
  '--warn',
  '--faint',
]

const body = document.querySelector('#contrast-table tbody')

if (body) {
  const rows = MEASURED.map((name) => {
    const raw = token(name)
    const colour = resolve(raw)
    return colour === null ? null : { name, raw, colour, ratio: contrast(colour, SHEET) }
  })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) => b.ratio - a.ratio)

  for (const { name, raw, colour, ratio } of rows) {
    const tr = document.createElement('tr')

    const swatch = document.createElement('td')
    const dot = document.createElement('span')
    dot.className = 'dot'
    dot.style.setProperty('--swatch', raw)
    swatch.append(dot, document.createTextNode(hex(colour)))
    swatch.className = 'num'

    const which = document.createElement('td')
    which.className = 'dim'
    which.textContent = name

    const figure = document.createElement('td')
    figure.className = `num ratio--${ratio >= 4.5 ? 'pass' : 'large'}`
    figure.textContent = `${ratio.toFixed(1)} : 1`

    const verdict = document.createElement('td')
    verdict.className = 'dim'
    verdict.textContent =
      ratio >= 7
        ? 'Anything, down to the smallest label'
        : ratio >= 4.5
          ? 'Anything, including body copy'
          : ratio >= 3
            ? 'Large text and secondary labels only'
            : 'Not text at any size'

    tr.append(swatch, which, figure, verdict)
    body.append(tr)
  }
}

/* --- the sizes, and the two hairlines ------------------------------------- */

for (const cell of document.querySelectorAll<HTMLElement>('[data-token-value]')) {
  const name = cell.dataset.tokenValue
  if (name !== undefined) cell.textContent = token(name)
}

/**
 * The rings, which are box-shadows rather than colours.
 *
 * The colour inside one is pulled out with a match rather than by parsing the
 * shadow, because the only part of it that changes between the two is the
 * alpha, and the rest — `inset 0 0 0 1px` — is the same sentence twice.
 */
for (const el of document.querySelectorAll<HTMLElement>('[data-ring]')) {
  const name = el.dataset.ring
  if (name === undefined) continue
  const found = token(name).match(/rgba?\([^)]*\)/)
  if (found) el.textContent = found[0]
}

for (const el of document.querySelectorAll<HTMLElement>('[data-flat-ring]')) {
  const name = el.dataset.flatRing
  if (name === undefined) continue
  const found = token(name).match(/rgba?\([^)]*\)/)
  const colour = found ? resolve(found[0]) : null
  if (colour) el.textContent = hex(flatten(colour, SHEET))
}

/* --- the meter ------------------------------------------------------------
 *
 * Built here rather than written into the markup because it is fourteen
 * identical elements, and because the stagger is the only thing that stops a
 * row of bars pulsing in unison and reading as one wide bar going up and down.
 *
 * Delays are spread deterministically rather than randomly: a specimen that
 * looked different on every reload would be a bad specimen.
 */

const bars = document.querySelector('#brand-levels')

if (bars) {
  for (let i = 0; i < 14; i += 1) {
    const bar = document.createElement('span')
    bar.className = 'levels__bar'
    // Golden-ratio stepping, wrapped into the animation's own 900ms. It is the
    // cheapest way to get a spread that never repeats a neighbour's phase.
    bar.style.animationDelay = `${Math.round(((i * 0.618) % 1) * 900)}ms`
    bars.append(bar)
  }
}
