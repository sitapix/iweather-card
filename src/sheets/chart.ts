import type { TileContext } from '../cards/shared/context.ts';
import { dateFormat } from '../lib/formats.ts';
import { ampm, clockOf } from './time.ts';
import { HOURS_PER_DAY, HOUR, MINUTES_PER_HOUR } from '../lib/time.ts';
import { withEarlier, type PlotPoint } from './series.ts';
import type { ChartScale } from './scale.ts';
import type { DayAxis } from './days.ts';
import type { DayBand } from '../cards/averages/climate.ts';
import { clamp, finite } from '../lib/values.ts';
import { percent, PERCENT } from '../lib/html.ts';
import { weatherIcon } from '../weather/icons.ts';
import { type ChartMark, lineAttribute, pointsAttribute, readsAlong, timeSelector } from './chart-scrub.ts';
import { type Curve, heightAt, smoothPath, type XY } from './curve.ts';
import { say } from '../weather/words.ts';
// Lines are drawn this wide, and earlier in the day in dashes of this pattern, which round caps
// make read as 13.75 on and 6.25 off.
export const LINE_WIDTH = 6.25,
  PAST_DASH = '7.5 12.5';
// A fill's strength, and gradient stops keep three decimals.
export const FILL_STRENGTH = 0.49,
  STOP_DIGITS = 3;
// The day's chart: gridlines, the reading as a line over a tinted area (bars for
// precipitation), gusts above wind, and a dot at the current reading. Labels are
// HTML beside the SVG so they keep their shape at any width.
export const W = 300,
  H = 150;
// A plot's height, tall or small, and the band kept clear inside it above the scale (see the styles).
export const PLOT = { tall: 273.75, small: 175 } as const,
  CLEAR_BAND = 40;

// An axis is marked every six hours gone from the day's start, not at the same hours of the clock:
// a day of 25 hours reads 12AM 5AM 11AM 5PM, and one of 23 reads 12AM 7AM 1PM 7PM.
const AXIS_STEP = 6;
export const axisMarks = ({ hours }: DayAxis): number[] =>
  Array.from({ length: Math.floor(hours / AXIS_STEP) + 1 }, (_, i) => i * AXIS_STEP);
// Those with a label: the mark that ends a whole day has no room for one before the plot's edge.
export const labelledMarks = (axis: DayAxis): number[] => axisMarks(axis).filter(hour => hour < HOURS_PER_DAY);
// The hour labels under a day's chart.
export const hourAxis = (ctx: Pick<TileContext, 'locale' | 'hour12' | 'timeZone'>, axis: DayAxis): string => {
  const format = dateFormat(ctx.locale, { hour: 'numeric', timeZone: ctx.timeZone, hour12: ctx.hour12 });
  return labelledMarks(axis)
    .map(
      hour =>
        `<span style="left:${(hour / axis.hours) * PERCENT}%">${ampm(format.format(axis.start + hour * HOUR))}</span>`,
    )
    .join('');
};
export type ChartContext = Pick<
  TileContext,
  'id' | 'attrs' | 'fmt' | 'locale' | 'numbers' | 'hour12' | 'timeZone' | 'now'
>;
// A precipitation bar fills 60% of its hour, with its corners rounded by 2.5 px. A level's name
// knocks a pill out of what is behind it: 5 px round, 5 in from the plot's left, hanging from just
// under its line, as long as the name. The drawing is laid over a plot this wide.
const BAR_SHARE = 0.6,
  BAR_RADIUS = 2.5,
  BAR_PLOT_WIDTH = 315,
  PILL = { left: 5, top: 1.25, height: 17.5, radius: 5, ends: 7.5, letter: 7 } as const;
