// Marks that add their light to the glass behind them, as a dial's ticks do. A blend mode can't
// reach through a backdrop filter, so under each kind of mark a lift, clipped to its shapes,
// brightens what is behind by 1 / (1 − the kind's opacity); the kind drawn over it at that
// opacity then leaves the backdrop plus its colour. Without backdrop filters they are simply
// drawn over, a little dimmer. A lift reads only what is drawn before it.
interface Light {
  rgb: readonly number[];
  opacity: number;
}
interface LightMarks extends Light {
  name: string;
  shapes: string;
}
const LIFT_DIGITS = 3;
const lift = (light: Light, style: string) =>
  `<i class="lift" style="--lift:${(1 / (1 - light.opacity)).toFixed(LIFT_DIGITS)};${style}"></i>`;
const drawn = (light: Light, shapes: string) =>
  `<g fill="rgb(${light.rgb.map(Math.round).join(' ')})" fill-opacity="${light.opacity.toFixed(LIFT_DIGITS)}">${shapes}</g>`;
export function addedLight(id: string, kinds: readonly LightMarks[]): { lifts: string; marks: string } {
  return {
    lifts: kinds.map(kind => lift(kind, `clip-path:url(#${kind.name}-${id})`)).join(''),
    marks: `<defs>${kinds.map(kind => `<clipPath id="${kind.name}-${id}">${kind.shapes}</clipPath>`).join('')}</defs>${kinds
      .map(kind => drawn(kind, kind.shapes))
      .join('')}`,
  };
}
// White marks whose lift adds their light by itself. Under a contrast of 1 / k and then a brightness
// of k = 1 + 2 × the marks' opacity, what is behind goes from x to x + that opacity, the sum a lift
// and white marks drawn over it make. The light is then one shape and can't stand off marks drawn
// in a box of their own, as a lift's clip can where WebKit sets it a pixel or more off in a zoomed
// page, by how far depending on where the lift falls. The marks are still drawn, for where backdrop
// filters aren't, and the styles hide them where they are.
export function addedLightAlone(id: string, kinds: readonly LightMarks[]): { lifts: string; marks: string } {
  return {
    lifts: kinds
      .map(
        kind =>
          `<i class="lift" style="--add:${(1 + 2 * kind.opacity).toFixed(LIFT_DIGITS)};clip-path:url(#${kind.name}-${id})"></i>`,
      )
      .join(''),
    marks: addedLight(id, kinds).marks,
  };
}
// Marks in a box that stretches, `shapes` in its shares, 0 to 1 each way, lifted by boxes of their
// own: each of `places` is a lift's style, where it stands in the box and how its corners round.
// They are not cut to a clip in shares of the box, as Firefox zooms such a clip a second time
// inside a zoomed page, and lifts a smaller copy beside the marks.
export function addedLightBoxes(
  places: readonly string[],
  shapes: string,
  light: Light,
): { lifts: string; marks: string } {
  return { lifts: places.map(place => lift(light, place)).join(''), marks: drawn(light, shapes) };
}
// Words add their light as marks do. Titles and quiet labels are white at 25%, which reads a little
// above the panel at night and light blue by day, as the panel's colour shows through; a wide
// tile's readings are 23%, what is second to a reading 55%, and the pinned reading 58%.
const WHITE: readonly number[] = [255, 255, 255];
export const WORDS = {
  label: { rgb: WHITE, opacity: 0.25 },
  reading: { rgb: WHITE, opacity: 0.23 },
  aside: { rgb: WHITE, opacity: 0.55 },
  brief: { rgb: WHITE, opacity: 0.58 },
} as const;
// Words in added light inside the box they are put in, over the page's own words, which the styles
// hide and leave to hold their place: `shapes`, the <text> of each line, are drawn in the box's type.
// LINE_MIDDLE, on a <text>, sets its baseline where the page sets that of a line centred on its y:
// browsers differ by a pixel on a central baseline, and a word on a row would stand off its label.
export const LINE_MIDDLE = 'dy=".355em"';
export function addedWords(
  id: string,
  name: string,
  shapes: string,
  light: (typeof WORDS)[keyof typeof WORDS],
): string {
  const { lifts, marks } = addedLight(id, [{ name, shapes, ...light }]);
  return `${lifts}<svg class="words" aria-hidden="true">${marks}</svg>`;
}
// The system's fills as they look on a dark material: the faint one a dial's fine ticks use,
// the stronger its bolder ones; and a secondary label's colour.
export const FILL = {
  tertiary: { rgb: [118, 118, 128], opacity: 0.24 },
  secondary: { rgb: [120, 120, 128], opacity: 0.32 },
  label: { rgb: [235, 235, 245], opacity: 0.6 },
} as const;
