import { rgb, CHANNEL_MAX, toHex } from '../lib/canvas.ts';
import { convertUnit, UNITS } from './units.ts';
import { PERCENT } from '../lib/html.ts';
import { finite } from '../lib/values.ts';
// The temperature scale the range bars and charts are coloured by: nine colours from −120 °F
// to 120 °F (deep violet through blues, teal, yellow and orange to dark red), blended in OKLab
// between them, as CSS does `in oklab`.
const TEMPERATURE_SCALE = [
  [-120, '#30004d'],
  [-60, '#5856d6'],
  [0, '#007aff'],
  [30, '#5ac8fa'],
  [50, '#66d4cf'],
  [70, '#ffcc00'],
  [80, '#ff9500'],
  [100, '#ff3b30'],
  [120, '#770700'],
] as const;

const SCALE_DIGITS = 2;

// sRGB and OKLab, by way of linear light (the published matrices); OKLab's axes are the cone
// responses' cube roots.
const SRGB = { knee: 0.04045, linearKnee: 0.0031308, slope: 12.92, offset: 0.055, gain: 1.055, gamma: 2.4 } as const,
  CUBE = 3;

const TO_LMS = [
    [0.4122214708, 0.5363325363, 0.0514459929],
    [0.2119034982, 0.6806995451, 0.1073969566],
    [0.0883024619, 0.2817188376, 0.6299787005],
  ],
  TO_LAB = [
    [0.2104542553, 0.793617785, -0.0040720468],
    [1.9779984951, -2.428592205, 0.4505937099],
    [0.0259040371, 0.7827717662, -0.808675766],
  ],
  FROM_LAB = [
    [1, 0.3963377774, 0.2158037573],
    [1, -0.1055613458, -0.0638541728],
    [1, -0.0894841775, -1.291485548],
  ],
  FROM_LMS = [
    [4.0767416621, -3.3077115913, 0.2309699292],
    [-1.2684380046, 2.6097574011, -0.3413193965],
    [-0.0041960863, -0.7034186147, 1.707614701],
  ];

const times = (matrix: readonly (readonly number[])[], v: readonly number[]) =>
  matrix.map(row => row.reduce((sum, k, i) => sum + k * (v[i] ?? 0), 0));

const toOklab = (hex: string) =>
  times(
    TO_LAB,
    times(
      TO_LMS,
      rgb(hex).map(channel => {
        const c = channel / CHANNEL_MAX;
        return c <= SRGB.knee ? c / SRGB.slope : ((c + SRGB.offset) / SRGB.gain) ** SRGB.gamma;
      }),
    ).map(Math.cbrt),
  );

const fromOklab = (lab: readonly number[]) =>
  toHex(
    times(
      FROM_LMS,
      times(FROM_LAB, lab).map(c => c ** CUBE),
    ).map(c => {
      const v = c <= SRGB.linearKnee ? c * SRGB.slope : SRGB.gain * c ** (1 / SRGB.gamma) - SRGB.offset;
      return v * CHANNEL_MAX;
    }),
  );

// Two ways to blend two colours: in OKLab, as the scale goes, and plainly in sRGB, which stays
// stronger between its ends.
type Blend = (from: string, to: string, t: number) => string;
const inOklab: Blend = (from, to, t) => {
  const a = toOklab(from),
    b = toOklab(to);
  return fromOklab(a.map((c, i) => c + ((b[i] ?? c) - c) * t));
};
const inSrgb: Blend = (from, to, t) => {
  const b = rgb(to);
  return toHex(rgb(from).map((c, i) => c + ((b[i] ?? c) - c) * t));
};

// The colour at `value` on a scale of values and colours, in order, blended in OKLab unless told
// otherwise; held at either end past it.
export function scaleColor(
  scale: readonly (readonly [at: number, color: string])[],
  value: number,
  blend = inOklab,
): string {
  const lowest = scale[0],
    highest = scale.at(-1);
  if (!lowest || !highest || value <= lowest[0]) return lowest?.[1] ?? '#000000';
  if (value >= highest[0]) return highest[1];
  const above = scale.findIndex(([at]) => at >= value),
    [lo, loColor] = scale[above - 1] ?? lowest,
    [hi, hiColor] = scale[above] ?? highest,
    t = (value - lo) / (hi - lo);
  return blend(loColor, hiColor, t);
}
export const temperatureColor = (value: number, unit: string | undefined, blend = inOklab): string =>
  scaleColor(TEMPERATURE_SCALE, convertUnit('temperature_unit', value, unit, UNITS.fahrenheit), blend);

