<!-- SPDX-FileCopyrightText: Ruben Talstra -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# eduLIMS brand

The eduLIMS mark, wordmark, palette and raster icons. All of it is under the
Apache License 2.0 with the rest of the repository.

## The mark

The mark is a corner of a 96-well microplate: twelve wells in four columns and
three rows on a rounded indigo tile. One well, in the third column of the
middle row, is filled amber and drawn slightly larger: that is the sample. The
plate is the one the BioTek Epoch 2 reads in the practicals, and a grid of
wells also reads as a grid of data, which is what a LIMS keeps.

The geometry sits on a 32-unit grid: wells 4 units across with 2-unit gaps,
centred on the tile, so the mark is pixel-exact at 32 px. The 48-unit icon
files are the same drawing at 1.5 times. The sample well has a radius of 2.6
units against 2 for the others.

At 16 px a round 2-pixel well blurs into its neighbours, so `favicon-16.png`
(and the 16 px entry of `favicon.ico`) is drawn on its own 16-pixel grid: the
same 4 by 3 plate with square 2-pixel wells and 1-pixel gaps, and the sample
the same size as the other wells, told apart by colour only. Four 2-pixel
wells with 1-pixel gaps span 11 pixels, so the plate sits 2 pixels from the
left edge and 3 from the right. Every other file uses the round wells.

## Palette

| Token | Hex | Use |
|---|---|---|
| indigo | `#3730a3` | the tile, brand text on light |
| indigo-light | `#a5b4fc` | the tile's rim on dark, brand text on dark |
| well | `#8b8bd6` | the eleven empty wells |
| amber | `#fbbf24` | the sample well, highlights on dark |
| amber-deep | `#d97706` | the sample well of the glyph on light |
| ink | `#0f172a` | text on light |
| mist | `#f1f5f9` | text on dark |
| night | `#0b1220` | dark background |
| surface | `#f8fafc` | light background |

The values live in `tokens.css` as custom properties, with roles
(`--edulims-brand`, `--edulims-accent`, `--edulims-brand-text`, `--edulims-fg`,
`--edulims-bg`) that switch for `prefers-color-scheme: dark`.

The well colour is solid. It is the colour a 42% light-indigo wash over the
tile gives, lifted until it reaches 3:1 against the tile, so the mark renders
the same in every viewer and on every background.

## Contrast

