# Midjourney prompts: poster revamp

The image assets for the poster revamp in Figma (page **revamp — poster**). Every
grey crossed box in that page is an `Asset slot` whose label starts with an id
such as `MJ-01`. Each id matches a prompt below. Generate the image, drop it in
as the slot's fill, and keep the slot's size.

## The look we are after

A small, real room that broadcasts to the internet, recorded the way a 1970s–90s
poster or zine would have recorded it. That means:

- **Photographs:** documentary and candid. On-camera flash or warm practical light,
  35mm film grain, slightly imperfect framing. People mid-gesture, never posing.
  Lot Radio's booth photos are the reference for honesty, not for decoration.
- **Print artefacts:** risograph two-colour printing, halftone dots, photocopier
  toner, newsprint, paper folds, tape.
- **Palette:** ink black `#111110`, newsprint `#E9E5DA`, bone `#D6D0C1`, riso blue
  `#3255A4`, fluorescent pink `#FF48B0`. Red `#FB2C36` is only ever "on air", so
  keep it out of the images.
- **Never:** glossy 3D renders, neon gradients, cyberpunk, stock-photo smiles, or
  text inside the image. Midjourney spells badly, so every word on the page is
  set in Figma.

## How to keep the set consistent

1. Generate **MJ-01** first and pick the strongest image.
2. Use that image as a style reference for everything else: add
   `--sref <url-of-MJ-01>` to each prompt below.
3. Keep `--style raw` on. It stops Midjourney from making the images glossy.
4. Upscale the chosen image, then export at 2× the slot size.

All prompts are written for Midjourney v7.

---

### MJ-01 · The room, hero

Slot: landing hero, 1440×760 on desktop and a 390×520 crop on phones.

```
candid documentary photograph of a tiny home radio studio at night, a DJ in a worn t-shirt leaning over two turntables and a small mixer, three friends squeezed onto a couch behind with headphones around their necks, shelves of vinyl records, gig posters and torn flyers taped to the walls, a small lamp and on-camera flash, 35mm film, Kodak Portra 800, heavy grain, slightly tilted framing, warm shadows, authentic, unposed, late 1990s zine photography --ar 19:10 --style raw --v 7 --s 150 --no text, letters, logo, watermark, neon
```

Phone crop: rerun with `--ar 3:4` and keep the DJ in the middle third.

### MJ-02 · The deck

Slot: station screen, top of the left column, 376×300.

```
overhead flash photograph of a well-used turntable and two-channel mixer on a wooden table, a record mid-spin with a plain cream centre label, slipmat with scuffs, a coffee ring, a handwritten setlist on torn paper beside it (illegible), cables, 35mm film grain, high contrast, documentary, 1990s --ar 5:4 --style raw --v 7 --s 100 --no text, letters, logo, watermark
```

### MJ-03 · Newsprint texture (background)

Slot: optional overlay on the newsprint and bone bands, tiled at 30–40% opacity.

```
flat scan of old newsprint paper, off-white, faint fold creases, subtle toner speckle, very fine halftone dots barely visible, even lighting, seamless tileable texture, no content --ar 1:1 --tile --style raw --v 7 --s 50 --no text, letters, images, stains
```

### MJ-04a–d · Session covers

Slot: archive cards, 296×200. Make one per session; change only the subject line.

```
two-colour risograph print, riso blue and fluorescent pink on newsprint paper, misregistered layers, halftone photograph of [SUBJECT], bold cut-paper shapes, grain and ink speckle, 1970s concert poster composition, generous empty space at top for type --ar 3:2 --style raw --v 7 --s 200 --no text, letters, logo, watermark
```

| Id | `[SUBJECT]` |
|---|---|
| MJ-04a · Late-night soul | a hand lowering a needle onto a record |
| MJ-04b · Sunday slow jams | two people dancing slowly in a kitchen |
| MJ-04c · Amapiano after dark | a crowd's raised hands under a single bulb |
| MJ-04d · Records from home | a stack of old vinyl sleeves on a chair |

### MJ-05 · Host portrait

Slot: hosts band, 360×440 on desktop and 358×300 on phones. One portrait per host.
The landing page shows one at a time.

```
black and white photocopied portrait of a young [HOST DESCRIPTION] wearing headphones around the neck, looking off-camera mid-laugh, harsh direct flash, xerox toner texture, crushed blacks, grainy, slight blur, zine aesthetic, plain wall behind --ar 4:5 --style raw --v 7 --s 120 --no text, letters, colour
```

If you have real photos of the hosts, use them. Run them through the same
treatment (black and white, high contrast, photocopy grain) and skip this prompt.

### MJ-06 · Social and OG image

Slot: `client/public/og.png` (1200×630) and the 1080×1350 session poster
background in `server/src/lib/poster.ts`.

```
risograph print poster background, riso blue on newsprint, halftone close-up of a spinning vinyl record seen from the side, strong diagonal composition, large empty area on the left for headline type, ink speckle and misregistration --ar 40:21 --style raw --v 7 --s 200 --no text, letters, logo
```

For the 1080×1350 poster, rerun with `--ar 4:5`.

### MJ-07 · Sticker sheet

Slot: landing manifesto band, 360×360, placed at an angle of −4°.

```
sheet of die-cut vinyl stickers on a white backing, retro radio station motifs: an on-air lamp, a cassette tape, a vinyl record, a pointing hand, a lightning bolt, a star, a pair of headphones, a microphone, printed in riso blue, fluorescent pink and black on cream, thick white borders, slightly peeling corners, flat lay, even light --ar 1:1 --style raw --v 7 --s 250 --no text, letters, words, logo
```

Cut individual stickers out in Figma or Photoshop so they can be scattered as
separate layers, the way Lot Radio scatters its sticker wall.

### MJ-08 · Off air

Slot: replaces MJ-01 in the hero when the station is off air.

```
the same tiny home radio studio, empty, lights off except a desk lamp, turntable lid closed, headphones hung on the mic stand, a chair pushed back, blue hour light through a window, 35mm film grain, quiet, documentary --ar 19:10 --style raw --v 7 --s 120 --no text, people, neon
```

### MJ-09 · Halftone grain overlay

Slot: optional overlay for MJ-01, MJ-02 and MJ-05 to unify them, set to multiply
at 15–25%.

```
seamless halftone dot and film grain overlay, mid-grey on white, uneven ink density, photocopier noise --ar 1:1 --tile --style raw --v 7 --s 0 --no text, shapes
```

---

## Not Midjourney

Make these in Figma, because they contain type:

- The wordmark `CHUNKY.FM` (Big Shoulders Display Black), favicon, and
  `apple-touch-icon.png`.
- The ticker, buttons, tags and everything else on the page.
