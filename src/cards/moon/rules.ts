import { MOON_PHASE, moonAltitude, moonPhase } from '../../sky/sky.ts';
import { MINUTE, DAY, SECOND } from '../../lib/time.ts';
import { finite } from '../../lib/values.ts';
import { phrase } from '../../weather/words.ts';
// The header symbol stands for the phase's name, not the moment, as the title does: a ringed disc
// with its lit part filled and its dark part filled at a quarter, bright limb right while waxing in
// the north. A crescent's lit edge is the disc's own edge moved 0.659 of its radius toward the dark
// side, which lights a third of the way across; a gibbous moon's is that edge moved the other way,
// and a quarter's runs straight down the middle. The ring and the lit part are one shape with the
// dark part cut from it, so no line shows between them. Every part is a fill, as every tile's
// glyph is.
type GlyphShape = 'new' | 'crescent' | 'quarter' | 'gibbous' | 'full';
const GLYPH = { middle: 8, outer: 7.775, inner: 6.475, shift: 0.659 } as const,
  GLYPH_DIGITS = 3,
  DARK_SHARE = 0.25;
const glyphAt = (value: number) => +value.toFixed(GLYPH_DIGITS);
const { middle: MIDDLE, outer: OUTER, inner: INNER } = GLYPH,
  INNER_TOP = glyphAt(MIDDLE - INNER),
  INNER_FOOT = glyphAt(MIDDLE + INNER);
// The disc, drawn clockwise.
const DISC = `M${MIDDLE} ${glyphAt(MIDDLE - OUTER)}A${OUTER} ${OUTER} 0 1 1 ${MIDDLE} ${glyphAt(MIDDLE + OUTER)}A${OUTER} ${OUTER} 0 1 1 ${MIDDLE} ${glyphAt(MIDDLE - OUTER)}Z`;
// The dark part, on the right (`side` 1) or the left (-1), wound against the disc so that it is cut
// from it: down its left and up its right.
function darkPart(shape: Exclude<GlyphShape, 'full'>, side: 1 | -1): string {
  if (shape === 'new')
    return `M${MIDDLE} ${INNER_TOP}A${INNER} ${INNER} 0 1 0 ${MIDDLE} ${INNER_FOOT}A${INNER} ${INNER} 0 1 0 ${MIDDLE} ${INNER_TOP}Z`;
  if (shape === 'quarter')
    return side > 0
      ? `M${MIDDLE} ${INNER_TOP}V${INNER_FOOT}A${INNER} ${INNER} 0 0 0 ${MIDDLE} ${INNER_TOP}Z`
      : `M${MIDDLE} ${INNER_TOP}A${INNER} ${INNER} 0 0 0 ${MIDDLE} ${INNER_FOOT}V${INNER_TOP}Z`;
  // The lit edge's circle stands toward the dark side for a crescent and away from it for a gibbous
  // moon, and meets the ring's inside a little past the poles, on its own side.
  const crescent = shape === 'crescent',
    shift = GLYPH.shift * OUTER,
    across = (INNER ** 2 - OUTER ** 2 + shift ** 2) / (2 * shift),
    tip = Math.sqrt(INNER ** 2 - across ** 2),
    x = glyphAt(MIDDLE + (crescent ? side : -side) * across),
    up = glyphAt(MIDDLE - tip),
    down = glyphAt(MIDDLE + tip),
    edge = `A${OUTER} ${OUTER} 0 0 ${crescent ? 0 : 1}`,
    ring = `A${INNER} ${INNER} 0 ${crescent ? 0 : 1} 0`;
  return side > 0
    ? `M${x} ${up}${edge} ${x} ${down}${ring} ${x} ${up}Z`
    : `M${x} ${up}${ring} ${x} ${down}${edge} ${x} ${up}Z`;
}
function glyphShape(phase: number): GlyphShape {
  const row = moonPhaseRow(phase);
  if (!row) return 'new';
  const [, , , shape] = row;
  return shape;
}
export function moonGlyph(phase: number, south = false): string {
  const shape = glyphShape(phase),
    dark = shape === 'full' ? '' : darkPart(shape, phase < MOON_PHASE.full === south ? 1 : -1);
  return `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="${DISC}${dark}"/>${dark ? `<path fill="currentColor" opacity="${DARK_SHARE}" d="${dark}"/>` : ''}</svg>`;
}

