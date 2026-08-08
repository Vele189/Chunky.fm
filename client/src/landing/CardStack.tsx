import { motion } from 'motion/react'
import type { ReactNode } from 'react'

/**
 * A deck of panels with one face up.
 *
 * A port of Aceternity UI's Card Stack
 * (<https://ui.aceternity.com/components/card-stack>), and the arithmetic is the
 * original's: the card at position `i` in the deck sits `i × 10px` higher, at
 * `1 − i × 0.06` scale, `cards.length − i` deep, with its transform origin at
 * the top so the ones behind peek out above the front one rather than growing
 * out of the middle of it.
 *
 * The one departure is what turns the deck. The original runs a `setInterval`
 * that moves the last card to the front every five seconds, which is right for
 * a stack that is decorating a page on its own. This one is inside a sticky
 * reveal that already knows which of its three things you are reading, so the
 * deck is cut to that instead: the active card is the face, and the rest follow
 * it round. Scrolling deals the next one.
 *
 * Nothing is unmounted as the order changes, for the same reason the crossfade it
 * replaces did not unmount either. One of these panels holds a conversation
 * that fills as the page scrolls, and a card rebuilt every time it came to the
 * front would keep starting the evening again.
 */

/** How far up each card behind the front one sits. The original's. */
const CARD_OFFSET = 10
const SCALE_FACTOR = 0.06

export interface StackCard {
  key: string
  node: ReactNode
}

export function CardStack({
  items,
  active,
  className = '',
}: {
  items: readonly StackCard[]
  /** Which card is face up. Everything else follows it round the deck. */
  active: number
  className?: string
}) {
  return (
    <div className={`stack ${className}`}>
      {items.map((item, index) => {
        // Where this card sits in the deck as it is currently cut: 0 is the
        // face, and the rest wrap round in order behind it.
        const place = (index - active + items.length) % items.length
        const front = place === 0

        return (
          <motion.div
            className="stack__card"
            key={item.key}
            style={{ transformOrigin: 'top center' }}
            animate={{
              top: place * -CARD_OFFSET,
              scale: 1 - place * SCALE_FACTOR,
              zIndex: items.length - place,
            }}
            transition={{ type: 'spring', stiffness: 260, damping: 32 }}
            // The cards behind are a stack of edges, not three panels of content
            // to be read. Only the face is offered to anything reading the page
            // out, and only the face can be clicked into.
            aria-hidden={!front}
            inert={front ? undefined : true}
          >
            {item.node}
          </motion.div>
        )
      })}
    </div>
  )
}
