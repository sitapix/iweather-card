import type { GlyphId } from '../ids.ts';
// A tile's glyph, in its title's colour, in a box 16 high: filled, lines included, for its title's
// added light is clipped to its shapes, and a clip knows only fills. No shape is laid over another,
// since that colour is partly see-through and an overlap would show. A box is as wide as the glyph
// needs, centred on the usual 16, and the ink may run a little past its top and foot, so that the
// header's row keeps its height.
const BOX = 16,
  WIDE = 20;
const glyph = (body: string, width = BOX) =>
  `<svg viewBox="${(BOX - width) / 2} 0 ${width} ${BOX}" overflow="visible" aria-hidden="true">${body}</svg>`;
const solid = (d: string) => `<path fill="currentColor" d="${d}"/>`;
// The sun on the horizon: rises and sets under an arrow up or down.
const horizon = (arrow: string) =>
  glyph(
    solid(
      `M3.6 13A4.4 4.4 0 0 1 12.4 13ZM-1 14.1H17A.7.7 0 0 1 17 15.5H-1A.7.7 0 0 1-1 14.1ZM-.2 11.875L1.6 11.875A.625 .625 0 0 1 1.6 13.125L-.2 13.125A.625 .625 0 0 1 -.2 11.875ZM14.4 11.875L16.2 11.875A.625 .625 0 0 1 16.2 13.125L14.4 13.125A.625 .625 0 0 1 14.4 11.875ZM3.142 8.058L4.442 9.358A.625 .625 0 0 1 3.558 10.242L2.258 8.942A.625 .625 0 0 1 3.142 8.058ZM13.742 8.942L12.442 10.242A.625 .625 0 0 1 11.558 9.358L12.858 8.058A.625 .625 0 0 1 13.742 8.942Z${arrow}`,
    ),
    WIDE,
  );
// Three wavering lines, the top two curling up at their ends and the last one down, which the
// wind's symbol and switch use too, as strokes.
export const WIND_LINES =
  'M.7 5.3C2.2 4.5 4.6 4.5 6.1 5C7.7 5.5 9.75 5.2 9.75 3.2A1.55 1.55 0 0 0 6.7 2.8M.7 7.9C2.6 7.2 4.7 7.5 6.6 8.2C8.8 9 11.2 9.1 13.45 8.6A2.05 2.05 0 1 0 10.99 6.19M.7 11.1C2.2 10.2 4.2 10.1 6 10.5C7.6 10.9 9.8 11.3 9.8 12.6A1.5 1.5 0 1 1 6.85 13';
// The air quality glyph: 19 dots in a hexagon on a hexagonal grid 4.05 apart, about the middle of
// its 16-unit box: five down the middle, four either side of them, three down each edge; the
// outer ring of dots smaller and fainter than the seven inside it. A worse category fills it in.
const DOTS = { middle: 8, reach: 2, gap: 4.05, faint: 0.7 } as const,
  HEX_ACROSS = Math.sqrt(3) / 2;
const AIR_DENSITY = {
  low: { inner: 0.85, outer: 0.6 },
  medium: { inner: 1.3, outer: 0.9 },
  high: { inner: 1.7, outer: 1.25 },
} as const;
type AirDensity = keyof typeof AIR_DENSITY;
const hexDots = ({ inner, outer }: (typeof AIR_DENSITY)[AirDensity]): string[] =>
  Array.from({ length: DOTS.reach * 2 + 1 }, (_, i) => i - DOTS.reach).flatMap(q =>
    Array.from({ length: DOTS.reach * 2 + 1 }, (_, j) => j - DOTS.reach).flatMap(r => {
      const far = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
      return far > DOTS.reach
        ? []
        : [
            `<circle cx="${(DOTS.middle + q * DOTS.gap * HEX_ACROSS).toFixed(2)}" cy="${(DOTS.middle + (r + q / 2) * DOTS.gap).toFixed(2)}" ${far < DOTS.reach ? `r="${inner}"` : `r="${outer}" opacity="${DOTS.faint}"`}/>`,
          ];
    }),
  );
export const airGlyph = (density: AirDensity): string =>
  glyph(`<g fill="currentColor">${hexDots(AIR_DENSITY[density]).join('')}</g>`);
