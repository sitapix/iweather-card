import type { ReadingSpec } from '../../sheets/reading.ts';
import { glyphs } from '../shared/glyphs.ts';
import { attributeSeries, type PlotPoint } from '../../sheets/series.ts';
import { esc } from '../../lib/html.ts';
import { sheetSection } from '../../sheets/parts.ts';
import { finite } from '../../lib/values.ts';
import { shadeByValue } from '../../sheets/chart.ts';
import { ceilTo, floorTo, steppedScale } from '../../sheets/scale.ts';
import { scaleColor } from '../../weather/temperature-colors.ts';
import { BEAUFORT_LIMITS, convertUnit, UNITS } from '../../weather/units.ts';
import { BEAUFORT, bearingName, bearingPoint, beaufortSpeeds } from './rules.ts';
import { gusts, highest, compareResult } from '../../sheets/compare.ts';
import { phrase, say } from '../../weather/words.ts';
import { mapView } from '../../map/view.ts';
const ABOUT = [
  phrase('About Wind Speed and Gusts'),
  phrase(
    'Wind speed is averaged over a short period. Gusts are brief bursts above that average, usually lasting under 20 seconds.',
  ),
] as const;
const ABOUT_BEAUFORT = [
  phrase('About the Beaufort Scale'),
  phrase(
    'The Beaufort scale groups wind speeds by their effect, from calm at force 0 to hurricane force at 12, so a single number gives a sense of how the wind will feel and what it can move.',
  ),
] as const;
// The day's wind in whole sentences, each on its own and with its gusts, as tense and agreement
// differ by language: a speed or a force, steady or ranging, today, on a day that is over or on one
// to come.
const WIND_SENTENCES = {
  speeds: {
    steady: {
      today: [
        phrase('Today, wind speeds will be around {speed} all day.'),
        phrase('Today, wind speeds will be around {speed} all day, with gusts up to {gust}.'),
      ],
      over: [
        phrase('Yesterday, wind speeds were around {speed} all day.'),
        phrase('Yesterday, wind speeds were around {speed} all day, with gusts up to {gust}.'),
      ],
      later: [
        phrase('On {weekday}, wind speeds will be around {speed} all day.'),
        phrase('On {weekday}, wind speeds will be around {speed} all day, with gusts up to {gust}.'),
      ],
    },
    ranging: {
      today: [
        phrase('Today, wind speeds are {low} to {high}.'),
        phrase('Today, wind speeds are {low} to {high}, with gusts up to {gust}.'),
      ],
      over: [
        phrase('Yesterday, wind speeds were {low} to {high}.'),
        phrase('Yesterday, wind speeds were {low} to {high}, with gusts up to {gust}.'),
      ],
      later: [
        phrase('On {weekday}, wind speeds will be {low} to {high}.'),
        phrase('On {weekday}, wind speeds will be {low} to {high}, with gusts up to {gust}.'),
      ],
    },
  },
  force: {
    steady: {
      today: [
        phrase('Today, wind force will be around {speed} all day.'),
        phrase('Today, wind force will be around {speed} all day, with gusts up to {gust}.'),
      ],
      over: [
        phrase('Yesterday, wind force was around {speed} all day.'),
        phrase('Yesterday, wind force was around {speed} all day, with gusts up to {gust}.'),
      ],
      later: [
        phrase('On {weekday}, wind force will be around {speed} all day.'),
        phrase('On {weekday}, wind force will be around {speed} all day, with gusts up to {gust}.'),
      ],
    },
    ranging: {
      today: [
        phrase('Today, wind force is {low} to {high}.'),
        phrase('Today, wind force is {low} to {high}, with gusts up to {gust}.'),
      ],
      over: [
        phrase('Yesterday, wind force was {low} to {high}.'),
        phrase('Yesterday, wind force was {low} to {high}, with gusts up to {gust}.'),
      ],
      later: [
        phrase('On {weekday}, wind force will be {low} to {high}.'),
        phrase('On {weekday}, wind force will be {low} to {high}, with gusts up to {gust}.'),
      ],
    },
  },
} as const;
// Wind reads in fives, or twos in metres a second. On the Beaufort scale it reads every force up to
// the scale's top, and on to the extended scale's for a wind past it.
const WIND_STEP = 5,
  METRE_STEP = 2,
  BEAUFORT_TOP = BEAUFORT_LIMITS.length,
  BEAUFORT_EXTENDED = 17;
const isBeaufort = (unit: string | undefined) => unit === UNITS.beaufort || unit === UNITS.beaufortScale;
// A chart's colours go by the speed itself, in even steps from calm to 73 mph, each step mixing with
// the next in OKLab, and named at every whole unit of the speed shown. Gusts take the same colours,
// at half strength, under the wind.
const WIND_COLORS = BEAUFORT.slice(0, -1).map(({ color }) => color),
  WIND_COLOR_TOP = 73,
  WIND_SHADE_EVERY = 1,
  GUST_STRENGTH = 0.5;
