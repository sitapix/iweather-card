import type { ReadingSpec } from '../../sheets/reading.ts';
import { glyphs } from '../shared/glyphs.ts';
import { attributeSeries, mean } from '../../sheets/series.ts';
import { pressureNumber, pressureTrend, type PressureTrend } from './rules.ts';
import { esc } from '../../lib/html.ts';
import { FILL_STRENGTH, STOP_DIGITS } from '../../sheets/chart.ts';
import { ceilTo, floorTo, steppedScale } from '../../sheets/scale.ts';
import { convertUnit, UNITS } from '../../weather/units.ts';
import { TREND_AHEAD_HOURS } from './rules.ts';
import { finite } from '../../lib/values.ts';
import { phrase, say } from '../../weather/words.ts';
// Pressure barely moves, so its ticks are set by unit and its scale keeps well clear of the readings:
// two steps either side. Hectopascals and millibars reach further: a series under 30 apart is shown
// 30 tall around its middle, and a wider one with 10 either side.
const PRESSURE_STEPS: Readonly<Record<string, number>> = {
    [UNITS.inchesOfMercury]: 0.5,
    [UNITS.hectopascals]: 5,
    [UNITS.millibars]: 5,
    [UNITS.millimetersOfMercury]: 10,
    [UNITS.kilopascals]: 1.5,
    [UNITS.pascals]: 1500,
  },
  HECTOPASCAL_SPAN = 30,
  HECTOPASCAL_MARGIN = 10;
// A plain purple line, over a fill of the same that thickens with the pressure itself, wherever the
// scale sits: from a tenth at 950 hPa to all of it at 1075.
const PRESSURE_PURPLE = '#db34f2',
  PRESSURE_FILL = { low: 950, high: 1075, thinnest: 0.1 } as const;
const inHectopascals = (unit: string | undefined) => unit === UNITS.hectopascals || unit === UNITS.millibars;
const ABOUT = [
  phrase('About Pressure'),
  phrase(
    'Quick changes in air pressure often come before a change in the weather. Falling pressure can mean rain or snow is on the way; rising pressure usually means the weather is improving.',
  ),
] as const;
// A trend's name and the sentence that gives it with the reading.
const TRENDS: Readonly<Record<PressureTrend, { name: string; now: string }>> = {
  rising: { name: phrase('Rising'), now: phrase('Pressure is currently {value} and rising.') },
  falling: { name: phrase('Falling'), now: phrase('Pressure is currently {value} and falling.') },
  steady: { name: phrase('Steady'), now: phrase('Pressure is currently {value} and steady.') },
};
// Thin, rounded arrows for changes, and an equals sign when the pressure holds steady.
const TREND_PATHS: Readonly<Record<PressureTrend, string>> = {
  rising: 'M8 14V2M3.5 6.5 8 2l4.5 4.5',
  falling: 'M8 2v12M3.5 9.5 8 14l4.5-4.5',
  steady: 'M3.5 6h9M3.5 10h9',
};
// A day's sentence, by when the day is: of an average at its lowest all day, or of the two.
const SAID = {
  today: {
    flat: phrase('Today, the pressure will be {average} all day.'),
    both: phrase('Today, the average pressure will be {average}, and the lowest pressure will be {low}.'),
  },
  over: {
    flat: phrase('Yesterday, the average pressure was {average} all day.'),
    both: phrase('Yesterday, the average pressure was {average}, and the lowest pressure was {low}.'),
  },
  later: {
    flat: phrase('On {day}, the average pressure will be {average} all day.'),
    both: phrase('On {day}, the average pressure will be {average}, and the lowest pressure will be {low}.'),
  },
} as const;
export const pressureReading: ReadingSpec = {
  glyph: glyphs.pressure,
  about: ABOUT,
  series: attributeSeries('pressure'),
  chart: {
    id: 'pressure',
    color: PRESSURE_PURPLE,
    shade: ({ uid, ctx, y }) => {
      const at = (hectopascals: number) =>
        y(convertUnit('pressure_unit', hectopascals, UNITS.hectopascals, ctx.attrs.pressure_unit));
      return {
        defs: `<linearGradient id="fill-${uid}" gradientUnits="userSpaceOnUse" x1="0" y1="${at(PRESSURE_FILL.low)}" x2="0" y2="${at(PRESSURE_FILL.high)}"><stop offset="0" stop-color="${PRESSURE_PURPLE}" stop-opacity="${(PRESSURE_FILL.thinnest * FILL_STRENGTH).toFixed(STOP_DIGITS)}"/><stop offset="1" stop-color="${PRESSURE_PURPLE}" stop-opacity="${FILL_STRENGTH}"/></linearGradient>`,
      };
    },
    curve: 'catmullRom',
    tall: true,
    row: {
      slots: 12,
      symbols: true,
      reads: (point, ctx, points) => {
        // The same three-hour change as the headline. Near midnight, use the hours ahead
        // until there are enough earlier readings; one reading alone has no known trend.
        const earlier = points.findLast(item => item.hour <= point.hour - TREND_AHEAD_HOURS),
          later = points.find(item => item.hour >= point.hour + TREND_AHEAD_HOURS),
          trend = pressureTrend(point.value, later?.value, ctx.attrs.pressure_unit, earlier?.value);
        return trend
          ? `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" d="${TREND_PATHS[trend]}"/></svg>`
          : '';
      },
    },
    reads: ({ ctx, value }) =>
      `${pressureNumber(value, ctx.attrs.pressure_unit, ctx.numbers)} <small>${esc(ctx.attrs.pressure_unit ?? '')}</small>`,
  },
  scale({ min, max }, { pressure_unit: unit }) {
    const step = PRESSURE_STEPS[unit ?? ''] ?? 1;
    if (!inHectopascals(unit)) return steppedScale(floorTo(min - 2 * step, step), ceilTo(max + 2 * step, step), step);
    if (max - min >= HECTOPASCAL_SPAN)
      return steppedScale(floorTo(min, step) - HECTOPASCAL_MARGIN, ceilTo(max, step) + HECTOPASCAL_MARGIN, step);
    const middle = (min + max) / 2;
    return steppedScale(middle - HECTOPASCAL_SPAN / 2, middle + HECTOPASCAL_SPAN / 2, step);
  },
  summary({ ctx, today, points, values, tense, weekday, low, current }) {
    const unit = ctx.attrs.pressure_unit ?? '',
      shown = esc(unit),
      number = (value: number) => pressureNumber(value, unit, ctx.numbers),
      at = (value: number) => `${number(value)} ${shown}`.trim(),
      average = mean(values),
      value = current ? current.value : average,
      said = SAID[tense],
      words = {
        day: weekday,
        average: at(average),
        low: at(low),
      };
    const later = current ? points.find(point => point.hour >= current.hour + TREND_AHEAD_HOURS)?.value : undefined,
      earlier = ctx.earlier?.['pressure'];
    const trend = current ? pressureTrend(current.value, later, unit, finite(earlier) ? earlier : undefined) : null;
    return {
      headline: `${number(value)} <small>${shown}</small>`,
      sub: today ? (trend ? say(TRENDS[trend].name) : '') : say('Average'),
      text: `${current && trend ? `${say(TRENDS[trend].now, { value: at(current.value) })} ` : ''}${say(
        at(average) === at(low) ? said.flat : said.both,
        words,
      )}`,
    };
  },
};