// The cloud and the disc behind it, cut clear of it, the pair's ink a little left of the box's
// middle; and the drop.
const CLOUD = 'M.1 13.7H9.6A3.35 3.35 0 1 0 7.78 7.53A4.2 4.2 0 0 0 -.57 8.38A2.7 2.7 0 0 0 .1 13.7Z',
  DISC = 'M8.11 5.86A3.7 3.7 0 1 1 13.58 9.35A4.1 4.1 0 0 0 8.33 6.45A4.95 4.95 0 0 0 8.11 5.86Z',
  DROP = 'M8 .6C7 2.1 2.8 7 2.8 10.2A5.2 5.2 0 0 0 13.2 10.2C13.2 7 9 2.1 8 .6Z';
export const glyphs: Readonly<Record<GlyphId, string>> = {
  conditions: glyph(solid(CLOUD + DISC)),
  uv: glyph(
    `<circle cx="8" cy="8" r="4.1" fill="currentColor"/>${solid(
      'M8.525 .4L8.525 2.1A.525 .525 0 0 1 7.475 2.1L7.475 .4A.525 .525 0 0 1 8.525 .4ZM8.525 13.9L8.525 15.6A.525 .525 0 0 1 7.475 15.6L7.475 13.9A.525 .525 0 0 1 8.525 13.9ZM.4 7.475L2.1 7.475A.525 .525 0 0 1 2.1 8.525L.4 8.525A.525 .525 0 0 1 .4 7.475ZM13.9 7.475L15.6 7.475A.525 .525 0 0 1 15.6 8.525L13.9 8.525A.525 .525 0 0 1 13.9 7.475ZM2.971 2.229L4.171 3.429A.525 .525 0 0 1 3.429 4.171L2.229 2.971A.525 .525 0 0 1 2.971 2.229ZM12.571 11.829L13.771 13.029A.525 .525 0 0 1 13.029 13.771L11.829 12.571A.525 .525 0 0 1 12.571 11.829ZM2.229 13.029L3.429 11.829A.525 .525 0 0 1 4.171 12.571L2.971 13.771A.525 .525 0 0 1 2.229 13.029ZM11.829 3.429L13.029 2.229A.525 .525 0 0 1 13.771 2.971L12.571 4.171A.525 .525 0 0 1 11.829 3.429Z',
    )}`,
  ),
  sun: horizon(
    'M7.375 7.1L7.375 .8A.625 .625 0 0 1 8.625 .8L8.625 7.1A.625 .625 0 0 1 7.375 7.1ZM5.258 2.658L7.558 .358A.625 .625 0 0 1 8.442 1.242L6.142 3.542A.625 .625 0 0 1 5.258 2.658ZM8.442 .358L10.742 2.658A.625 .625 0 0 1 9.858 3.542L7.558 1.242A.625 .625 0 0 1 8.442 .358Z',
  ),
  sunset: horizon(
    'M8.625 .8L8.625 7.1A.625 .625 0 0 1 7.375 7.1L7.375 .8A.625 .625 0 0 1 8.625 .8ZM6.142 4.358L8.442 6.658A.625 .625 0 0 1 7.558 7.542L5.258 5.242A.625 .625 0 0 1 6.142 4.358ZM7.558 6.658L9.858 4.358A.625 .625 0 0 1 10.742 5.242L8.442 7.542A.625 .625 0 0 1 7.558 6.658Z',
  ),
  wind: glyph(
    solid(
      'M.46 4.86C2.08 4.01 4.68 4.01 6.26 4.53C7.74 5 9.37 4.87 9.25 3.2L9.25 3.2A1.05 1.05 0 0 0 7.19 2.93A.5 .5 0 0 1 6.22 2.67A2.05 2.05 0 0 1 10.25 3.2L10.25 3.2C10.13 5.53 7.66 6 5.95 5.48C4.52 4.99 2.32 4.99 .94 5.74A.5 .5 0 0 1 .46 4.86ZM.53 7.43C2.55 6.7 4.82 7.02 6.77 7.73C8.9 8.51 11.16 8.6 13.34 8.11L13.34 8.11A1.55 1.55 0 1 0 11.48 6.29A.5 .5 0 0 1 10.5 6.09A2.55 2.55 0 1 1 13.56 9.09L13.56 9.09C11.24 9.6 8.7 9.49 6.43 8.67C4.58 7.98 2.65 7.7 .87 8.37A.5 .5 0 0 1 .53 7.43ZM.44 10.67C2.05 9.72 4.24 9.6 6.11 10.01C7.71 10.41 10.18 10.98 10.3 12.6L10.3 12.6A2 2 0 1 1 6.37 13.13A.5 .5 0 0 1 7.34 12.87A1 1 0 1 0 9.3 12.6L9.3 12.6C9.42 11.62 7.49 11.39 5.88 10.99C4.16 10.6 2.35 10.68 .96 11.53A.5 .5 0 0 1 .44 10.67Z',
    ),
  ),
  moon: glyph(solid('M5.8 1.9A6.5 6.5 0 1 0 14.1 10.2 6.3 6.3 0 0 1 5.8 1.9Z')),
  // The drop, solid.
  precipitation: glyph(solid(DROP)),
  // The tube in outline, then the bulb and mercury solid to mid-height, and three ticks at the side.
  feels_like: glyph(
    solid(
      'M4.4 10.4L4.4 2A2.2 2.2 0 0 1 8.8 2L8.8 10.4A.6 .6 0 0 1 7.6 10.4L7.6 2A1 1 0 0 0 5.6 2L5.6 10.4A.6 .6 0 0 1 4.4 10.4ZM8.537 9.903A3.45 3.45 0 1 1 4.663 9.903A.6 .6 0 0 1 5.337 10.897A2.25 2.25 0 1 0 7.863 10.897A.6 .6 0 0 1 8.537 9.903ZM6 7.2A.6.6 0 0 1 7.2 7.2V11.2A1.7 1.7 0 1 1 6 11.2ZM10.5 1.925L12.3 1.925A.475 .475 0 0 1 12.3 2.875L10.5 2.875A.475 .475 0 0 1 10.5 1.925ZM10.5 4.425L12.3 4.425A.475 .475 0 0 1 12.3 5.375L10.5 5.375A.475 .475 0 0 1 10.5 4.425ZM10.5 6.925L12.3 6.925A.475 .475 0 0 1 12.3 7.875L10.5 7.875A.475 .475 0 0 1 10.5 6.925Z',
    ),
  ),
  // Three wavy lines, cut short by a solid drop low on the right.
  humidity: glyph(
    solid(
      'M-.16 4.04C.878 3.003 2.028 2.505 3.087 2.463C4.145 2.421 5.252 2.799 6.291 3.319C7.234 3.79 8.058 4.017 9.015 3.928C9.992 3.837 10.972 3.432 12.204 2.485A.65 .65 0 0 1 12.996 3.515C11.628 4.568 10.308 5.113 9.135 5.222C7.942 5.333 6.766 5.01 5.709 4.481C4.748 4.001 3.955 3.729 3.138 3.762C2.322 3.795 1.622 4.097 .76 4.96A.65 .65 0 0 1 -.16 4.04ZM-.16 7.54C.878 6.503 2.028 6.005 3.087 5.963C4.145 5.921 5.252 6.299 6.291 6.819C7.257 7.302 7.673 7.453 8.042 7.463C8.372 7.471 8.66 7.345 9.381 7.088A.65 .65 0 0 1 9.819 8.312C9.14 8.555 8.628 8.779 8.008 8.762C7.427 8.747 6.743 8.498 5.709 7.981C4.748 7.501 3.955 7.229 3.138 7.262C2.322 7.295 1.622 7.597 .76 8.46A.65 .65 0 0 1 -.16 7.54ZM-.16 11.04C.878 10.003 2.028 9.505 3.087 9.463C4.145 9.421 5.252 9.799 6.291 10.319C6.696 10.498 7.029 10.623 7.352 10.688C7.664 10.75 7.859 10.75 8.121 10.675A.65 .65 0 0 1 8.479 11.925C8.041 12.05 7.536 12.05 7.098 11.962C6.671 11.877 6.204 11.702 5.736 11.494C4.748 11.001 3.955 10.729 3.138 10.762C2.322 10.795 1.622 11.097 .76 11.96A.65 .65 0 0 1 -.16 11.04ZM12.9 5.8C12.4 6.7 9.8 9.7 9.8 11.9A3.05 3.05 0 0 0 15.9 11.9C15.9 9.7 13.4 6.7 12.9 5.8Z',
    ),
  ),
  // A solid almond, with a ring cut out of it round the pupil.
  visibility: glyph(
    solid(
      'M-2 8C.2 3.8 3.9 1.7 8 1.7S15.8 3.8 18 8C15.8 12.2 12.1 14.3 8 14.3S.2 12.2-2 8ZM8 4.2A3.8 3.8 0 1 0 8 11.8A3.8 3.8 0 1 0 8 4.2ZM8 6.5A1.5 1.5 0 1 1 8 9.5A1.5 1.5 0 1 1 8 6.5Z',
    ),
    WIDE,
  ),
  // A full circle, dots round its top, and a needle up from the middle.
  pressure: glyph(
    `${solid(
      'M8 .6A7.4 7.4 0 1 1 8 15.4A7.4 7.4 0 1 1 8 .6ZM8 2A6 6 0 1 0 8 14A6 6 0 1 0 8 2ZM7.15 10.1 7.6 5.6H8.4L8.85 10.1A.85.85 0 0 1 7.15 10.1Z',
    )}<g fill="currentColor"><circle cx="8" cy="3.7" r=".7"/><circle cx="5.8" cy="4.3" r=".7"/><circle cx="10.2" cy="4.3" r=".7"/><circle cx="4.2" cy="5.9" r=".7"/><circle cx="11.8" cy="5.9" r=".7"/></g>`,
  ),
  // The umbrella the precipitation map goes by: a canopy half a disc, its hem three even scallops and
  // a short tip standing on its crown, over a handle that hooks at its foot.
  map: glyph(
    solid(
      'M.61 8.6A7.39 7.39 0 0 1 15.39 8.6A3.21 3.21 0 0 0 10.47 8.6A3.21 3.21 0 0 0 5.53 8.6A3.21 3.21 0 0 0 .61 8.6ZM7.29 2.02V.23A.71 .71 0 0 1 8.71 .23V2.02ZM8.71 6.91L8.71 14.2A2.39 2.39 0 0 1 3.92 14.2A.71 .71 0 0 1 5.34 14.2A.98 .98 0 0 0 7.29 14.2L7.29 6.91Z',
    ),
  ),
  // L-shaped axes, and a rising line ending in an arrowhead.
  averages: glyph(
    solid(
      'M1 1.3L1 14.45A.55 .55 0 0 1 -.1 14.45L-.1 1.3A.55 .55 0 0 1 1 1.3ZM.45 13.9L15.6 13.9A.55 .55 0 0 1 15.6 15L.45 15A.55 .55 0 0 1 .45 13.9ZM2.578 10.747L5.678 7.047A.55 .55 0 0 1 6.522 7.753L3.422 11.453A.55 .55 0 0 1 2.578 10.747ZM6.442 6.969L9.342 9.269A.55 .55 0 0 1 8.658 10.131L5.758 7.831A.55 .55 0 0 1 6.442 6.969ZM8.58 9.345L11.88 5.445A.55 .55 0 0 1 12.72 6.155L9.42 10.055A.55 .55 0 0 1 8.58 9.345ZM15.9 1.9 15.2 7.1 10.8 3.2Z',
    ),
  ),
  air_quality: airGlyph('medium'),
  // A ring with the hands at nine.
  clock: glyph(
    solid(
      'M8 .6A7.4 7.4 0 1 1 8 15.4A7.4 7.4 0 1 1 8 .6ZM8 1.8A6.2 6.2 0 1 0 8 14.2A6.2 6.2 0 1 0 8 1.8ZM7.4 3.9A.6 .6 0 0 1 8.6 3.9L8.6 8A.6 .6 0 0 1 8 8.6L4.9 8.6A.6 .6 0 0 1 4.9 7.4L7.4 7.4Z',
    ),
  ),
};
// The forecast switch's symbols. The conditions' disc and the drop are parts of their own, so the
// view shown can colour them (see the styles).
export const modeGlyphs = {
  conditions: glyph(`${solid(CLOUD)}<path class="mode-sun" fill="currentColor" d="${DISC}"/>`),
  rain: glyph(`<path class="mode-drop" fill="currentColor" d="${DROP}"/>`),
  wind: glyphs.wind,
} as const;
