import type { Asset } from './assets.js'

/**
 * A picture, or the box it will go in.
 *
 * Until a Midjourney image exists for it, the slot draws what the Figma page
 * draws: bone paper, a thin cross from corner to corner, and the asset's id in
 * a tab at the top left. The page is then the right shape before any picture is
 * finished, and a placeholder that ships by accident still reads as "a picture
 * goes here" rather than as a broken image.
 *
 * The placeholder is `aria-hidden`. It is not content: a screen reader told
 * "MJ-01, the room" would be hearing the build process. The real picture
 * carries the `alt` from assets.ts.
 *
 * The size comes from CSS (`aspect-ratio` on the slot's modifier class), not
 * from the asset. That keeps the box and the picture that later replaces it at
 * the same proportions, so a picture arriving never moves the page.
 */
export function Slot({
  asset,
  className,
  label,
  eager = false,
}: {
  asset: Asset
  className?: string
  /** Overrides the placeholder's caption, e.g. a session cover per episode. */
  label?: string
  eager?: boolean
}) {
  const classes = className ? `slot ${className}` : 'slot'

  if (asset.src) {
    return (
      <img
        className={`${classes} slot--filled`}
        src={asset.src}
        alt={asset.alt}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
      />
    )
  }

  return (
    <div className={`${classes} slot--empty`} aria-hidden="true" data-asset={asset.id}>
      <span className="slot__tab">
        <span className="slot__id">
          {asset.id} · {label ?? asset.what}
        </span>
        <span className="slot__hint">Placeholder</span>
      </span>
    </div>
  )
}