WCAG 2.1 asks **4.5:1** for body text and **3:1** for a graphical object or
large text ([SC 1.4.3](https://www.w3.org/TR/WCAG21/#contrast-minimum),
[SC 1.4.11](https://www.w3.org/TR/WCAG21/#non-text-contrast)). Every token is
measured against the three grounds the palette draws on: the light surface,
the dark background and the indigo tile. "Graphics" in the last column means
the mark, a rule or an icon, never a label.

| Token | Value | On #f8fafc | On #0b1220 | On #3730a3 | Safe for |
|---|---|---|---|---|---|
| `--edulims-indigo` | `#3730a3` | 9.49 | 1.88 | 1.00 | light: text, dark: neither, tile: neither |
| `--edulims-indigo-light` | `#a5b4fc` | 1.91 | 9.39 | 4.98 | light: neither, dark: text, tile: text |
| `--edulims-well` | `#8b8bd6` | 2.97 | 6.03 | 3.20 | light: neither, dark: text, tile: graphics |
| `--edulims-amber` | `#fbbf24` | 1.60 | 11.22 | 5.95 | light: neither, dark: text, tile: text |
| `--edulims-amber-deep` | `#d97706` | 3.04 | 5.88 | 3.12 | light: graphics, dark: text, tile: graphics |
| `--edulims-ink` | `#0f172a` | 17.06 | 1.05 | 1.80 | light: text, dark: neither, tile: neither |
| `--edulims-mist` | `#f1f5f9` | 1.05 | 17.09 | 9.07 | light: neither, dark: text, tile: text |
| `--edulims-night` | `#0b1220` | 17.89 | 1.00 | 1.88 | light: text, dark: neither, tile: neither |
| `--edulims-surface` | `#f8fafc` | 1.00 | 17.89 | 9.49 | light: neither, dark: text, tile: text |
| `--edulims-chart-light-1` | `#3730a3` | 9.49 | 1.88 | 1.00 | light: text, dark: neither, tile: neither |
| `--edulims-chart-light-2` | `#b45309` | 4.80 | 3.73 | 1.98 | light: text, dark: graphics, tile: neither |
| `--edulims-chart-light-3` | `#0f766e` | 5.23 | 3.42 | 1.81 | light: text, dark: graphics, tile: neither |
| `--edulims-chart-light-4` | `#be185d` | 5.77 | 3.10 | 1.65 | light: text, dark: graphics, tile: neither |
| `--edulims-chart-light-5` | `#4d7c0f` | 4.77 | 3.75 | 1.99 | light: text, dark: graphics, tile: neither |
| `--edulims-chart-light-6` | `#0369a1` | 5.67 | 3.16 | 1.67 | light: text, dark: graphics, tile: neither |
| `--edulims-chart-dark-1` | `#a5b4fc` | 1.91 | 9.39 | 4.98 | light: neither, dark: text, tile: text |
| `--edulims-chart-dark-2` | `#fbbf24` | 1.60 | 11.22 | 5.95 | light: neither, dark: text, tile: text |
| `--edulims-chart-dark-3` | `#2dd4bf` | 1.78 | 10.06 | 5.34 | light: neither, dark: text, tile: text |
| `--edulims-chart-dark-4` | `#f472b6` | 2.53 | 7.07 | 3.75 | light: neither, dark: text, tile: graphics |
| `--edulims-chart-dark-5` | `#a3e635` | 1.44 | 12.42 | 6.59 | light: neither, dark: text, tile: text |
| `--edulims-chart-dark-6` | `#38bdf8` | 2.05 | 8.74 | 4.64 | light: neither, dark: text, tile: text |

What the table decides:

- **The tile needs a rim on dark.** Indigo reaches 9.49:1 on the light surface
  and only 1.88:1 on the dark background, under the 3:1 a graphic needs.
  `edulims-icon-dark.svg` and the dark lockup draw a 1-unit `indigo-light` rim
  inside the tile edge (9.39:1 on dark), so the tile keeps its outline there.
- **The wells are drawn on the tile only.** The well colour reaches 3.20:1 on
  the tile and misses 3:1 on the light surface by a hair, so it is never used
  on its own on a light page.
- **Amber is never text on light.** At 1.60:1 it fails even the graphics
  threshold on the light surface. The glyph, which has no tile, uses
  `amber-deep` (3.04:1) for the sample on light and amber on dark. Neither
  amber is a text colour on light.
- **The application theme** uses indigo as its primary colour with white
  button text (9.93:1) and keeps its neutral greys for everything else. The
  documentation site uses indigo as the Starlight accent (`#3730a3` on light,
  `#c7d2fe` on dark).

`scripts/checks/brand-contrast.sh` measures the values in `tokens.css` and
fails when a token's `safe:` comment or a row of this table stops matching
what it measures; `--table` prints the table, `--self-test` proves the check
refuses a false claim. The same script measures the theme's `--destructive`
in `src/styles/app.css` as a label on its own tints (the shadcn button and
badge) over the page, card, popover and muted surfaces, in light and dark, and
fails below 4.5:1. The `brand` CI job runs both on every change, and
checks that the icons the application and the documentation site serve are
byte-identical to the ones here.

## Chart palette

Charts draw their series in six categorical colours per scheme, the
`--edulims-chart-light-*` set on the light surface and the
`--edulims-chart-dark-*` set on the dark background. The light set starts at
the brand indigo and the dark set at the light indigo and the amber, and the
other hues are spread around the wheel so neighbouring series differ in hue as
well as lightness. Every one reaches at least 4.5:1 on its own ground (the
rows above), more than the 3:1 a graphical object needs
([SC 1.4.11](https://www.w3.org/TR/WCAG21/#non-text-contrast)), so a series
also stays readable as a thin line or a small point. `brand-contrast.sh`
fails when a chart colour drops under 3:1 on the ground it is drawn on.

Colour is never the only signal: every chart also tells its series apart by
shape or label, and every chart can be read as a table
(`src/components/charts/`). The application maps the two sets onto the theme
tokens `--chart-1` to `--chart-6` in `src/styles/app.css`.

## Files

| File | What it is |
|---|---|
| `edulims-icon.svg` | the mark: the plate on the indigo tile |
| `edulims-icon-dark.svg` | the mark with an `indigo-light` rim, for dark backgrounds |
| `edulims-icon-mono.svg` | one colour (`currentColor`): the wells cut out of the tile, the sample a filled dot in its cut-out |
| `edulims-glyph.svg` | the plate without the tile, for places that supply their own background; follows `prefers-color-scheme` |
| `edulims-lockup-light.svg` | the mark and the wordmark for light backgrounds |
| `edulims-lockup-dark.svg` | the lockup for dark backgrounds |
| `edulims-lockup-auto.svg` | the lockup that follows `prefers-color-scheme` |
| `favicon.svg` | the mark on the 32-unit grid, for browser tabs |
| `favicon.ico` | 16, 32 and 48 px in one file |
| `favicon-16.png`, `favicon-32.png` | raster favicons; the 16 px one is the pixel-grid drawing |
| `apple-touch-icon.png` | 180 px, square and full-bleed (iOS rounds the corners itself) |
| `icon-192.png`, `icon-512.png` | the web app manifest icons |
| `edulims-social.svg`, `edulims-social.png` | the 1280 by 640 GitHub social preview |
| `tokens.css` | the palette and roles as CSS custom properties |

The application serves copies of the favicons and manifest icons from
`public/`, and the documentation site from `website/public/`.

## The wordmark

"edu" is set in Space Grotesk Regular (400) and "LIMS" in Space Grotesk Bold
(700), at a cap height of 22.4 units beside the 48-unit tile, in `ink` and
`indigo` on light and in `mist` and `indigo-light` on dark. The letters are
outlined to paths, so no SVG here needs the font. The outlines come from Space
Grotesk version 2.000 (the `@fontsource/space-grotesk` 5.3.0 package), by the
Space Grotesk Project Authors, under the SIL Open Font License 1.1. The OFL
covers the font software; artwork made with it, such as these outlines, is
not font software, so the files stay Apache-2.0. Set the wordmark from these
files and never retype it in another typeface.

## Clear space and minimum size

- Keep clear space around the mark equal to the well pitch: one well plus one
  gap (6 units on the 32-unit grid, 3/16 of the tile's width). The lockup
  keeps two of those between the tile and the wordmark.
- The mark reads down to 16 px with the pixel-grid favicon; use
  `favicon-16.png` or `favicon.ico` at that size, never the round-well SVG.
- The lockup reads down to 24 px high. Below that, use the mark alone.

## Do not

- Recolour the mark outside the palette, or put the light tile on a dark
  background without its rim.
- Add or remove wells, move the sample, or change its colour.
- Stretch, rotate, outline or shadow the mark, or set it on a busy photograph.
- Retype the wordmark, change its weights, or put a space between "edu" and
  "LIMS".
- Use translucent wells: the solid well colour is what keeps the mark the same
  everywhere.

## Intrinsic size

The square icons carry a natural size of 512 by 512, so a consumer that
rasterizes an SVG with no size of its own (a package registry, an icon cache)
gets a sharp bitmap. `favicon.svg` keeps 32 by 32, because a browser tab asks
for a small icon. The lockups keep their drawn aspect (193 by 48) and scale by
one dimension.

## Regenerating the rasters

The PNG files are the SVGs rendered with Playwright's Chromium (the
`@playwright/test` dev dependency) at their listed size, on a transparent
background: `favicon-32.png` from `favicon.svg`, `icon-192.png`,
`icon-512.png` and the 48 px ICO entry from `edulims-icon.svg`, and
`edulims-social.png` from `edulims-social.svg`. `favicon-16.png` and
`apple-touch-icon.png` come from their own drawings, described above.
`favicon.ico` packs the 16, 32 and 48 px PNGs as PNG-compressed entries.