export const windColor = (value: number, unit: string | undefined): string => {
  const top = convertUnit('wind_speed_unit', WIND_COLOR_TOP, UNITS.milesPerHour, unit);
  return scaleColor(
    WIND_COLORS.map((color, i) => [(i / (WIND_COLORS.length - 1)) * top, color]),
    value,
  );
};
// Every force with its name and the speeds it takes in, in the unit shown. On the Beaufort scale
// itself a third column would only say the first again.
const beaufortTable: NonNullable<ReadingSpec['table']> = ({ attrs, fmt }) => {
  const listed = beaufortSpeeds(attrs.wind_speed_unit, fmt);
  return sheetSection(
    say('Beaufort Scale'),
    `<table class="beaufort"><thead><tr><th scope="col">bft</th><th scope="col">${say('Description')}</th>${listed ? `<th scope="col">${esc(listed.unit)}</th>` : ''}</tr></thead><tbody>${BEAUFORT.map(
      ({ name, color }, force) =>
        `<tr><td><i style="background:${color}"></i>${force}</td><td>${say(name)}</td>${listed ? `<td>${esc(listed.speeds[force] ?? '')}</td>` : ''}</tr>`,
    ).join('')}</tbody></table>`,
  );
};
export const windReading: ReadingSpec = {
  glyph: glyphs.wind,
  about: ABOUT,
  table: beaufortTable,
  alsoAbout: ABOUT_BEAUFORT,
  series: { ...attributeSeries('wind_speed'), also: [attributeSeries('wind_gust_speed')] },
  chart: {
    id: 'wind',
    shade: shadeByValue((value, ctx) => windColor(value, ctx.attrs.wind_speed_unit), WIND_SHADE_EVERY),
    tall: true,
    under: {
      read: ({ gust, value }) => (finite(gust) ? Math.max(gust, value) : undefined),
      opacity: GUST_STRENGTH,
    },
    reads: ({ ctx, value, bearing }) =>
      `${ctx.fmt(value)} <small>${esc(`${ctx.attrs.wind_speed_unit ?? ''} ${bearingPoint(bearing)}`.trim())}</small>`,
    notes: ({ ctx, gust }) =>
      finite(gust)
        ? say('Gusts: {speed}', { speed: `${ctx.fmt(gust)} ${esc(ctx.attrs.wind_speed_unit ?? '')}`.trim() })
        : '',
  },
  scale({ min, max }, { wind_speed_unit: unit }) {
    if (isBeaufort(unit)) return steppedScale(0, max > BEAUFORT_TOP ? BEAUFORT_EXTENDED : BEAUFORT_TOP, 1);
    const step = unit === UNITS.metersPerSecond ? METRE_STEP : WIND_STEP;
    return steppedScale(Math.max(0, floorTo(min - step, step)), ceilTo(max + step, step), step);
  },
  summary({ ctx, day, over, tense, weekday, low, high, current }) {
    const { fmt } = ctx,
      unit = ctx.attrs;
    const speed = esc(unit.wind_speed_unit ?? ''),
      at = (value: number) => `${fmt(value)} ${speed}`.trim(),
      gusts = day.map(point => point.gust).filter(finite),
      gust = gusts.length ? Math.max(...gusts) : null,
      // On the Beaufort scale the wind is a force; in a speed unit it has speeds.
      force = isBeaufort(unit.wind_speed_unit),
      steady = fmt(low) === fmt(high),
      also = gust !== null && steady && fmt(gust) === fmt(low);
    const [alone, gusting] = WIND_SENTENCES[force ? 'force' : 'speeds'][steady ? 'steady' : 'ranging'][tense],
      reach = { weekday, speed: at(low), low: fmt(low), high: at(high) },
      span = gust !== null && !also ? say(gusting, { ...reach, gust: at(gust) }) : say(alone, reach),
      gustsToo =
        gust === null || !also
          ? ''
          : force
            ? over
              ? say('Gusts were {gust}.', { gust: at(gust) })
              : say('Gusts are {gust}.', { gust: at(gust) })
            : over
              ? say('Gusts were also {gust}.', { gust: at(gust) })
              : say('Gusts are also {gust}.', { gust: at(gust) });
    const from = current ? bearingName(current.bearing) : '',
      speedNow = current ? at(current.value) : '',
      now = !current
        ? ''
        : force
          ? from
            ? say('Wind is currently coming from the {direction} with a wind force of {speed}.', {
                direction: esc(from),
                speed: speedNow,
              })
            : ''
          : from
            ? say('Wind is currently {speed} from the {direction}.', { speed: speedNow, direction: esc(from) })
            : say('Wind is currently {speed}.', { speed: speedNow });
    return {
      headline: current
        ? `${fmt(current.value)} ${speed} <span class="detail-dim">${esc(bearingPoint(current.bearing))}</span>`
        : `${steady ? fmt(low) : `${fmt(low)}–${fmt(high)}`} ${speed}`,
      sub: current
        ? finite(current.gust)
          ? say('Gusts: {speed}', { speed: at(current.gust) })
          : ''
        : gust === null
          ? ''
          : say('Gusts up to {speed}', { speed: at(gust) }),
      text: [now, span, gustsToo].filter(Boolean).join(' '),
    };
  },
  // Today, a map of the wind around home (see map/views.ts), where the card has a map.
  todaySection: ctx =>
    mapView(ctx, 'wind')
      ? sheetSection(say('Map'), '<div class="radar sheet-map" data-kind="wind"></div>', {
          kind: 'sheet-map-section',
          plain: true,
        })
      : '',
  compare(today, yesterday, { fmt, attrs }) {
    const gusty = gusts(today).length > 0 && gusts(yesterday).length > 0,
      peak = (points: readonly PlotPoint[]) => Math.round(gusty ? Math.max(...gusts(points)) : highest(points)),
      a = peak(today),
      b = peak(yesterday),
      speed = esc(attrs.wind_speed_unit ?? '');
    return compareResult(gusty ? 'gust' : 'wind', a, b, value => `${fmt(value)} ${speed}`.trim(), a === b);
  },
};
