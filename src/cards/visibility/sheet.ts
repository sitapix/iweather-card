import type { ReadingSpec } from '../../sheets/reading.ts';
import { glyphs } from '../shared/glyphs.ts';
import { attributeSeries } from '../../sheets/series.ts';
import { H, FILL_STRENGTH, STOP_DIGITS } from '../../sheets/chart.ts';
import { esc } from '../../lib/html.ts';
import { smallValueDigits } from '../../lib/formats.ts';
import { niceScale, steppedScale } from '../../sheets/scale.ts';
import { visibilityBand, visibilityKm, visibilityLabel, visibilityWord } from './rules.ts';
import { highest } from '../../sheets/compare.ts';
import { phrase, say } from '../../weather/words.ts';
// Visibility's fill: white, by value along the scale, so a clear day shows little of it and a
// foggy one a bright floor.
export const VISIBILITY_FILL = [
  [0, 0.75],
  [0.24, 0.25],
  [0.5, 0.12],
  [1, 0.1],
] as const;
// Visibility reads against the same scale every day, in fives, and a reading goes no further than a
// step short of its top.
const VISIBILITY_TOP: Readonly<Record<string, number>> = { mi: 30, km: 45 },
  VISIBILITY_STEP = 5;
const farthest = (unit: string | undefined) => {
  const top = VISIBILITY_TOP[unit ?? ''];
  return top === undefined ? Infinity : top - VISIBILITY_STEP;
};
const ABOUT = [
  phrase('About Visibility'),
  phrase(
    'Visibility is how far you can see through the air before distant things blur. It depends on how clear the air is, not on daylight or on what stands in the way. At 10 km (6 mi) or more, the air counts as clear.',
  ),
] as const;
// A day's sentence, by when the day is: of one reading, of several in one band, or of two bands.
// A band stays a value: six of them in three sentences on three days are too many to write out, and
// what fills it describes only visibility (see VISIBILITY_WORDS).
const SAID = {
  today: {
    reading: phrase('Today, the visibility will be {band}, at {low}.'),
    span: phrase('Today, the visibility will be {band}, at {low} to {high}.'),
    bands: phrase('Today, the lowest visibility will be {band} at {low}, and the highest will be {top} at {high}.'),
  },
  over: {
    reading: phrase('Yesterday, the visibility was {band}, at {low}.'),
    span: phrase('Yesterday, the visibility was {band}, at {low} to {high}.'),
    bands: phrase('Yesterday, the lowest visibility was {band} at {low}, and the highest was {top} at {high}.'),
  },
  later: {
    reading: phrase('On {day}, the visibility will be {band}, at {low}.'),
    span: phrase('On {day}, the visibility will be {band}, at {low} to {high}.'),
    bands: phrase('On {day}, the lowest visibility will be {band} at {low}, and the highest will be {top} at {high}.'),
  },
} as const;
export const visibilityReading: ReadingSpec = {
  glyph: glyphs.visibility,
  about: ABOUT,
  series: attributeSeries('visibility'),
  chart: {
    id: 'visibility',
    curve: 'catmullRom',
    tall: true,
    row: { slots: 12, reads: ({ value }, ctx) => ctx.fmt(value, smallValueDigits(value)) },
    ceiling: ({ attrs }) => farthest(attrs.visibility_unit),
    shade: ({ uid, scale, y }) => ({
      defs: `<linearGradient id="fill-${uid}" gradientUnits="userSpaceOnUse" x1="0" y1="${H}" x2="0" y2="${y(scale.ticks.at(-1) ?? scale.max)}">${VISIBILITY_FILL.map(([at, alpha]) => `<stop offset="${at}" stop-color="#fff" stop-opacity="${(alpha * FILL_STRENGTH).toFixed(STOP_DIGITS)}"/>`).join('')}</linearGradient>`,
    }),
    tickSuffix: (tick, scale, ctx) => (tick === scale.min ? ` ${esc(ctx.attrs.visibility_unit ?? '')}` : ''),
    reads: ({ ctx, value }) =>
      `${ctx.fmt(value, smallValueDigits(value))} <small>${esc(ctx.attrs.visibility_unit ?? '')}</small>`,
  },
  scale({ min, max }, { visibility_unit: unit }) {
    const top = VISIBILITY_TOP[unit ?? ''];
    return top === undefined ? niceScale([min, max]) : steppedScale(0, top, VISIBILITY_STEP);
  },
  summary({ ctx, tense, weekday, low, high, current }) {
    const { fmt } = ctx;
    const unit = ctx.attrs.visibility_unit ?? '',
      shown = esc(unit),
      // Distances read as they show: a tenth below 10.
      distance = (amount: number) => {
        const seen = Math.min(amount, farthest(unit));
        return fmt(seen, smallValueDigits(seen));
      },
      at = (amount: number) => `${distance(amount)} ${shown}`.trim(),
      oneBand = visibilityBand(visibilityKm(low, unit)) === visibilityBand(visibilityKm(high, unit)),
      said = SAID[tense],
      words = {
        day: weekday,
        band: visibilityWord(low, unit),
        top: visibilityWord(high, unit),
      };
    return {
      headline: current
        ? `${distance(current.value)} <small>${shown}</small>`
        : `${distance(low) === distance(high) ? distance(low) : `${distance(low)}–${distance(high)}`} <small>${shown}</small>`,
      sub: current
        ? visibilityLabel(current.value, unit)
        : oneBand
          ? visibilityLabel(low, unit)
          : say('{low} to {high}', { low: visibilityLabel(low, unit), high: words.top }),
      text:
        distance(low) === distance(high)
          ? say(said.reading, { ...words, low: at(low) })
          : oneBand
            ? say(said.span, { ...words, low: distance(low), high: at(high) })
            : say(said.bands, { ...words, low: at(low), high: at(high) }),
    };
  },
  compare(today, yesterday, { fmt, attrs }) {
    const most = farthest(attrs.visibility_unit),
      a = Math.min(highest(today), most),
      b = Math.min(highest(yesterday), most),
      shown = (value: number) => `${fmt(value, smallValueDigits(value))} ${esc(attrs.visibility_unit ?? '')}`.trim(),
      same = shown(a) === shown(b);
    return {
      text: same
        ? say('Visibility today is similar to yesterday.')
        : a > b
          ? say('Visibility today is greater than yesterday.')
          : say('Visibility today is less than yesterday.'),
      today: a,
      yesterday: b,
      shown: [shown(a), shown(b)],
    };
  },
};
