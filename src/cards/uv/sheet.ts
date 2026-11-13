import { type ChartPoint, attributeSeries } from '../../sheets/series.ts';
import type { SummaryContext, ReadingSpec } from '../../sheets/reading.ts';
import { UV, uvLevel, uvSummary } from './rules.ts';
import { clockOf } from '../../sheets/time.ts';
import { HOUR } from '../../lib/time.ts';
import { glyphs } from '../shared/glyphs.ts';
import { shadeByValue } from '../../sheets/chart.ts';
import { steppedScale } from '../../sheets/scale.ts';
import { scaleColor } from '../../weather/temperature-colors.ts';
import { highest, compareResult } from '../../sheets/compare.ts';
import { phrase, say } from '../../weather/words.ts';
const UV_STOPS: readonly (readonly [value: number, color: string])[] = [
  [0, '#30d158'],
  [3, '#ffd600'],
  [6, '#ff9230'],
  [8, '#ff375f'],
  [11, '#db34f2'],
];
const UV_LEVEL_LINES: readonly (readonly [value: number, label: string])[] = [
  [1, phrase('Low')],
  [3, phrase('Moderate')],
  [6, phrase('High')],
  [8, phrase('Very High')],
  [11, phrase('Extreme')],
];
// UV reads from 0 to 11 in ones until the series' peak passes 9, then to two past that peak. Its
// colours mix in OKLab, so they are named every quarter.
const UV_CLEAR = 9,
  UV_ROOM = 2,
  UV_SHADE_EVERY = 0.25;
const ABOUT = [
  phrase('About the UV Index'),
  phrase(
    'The UV index measures the strength of the sun’s ultraviolet radiation. The higher it is, the faster unprotected skin can burn. At 3 (moderate) and above, the World Health Organization advises shade, sunscreen, a hat and covering clothing.',
  ),
] as const;
// When the day's UV is Moderate or more: from its first reading at that level to the next reading
// after its last (an hour after it, at the end of the day); reached already once that is past,
// every hour when none is lower.
function uvHours(points: readonly ChartPoint[], ctx: SummaryContext, today: boolean): string {
  const high = (point: ChartPoint) => point.value >= UV.moderate,
    from = points.find(high),
    last = points.findLastIndex(high);
  if (!from) return '';
  const hour = clockOf(ctx, false),
    allDay = points.every(high),
    to = points[last + 1]?.time ?? (points[last]?.time ?? ctx.now) + HOUR,
    hours = { from: hour(from.time), to: hour(to) };
  if (!today)
    return allDay
      ? say('Sun protection recommended all day.')
      : say('Sun protection recommended from {from} to {to}.', hours);
  if (allDay) return ` ${say('Levels of Moderate or higher are reached all day.')}`;
  return ` ${
    to <= ctx.now
      ? say('Levels of Moderate or higher were reached from {from} to {to}.', hours)
      : say('Levels of Moderate or higher are reached from {from} to {to}.', hours)
  }`;
}
export const uvReading: ReadingSpec = {
  glyph: glyphs.uv,
  about: ABOUT,
  series: attributeSeries('uv_index'),
  headedByNow: true,
  chart: {
    id: 'uv',
    tall: true,
    highest: (value, ctx) => ctx.fmt(value),
    shade: shadeByValue(value => scaleColor(UV_STOPS, value), UV_SHADE_EVERY),
    levels: UV_LEVEL_LINES,
    weather: true,
    row: { slots: 12, reads: ({ value }, ctx) => ctx.fmt(value) },
    reads: ({ ctx, value, icon, weather }) =>
      `${ctx.fmt(value)} <small>${uvLevel(Math.round(value))}</small>${icon(weather)}`,
  },
  scale({ max }) {
    const end = max > UV_CLEAR ? max + UV_ROOM : UV.extreme;
    return steppedScale(0, end, 1, Math.floor(end));
  },
  summary({ ctx, day, over, high, current }) {
    const { fmt } = ctx;
    const value = current ? current.value : high;
    return {
      headline: `${fmt(value)} <small>${uvLevel(Math.round(value))}</small>`,
      sub: say('World Health Organization UVI'),
      text: current
        ? `${uvSummary(current.value, ctx.hourly, ctx.now, ctx.timeZone)}${uvHours(day, ctx, true)}`
        : over
          ? say('Yesterday, the highest UV index was {index}.', { index: fmt(high) })
          : high >= UV.moderate
            ? uvHours(day, ctx, false)
            : say('Low levels all day.'),
    };
  },
  compare(today, yesterday, { fmt }) {
    const a = Math.round(highest(today)),
      b = Math.round(highest(yesterday));
    return compareResult('uv', a, b, value => fmt(value), a === b);
  },
};