// Rise and set are when the Moon's centre is 0.125° above the geometric horizon: its
// parallax less refraction and its radius. Ten-minute steps over two days find the crossing;
// halving narrows it to 15 seconds. `rise` picks the next rising, else the next setting.
const MOON_HORIZON = 0.125;
const CROSSING = { step: 10 * MINUTE, span: 2 * DAY, within: 15 * SECOND } as const;
function moonCrossing(
  now: number,
  latitude: number | undefined,
  longitude: number | undefined,
  rise: boolean,
): number | null {
  const above = (time: number) => {
    const altitude = moonAltitude(time, latitude, longitude);
    return altitude !== undefined && altitude > MOON_HORIZON;
  };
  let state = above(now);
  for (let time = now + CROSSING.step; time < now + CROSSING.span; time += CROSSING.step) {
    const next = above(time);
    if (next === state) continue;
    state = next;
    if (next !== rise) continue;
    let low = time - CROSSING.step,
      high = time;
    while (high - low > CROSSING.within) {
      const middle = (low + high) / 2;
      if (above(middle) === next) high = middle;
      else low = middle;
    }
    return high;
  }
  return null;
}
export function moonTimes(
  now: number,
  latitude: number | undefined,
  longitude: number | undefined,
): { rise: number | null; set: number | null } {
  if (!finite(moonAltitude(now, latitude, longitude))) return { rise: null, set: null };
  return { rise: moonCrossing(now, latitude, longitude, true), set: moonCrossing(now, latitude, longitude, false) };
}
// The phases' names, each up to its end as a share of the cycle: new, full and the quarters
// hold about a day either side. Each is written as a tile's title and as a sheet's, as capitals
// don't work the same way in every language. Each has the shape of its symbol.
const MOON_NAMES: readonly (readonly [below: number, name: string, heading: string, shape: GlyphShape])[] = [
  [0.03, phrase('New moon'), phrase('New Moon'), 'new'],
  [0.22, phrase('Waxing crescent'), phrase('Waxing Crescent'), 'crescent'],
  [0.28, phrase('First quarter'), phrase('First Quarter'), 'quarter'],
  [0.47, phrase('Waxing gibbous'), phrase('Waxing Gibbous'), 'gibbous'],
  [0.53, phrase('Full moon'), phrase('Full Moon'), 'full'],
  [0.72, phrase('Waning gibbous'), phrase('Waning Gibbous'), 'gibbous'],
  [0.78, phrase('Last quarter'), phrase('Last Quarter'), 'quarter'],
  [0.97, phrase('Waning crescent'), phrase('Waning Crescent'), 'crescent'],
  [Infinity, phrase('New moon'), phrase('New Moon'), 'new'],
];
const moonPhaseRow = (phase: number) => MOON_NAMES.find(([below]) => phase < below);
export const moonName = (phase: number): string => moonPhaseRow(phase)?.[1] ?? phrase('New moon');
export const moonHeading = (phase: number): string => moonPhaseRow(phase)?.[2] ?? phrase('New Moon');
export interface MoonInfo {
  phase: number;
  illumination: number;
  // Its name, in English.
  name: string;
  // The next rise while it is down, or the next set while it is up.
  event: { kind: 'Moonrise' | 'Moonset'; time: number } | null;
  rise: number | null;
  set: number | null;
  // Above the horizon; null without a location.
  up: boolean | null;
}
export function moonInfo(now: number, latitude: number | undefined, longitude: number | undefined): MoonInfo {
  const phase = moonPhase(now),
    illumination = (1 - Math.cos(2 * Math.PI * phase)) / 2,
    altitude = moonAltitude(now, latitude, longitude);
  const { rise, set } = moonTimes(now, latitude, longitude);
  const up = finite(altitude) ? altitude > MOON_HORIZON : null;
  const event =
    up === null
      ? null
      : up
        ? set !== null
          ? { kind: phrase('Moonset'), time: set }
          : null
        : rise !== null
          ? { kind: phrase('Moonrise'), time: rise }
          : null;
  return { phase, illumination, name: moonName(phase), event, rise, set, up: finite(altitude) ? altitude > 0 : null };
}
