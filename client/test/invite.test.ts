import { describe, expect, it } from 'vitest'
import { codeRefusal, readAnswer } from '../src/hooks/useStationAccess.js'
import { inviteFrom, inviteLink, withoutInvite } from '../src/lib/invite.js'

describe('inviteFrom', () => {
  it('reads the key out of a link', () => {
    expect(inviteFrom('?k=abc123')).toBe('abc123')
    expect(inviteFrom('?other=1&k=abc123')).toBe('abc123')
  })

  it('is null when the link carries none', () => {
    expect(inviteFrom('')).toBe(null)
    expect(inviteFrom('?other=1')).toBe(null)
  })

  it('treats an empty or blank key as no key at all', () => {
    expect(inviteFrom('?k=')).toBe(null)
    expect(inviteFrom('?k=%20%20')).toBe(null)
  })
})

describe('withoutInvite', () => {
  it('takes the key out and leaves the rest of the address alone', () => {
    expect(withoutInvite('/?k=abc123')).toBe('/')
    expect(withoutInvite('/?other=1&k=abc123')).toBe('/?other=1')
  })

  /** A `#chat` link with an invite on it has to survive being cleaned. */
  it('keeps the fragment, which is what decides the view', () => {
    expect(withoutInvite('/?k=abc123#chat')).toBe('/#chat')
    expect(withoutInvite('/some/path?k=abc#history')).toBe('/some/path#history')
  })

  it('leaves no dangling question mark behind', () => {
    expect(withoutInvite('/?k=abc123')).not.toContain('?')
  })

  it('is null when there was nothing to strip', () => {
    expect(withoutInvite('/')).toBe(null)
    expect(withoutInvite('/?other=1#chat')).toBe(null)
  })

  it('copes with an absolute address', () => {
    expect(withoutInvite('https://chunky.fm/?k=abc#sync')).toBe('/#sync')
  })

  /**
   * What it is actually handed, now that the station is a name in rather than
   * the root. Cleaning must leave an address that still reaches the station, or
   * a listener who reloads after being let in arrives at the landing page.
   */
  it('leaves the station address reaching the station', () => {
    expect(withoutInvite('https://chunky.fm/listen?k=abc')).toBe('/listen')
    expect(withoutInvite('https://chunky.fm/listen?k=abc#chat')).toBe('/listen#chat')
  })
})

describe('readAnswer', () => {
  it('admits on any success', () => {
    expect(readAnswer(200, true)).toBe('admitted')
    expect(readAnswer(204, true)).toBe('admitted')
  })

  it('refuses only on 401 — the one status the gate itself sends', () => {
    expect(readAnswer(401, false)).toBe('refused')
  })

  /**
   * The rule that matters. With the station stopped, the thing in front of it
   * answers instead — Vite's dev proxy with a 500, nginx with a 502 — and
   * reading either as "you are not invited" would tell a listener their link
   * was bad every time the station restarted under them.
   */
  it('treats anything else as the station not answering, not as a refusal', () => {
    for (const status of [500, 502, 503, 504, 429, 404]) {
      expect(readAnswer(status, false)).toBe('unreachable')
    }
  })
})

describe('inviteLink', () => {
  it('carries the key when the station is private', () => {
    expect(inviteLink('https://chunky.fm', 'abc123')).toBe('https://chunky.fm/listen?k=abc123')
  })

  it('is the station on its own when the station is open', () => {
    expect(inviteLink('https://chunky.fm', null)).toBe('https://chunky.fm/listen')
  })

  /**
   * The root is the landing page now. A link handed out from the console that
   * pointed there would send a listener to the page describing the station
   * rather than into it — so this is the check that keeps it pointed at the app.
   */
  it('points at the station rather than at the page in front of it', () => {
    for (const key of [null, 'abc123']) {
      expect(new URL(inviteLink('https://chunky.fm', key)).pathname).toBe('/listen')
    }
  })

  it('escapes a key that needs it, rather than producing a link that splits', () => {
    expect(inviteLink('https://chunky.fm', 'a+b/c=')).toBe('https://chunky.fm/listen?k=a%2Bb%2Fc%3D')
  })

  it('does not double the slash on an origin that has one', () => {
    expect(inviteLink('http://localhost:5173/', null)).toBe('http://localhost:5173/listen')
    expect(inviteLink('http://localhost:5173/', 'k')).toBe('http://localhost:5173/listen?k=k')
  })

  /** What is handed out has to be redeemable by the code that reads it back. */
  it('round-trips through the reader on the other side', () => {
    const link = inviteLink('https://chunky.fm', 'a+b/c=')

    expect(inviteFrom(new URL(link).search)).toBe('a+b/c=')
  })
})

describe('codeRefusal', () => {
  it('says the code was wrong when the station said so', () => {
    expect(codeRefusal(401)).toMatch(/not the code/i)
  })

  it('says to wait when the door is being knocked on too fast', () => {
    // A short code can be guessed at, so the throttle is reachable by hand in a
    // way a 24-character key never was — and "wrong code" would be a lie here.
    expect(codeRefusal(429)).toMatch(/wait/i)
    expect(codeRefusal(429)).not.toMatch(/not the code/i)
  })

  it('never calls an unreachable station a wrong code', () => {
    // The worst version of this screen: somebody retyping a code that was right
    // all along, because the server happened to be restarting.
    for (const status of [0, 500, 502, 503, 504]) {
      expect(codeRefusal(status), String(status)).not.toMatch(/not the code/i)
      expect(codeRefusal(status), String(status)).toMatch(/did not answer/i)
    }
  })
})
