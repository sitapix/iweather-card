// What runs across the hourly strip rather than down a column: the wind chart, and the
// precipitation view's tint, level lines and baseline. Both stand under the columns, as wide as
// the strip scrolls, placed from where the columns came to be (see StripFrame).
import { mix } from '../../lib/canvas.ts';
import { esc } from '../../lib/html.ts';
import { DAY, HOUR } from '../../lib/time.ts';
import { clamp, finite } from '../../lib/values.ts';
import { forecasts, type StripItem } from '../../weather/forecast-items.ts';
import type { ForecastState } from '../../weather/forecast.ts';
import { convertUnit, isBeaufort, UNITS } from '../../weather/units.ts';
import { addedLight, WORDS } from '../shared/light.ts';

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}
// A column as it came out, in the strip's own scrolled pixels: its place, its bar if it has one,
// and the words in its last row, which stand on that box's foot, or the label on the chart.
export interface StripColumn {
  left: number;
  width: number;
  bar: Box | null;
  value: Box | null;
}
export interface StripFrame {
  width: number;
  height: number;
  columns: readonly StripColumn[];
  // How the wind chart is drawn, where the styles say (see LOOKS).
  look?: WindLookName;
}

// How much of the time an hour, a day or half a day takes across the strip.
const STEPS = { hourly: HOUR, daily: DAY, twice_daily: DAY / 2 } as const;

// How the wind chart is drawn. It stands on the panel's foot, its scale's top `height` over it and
// nothing `lift` over it, starting `floor` readings under nothing. The hour under way starts `start`
// along, where now's dot stands: from there, as the columns' whole pitch is the time they hold, a
// sunrise's column adds width but no hours, and the line drifts against the columns above it. The
// line is `line` across, in round dashes of `dash` before now, and the dot `dot` round with a white
// middle `hole` round. Under the line lie its colours at `under` and black at `shade`.
interface WindLook {
  height: number;
  lift: number;
  floor: number;
  start: number;
  line: number;
  dash: number;
  dot: number;
  hole: number;
  under: number;
  shade: number;
}
// On the whole, the scale starts four under nothing, so that a calm day's line isn't lost in the
// foot, and the hour under way starts 13 px along. On a phone's page (`--wind-look: phone`) the line,
// its dashes and the dot are .92 of that size; nothing stands 3.7 px over the foot and the top 32.4,
// with no readings under nothing; the hour under way starts 38.5 px in from the panel's edge, its past
// dashed in from there; and what lies under the line is stronger.
const LOOKS = {
  wide: { height: 38.1, lift: 0, floor: 4, start: 13, line: 5, dash: 7.5, dot: 5, hole: 2.5, under: 0.2, shade: 0.05 },
  phone: {
    height: 32.4,
    lift: 3.7,
    floor: 0,
    start: 38.5,
    line: 4.6,
    dash: 7,
    dot: 4.6,
    hole: 2.3,
    under: 0.35,
    shade: 0.1,
  },
} as const satisfies Record<string, WindLook>;
export type WindLookName = keyof typeof LOOKS;
export const isWindLook = (name: string): name is WindLookName => Object.hasOwn(LOOKS, name);
const DIGITS = 2;
// The top of the scale: a gust's next multiple of these, or the next force.
const TOP_STEP = { [UNITS.metersPerSecond]: 2, other: 5 } as const;
const TOP_FORCE = 12;
// The wind's colours, up the chart, evenly from calm to 73 mph.
const SCALE = [
  '#22b9d2',
  '#07c3c0',
  '#00bc8b',
  '#00b556',
  '#24b426',
  '#90b400',
  '#d5b300',
  '#dda500',
  '#df9500',
  '#e28400',
  '#e65305',
  '#e72d2e',
] as const;
const SCALE_TOP = 73;
const LAST = SCALE.length - 1;
// The colour a share of the way up the scale, blended from the two around it as a gradient blends.
const scaleAt = (share: number): string => {
  const place = clamp(share) * LAST,
    below = Math.min(Math.floor(place), LAST - 1);
  return mix(SCALE[below] ?? SCALE[0], SCALE[below + 1] ?? SCALE[0], place - below);
};
// The lowest and highest readings a shape reaches.
export interface Reach {
  low: number;
  high: number;
}
const reachOf = (values: readonly number[]): Reach | undefined =>
  values.length > 0 ? { low: Math.min(...values), high: Math.max(...values) } : undefined;
