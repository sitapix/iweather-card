import type { ReadingSpec } from '../../sheets/reading.ts';
import { glyphs } from '../shared/glyphs.ts';
import { attributeSeries, mean, range } from '../../sheets/series.ts';
import { finite } from '../../lib/values.ts';
import { PERCENT } from '../../lib/html.ts';
import { steppedScale } from '../../sheets/scale.ts';
import { shadeByValue } from '../../sheets/chart.ts';
import { scaleColor } from '../../weather/temperature-colors.ts';
import { values, compareResult } from '../../sheets/compare.ts';
import { phrase, say } from '../../weather/words.ts';
// Percentages run 0 to 100 in fifths, green when dry, through blue to purple when saturated. The
// colours mix in OKLab, so they are named every two percent.
const PERCENT_STEP = 20,
  HUMIDITY_SHADE_EVERY = 2;
const HUMIDITY_STOPS: readonly (readonly [value: number, color: string])[] = [
  [0, '#30d158'],
  [25, '#3cd3fe'],
  [75, '#0091ff'],
  [100, '#bf5af2'],
];
const ABOUT = [
  phrase('About Relative Humidity'),
  phrase(
    'Relative humidity is how much water vapor the air holds compared with the most it could hold at its temperature. Warmer air can hold more, so the same vapor reads as a lower humidity on a warmer day.',
  ),
] as const;
const ABOUT_DEW_POINT = [
  phrase('About Dew Point'),
  phrase(
    'The dew point is the temperature the air would need to cool to for dew to form. It tells you how humid the air feels better than relative humidity does: the higher it is, the muggier it feels.',
  ),
] as const;
// A day's sentences, by when the day is: its average, then its dew point when there is one.
const SAID = {
  today: {
    average: phrase('Today, the average humidity is {average}%.'),
    dew: phrase('The dew point is {low}° all day.'),
    dews: phrase('The dew point is {low}° to {high}°.'),
  },
  over: {
    average: phrase('Yesterday, the average humidity was {average}%.'),
    dew: phrase('The dew point was {low}° all day.'),
    dews: phrase('The dew point was {low}° to {high}°.'),
  },
  later: {
    average: phrase('On {day}, the average humidity will be {average}%.'),
    dew: phrase('The dew point will be {low}° all day.'),
    dews: phrase('The dew point will be {low}° to {high}°.'),
  },
} as const;
export const humidityReading: ReadingSpec = {
  glyph: glyphs.humidity,
  about: ABOUT,
  alsoAbout: ABOUT_DEW_POINT,
  series: attributeSeries('humidity'),
  chart: {
    id: 'humidity',
    shade: shadeByValue(value => scaleColor(HUMIDITY_STOPS, value), HUMIDITY_SHADE_EVERY),
    curve: 'catmullRom',
    tall: true,
    row: { slots: 4, reads: ({ value }, ctx) => `${ctx.fmt(value)}%` },
    tickSuffix: () => '%',
    reads: ({ ctx, value }) => `${ctx.fmt(value)}<small>%</small>`,
    notes: ({ ctx, dew }) => (finite(dew) ? say('Dew point: {dew}°', { dew: ctx.fmt(dew) }) : ''),
  },
  scale: () => steppedScale(0, PERCENT, PERCENT_STEP),
  summary({ ctx, today, day, values, tense, weekday, current }) {
    const { fmt } = ctx;
    const average = mean(values),
      dews = day.map(point => point.dew).filter(finite),
      [dewLow, dewHigh] = dews.length ? range(dews) : [NaN, NaN],
      said = SAID[tense];
    const dew = dews.length
      ? ` ${say(fmt(dewLow) === fmt(dewHigh) ? said.dew : said.dews, { low: fmt(dewLow), high: fmt(dewHigh) })}`
      : '';
    return {
      headline: `${fmt(current ? current.value : average)}<small>%</small>`,
      sub: today ? (finite(current?.dew) ? say('Dew point: {dew}°', { dew: fmt(current.dew) }) : '') : say('Average'),
      text: `${say(said.average, { day: weekday, average: fmt(average) })}${dew}`,
    };
  },
  compare(today, yesterday, { fmt }) {
    const a = Math.round(mean(values(today))),
      b = Math.round(mean(values(yesterday)));
    return compareResult('humidity', a, b, value => `${fmt(value)}%`, a === b);
  },
};
