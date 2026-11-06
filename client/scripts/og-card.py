#!/usr/bin/env python3
"""The card a link turns into when somebody pastes it into a chat.

This station spreads person to person: somebody says "you should be on this at
nine" and sends the address. That preview is the first impression far more often
than any search result will ever be, and until this existed it was a grey
rectangle with a hostname in it.

Drawn rather than screenshotted, and the difference matters. A screenshot of the
station is a dark player at card size, which is illegible: unfurls render around
five hundred pixels wide in most clients and smaller on a phone. So this is the
wordmark, one sentence, and the on-air lamp — three things that survive being
made small, because they are the three things somebody needs to decide whether
to tap.

The face is a stand-in. The real one is Space Grotesk, vendored as woff2 for the
browser, which Pillow cannot read and which is not worth a build-time conversion
for one image. Lato is the closest thing likely to be installed; the fallbacks
below are what to try after it. If the card ever stops looking like the station,
this is the line that is lying.

    python3 scripts/og-card.py       # or: npm run assets:og

Writes public/og.png (1200x630) and public/apple-touch-icon.png (180x180).
"""

from pathlib import Path

from PIL import Image, ImageColor, ImageDraw, ImageFont

# The station's own values, from src/tokens.css. Nothing here invents a colour.
BG = "#0a0a0a"
FG = "#ffffff"
DIM = "#d4d4d4"
LIVE = "#fb2c36"
RAISED = "#1c1c1c"

# What every unfurler asks for. Not a guess: Facebook, Slack, Discord, iMessage
# and X all crop to roughly 1.91:1, and anything else gets letterboxed or cut.
WIDTH, HEIGHT = 1200, 630

FACES = [
    "/usr/share/fonts/truetype/lato/Lato-{w}.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans{dash}{w}.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-{w}.ttf",
]

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"


def face(weight: str, size: int) -> ImageFont.FreeTypeFont:
    """The heaviest thing that will load, at this size."""
    for pattern in FACES:
        path = pattern.format(w=weight, dash="-" if weight != "Regular" else "")
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    # Pillow's built-in bitmap face, which is unreadable at this size and is
    # here so the script fails visibly rather than by raising in a build.
    print(f"  ! no system face for {weight}; the card will look wrong")
    return ImageFont.load_default()


def wrap(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, width: int) -> list[str]:
    """Greedy wrap. The sentence is fixed and short; this is not a typesetter."""
    lines: list[str] = []
    line = ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if draw.textlength(trial, font=font) <= width:
            line = trial
        else:
            if line:
                lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


# The poster revamp's values, from the "poster" block of src/tokens.css.
INK = "#111110"
PRESS = "#3255a4"

FONTS = ROOT / "src" / "assets" / "fonts"
# MJ-06a, the riso record with an empty left half for the type. Kept as a
# source file rather than in public/, because only this card is published.
BACKDROP = ROOT / "assets-src" / "poster" / "mj-06a-og.jpg"


def poster_face(file: str, size: int, style: str | None = None) -> ImageFont.FreeTypeFont:
    """The page's own faces. FreeType reads the vendored woff2 directly."""
    font = ImageFont.truetype(str(FONTS / file), size)
    if style:
        font.set_variation_by_name(style)
    return font


def card() -> Image.Image:
    """The link preview, printed like the poster: type on the riso record."""
    image = Image.open(BACKDROP).convert("RGB").resize((WIDTH, HEIGHT), Image.LANCZOS)
    draw = ImageDraw.Draw(image)

    margin = 72

    # The on-air lamp: still the only red, as on the page.
    lamp_y = margin + 4
    draw.ellipse([margin, lamp_y, margin + 18, lamp_y + 18], fill=LIVE)
    label = poster_face("Cousine-700.woff2", 24)
    draw.text((margin + 32, lamp_y - 4), "LIVE RADIO", font=label, fill=INK)

    # The wordmark, in the display face at its heaviest.
    mark = poster_face("BigShouldersDisplay.woff2", 168, "Black")
    draw.text((margin, 128), "CHUNKY.FM", font=mark, fill=INK)

    # The sentence: the page's description and its first line of prose.
    body = poster_face("SpaceGrotesk.woff2", 38, "Medium")
    y = 336
    for line in wrap(draw, "Everyone hears the same second of the same song.", body, 500):
        draw.text((margin, y), line, font=body, fill=INK)
        y += 50

    # Nothing along the bottom: the record runs off that edge, and type over
    # it would be blue on blue.
    return image


def printed(image: Image.Image) -> Image.Image:
    """The card in a palette: 1.4 MB as full colour, about a third as this.

    Two inks on paper lose nothing to a palette. A palette chosen from the whole
    card would drop the lamp, which is a few hundred pixels of the only red, so
    the backdrop's own colours are taken first and then ramps from the paper
    to each colour the type is drawn in, for its anti-aliased edges.
    """
    base = image.quantize(colors=200, method=Image.Quantize.MEDIANCUT)
    colours = base.getpalette()[: 200 * 3]
    paper = image.getpixel((WIDTH // 4, HEIGHT - 40))
    for ink in (INK, LIVE):
        target = ImageColor.getrgb(ink)
        for step in range(1, 19):
            t = step / 18
            colours += [round(p + (c - p) * t) for p, c in zip(paper, target)]
    palette = Image.new("P", (1, 1))
    palette.putpalette(colours + [0] * (768 - len(colours)))
    return image.quantize(palette=palette, dither=Image.Dither.NONE)


def touch_icon() -> Image.Image:
    """The square one, for a phone that saves the station to a home screen."""
    size = 180
    image = Image.new("RGB", (size, size), BG)
    draw = ImageDraw.Draw(image)
    mark = face("Black", 96)
    text = "c"
    width = draw.textlength(text, font=mark)
    draw.text(((size - width) / 2, 28), text, font=mark, fill=FG)
    draw.ellipse([size / 2 - 9, size - 44, size / 2 + 9, size - 26], fill=LIVE)
    return image


def main() -> None:
    PUBLIC.mkdir(exist_ok=True)
    out = PUBLIC / "og.png"
    printed(card()).save(out, "PNG", optimize=True)
    print(f"  {out.relative_to(ROOT)}  {out.stat().st_size // 1024} kB")

    icon = PUBLIC / "apple-touch-icon.png"
    touch_icon().save(icon, "PNG", optimize=True)
    print(f"  {icon.relative_to(ROOT)}  {icon.stat().st_size // 1024} kB")


if __name__ == "__main__":
    main()