// The part of the scale from `from` to `to`, as a CSS gradient's stops from 0% to 100%; use it
// `in oklab`. Firefox can't draw a gradient whose stops lie far outside its box, and a bar is a
// small window on the scale, so only the stops inside it are named.
export function temperatureGradient(from: number, to: number, unit: string | undefined, blend = inOklab): string {
  const a = convertUnit('temperature_unit', from, unit, UNITS.fahrenheit),
    b = convertUnit('temperature_unit', to, unit, UNITS.fahrenheit),
    low = Math.min(a, b),
    high = Math.max(a, b);
  if (a === b) {
    const color = temperatureColor(from, unit, blend);
    return `${color},${color}`;
  }
  const inside = TEMPERATURE_SCALE.filter(([at]) => at > low && at < high).map(
    ([at, color]) => `${color} ${(((at - a) / (b - a)) * PERCENT).toFixed(SCALE_DIGITS)}%`,
  );
  return [
    `${temperatureColor(from, unit, blend)} 0%`,
    ...(a < b ? inside : [...inside].reverse()),
    `${temperatureColor(to, unit, blend)} 100%`,
  ].join(',');
}

// A day's bar along the week's track: where it starts and how long it is (% of the track), its
// colours' gradient stops and the space they blend in, and today's reading as a share of the
// day's own range.
export interface RangeBar {
  left: number;
  width: number;
  gradient: string;
  space: 'oklab' | 'srgb';
  current: number | null;
}

// A range bar's inline styles: the fill's place, length and colours (with --p placing the clear
// cut round today's dot), and the dot's place, kept between the fill's rounded ends.
export function rangeStyles(bar: RangeBar): { fill: string; dot: string | null } {
  const today = bar.current === null ? '' : `;--p:${bar.current}`;
  return {
    fill: `left:${bar.left}%;width:${bar.width}%;background:linear-gradient(90deg in ${bar.space},${bar.gradient})${today}`,
    dot:
      bar.current === null
        ? null
        : `left:calc(${bar.left}% + var(--bar) / 2 + (${bar.width}% - var(--bar)) * ${bar.current})`,
  };
}

type Ranged = { low: number | null; high: number | null; today?: boolean };

// Today's reading on a day with no spread sits in the middle of its bar.
const HALF = 0.5;

export function temperatureRange(
  items: readonly Ranged[],
  unit: string | undefined,
  current: number | undefined,
): (RangeBar | null)[] {
  const valid = items.filter(
    (item): item is Ranged & { low: number; high: number } =>
      finite(item.low) && finite(item.high) && item.high >= item.low,
  );
  const min = Math.min(...valid.map(item => item.low)),
    max = Math.max(...valid.map(item => item.high)),
    span = Math.max(1, max - min);
  // A day's colours run the whole track, its low at the left edge to its high at the right, so
  // its bar shows its own stretch of them. Today's blend plainly, so its bar stands out a little
  // stronger than the rest.
  return items.map(item => {
    if (!finite(item.low) || !finite(item.high) || item.high < item.low) return null;
    const { low, high } = item,
      left = ((low - min) / span) * PERCENT,
      width = Math.max(2, ((high - low) / span) * PERCENT),
      along = (share: number) => low + (high - low) * (share / PERCENT);
    return {
      left,
      width,
      gradient: temperatureGradient(along(left), along(left + width), unit, item.today ? inSrgb : inOklab),
      space: item.today ? 'srgb' : 'oklab',
      current:
        item.today && finite(current)
          ? high > low
            ? Math.max(0, Math.min(1, (current - low) / (high - low)))
            : HALF
          : null,
    };
  });
}