// The wind's colours as a gradient up a chart: `y` says where a reading comes on it. Without a
// reach, the whole scale climbs the chart. With one, the shape it fills goes from calm's colour at
// its lowest reading to its highest reading's colour on the whole scale, at its highest, and keeps
// those colours past either end. So the colours in between come closer together, and a shape
// with no height takes its one reading's colour.
export const windColours = (
  id: string,
  y: (value: number) => number,
  unit: string | undefined,
  reach?: Reach,
): string => {
  const top = convertUnit('wind_speed_unit', SCALE_TOP, UNITS.milesPerHour, unit),
    stop = (offset: number, colour: string) => `<stop offset="${round(offset)}" stop-color="${colour}"/>`,
    gradient = (from: number, to: number, stops: string) =>
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="${round(y(from))}" y2="${round(y(to))}">${stops}</linearGradient>`;
  if (!reach) return gradient(0, top, SCALE.map((colour, level) => stop(level / LAST, colour)).join(''));
  const { low, high } = reach,
    share = Math.max(0, high) / top,
    end = stop(1, scaleAt(share));
  if (round(y(low)) === round(y(high))) return `<linearGradient id="${id}">${end}</linearGradient>`;
  const stops = SCALE.flatMap((colour, level) => (level / LAST < share ? [stop(level / LAST / share, colour)] : []));
  return gradient(low, high, stops.join('') + end);
};
// The rule at each gap between columns runs from the time row to a whisker over the panel's foot.
const RULE = { top: 4.375, foot: 1.25 } as const;
// A sunrise or sunset rides on the line, in a pill of the panel's own colour: the chart stops
// short of it, level with the middle of the line.
const PILL_HEIGHT = 12.8;
const round = (value: number) => Number(value.toFixed(DIGITS));
export interface WindPoint {
  time: number;
  speed: number;
  gust: number | null;
}
// What the chart plots, past both ends of the strip. `from` is the time at its start, `span` how
// long its width stands for, `top` the reading at its top, and `now` where the past gives way, in
// a strip that starts from now: the start of the hour under way, where now's dot stands.
export interface WindSeries {
  points: readonly WindPoint[];
  from: number;
  span: number;
  top: number;
  now: number | null;
  unit: string | undefined;
}
// The top of a chart whose highest reading is `most`: never under it, in round numbers.
export function windTop(most: number, unit: string | undefined): number {
  if (isBeaufort(unit)) return Math.min(TOP_FORCE, Math.floor(most) + 1);
  const step = unit === UNITS.metersPerSecond ? TOP_STEP[UNITS.metersPerSecond] : TOP_STEP.other;
  return Math.max(step, Math.ceil(most / step) * step);
}
export function windSeries(
  type: keyof typeof STEPS,
  items: readonly StripItem[],
  forecast: ForecastState | undefined,
  unit: string | undefined,
  now: number,
): WindSeries {
  const shown = items.filter(item => !item.sun),
    live = shown.find(item => item.now),
    step = STEPS[type],
    entries = forecasts([...(forecast?.earlier ?? []), ...(forecast?.forecast ?? [])]),
    from = live
      ? (entries.findLast(entry => entry.time <= now && entry.time > now - HOUR)?.time ?? Math.floor(now / HOUR) * HOUR)
      : (shown[0]?.time ?? now),
    last = shown.at(-1)?.time ?? now,
    // One reading past each end, so that the line leaves the strip rather than stopping in it. The
    // hour under way reads what the card reads now.
    near = entries.filter(
      entry => entry.time >= from - step && entry.time <= last + step && !(live && entry.time === from),
    );
  const points = [...near, ...(live ? [{ ...live, time: from }] : [])]
    .sort((a, b) => a.time - b.time)
    .flatMap(({ time, wind_speed: speed, wind_gust_speed: gust }): WindPoint[] =>
      finite(speed) ? [{ time, speed, gust: finite(gust) ? gust : null }] : [],
    );
  return {
    points,
    from,
    span: shown.length * step,
    top: windTop(Math.max(0, ...shown.flatMap(item => [item.wind_speed, item.wind_gust_speed]).filter(finite)), unit),
    now: live ? from : null,
    unit,
  };
}
// The speed at a time, on the straight line between the readings around it.
export function speedAt(points: readonly WindPoint[], time: number): number | null {
  const after = points.findIndex(point => point.time >= time),
    next = points[after],
    previous = points[after - 1];
  if (!next) return points.at(-1)?.speed ?? null;
  if (!previous) return next.speed;
  return previous.speed + (next.speed - previous.speed) * clamp((time - previous.time) / (next.time - previous.time));
}
// A rounded pill, as a path to cut out of the chart.
const pillPath = (x: number, y: number, width: number, height: number) => {
  const r = height / 2,
    run = width - height;
  return `M${round(x + r)} ${round(y)}h${round(run)}a${round(r)} ${round(r)} 0 0 1 0 ${round(height)}h${round(-run)}a${round(r)} ${round(r)} 0 0 1 0 ${round(-height)}z`;
};
// How far up the column's foot a sun label stands, by index along the columns.
export type PillPlaces = readonly (number | null)[];
export function windChart(series: WindSeries, frame: StripFrame): { chart: string; pills: PillPlaces } {
  const look: WindLook = LOOKS[frame.look ?? 'wide'],
    { height: H, lift, floor, start } = look,
    { points, from, span, top, now, unit } = series,
    [first, second] = frame.columns,
    edge = first?.left ?? 0,
    gap = first && second ? second.left - first.left - first.width : 0,
    across = frame.width - 2 * edge + gap,
    x = (time: number) => start + ((time - from) / span) * across,
    y = (value: number) => H - lift - (H - lift) * ((value + floor) / (top + floor)),
    at = (time: number, value: number) => `${round(x(time))} ${round(y(value))}`,
    line = (run: readonly WindPoint[]) => run.map(point => at(point.time, point.speed)).join('L');
  // The gust band, and what lies under the line to the panel's foot.
  const gusted = points.filter(point => point.gust !== null),
    band =
      gusted.length > 1
        ? `M${gusted.map(point => at(point.time, point.gust ?? point.speed)).join('L')}L${line([...gusted].reverse())}Z`
        : '',
    earliest = points[0],
    latest = points.at(-1),
    under =
      earliest && latest && points.length > 1
        ? `M${line(points)}L${round(x(latest.time))} ${H}L${round(x(earliest.time))} ${H}Z`
        : '';
  // Each dashes out from now, so that a dash meets the dot.
  const past = now === null ? [] : points.filter(point => point.time <= now).reverse(),
    coming = now === null ? points : points.filter(point => point.time >= now);
  const rise = frame.height - H,
    gaps = frame.columns.slice(1).map((column, index) => {
      const before = frame.columns[index];
      return before ? (before.left + before.width + column.left) / 2 : column.left;
    }),
    rules = gaps.map(middle => `M${round(middle)} ${round(RULE.top - rise)}V${round(H - RULE.foot)}`).join('');
  let holes = '';
  const pills = frame.columns.map(({ left, width, value }) => {
    const speed = value && speedAt(points, from + ((left + width / 2 - start) / across) * span);
    if (!value || !finite(speed)) return null;
    const foot = y(speed);
    holes += pillPath(left + width / 2 - value.width / 2, foot - PILL_HEIGHT, value.width, PILL_HEIGHT);
    return round(H - foot);
  });
  const reach = H + look.line,
    cut = holes
      ? `<clipPath id="strip-pills"><path clip-rule="evenodd" d="M${-look.line} ${-reach}H${round(frame.width + look.line)}V${reach}H${-look.line}Z${holes}"/></clipPath>`
      : '',
    // The line, both sides of now, and what lies under it take their colours from the line's
    // reach, and the gust band from its own.
    scale =
      windColours('strip-wind', y, unit, reachOf(points.map(point => point.speed))) +
      (band
        ? windColours('strip-gust', y, unit, reachOf(gusted.flatMap(point => [point.speed, point.gust ?? point.speed])))
        : ''),
    stroke = `fill="none" stroke="url(#strip-wind)" stroke-width="${look.line}" stroke-linecap="round" stroke-linejoin="round"`,
    live = now === null ? null : speedAt(points, now),
    dot =
      now !== null && finite(live)
        ? `<g transform="translate(${at(now, live)})"><circle r="${look.dot}" fill="#1c1c1e"/><circle r="${look.hole}" fill="#fff"/></g>`
        : '';
  return {
    pills,
    chart: `<svg class="wind-chart" aria-hidden="true" viewBox="0 0 ${round(frame.width)} ${H}" style="width:${round(frame.width)}px;height:${H}px"><defs>${scale}${cut}</defs><path d="${rules}" fill="none" stroke="#ffffff4d" stroke-width="1.25" stroke-linecap="round" stroke-dasharray="5 5"/><g${cut ? ' clip-path="url(#strip-pills)"' : ''}>${band ? `<path d="${band}" fill="url(#strip-gust)" fill-opacity=".25"/>` : ''}${under ? `<path d="${under}" fill="url(#strip-wind)" fill-opacity="${look.under}"/><path d="${under}" fill="#000" fill-opacity="${look.shade}"/>` : ''}${past.length > 1 ? `<path d="M${line(past)}" ${stroke} stroke-dasharray="${look.dash} ${look.dash}"/>` : ''}${coming.length > 1 ? `<path d="M${line(coming)}" ${stroke}/>` : ''}</g>${dot}</svg>`,
  };
}

// The precipitation view's bars: 33% and 66% down, a level line of 1.875 px dashes; under them all,
// 4.375 px below the bars, a baseline of 2.5 px dashes across the whole strip. Both add their
// light to the panel, as a day's tint does, and the words for nothing.
const LEVELS = [0.33, 0.66] as const;
const LEVEL = { dash: 1.875, height: 1.25 } as const;
const BASELINE = { dash: 2.5, height: 1.25, below: 4.375 } as const;
const WHITE = [255, 255, 255] as const;
// A stretch of day adds this light; one of night is this black.
export const DAY_TINT = { rgb: WHITE, opacity: 0.08 } as const;
export const NIGHT_TINT = '#00000014';
const RULES = 0.27;
// What the precipitation view needs of a column beyond where it is.
export interface RainColumn {
  night: boolean;
  // Words for none, drawn in added light.
  none: string | null;
}
// A row of dashes, one subpath each: a stroke's dashes would be nothing to clip to.
function dashes(from: number, to: number, y: number, dash: number, height: number): string {
  const count = Math.ceil((to - from) / (dash * 2));
  return Array.from(
    { length: count },
    (_, index) => `M${round(from + index * dash * 2)} ${round(y)}h${dash}v${height}h${-dash}z`,
  ).join('');
}
export function rainMarks(frame: StripFrame, columns: readonly (RainColumn | null)[]): string {
  const bars = frame.columns.flatMap(({ bar }, index) => {
      const column = columns[index];
      return bar && column ? [{ bar, column }] : [];
    }),
    levels = bars.flatMap(({ bar }) =>
      LEVELS.map(level =>
        dashes(bar.left, bar.left + bar.width, bar.top + bar.height * level, LEVEL.dash, LEVEL.height),
      ),
    ),
    foot = bars[0]?.bar,
    baseline = foot
      ? dashes(0, frame.width, foot.top + foot.height + BASELINE.below, BASELINE.dash, BASELINE.height)
      : '',
    tints = bars
      .filter(({ column }) => !column.night)
      .map(({ bar }) => `<rect x="${bar.left}" y="${bar.top}" width="${bar.width}" height="${bar.height}" rx="7.5"/>`),
    words = frame.columns.flatMap(({ value }, index) => {
      const none = columns[index]?.none;
      return none && value
        ? [
            `<text x="${round(value.left + value.width / 2)}" y="${round(value.top + value.height)}">${esc(none)}</text>`,
          ]
        : [];
    });
  const { lifts, marks } = addedLight('strip', [
    { name: 'tint', shapes: tints.join(''), ...DAY_TINT },
    { name: 'rules', shapes: `<path d="${levels.join('')}${baseline}"/>`, rgb: WHITE, opacity: RULES },
    { name: 'none', shapes: words.join(''), ...WORDS.label },
  ]);
  return `<div class="strip-marks" aria-hidden="true" style="width:${round(frame.width)}px">${lifts}<svg>${marks}</svg></div>`;
}
// What the bars and the row under them stand for: each level's name at the middle of its third of a
// bar, heaviest at the top, and what the row reads on the row itself, all in the light of what is
// second to a reading. They stand out of sight until the strip is pulled past its start (see
// stripPull), and take the room of the longest (see the styles).
export interface RainLabels {
  levels: readonly string[];
  row: string;
}
export function rainLabels(frame: StripFrame, { levels, row }: RainLabels): string {
  const column = frame.columns.find(({ bar }) => bar),
    bar = column?.bar;
  if (!bar) return '';
  const value = column.value,
    third = bar.height / levels.length,
    shapes = levels.map(
      (level, index) => `<text class="level" y="${round(bar.top + third * (index + 1 / 2))}">${esc(level)}</text>`,
    );
  if (value) shapes.push(`<text y="${round(value.top + value.height)}">${esc(row)}</text>`);
  const { lifts, marks } = addedLight('strip', [{ name: 'labels', shapes: shapes.join(''), ...WORDS.aside }]);
  return `<div class="strip-labels" aria-hidden="true">${[...levels, row].map(word => `<span>${esc(word)}</span>`).join('')}${lifts}<svg>${marks}</svg></div>`;
}
