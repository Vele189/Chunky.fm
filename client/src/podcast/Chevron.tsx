/**
 * The back chevron, drawn the way Apple draws one.
 *
 * A stroked chevron rather than the arrow (`←`) this used to be, and rather
 * than a `‹` typed as text: a text chevron is whatever the reading face makes
 * of it — in Space Grotesk it is a wide, light angle bracket that sits too high
 * against a 13px line — where this is the proportion iOS uses at every size. A
 * touch taller than it is wide, 2.2 of stroke with round caps and a round join,
 * and optically centred on the word rather than on its own box.
 */
export function BackChevron() {
  return (
    <svg
      className="back__chevron"
      viewBox="0 0 12 20"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M10 2L2.6 9.4a.85.85 0 000 1.2L10 18"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}