// A gradient on a line goes through a mask as big as this, to take in all a line can overhang.
const OVERHANG = { x: -W, y: -H, width: 2 * W + W, height: 2 * H + H } as const;
// A bar chart's reading has no place up the chart: its dot, and the hole round it, stand clear of it.
const NO_DOT = -PERCENT;
// A tick's decimals, by the step between ticks.
const FINE_STEP = 0.1;
export const tickDigits = (step: number) => (step < FINE_STEP ? 2 : step < 1 ? 1 : 0);
// A tick reads to a decimal, with none where that is a nought.
const tickText = (tick: number, ctx: ChartContext) => {
  const shown = +tick.toFixed(1);
  return ctx.fmt(shown, Number.isInteger(shown) ? 0 : 1);
};
// What sets a chart apart. Everything is optional but its name: a plain chart is a small white
// smooth line over its fill, a dot at now, its grid, and its readings as numbers.
export interface ChartLook {
  // Names the chart and, with the card's id, its gradients.
  id: string;
  color?: string;
  // The plain fill's opacity, and the line's colour where it isn't the fill's.
  alpha?: number;
  stroke?: string;
  // Gradients in place of the plain fill, and the line's colour where they set it.
  shade?: (chart: ChartShade) => { defs: string; stroke?: string };
  // The tall chart, rather than the small one.
  tall?: boolean;
  // No clear band above the scale: its top sits on the frame.
  flush?: boolean;
  // A rounded frame round all of it, scale and hours too, in place of the two rules.
  framed?: boolean;
  // How its line runs between readings, a monotone curve by default, and how wide it is.
  curve?: Curve;
  lineWidth?: number;
  // The line alone, with no fill under it.
  bare?: boolean;
  // The line in a drawing of its own, over the rest, so a shadow can fall from it (see the styles).
  lifted?: boolean;
  // A second reading on the same scale, drawn under the first and in the same way, where the day has it.
  under?: UnderLine;
  // The most a reading is drawn at, whatever it is.
  ceiling?: (ctx: ChartContext) => number | undefined;
  // Bars across each hour that brings some, in place of the line: how much of the scale each reaches, in
  // what colour.
  bars?: (point: PlotPoint, ctx: ChartContext) => { height: number; color: string };
  // What is over is hatched, and the line runs, and is read, from the hour under way on only: over the
  // hatching there is nothing to read, and the charts beside read there without it.
  hatched?: boolean;
  // Read, an hour's time goes from its start to its end, as a bar's does: 1PM - 2PM.
  spans?: boolean;
  // The band given drawn under the line: the normal range at each hour.
  ranged?: boolean;
  // The day drawn whole, with no past and no now.
  whole?: boolean;
  // No dot at now.
  dotless?: boolean;
  // Labelled rings at the day's lowest and highest, on every day.
  extremes?: boolean;
  // A ring at the day's highest, on any day but today. A formatter adds its value above it.
  highest?: boolean | ((value: number, ctx: ChartContext) => string);
  // A label at the day's highest.
  peak?: (highest: number, ctx: ChartContext) => string;
  // What follows a tick's number.
  tickSuffix?: (tick: number, scale: ChartScale, ctx: ChartContext) => string;
  // Level names at the left, each hanging below its value's line, kept in English and said as it is
  // drawn. They stay bright over the past.
  levels?: readonly (readonly [value: number, label: string])[];
  // Read on its own, an hour at a time, each hour as the time it starts: it takes no reading from
  // the charts beside it, and lends them none.
  alone?: boolean;
  // Reading it by hover or drag (see chart-scrub): the value's line, and the line under it.
  reads?: (read: ChartRead) => string;
  notes?: (read: ChartRead) => string;
  // The reading goes with the weather nearest it that has one.
  weather?: boolean;
  // Weather symbols or sampled readings across the clear band above the scale.
  row?: ChartRow;
  // Said across a chart with nothing to show.
  note?: string;
}
export interface ChartRow {
  slots: number;
  // Compact monochrome symbols, such as trends and directions.
  symbols?: boolean;
  // Use only points that carry a weather condition.
  weather?: boolean;
  reads: (point: PlotPoint, ctx: ChartContext, points: readonly PlotPoint[]) => string;
}
export const WEATHER_ROW: ChartRow = {
  slots: 12,
  weather: true,
  reads: point => weatherIcon(point.condition, point.night === true),
};
// A second line: what it reads, its colour and strength where they aren't the line's own, and an
// area under it.
export interface UnderLine {
  read: (point: PlotPoint) => number | undefined;
  stroke?: string;
  opacity?: number;
  fill?: string;
}
export interface ChartShade {
  uid: string;
  scale: ChartScale;
  ctx: ChartContext;
  y: (value: number) => string;
}
// A gradient up the plot from the scale's foot to its top, each colour at its value's height. SVG
// blends stops straight, so colours that mix in another space are named every `every` of the scale.
export function valueGradient(
  { uid, scale: { min, max }, ctx, y }: ChartShade,
  name: string,
  colorAt: (value: number, ctx: ChartContext) => string,
  every: number,
  strength?: number,
): string {
  const count = Math.ceil((max - min) / every),
    end = strength === undefined ? '/>' : ` stop-opacity="${strength}"/>`,
    stops = Array.from({ length: count + 1 }, (_, i) => {
      const share = i / count;
      return `<stop offset="${share.toFixed(STOP_DIGITS)}" stop-color="${colorAt(min + (max - min) * share, ctx)}"${end}`;
    });
  return `<linearGradient id="${name}-${uid}" gradientUnits="userSpaceOnUse" x1="0" y1="${y(min)}" x2="0" y2="${y(max)}">${stops.join('')}</linearGradient>`;
}
// Line and fill coloured by value, bottom to top, so a colour sits at its value's height.
export const shadeByValue =
  (colorAt: (value: number, ctx: ChartContext) => string, every: number): NonNullable<ChartLook['shade']> =>
  chart => ({
    defs: `${valueGradient(chart, 'fill', colorAt, every, FILL_STRENGTH)}${valueGradient(chart, 'line', colorAt, every)}`,
    stroke: `url(#line-${chart.uid})`,
  });
