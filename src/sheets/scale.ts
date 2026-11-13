// A scale's step: about a quarter of its span, rounded up to 1, 2 or 5 of a power of ten.
const TARGET_STEPS = 4,
  NICE = [1, 2, 5] as const,
  DECADE = 10;
const niceStep = (span: number) => {
  const raw = span / TARGET_STEPS,
    power = DECADE ** Math.floor(Math.log10(raw || 1));
  return NICE.map(n => n * power).find(n => n >= raw) ?? power * DECADE;
};
// Vertical scale and gridline values.
export interface ChartScale {
  min: number;
  max: number;
  ticks: number[];
}
// Ticks keep four decimals, past a step's rounding.
const TICK_DIGITS = 4;
// A scale fitted to `values`: from zero, or from their lowest; `least` is how high it must reach
// from there at least.
export function niceScale(values: readonly number[], fromLowest = false, least = (low: number) => low + 1): ChartScale {
  const low = fromLowest ? Math.min(...values) : 0;
  // A day below freezing spans its own temperatures, not up to 1°.
  const high = Math.max(...values, least(low));
  const step = niceStep(high - low),
    min = Math.floor(low / step) * step,
    max = Math.max(min + step, Math.ceil(high / step) * step);
  return steppedScale(min, max, step);
}
// A value rounded down or up to a multiple of `step`. An exact multiple stays where it is, past
// what dividing by a step such as 1.5 leaves in the last decimals.
const RATIO_DIGITS = 9;
const multiples = (value: number, step: number) => +(value / step).toFixed(RATIO_DIGITS);
export const floorTo = (value: number, step: number): number => Math.floor(multiples(value, step)) * step;
export const ceilTo = (value: number, step: number): number => Math.ceil(multiples(value, step)) * step;
// A scale from `min` to `max` with a tick on each multiple of `step` in it, up to `top` where the
// highest tick stops short of the scale's end. Its ends needn't be multiples themselves: the ticks
// keep to round numbers whatever the readings' middle comes to.
export const steppedScale = (min: number, max: number, step: number, top = max): ChartScale => {
  const first = ceilTo(min, step);
  return {
    min,
    max,
    ticks: Array.from(
      { length: Math.round((floorTo(top, step) - first) / step) + 1 },
      (_, i) => +(first + i * step).toFixed(TICK_DIGITS),
    ),
  };
};