// A place on the chart as it is read, with what goes with it from the nearest reading that has it.
export interface ChartRead {
  ctx: ChartContext;
  hour: number;
  value: number;
  near: PlotPoint;
  weather: PlotPoint;
  bearing: PlotPoint['bearing'];
  dew: number | undefined;
  gust: number | undefined;
  actual: number | undefined;
  range: readonly [low: number, high: number] | undefined;
  // The weather's icon, kept once in the chart (see below).
  icon: (point: PlotPoint | undefined) => string;
}
// The hours a line can be read at: each whole hour along it, or the one reading it has.
function hoursAlong(all: readonly PlotPoint[]): readonly number[] {
  const [first, last] = [all[0], all.at(-1)];
  if (!first || !last) return [];
  const from = Math.ceil(first.hour),
    to = Math.floor(last.hour);
  return from > to ? [first.hour] : Array.from({ length: to - from + 1 }, (_, i) => from + i);
}
// Labels sit halfway through equal slots across the day: two-hour symbols and visibility, and
// six-hour humidity. Stretching with the day keeps them inside the frame when the clocks change.
// Only hours covered by data get a label; the last forecast hour holds through that hour.
function chartRow(row: ChartRow, all: readonly PlotPoint[], axis: DayAxis, gone: number, ctx: ChartContext): string {
  const points = row.weather ? all.filter(point => point.condition) : all,
    first = points[0],
    last = points.at(-1);
  if (!first || !last) return '';
  const labels = Array.from({ length: row.slots }, (_, index) => {
    const hour = ((index + 1 / 2) * axis.hours) / row.slots;
    if (hour < first.hour || hour >= last.hour + 1) return '';
    const point = points.reduce((best, point) =>
        Math.abs(point.hour - hour) < Math.abs(best.hour - hour) ? point : best,
      ),
      label = row.reads(point, ctx, points);
    return label
      ? `<span${hour < gone ? ' data-past' : ''} style="left:${percent(hour / axis.hours)}">${label}</span>`
      : '';
  }).join('');
  return labels
    ? `<div class="chart-top"${row.weather ? ' data-weather' : ''}${row.symbols ? ' data-symbols' : ''}>${labels}</div>`
    : '';
}
export function chartMarkup(
  look: ChartLook,
  shown: readonly PlotPoint[],
  scale: ChartScale,
  ctx: ChartContext,
  axis: DayAxis,
  earlier: readonly PlotPoint[] = [],
  // The class of the element beside the chart that shows its reading (see chart-scrub), if any.
  readout = '',
  // The normal range at each hour, for a chart that draws one.
  band?: DayBand | null,
): string {
  const { id } = look,
    ceiling = look.ceiling?.(ctx),
    capped = (list: readonly PlotPoint[]) =>
      ceiling === undefined ? list : list.map(point => ({ ...point, value: Math.min(point.value, ceiling) })),
    [points, past] = [capped(shown), capped(earlier)];
  // A plot keeps its band clear above the scale, so a value's place is a share of what is left.
  const clear = look.flush ? 0 : CLEAR_BAND / (look.tall ? PLOT.tall : PLOT.small),
    height = (value: number) => clear + (1 - clear) * (1 - (value - scale.min) / (scale.max - scale.min));
  const x = (hour: number) => ((hour / axis.hours) * W).toFixed(1),
    y = (value: number) => (H * height(value)).toFixed(1),
    top = (value: number) => (PERCENT * height(value)).toFixed(1),
    left = (hour: number) => percent(hour / axis.hours);
  // Every day's page has this chart, each with its own gradients and cuts.
  const uid = `${ctx.id}-${id}-${axis.start}`,
    color = look.color ?? '#fff',
    alpha = look.alpha ?? FILL_STRENGTH;
  let defs = `<linearGradient id="fill-${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="${alpha}"/><stop offset="1" stop-color="${color}" stop-opacity="${alpha}"/></linearGradient>`,
    stroke = look.stroke ?? color;
  if (look.shade) {
    const shaded = look.shade({ uid, scale, ctx, y });
    defs = shaded.defs;
    stroke = shaded.stroke ?? stroke;
  }
  // A line for every tick but one on the frame, which is the frame's.
  const grid = scale.ticks
    .filter(tick => height(tick) > 0)
    .map(tick => `<path d="M0 ${y(tick)}H${W}" class="grid"/>`)
    .join('');
  // None at the first mark, and the last one closes the day.
  const marks = axisMarks(axis),
    hourLines = marks
      .slice(1)
      .map(hour => `<i class="chart-hour"${hour === marks.at(-1) ? ' data-last' : ''} style="left:${left(hour)}"></i>`)
      .join('');
  // How much of the day has gone. Today it runs up to now, where the day's line turns from dashes
  // to solid; everything before that is fainter (see the styles).
  const elapsed = (ctx.now - axis.start) / HOUR,
    gone = look.whole ? 0 : clamp(elapsed, 0, axis.hours),
    today = !look.whole && elapsed >= 0 && elapsed < axis.hours;
  const all = withEarlier(past, points),
    first = all[0],
    last = all.at(-1),
    curve = look.curve ?? 'monotone';
  // A day's last hour holds its reading to the day's end, so the line reaches the plot's edge.
  const end = last && last.hour >= axis.hours - 1 ? axis.hours : (last?.hour ?? 0),
    heldToEnd = (list: readonly XY[]): readonly XY[] => {
      const final = list.at(-1);
      return final && final[0] >= axis.hours - 1 && final[0] < axis.hours ? [...list, [axis.hours, final[1]]] : list;
    },
    drawn = heldToEnd(all.map((point): XY => [point.hour, point.value])),
    lineAt = heightAt(drawn, curve);
  // The normal range at each hour of the clock, carried round from midnight to midnight and laid
  // along the day's own length.
  const bandHours = band ? [...band.low.keys(), HOURS_PER_DAY] : [],
    alongDay = axis.hours / HOURS_PER_DAY,
    bandAt = (list: readonly number[]) =>
      heightAt(bandHours.map(hour => [hour * alongDay, list[hour % HOURS_PER_DAY] ?? 0]));
  let series = '',
    lifted = '';
  if (look.bars) {
    const { bars } = look,
      slot = W / axis.hours,
      width = slot * BAR_SHARE,
      wide = W / BAR_PLOT_WIDTH,
      tall = H / PLOT.small,
      corners = (radius: number) => `rx="${(radius * wide).toFixed(1)}" ry="${(radius * tall).toFixed(1)}"`,
      pills = (look.levels ?? [])
        .map(
          ([value, label]) =>
            `<rect x="${(PILL.left * wide).toFixed(1)}" y="${(+y(value) + PILL.top * tall).toFixed(1)}" width="${((PILL.ends + say(label).length * PILL.letter) * wide).toFixed(1)}" height="${(PILL.height * tall).toFixed(1)}" ${corners(PILL.radius)}/>`,
        )
        .join('');
    defs += `<mask id="levels-${uid}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/>${pills}</mask>`;
    const rects = all.map(point => {
      if (point.value <= 0) return '';
      const { height: level, color: tint } = bars(point, ctx),
        crown = +y(level);
      return `<rect x="${(+x(point.hour) + (slot - width) / 2).toFixed(1)}" y="${crown.toFixed(1)}" width="${width.toFixed(1)}" height="${(H - crown).toFixed(1)}" ${corners(BAR_RADIUS)} fill="${tint}"/>`;
    });
    series = `<g mask="url(#levels-${uid})">${rects.join('')}</g>`;
  } else if (first && !(look.hatched && gone >= axis.hours)) {
    const place = (list: readonly XY[]) => list.map(([hour, value]): XY => [+x(hour), +y(value)]),
      line = smoothPath(place(drawn), curve),
      across = +x(gone),
      // Cut at now, today. On a chart of what's to come, or with nothing earlier than the hour under
      // way, unless that hour began the day, nothing is drawn before it.
      cut = gone > first.hour && gone < axis.hours,
      fromNow = cut && (look.hatched === true || (first.hour > 0 && gone - first.hour < 1)),
      ahead = fromNow ? ` clip-path="url(#to-come-${uid})"` : '';
    if (cut) {
      const side = (name: string, from: number, to: number) =>
        `<clipPath id="${name}-${uid}"><rect x="${from}" y="${-H}" width="${to - from}" height="${2 * H + H}"/></clipPath>`;
      defs += `${side('past', -W, across)}${side('to-come', across, W + W)}`;
    }
    // One line, drawn twice and cut at now, so it doesn't kink where the dashes end. A gradient is
    // laid over it through a mask: under a zoom, WebKit puts a gradient on a non-scaling stroke in the
    // wrong place, and the line comes out in one colour.
    let masks = 0;
    const lineOf = (path: string, paint: string, more = '') => {
      const graded = paint.startsWith('url('),
        strokes = (attributes: string) =>
          `<path d="${path}" fill="none" stroke="${graded ? '#fff' : paint}" stroke-width="${look.lineWidth ?? LINE_WIDTH}" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"${graded ? '' : more}${attributes}/>`,
        line = fromNow
          ? strokes(ahead)
          : cut
            ? `${strokes(` stroke-dasharray="${PAST_DASH}" clip-path="url(#past-${uid})"`)}${strokes(` clip-path="url(#to-come-${uid})"`)}`
            : strokes(gone >= axis.hours ? ` stroke-dasharray="${PAST_DASH}"` : '');
      if (!graded) return line;
      masks += 1;
      defs += `<mask id="stroke-${masks}-${uid}" maskUnits="userSpaceOnUse" x="${OVERHANG.x}" y="${OVERHANG.y}" width="${OVERHANG.width}" height="${OVERHANG.height}">${line}</mask>`;
      return `<rect x="${OVERHANG.x}" y="${OVERHANG.y}" width="${OVERHANG.width}" height="${OVERHANG.height}" fill="${paint}" mask="url(#stroke-${masks}-${uid})"${more}/>`;
    };
    const { under } = look,
      below = heldToEnd(
        all.flatMap((point): XY[] => {
          const value = under?.read(point);
          return finite(value) ? [[point.hour, value]] : [];
        }),
      );
    if (under && below.length > 1) {
      const path = smoothPath(place(below), curve),
        [start, stop] = [below[0], below.at(-1)];
      if (under.fill && start && stop)
        series += `<path d="${path}L${x(stop[0])} ${H}L${x(start[0])} ${H}Z" fill="${under.fill}"${ahead}/>`;
      series += lineOf(path, under.stroke ?? stroke, under.opacity === undefined ? '' : ` opacity="${under.opacity}"`);
    }
    if (look.ranged) {
      if (band) {
        const edge = (list: readonly number[], hours: readonly number[]) =>
          smoothPath(hours.map(hour => [+x(hour * alongDay), +y(list[hour % HOURS_PER_DAY] ?? 0)]));
        series += `<path d="${edge(band.high, bandHours)}${edge(band.low, [...bandHours].reverse()).replace(/^M/, 'L')}Z" fill="url(#fill-${uid})"/>`;
      }
    } else if (!look.bare)
      series += `<path d="${line}L${x(end)} ${H}L${x(first.hour)} ${H}Z" fill="url(#fill-${uid})"${ahead}/>`;
    if (look.lifted)
      lifted = `<svg class="chart-lifted" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${lineOf(line, stroke)}</svg>`;
    else series += lineOf(line, stroke);
  }
  // The dot at now, and the rings at the day's lowest and highest. A ring needs a day that goes up
  // and down. The styles cut their holes from these places, as shares of the plot.
  const dotted = today && !look.dotless && drawn.length > 0,
    dot = dotted ? `<i class="chart-dot" style="left:${left(elapsed)};top:${top(lineAt(elapsed))}%"></i>` : '',
    highest = first && all.reduce((high, point) => (point.value > high.value ? point : high), first),
    lowest = first && all.reduce((low, point) => (point.value < low.value ? point : low), first),
    ringed =
      (look.extremes || ((look.highest === true || typeof look.highest === 'function') && !today)) &&
      highest &&
      lowest &&
      highest.value > lowest.value,
    down = (value: number) => height(value).toFixed(STOP_DIGITS),
    ring = (name: string, { hour, value }: PlotPoint) => `--${name}-x:${left(hour)};--${name}-y:${down(value)};`;
  const places =
    (gone > 0 ? `--now-x:${left(gone)};` : '') +
    (dotted ? `--now-y:${down(lineAt(elapsed))};` : '') +
    (ringed && look.extremes ? ring('low', lowest) : '') +
    (ringed ? ring('high', highest) : '');
  // Temperature's H and L, or UV's peak number, stand above their rings. Each label fades whole
  // when its time has passed, and stays within the plot even when an extreme falls at midnight.
  const extreme = (label: string, { hour, value }: PlotPoint) =>
      `<span class="chart-extreme"${hour < gone ? ' data-past' : ''} style="--extreme-x:${left(hour)};top:${top(value)}%">${label}</span>`,
    extremes = ringed
      ? look.extremes
        ? extreme('L', lowest) + extreme('H', highest)
        : typeof look.highest === 'function'
          ? extreme(look.highest(highest.value, ctx), highest)
          : ''
      : '',
    peak = look.peak && highest ? look.peak(highest.value, ctx) : '';
  const step = Math.abs((scale.ticks[1] ?? scale.max) - (scale.ticks[0] ?? scale.min)) || 1;
  const ticks = look.bars
    ? ''
    : scale.ticks
        .map(
          tick =>
            `<span style="top:${top(tick)}%">${tickText(tick, ctx)}${look.tickSuffix?.(tick, scale, ctx) ?? ''}</span>`,
        )
        .join('');
  const levels =
    look.levels && look.levels.length > 0
      ? `<div class="chart-bands">${look.levels
          .map(([value, label]) => `<span style="top:${top(value)}%">${say(label)}</span>`)
          .reverse()
          .join('')}</div>`
      : '';
  const hatch = look.hatched && gone > 0 ? '<i class="chart-hatch"></i>' : '';
  // What the chart reads, by hover or drag (see chart-scrub): its time, its value and what goes
  // with it (the gusts, the dew point), a line each. A line is read by the minute, along the line
  // as drawn: the value there, the gusts, the dew point and the like worked out the same way
  // between the readings that have them, and the weather and the direction from the nearest that
  // has one. A bar, and a chart read as an hour's span, are read an hour at a time, each hour with
  // the reading nearest it, as it stands; a bar at its middle.
  // The weather's icon beside a reading: each one once, in a template it's copied from (see
  // chart-scrub).
  const icons: string[] = [],
    iconOf = (point: PlotPoint | undefined) => {
      if (!point?.condition) return '';
      const icon = weatherIcon(point.condition, point.night === true);
      if (!icons.includes(icon)) icons.push(icon);
      return `<i data-icon="${icons.indexOf(icon)}"></i>`;
    };
  const hourClock = dateFormat(ctx.locale, { hour: 'numeric', timeZone: ctx.timeZone, hour12: ctx.hour12 }),
    hourName = (hour: number) => hourClock.format(axis.start + hour * HOUR).replace(/\s+(?=[AP]M)/i, ''),
    // An hour of precipitation reads from its start to its end: 10AM - 11AM.
    hourOf = (hour: number) => [hour, hour + 1].map(hourName).join(' - '),
    clock = clockOf(ctx);
  const nearest = (hour: number, list: readonly PlotPoint[]) =>
    list.reduce<PlotPoint | undefined>(
      (best, point) => (!best || Math.abs(point.hour - hour) < Math.abs(best.hour - hour) ? point : best),
      undefined,
    );
  // What goes with a reading comes from the nearest that has it, or along those that do.
  const bearings = all.filter(point => point.bearing !== undefined && point.bearing !== ''),
    dews = all.filter(point => finite(point.dew)),
    gusts = all.filter(point => finite(point.gust)),
    actuals = all.filter(point => finite(point.actual)),
    conditions = all.filter(point => point.condition),
    [bandLow, bandHigh] = band ? [bandAt(band.low), bandAt(band.high)] : [() => 0, () => 0],
    along = (read: (point: PlotPoint) => number | undefined): ((hour: number) => number | undefined) => {
      const xy = heldToEnd(
        all.flatMap((point): XY[] => {
          const value = read(point);
          return finite(value) ? [[point.hour, value]] : [];
        }),
      );
      return xy.length ? heightAt(xy, curve) : () => undefined;
    };
  const labelOf = (read: ChartRead) =>
    `${look.reads?.(read) ?? ctx.fmt(read.value, tickDigits(step))}\n${look.notes?.(read) ?? ''}`;
  const mark = (hour: number, near: PlotPoint, across: number, down: number): ChartMark => {
    const read: ChartRead = {
      ctx,
      hour,
      value: near.value,
      near,
      weather: look.weather ? (nearest(hour, conditions) ?? near) : near,
      bearing: nearest(hour, bearings)?.bearing,
      dew: nearest(hour, dews)?.dew,
      gust: nearest(hour, gusts)?.gust,
      actual: nearest(hour, actuals)?.actual,
      range: band ? [bandLow(hour), bandHigh(hour)] : undefined,
      icon: iconOf,
    };
    return [
      (across / axis.hours) * PERCENT,
      down,
      `${look.alone ? clock(axis.start + hour * HOUR) : hourOf(hour)}\n${labelOf(read)}`,
      Math.floor(hour),
    ];
  };
  const byMinute = !look.alone && !look.bars && !look.spans,
    marked = byMinute
      ? []
      : look.bars
        ? all.map(point => mark(point.hour, point, point.hour + 1 / 2, NO_DOT))
        : hoursAlong(all).flatMap(hour => {
            if (look.hatched && hour < Math.floor(gone)) return [];
            const near = nearest(hour, all);
            // The dot stays on the plot, should history go past a scale held from before it came.
            return near ? [mark(hour, near, hour, clamp(+top(lineAt(hour)), 0, PERCENT))] : [];
          });
  let line = '',
    selector = timeSelector(0, marked.length - 1);
  if (byMinute && first) {
    const [dewAt, gustAt, actualAt] = [
        along(point => point.dew),
        along(point => point.gust),
        along(point => point.actual),
      ],
      minutes = axis.hours * MINUTES_PER_HOUR,
      from = Math.ceil((drawn[0]?.[0] ?? first.hour) * MINUTES_PER_HOUR),
      // The line's last minute, before the next day's first.
      to = Math.max(from, Math.min(minutes - 1, Math.floor((drawn.at(-1)?.[0] ?? first.hour) * MINUTES_PER_HOUR)));
    const readAt = (minute: number) => {
      const hour = minute / MINUTES_PER_HOUR,
        near = nearest(hour, all) ?? first;
      return labelOf({
        ctx,
        hour,
        value: lineAt(hour),
        near,
        weather: look.weather ? (nearest(hour, conditions) ?? near) : near,
        bearing: nearest(hour, bearings)?.bearing,
        dew: dewAt(hour),
        gust: gustAt(hour),
        actual: actualAt(hour),
        range: band ? [bandLow(hour), bandHigh(hour)] : undefined,
        icon: iconOf,
      });
    };
    selector = timeSelector(from, to);
    line = ` data-line="${lineAttribute({
      start: axis.start,
      curve,
      places: drawn.map(([hour, value]): XY => [hour, +top(value)]),
      from,
      to,
      reads: readsAlong(from, to, readAt),
    })}"`;
  }
  const readings = pointsAttribute(marked),
    note = look.note && !all.length ? `<p class="chart-note">${look.note}</p>` : '';
  const iconSet = icons.length
    ? `<template class="chart-icons">${icons.map(icon => `<span class="detail-icon">${icon}</span>`).join('')}</template>`
    : '';
  return `<div class="chart" data-chart="${id}" data-size="${look.tall ? 'tall' : 'small'}"${look.flush ? ' data-flush' : ''}${look.framed ? ' data-framed' : ''}${elapsed >= axis.hours && !look.whole ? ' data-gone' : ''}${look.bars ? ' data-bars' : ''}${look.alone ? ' data-alone' : ''}${readout ? ` data-readout="${readout}"` : ''} data-hours="${axis.hours}" data-points="${readings}"${line}${places ? ` style="${places}"` : ''}><div class="chart-face">${hourLines}<div class="chart-plot">${hatch}<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><defs>${defs}</defs>${grid}${series}</svg>${lifted}${peak}</div><div class="chart-x" aria-hidden="true">${hourAxis(ctx, axis)}</div></div><div class="chart-marks" aria-hidden="true">${look.row ? chartRow(look.row, all, axis, gone, ctx) : ''}${levels}${extremes}${today ? '<i class="chart-rule"></i>' : ''}${dot}${note}</div>
    <div class="chart-y" aria-hidden="true">${ticks}</div>${iconSet}${selector}</div>`;
}
