import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { EntityAttributes } from '../src/card/home-assistant.ts';
import { averagesScale } from '../src/cards/averages/sheet.ts';
import { feelsLike, feelsSeries } from '../src/cards/feels-like/rules.ts';
import { ACTUAL, FELT, temperatureScale } from '../src/cards/forecast/conditions.ts';
import { humidityReading } from '../src/cards/humidity/sheet.ts';
import { chanceLook, chanceScale, precipitationLook, precipitationScale } from '../src/cards/precipitation/looks.ts';
import { KIND_COLORS } from '../src/cards/precipitation/totals.ts';
import { pressureReading } from '../src/cards/pressure/sheet.ts';
import { uvReading } from '../src/cards/uv/sheet.ts';
import { visibilityReading } from '../src/cards/visibility/sheet.ts';
import { windColor, windReading } from '../src/cards/wind/sheet.ts';
import { weatherNumber } from '../src/lib/formats.ts';
import { axisMarks, chartMarkup, hourAxis, type ChartLook } from '../src/sheets/chart.ts';
import { smoothPath } from '../src/sheets/curve.ts';
import { clockOf } from '../src/sheets/time.ts';
import { attributeIn, lineIn } from './chart-line.ts';
import type { ChartMark } from '../src/sheets/chart-scrub.ts';
import { dayAxis, hoursInto } from '../src/sheets/days.ts';
import { ceilTo, floorTo } from '../src/sheets/scale.ts';
import { detailSeries, earlierPoints, seriesReach, type PlotPoint, type SeriesData } from '../src/sheets/series.ts';
import { dailyItems, forecasts } from '../src/weather/forecast-items.ts';
import { scaleColor, temperatureColor } from '../src/weather/temperature-colors.ts';
import { convertUnit } from '../src/weather/units.ts';

const HOUR = 3_600_000,
  CHICAGO = 'America/Chicago';
const at = (time: string) => Date.parse(time);
// A chart's context on the clock given.
const FAHRENHEIT: EntityAttributes = { temperature_unit: '°F' };
const context = (now: number, attrs = FAHRENHEIT, timeZone = CHICAGO) => ({
  id: 'card',
  attrs,
  now,
  timeZone,
  locale: 'en-US',
  numbers: 'en-US',
  hour12: true,
  fmt: (value: number | null | undefined, digits = 0) => weatherNumber(value, 'en-US', digits),
});
const labels = (markup: string) => [...markup.matchAll(/<span style="left:[\d.]+%">(.*?)<\/span>/g)].map(m => m[1]);
const scaleLabels = (chart: string) =>
  [...(/<div class="chart-y"[^>]*>(.*?)<\/div>/.exec(chart)?.[1] ?? '').matchAll(/>([^<]+)<\/span>/g)].map(m => m[1]);
const topRow = (markup: string) => /<div class="chart-top"[^>]*>(.*?)<\/div>/.exec(markup)?.[1] ?? '';
const line = (from: number, to: number) => [
  { hour: from, value: 60 },
  { hour: to, value: 70 },
];

test('floorTo and ceilTo round to a multiple and leave a multiple alone', () => {
  assert.equal(floorTo(38, 8), 32);
  assert.equal(ceilTo(88.4, 8), 96);
  assert.equal(floorTo(40, 8), 40);
  assert.equal(ceilTo(40, 8), 40);
  assert.equal(floorTo(-5, 15), -15);
  assert.equal(ceilTo(100.5, 1.5), 100.5);
  assert.equal(floorTo(29.5, 0.5), 29.5);
});

// A date's start and length wherever the clocks do something odd.
const DAYS: readonly (readonly [zone: string, moment: string, start: string, hours: number])[] = [
  [CHICAGO, '2026-10-31T17:00:00Z', '2026-10-31T05:00:00Z', 24],
  [CHICAGO, '2026-11-01T17:00:00Z', '2026-11-01T05:00:00Z', 25],
  [CHICAGO, '2026-03-08T17:00:00Z', '2026-03-08T06:00:00Z', 23],
  ['Asia/Tokyo', '2026-10-31T07:00:00Z', '2026-10-30T15:00:00Z', 24],
  ['UTC', '2026-10-31T07:00:00Z', '2026-10-31T00:00:00Z', 24],
  // Midnight skipped, and midnight twice over.
  ['America/Havana', '2026-03-08T20:00:00Z', '2026-03-08T05:00:00Z', 23],
  ['America/Havana', '2026-11-01T20:00:00Z', '2026-11-01T04:00:00Z', 25],
  // The half-hour change.
  ['Australia/Lord_Howe', '2026-04-05T04:00:00Z', '2026-04-04T13:00:00Z', 24.5],
  ['Australia/Lord_Howe', '2026-10-04T04:00:00Z', '2026-10-03T13:30:00Z', 23.5],
];
test('a day runs from its first moment for as long as the clocks make it', () => {
  for (const [zone, moment, start, hours] of DAYS) {
    assert.deepEqual({ ...dayAxis(at(moment), zone), timeZone: zone }, { start: at(start), hours, timeZone: zone });
    // Every moment of the day finds the same one, whichever side of the change it falls.
    for (let hour = 0; hour < hours; hour++) {
      assert.equal(dayAxis(at(start) + hour * HOUR, zone).start, at(start), `${zone} ${moment} hour ${hour}`);
      assert.equal(hoursInto(at(start) + hour * HOUR, zone), hour);
    }
    assert.notEqual(dayAxis(at(start) - 1, zone).start, at(start));
    assert.notEqual(dayAxis(at(start) + hours * HOUR, zone).start, at(start));
  }
});
test('a forecast entry’s time is an instant, so an hour repeated by the clocks is two places', () => {
  const [first, second, same] = forecasts([
    { datetime: '2026-11-01T01:00:00-05:00' },
    { datetime: '2026-11-01T01:00:00-06:00' },
    { datetime: '2026-11-01T07:00:00+00:00' },
  ]);
  assert.ok(first && second);
  assert.equal(second.time, first.time + HOUR);
  assert.equal(hoursInto(first.time, CHICAGO), 1);
  assert.equal(hoursInto(second.time, CHICAGO), 2);
  // The same moment written another way is the same entry.
  assert.equal(same, undefined);
});
test('an axis is marked every six hours gone, with the last mark inside a long day', () => {
  const hours = (start: string) => {
    const axis = dayAxis(at(start), CHICAGO);
    return {
      marks: axisMarks(axis),
      read: labels(hourAxis({ locale: 'en-US', hour12: true, timeZone: CHICAGO }, axis)),
    };
  };
  const small = (read: readonly (string | undefined)[]) => read.map(text => text?.replace(/<\/?small>/g, ''));
  assert.deepEqual(small(hours('2026-10-31T12:00:00Z').read), ['12AM', '6AM', '12PM', '6PM']);
  assert.deepEqual(small(hours('2026-11-01T12:00:00Z').read), ['12AM', '5AM', '11AM', '5PM']);
  assert.deepEqual(small(hours('2026-03-08T12:00:00Z').read), ['12AM', '7AM', '1PM', '7PM']);
  assert.deepEqual(hours('2026-11-01T12:00:00Z').marks, [0, 6, 12, 18, 24]);
  assert.deepEqual(hours('2026-03-08T12:00:00Z').marks, [0, 6, 12, 18]);
  // Each hour of a 25-hour day has a place of its own, and the marks fall by time gone.
  const axis = dayAxis(at('2026-11-01T12:00:00Z'), CHICAGO),
    entries = Array.from({ length: 25 }, (_, hour) => ({ time: axis.start + hour * HOUR, wind_speed: hour + 1 })),
    points = detailSeries(windReading.series, entries, {}, axis.start, CHICAGO, false),
    chart = chartMarkup(windReading.chart, points, windReading.scale({ min: 1, max: 25 }, {}), context(0), axis);
  assert.deepEqual(
    points.map(point => point.hour),
    Array.from({ length: 25 }, (_, hour) => hour),
  );
  assert.match(chart, /<i class="chart-hour" style="left:24\.0%">/);
  assert.match(chart, /<i class="chart-hour" data-last style="left:96\.0%">/);
  // A short day ends on its last mark, and the first mark has no line.
  const short = chartMarkup(
    windReading.chart,
    line(0, 22),
    windReading.scale({ min: 1, max: 25 }, {}),
    context(0),
    dayAxis(at('2026-03-08T12:00:00Z'), CHICAGO),
  );
  assert.equal((short.match(/class="chart-hour"/g) ?? []).length, 3);
  assert.match(short, /data-last style="left:78\.3%"/);
  assert.doesNotMatch(short, /class="chart-hour[^>]*left:0/);
});

const stepped = (min: number, max: number, step: number) => {
  const ticks = [];
  for (let tick = Math.ceil(min / step) * step; tick <= max + 1e-9; tick += step) ticks.push(+tick.toFixed(4));
  return { min, max, ticks };
};
// Temperatures and feels-like, in the unit shown: the table runs on the numbers as they read.
const TEMPERATURES: readonly (readonly [low: number, high: number, min: number, max: number, step: number])[] = [
  [46, 79, 32, 96, 8],
  [45, 74, 32, 88, 8],
  [10, 90, -15, 120, 15],
  [20, 80, 0, 96, 12],
  [30, 72, 20, 90, 10],
  [50, 76, 42, 84, 6],
  [55, 75, 50, 80, 5],
  [60, 78, 57, 84, 3],
  [58, 67, 54, 72, 3],
  [60, 60, 57, 63, 3],
  // In Celsius.
  [8, 26, 3, 33, 3],
  [7, 29, 0, 35, 5],
  [-12, 3, -15, 9, 3],
];
test('a temperature scale comes from the series’ span, with a fifth of the way up above it', () => {
  for (const [low, high, min, max, step] of TEMPERATURES)
    assert.deepEqual(temperatureScale({ min: low, max: high }), stepped(min, max, step), `${low} to ${high}`);
});

// Speed and gusts, by unit.
const WINDS: readonly (readonly [unit: string, low: number, high: number, min: number, max: number, step: number])[] = [
  ['mph', 3, 21, 0, 30, 5],
  ['mph', 4, 33, 0, 40, 5],
  ['mph', 20, 30, 15, 35, 5],
  ['km/h', 12, 40, 5, 45, 5],
  ['kn', 6, 21, 0, 30, 5],
  ['m/s', 1.5, 14, 0, 16, 2],
  ['m/s', 8, 11, 6, 14, 2],
  ['bft', 2, 6, 0, 12, 1],
  ['Beaufort', 3, 14, 0, 17, 1],
];
test('a wind scale takes its steps from the unit and never goes below calm', () => {
  for (const [unit, low, high, min, max, step] of WINDS)
    assert.deepEqual(
      windReading.scale({ min: low, max: high }, { wind_speed_unit: unit }),
      stepped(min, max, step),
      `${low} to ${high} ${unit}`,
    );
});

const PRESSURES: readonly (readonly [
  unit: string,
  low: number,
  high: number,
  min: number,
  max: number,
  step: number,
])[] = [
  ['inHg', 29.84, 30.22, 28.5, 31.5, 0.5],
  ['hPa', 1005, 1021, 998, 1028, 5],
  ['hPa', 1009.4, 1016.7, 998.05, 1028.05, 5],
  ['mbar', 1005, 1021, 998, 1028, 5],
  ['hPa', 980, 1020, 970, 1030, 5],
  ['mbar', 985.2, 1022.8, 975, 1035, 5],
  ['mmHg', 750, 770, 730, 790, 10],
  ['kPa', 100.1, 102.3, 96, 106.5, 1.5],
  ['psi', 14.4, 14.9, 12, 17, 1],
  ['Pa', 100_500, 102_300, 97_500, 106_500, 1500],
];
test('a pressure scale keeps clear of the readings, by unit', () => {
  for (const [unit, low, high, min, max, step] of PRESSURES)
    assert.deepEqual(
      pressureReading.scale({ min: low, max: high }, { pressure_unit: unit }),
      stepped(min, max, step),
      `${low} to ${high} ${unit}`,
    );
});
test('a pressure tick reads to a decimal, dropping a nought', () => {
  const scale = pressureReading.scale({ min: 29.84, max: 30.22 }, { pressure_unit: 'inHg' }),
    today = dayAxis(at('2026-10-31T17:00:00Z'), CHICAGO),
    read = (of: typeof scale) => scaleLabels(chartMarkup(pressureReading.chart, line(1, 2), of, context(0), today));
  assert.deepEqual(read(scale), ['28.5', '29', '29.5', '30', '30.5', '31', '31.5']);
});
test('hectopascals tick on fives, whatever the readings’ middle comes to', () => {
  const scale = pressureReading.scale({ min: 1009.7, max: 1016.9 }, { pressure_unit: 'hPa' }),
    today = dayAxis(at('2026-10-31T17:00:00Z'), CHICAGO),
    drawn = chartMarkup(pressureReading.chart, line(1, 2), scale, context(0), today);
  assert.equal(scale.min, 998.3);
  assert.equal(scale.max, 1028.3);
  assert.deepEqual(scaleLabels(drawn), ['1,000', '1,005', '1,010', '1,015', '1,020', '1,025']);
  // Each stands where its value does, not where the scale's ends would put it.
  const place = (tick: number) => 40 / 273.75 + (1 - 40 / 273.75) * (1 - (tick - scale.min) / (scale.max - scale.min));
  assert.match(drawn, new RegExp(`top:${(place(1000) * 100).toFixed(1)}%">1,000`));
});

test('a temperature has one colour, in whichever unit it is shown', () => {
  assert.equal(temperatureColor(21.11, '°C'), temperatureColor(70, '°F'));
  assert.equal(temperatureColor(-84.44, '°C'), temperatureColor(-120, '°F'));
  assert.equal(temperatureColor(48.9, '°C'), temperatureColor(120, '°F'));
});
test('a chart with a fixed scale ignores how the readings fall', () => {
  const any = { min: 3, max: 70 };
  assert.deepEqual(humidityReading.scale(any, {}), stepped(0, 100, 20));
  assert.deepEqual(precipitationScale(), stepped(0, 3, 1));
  assert.deepEqual(chanceScale(), { ...stepped(0, 100, 20), max: 120 });
  assert.deepEqual(visibilityReading.scale(any, { visibility_unit: 'mi' }), stepped(0, 30, 5));
  assert.deepEqual(visibilityReading.scale(any, { visibility_unit: 'km' }), stepped(0, 45, 5));
  assert.deepEqual(uvReading.scale({ min: 0, max: 9 }, {}), stepped(0, 11, 1));
  assert.deepEqual(uvReading.scale({ min: 0, max: 11 }, {}), stepped(0, 13, 1));
});
test('every tick has its label, in its reading’s own way', () => {
  const today = dayAxis(at('2026-10-31T17:00:00Z'), CHICAGO),
    read = (look: ChartLook, scale: ReturnType<typeof temperatureScale>, attrs?: EntityAttributes) =>
      scaleLabels(chartMarkup(look, line(1, 2), scale, context(0, attrs), today));
  // Nine of them, with none dropped for space.
  assert.deepEqual(read(ACTUAL.chart, temperatureScale({ min: 46, max: 79 })), [
    '32°',
    '40°',
    '48°',
    '56°',
    '64°',
    '72°',
    '80°',
    '88°',
    '96°',
  ]);
  assert.deepEqual(read(humidityReading.chart, humidityReading.scale({ min: 0, max: 1 }, {})), [
    '0%',
    '20%',
    '40%',
    '60%',
    '80%',
    '100%',
  ]);
  // The chance's scale runs on past 100%, with nothing at its top.
  assert.deepEqual(read(chanceLook, chanceScale()), ['0%', '20%', '40%', '60%', '80%', '100%']);
  assert.deepEqual(read(precipitationLook, precipitationScale()), []);
  const miles = { visibility_unit: 'mi' };
  assert.deepEqual(read(visibilityReading.chart, visibilityReading.scale({ min: 3, max: 9 }, miles), miles), [
    '0 mi',
    '5',
    '10',
    '15',
    '20',
    '25',
    '30',
  ]);
});
test('the averages’ scale spans today and the normal band, and ends a step above its last label', () => {
  assert.deepEqual(averagesScale([58, 81, 45, 75], '°F'), { ...stepped(40, 90, 5), max: 95 });
  assert.deepEqual(averagesScale([58, 81, 45, 75], 'K'), { ...stepped(40, 90, 5), max: 95 });
  // Up, not down, from a step under the lowest.
  assert.deepEqual(averagesScale([7.4, 27.2], '°C'), { ...stepped(6, 33, 3), max: 36 });
});

// A forecast, history and today's reading for the same sheet.
const NOW = at('2026-10-31T17:00:00Z'),
  hourlyEntry = (hour: number, temperature: number, more = {}) => ({
    time: NOW + hour * HOUR,
    datetime: new Date(NOW + hour * HOUR).toISOString(),
    temperature,
    ...more,
  }),
  dayEntry = (days: number, high: number, low: number, more = {}) =>
    dailyItems(
      [{ datetime: new Date(NOW + days * 24 * HOUR).toISOString(), temperature: high, templow: low, ...more }],
      NOW,
      CHICAGO,
      {},
    )[0] ?? { time: 0, high: null, low: null, today: false, sky: { condition: 'sunny', night: false } },
  row = (hoursAgo: number, a: object) => ({ lu: (NOW - hoursAgo * HOUR) / 1000, s: 'sunny', a });
const data = (over: Partial<SeriesData> = {}): SeriesData => ({
  attrs: { temperature: 60, temperature_unit: '°F' },
  hourly: [hourlyEntry(0, 60), hourlyEntry(1, 58)],
  pastHours: [],
  daily: [],
  history: undefined,
  timeZone: CHICAGO,
  ...over,
});
test('a reading’s reach runs over its forecast, its history and the reading now', () => {
  assert.deepEqual(seriesReach(ACTUAL.series, data()), { min: 58, max: 60 });
  assert.deepEqual(seriesReach(ACTUAL.series, data({ attrs: { temperature: 66 } })), { min: 58, max: 66 });
  // Yesterday counts, and so does earlier today.
  const history = { yesterday: [row(30, { temperature: 79 })], today: [row(3, { temperature: 46 })] };
  assert.deepEqual(seriesReach(ACTUAL.series, data({ history })), { min: 46, max: 79 });
  assert.deepEqual(seriesReach(ACTUAL.series, data({ pastHours: [hourlyEntry(-20, 47)] })), { min: 47, max: 60 });
  assert.equal(seriesReach({ hour: () => undefined }, data()), null);
});
test('a chart’s two readings share a reach', () => {
  const feels = data({ hourly: [hourlyEntry(0, 60, { apparent_temperature: 52 })] });
  assert.deepEqual(seriesReach(ACTUAL.series, feels), { min: 52, max: 60 });
  const gusts = data({
    attrs: { wind_speed: 5, wind_speed_unit: 'mph' },
    hourly: [hourlyEntry(0, 60, { wind_speed: 4, wind_gust_speed: 31 }), hourlyEntry(1, 60, { wind_speed: 7 })],
    history: { yesterday: [row(30, { wind_speed: 3, wind_gust_speed: 40 })], today: [] },
  });
  assert.deepEqual(seriesReach(windReading.series, gusts), { min: 3, max: 40 });
});
test('the daily forecast counts from the last day with hours', () => {
  const hours = [hourlyEntry(0, 60), hourlyEntry(1, 58)];
  // Today has hours, so its daily high stays out; a later day's range goes in.
  assert.deepEqual(seriesReach(ACTUAL.series, data({ hourly: hours, daily: [dayEntry(4, 88, 40)] })), {
    min: 40,
    max: 88,
  });
  const after = hourlyEntry(30, 60),
    earlierDay = dayEntry(0, 95, 20);
  assert.deepEqual(seriesReach(ACTUAL.series, data({ hourly: [...hours, after], daily: [earlierDay] })), {
    min: 58,
    max: 60,
  });
  // Wind counts its gusts there too, and UV its peak.
  const windy = dayEntry(4, 88, 40, { wind_speed: 12, wind_gust_speed: 44 }),
    wind = data({ attrs: {}, hourly: [hourlyEntry(0, 60, { wind_speed: 6 })], daily: [windy] });
  assert.deepEqual(seriesReach(windReading.series, wind), { min: 6, max: 44 });
  const sunny = dayEntry(4, 88, 40, { uv_index: 10 });
  assert.equal(seriesReach(uvReading.series, data({ daily: [sunny] }))?.max, 10);
  // With no hours at all, every day counts.
  assert.deepEqual(seriesReach(ACTUAL.series, data({ hourly: [], attrs: {}, daily: [earlierDay] })), {
    min: 20,
    max: 95,
  });
});

const TODAY = dayAxis(NOW, CHICAGO),
  YESTERDAY = dayAxis(TODAY.start - 1, CHICAGO),
  TOMORROW = dayAxis(TODAY.start + 25 * HOUR, CHICAGO),
  DAY_LINE = [
    { hour: 2, value: 60 },
    { hour: 8, value: 50 },
    { hour: 15, value: 75 },
    { hour: 22, value: 62 },
  ],
  PEAK = temperatureScale({ min: 46, max: 79 });
const drawn = (look: ChartLook, axis = TODAY, list = DAY_LINE, scale = PEAK) =>
  chartMarkup(look, list, scale, context(NOW), axis);
const lines = (chart: string) => [...chart.matchAll(/<path d="[^"]+" fill="none" [^>]*>/g)].map(match => match[0]);
test('today is faint up to now, with one line dashed up to there and solid after', () => {
  const chart = drawn(ACTUAL.chart);
  assert.match(chart, /--now-x:50\.0%/);
  assert.match(chart, /<i class="chart-rule"><\/i>/);
  assert.equal((chart.match(/class="chart-dot"/g) ?? []).length, 1);
  assert.doesNotMatch(chart, /data-gone/);
  const [dashed, solid] = lines(chart);
  assert.equal(lines(chart).length, 2);
  assert.match(dashed ?? '', /stroke-dasharray="7\.5 12\.5"/);
  assert.match(dashed ?? '', /stroke-linecap="round"/);
  assert.match(dashed ?? '', /stroke-width="6\.25"/);
  assert.doesNotMatch(solid ?? '', /stroke-dasharray/);
  // The same curve either side of now.
  assert.equal(/d="([^"]+)"/.exec(dashed ?? '')?.[1], /d="([^"]+)"/.exec(solid ?? '')?.[1]);
});
test('another day has no past; a day gone by is past from end to end', () => {
  const later = drawn(ACTUAL.chart, TOMORROW);
  assert.doesNotMatch(later, /--now-x|chart-rule|chart-dot|stroke-dasharray|data-gone/);
  const gone = drawn(ACTUAL.chart, YESTERDAY);
  assert.match(gone, /--now-x:100\.0%/);
  assert.match(gone, /data-gone/);
  assert.doesNotMatch(gone, /chart-rule|chart-dot/);
  assert.equal(lines(gone).length, 1);
  assert.match(lines(gone)[0] ?? '', /stroke-dasharray="7\.5 12\.5"/);
});
test('rings mark the extremes on every day, and UV’s highest on other days only', () => {
  const rings = (chart: string) => ['low', 'high'].filter(name => chart.includes(`--${name}-x:`));
  assert.deepEqual(rings(drawn(ACTUAL.chart)), ['low', 'high']);
  assert.deepEqual(rings(drawn(ACTUAL.chart, TOMORROW)), ['low', 'high']);
  assert.match(drawn(ACTUAL.chart, TOMORROW), /--low-x:32\.0%;--low-y:[\d.]+;--high-x:60\.0%;/);
  assert.deepEqual(rings(drawn(uvReading.chart)), []);
  assert.deepEqual(rings(drawn(uvReading.chart, TOMORROW)), ['high']);
  // A flat day has neither.
  const flat = DAY_LINE.map(point => ({ ...point, value: 60 }));
  assert.deepEqual(rings(drawn(ACTUAL.chart, TOMORROW, flat)), []);
  // Temperature names both extremes, fading only those whose times have passed. UV's peak
  // ring does not get an H, and a flat temperature has neither label.
  const extremes = (chart: string) => [...chart.matchAll(/<span class="chart-extreme"(.*?)>([HL])<\/span>/g)];
  assert.deepEqual(
    extremes(drawn(ACTUAL.chart)).map(match => [match[2], match[1]?.includes('data-past')]),
    [
      ['L', true],
      ['H', false],
    ],
  );
  assert.ok(extremes(drawn(ACTUAL.chart, TOMORROW)).every(match => !match[1]?.includes('data-past')));
  assert.ok(extremes(drawn(ACTUAL.chart, YESTERDAY)).every(match => match[1]?.includes('data-past')));
  assert.equal(extremes(drawn(ACTUAL.chart, TOMORROW, flat)).length, 0);
  assert.equal(extremes(drawn(uvReading.chart, TOMORROW)).length, 0);
});
test('UV labels its peak above the ring on past and future days, never today', () => {
  const points = [
      { hour: 0, value: 0 },
      { hour: 12, value: 3.2 },
      { hour: 23, value: 0 },
    ],
    scale = uvReading.scale({ min: 0, max: 3.2 }, {}),
    chart = (axis: typeof TODAY, list = points) => drawn(uvReading.chart, axis, list, scale),
    label = (html: string) => /<span class="chart-extreme"(.*?)>(.*?)<\/span>/.exec(html);
  assert.equal(label(chart(TODAY)), null);
  for (const axis of [YESTERDAY, TOMORROW]) {
    const html = chart(axis),
      peak = label(html),
      ring = /--high-x:([\d.]+%);--high-y:([\d.]+)/.exec(html);
    assert.ok(peak && ring && peak[1] && ring[1] && ring[2]);
    assert.equal(peak[2], '3');
    assert.equal(peak[1].includes('data-past'), axis === YESTERDAY);
    assert.ok(peak[1].includes(`--extreme-x:${ring[1]}`));
    const top = /top:([\d.]+)%/.exec(peak[1])?.[1];
    assert.ok(Math.abs(Number(top) / 100 - Number(ring[2])) < 0.001);
  }
  assert.equal(label(chart(TOMORROW, [])), null);
  assert.equal(
    label(
      chart(
        TOMORROW,
        points.map(point => ({ ...point, value: 0 })),
      ),
    ),
    null,
  );
});
test('the dot sits on the line at now, and a chart can go without it', () => {
  const chart = drawn(ACTUAL.chart),
    dot = /class="chart-dot" style="left:50\.0%;top:([\d.]+)%"/.exec(chart)?.[1],
    held = /--now-y:([\d.]+)/.exec(chart)?.[1];
  assert.ok(dot && held);
  assert.ok(Math.abs(Number(dot) / 100 - Number(held)) < 0.001);
  // Bars have the rule and the fade, without a dot.
  const bars = drawn(precipitationLook, TODAY, DAY_LINE, precipitationScale());
  assert.match(bars, /chart-rule/);
  assert.doesNotMatch(bars, /chart-dot|--now-y/);
});
test('the scale sits below a clear band, unless its top is on the frame', () => {
  // A band of 40 over a plot of 273.75, so the top tick is 14.6% down and the bottom one at the foot.
  const tall = drawn(humidityReading.chart, TODAY, DAY_LINE, humidityReading.scale({ min: 0, max: 1 }, {})),
    tops = (chart: string) => [
      ...(/<div class="chart-y"[^>]*>(.*?)<\/div>/.exec(chart)?.[1] ?? '').matchAll(/top:([\d.]+)%/g),
    ];
  assert.match(tall, /data-size="tall"/);
  assert.equal(tops(tall).at(-1)?.[1], '14.6');
  assert.equal(tops(tall)[0]?.[1], '100.0');
  // A small chart, 40 over 175.
  const small = drawn(ACTUAL.chart);
  assert.match(small, /data-size="small"/);
  assert.equal(tops(small).at(-1)?.[1], '22.9');
  // A flush chart's top tick has no line of its own: the frame is there.
  const bars = drawn(precipitationLook, TODAY, DAY_LINE, precipitationScale());
  assert.match(bars, /data-flush/);
  assert.equal((bars.match(/class="grid"/g) ?? []).length, 3);
  assert.match(bars, /<span style="top:0\.0%">Heavy/);
});
test('a line and its area are coloured by value, with its OKLab mix named finely', () => {
  const chart = drawn(ACTUAL.chart),
    fill = /<linearGradient id="fill-card-temperature-\d+"[^>]*>(.*?)<\/linearGradient>/.exec(chart)?.[1] ?? '',
    stroke = /<linearGradient id="line-card-temperature-\d+"[^>]*>(.*?)<\/linearGradient>/.exec(chart)?.[1] ?? '',
    stops = (list: string) => [...list.matchAll(/offset="([\d.]+)" stop-color="(#[\da-f]+)"/g)];
  // Every two degrees over 32 to 96, and the area is the line's at .49.
  assert.equal(stops(fill).length, 33);
  assert.deepEqual(
    stops(fill).map(match => match[2]),
    stops(stroke).map(match => match[2]),
  );
  assert.equal((fill.match(/stop-opacity="0\.49"/g) ?? []).length, 33);
  assert.equal(stops(fill)[14]?.[2], temperatureColor(60, '°F'));
  // Bottom of the scale to its top, band left out.
  assert.match(
    chart,
    /id="line-card-temperature-\d+" gradientUnits="userSpaceOnUse" x1="0" y1="150\.0" x2="0" y2="34\.3"/,
  );
  // In a plain colour, at the same strength.
  assert.match(drawn({ id: 'plain', color: '#5ac8fa' }), /stop-color="#5ac8fa" stop-opacity="0\.49"/);
});
test('visibility is drawn no further than a step short of its scale’s top', () => {
  const miles = { visibility_unit: 'mi' },
    scale = visibilityReading.scale({ min: 3, max: 40 }, miles),
    chart = chartMarkup(
      visibilityReading.chart,
      [
        { hour: 1, value: 12 },
        { hour: 2, value: 40 },
      ],
      scale,
      context(NOW, miles),
      TOMORROW,
    );
  // 25 mi on a 0 to 30 scale, under the band.
  assert.match(lines(chart)[0] ?? '', /L24\.0 43\.3/);
});

test('temperatures, humidity, pressure and visibility run freely, UV and wind monotone, chance straight', () => {
  const peak: [number, number][] = [
    [0, 0],
    [10, 10],
    [20, 0],
    [30, 10],
  ];
  // A monotone curve is flat at a peak; a Catmull–Rom leans along the readings either side of it.
  assert.match(smoothPath(peak), /C3\.3 3\.3 6\.7 10\.0 10\.0 10\.0/);
  assert.match(smoothPath(peak, 'catmullRom'), /C3\.3 3\.3 6\.7 10\.0 10\.0 10\.0C13\.3 10\.0/);
  const even: [number, number][] = [
    [0, 0],
    [10, 10],
    [20, 40],
    [30, 10],
  ];
  assert.match(smoothPath(even, 'catmullRom'), /^M0\.0 0\.0C3\.3 3\.3 6\.7 3\.3 10\.0 10\.0C13\.3 16\.7/);
  assert.match(smoothPath(even, 'straight'), /^M0\.0 0\.0L10\.0 10\.0L20\.0 40\.0L30\.0 10\.0$/);
  assert.deepEqual(
    [ACTUAL.chart, FELT.chart, humidityReading.chart, pressureReading.chart, visibilityReading.chart].map(
      look => look.curve,
    ),
    Array.from({ length: 5 }, () => 'catmullRom'),
  );
  assert.equal(uvReading.chart.curve, undefined);
  assert.equal(windReading.chart.curve, undefined);
  assert.equal(chanceLook.curve, 'straight');
});
const GUSTY = [
    { hour: 2, value: 6, gust: 14 },
    { hour: 8, value: 8, gust: 18 },
    { hour: 15, value: 9, gust: 22 },
    { hour: 22, value: 7, gust: 16 },
  ],
  WINDY = windReading.scale({ min: 6, max: 22 }, { wind_speed_unit: 'mph' }),
  windAttrs = { wind_speed_unit: 'mph' };
const windChart = (axis: typeof TODAY, list: readonly PlotPoint[] = GUSTY) =>
  chartMarkup(windReading.chart, list, WINDY, context(NOW, windAttrs), axis);
// Where a line takes its colours from a gradient: the gradient, seen through the line.
const throughLines = (chart: string) => [...chart.matchAll(/<rect [^>]*fill="url\(#line-[^>]*>/g)];
test('gusts run under the wind in its colours at half strength, dashed before now, with no area', () => {
  const chart = windChart(TODAY),
    [gustPast, gustSolid, windPast, windSolid] = lines(chart);
  assert.equal(lines(chart).length, 4);
  for (const part of [gustPast, gustSolid]) assert.match(part ?? '', /stroke-width="6\.25"/);
  assert.match(gustPast ?? '', /stroke-dasharray="7\.5 12\.5"/);
  assert.doesNotMatch(gustSolid ?? '', /stroke-dasharray/);
  assert.doesNotMatch(windPast ?? '', /opacity=/);
  assert.match(windPast ?? '', /stroke-dasharray/);
  assert.doesNotMatch(windSolid ?? '', /stroke-dasharray|opacity=/);
  // Their colours are laid through each line, the gust's at half strength.
  const [gust, wind] = throughLines(chart);
  assert.match(
    gust?.[0] ?? '',
    /fill="url\(#line-card-wind-\d+\)" mask="url\(#stroke-1-card-wind-\d+\)" opacity="0\.5"/,
  );
  assert.match(wind?.[0] ?? '', /fill="url\(#line-card-wind-\d+\)" mask="url\(#stroke-2-card-wind-\d+\)"\/>/);
  // The one area is the wind's, drawn after the gust's line and so over it.
  assert.equal((chart.match(/fill="url\(#fill-card-wind-\d+\)"/g) ?? []).length, 1);
  assert.ok(chart.search(/fill="url\(#fill-card-wind-\d+\)"/) > chart.indexOf('opacity="0.5"'));
});
test('with no gusts there is no second line, and the scale comes from the speed', () => {
  const calm = GUSTY.map(({ hour, value }) => ({ hour, value })),
    chart = windChart(TOMORROW, calm);
  assert.equal(lines(chart).length, 1);
  assert.doesNotMatch(chart, /opacity="0\.5"/);
  const reach = seriesReach(
    windReading.series,
    data({ attrs: {}, hourly: [hourlyEntry(0, 60, { wind_speed: 6 }), hourlyEntry(1, 60, { wind_speed: 11 })] }),
  );
  assert.deepEqual(reach, { min: 6, max: 11 });
  assert.deepEqual(windReading.scale({ min: 6, max: 11 }, windAttrs).ticks, [0, 5, 10, 15, 20]);
  // One gust alone makes no line.
  assert.equal(lines(windChart(TOMORROW, [...calm.slice(0, 3), { hour: 22, value: 7, gust: 16 }])).length, 1);
});
test('wind is coloured by its speed, in even steps from calm to 73 mph', () => {
  assert.equal(windColor(0, 'mph'), '#22b9d2');
  assert.equal(windColor(73, 'mph'), '#e72d2e');
  assert.equal(windColor(90, 'mph'), '#e72d2e');
  assert.equal(windColor((73 / 11) * 5, 'mph'), '#90b400');
  // The same speed in another unit is the same colour, near enough for a rounded unit.
  assert.equal(windColor(73 * 1.609344, 'km/h'), '#e72d2e');
  assert.equal(windColor((73 / 11) * 5 * 0.44704, 'm/s'), '#90b400');
  // On the Beaufort scale, each force has its colour.
  assert.equal(windColor(5, 'bft'), '#90b400');
  const stops = /id="line-card-wind-\d+"[^>]*>(.*?)<\/linearGradient>/.exec(windChart(TOMORROW))?.[1] ?? '';
  // Every whole mph of a scale running 0 to 30.
  assert.equal((stops.match(/<stop /g) ?? []).length, 31);
  assert.ok(stops.includes(`stop-color="${windColor(4, 'mph')}"`));
});
test('feels-like is a bare line over the temperature in grey, with an area of its own', () => {
  const felt = DAY_LINE.map(point => ({ ...point, actual: point.value + 3 })),
    chart = chartMarkup(FELT.chart, felt, PEAK, context(NOW), TOMORROW),
    grey = lines(chart).find(part => part.includes('stroke="#5a5a5c"'));
  assert.equal(lines(chart).length, 2);
  assert.ok(grey);
  assert.equal(throughLines(chart).length, 1);
  assert.match(throughLines(chart)[0]?.[0] ?? '', /fill="url\(#line-card-feels_like-\d+\)"/);
  // .35 of the usual fill.
  assert.match(chart, /fill="#5a5a5c2c"/);
  assert.doesNotMatch(chart, /fill="url\(#fill-card-feels_like-\d+\)"/);
  assert.ok(chart.indexOf('fill="#5a5a5c2c"') < chart.indexOf('stroke="#5a5a5c"'));
  // Both dashed before now, on today.
  const today = lines(chartMarkup(FELT.chart, felt, PEAK, context(NOW), TODAY));
  assert.equal(today.length, 4);
  assert.equal(today.filter(part => part.includes('stroke-dasharray')).length, 2);
  assert.ok(today.some(part => /stroke="#5a5a5c".*stroke-dasharray/.test(part)));
});
test('chart rows cover only available hours and stay inside days whose clocks change', () => {
  const partial = [
    { hour: 10, value: 8, condition: 'rainy' },
    { hour: 11, value: 9, condition: 'cloudy' },
  ];
  // No weather or reading is invented for the hours before or after the data.
  for (const look of [FELT.chart, visibilityReading.chart]) {
    const row = topRow(drawn(look, TODAY, partial));
    assert.equal((row.match(/<span/g) ?? []).length, 1);
    assert.match(row, /left:45\.8%/);
    assert.match(row, /data-past/);
  }
  assert.equal(topRow(drawn(FELT.chart, TODAY, line(0, 23))), '');
  assert.equal(topRow(drawn(humidityReading.chart, TODAY, [])), '');
  for (const [, moment] of DAYS.slice(0, 3)) {
    const axis = dayAxis(at(moment), CHICAGO),
      hours = Array.from({ length: Math.ceil(axis.hours) }, (_, hour) => ({ hour, value: 80 })),
      markup = chartMarkup(humidityReading.chart, hours, PEAK, context(axis.start - HOUR), axis),
      row = topRow(markup);
    assert.equal((row.match(/>80%<\/span>/g) ?? []).length, 4);
    assert.deepEqual(
      [...row.matchAll(/left:([\d.]+)%/g)].map(match => Number(match[1])),
      [12.5, 37.5, 62.5, 87.5],
    );
    assert.doesNotMatch(row, /data-past/);
  }
});
test('pressure symbols follow the three-hour change in the displayed unit, including the day’s edges', () => {
  const pressure = (hour: number) => (hour < 8 ? 1016 - 2 * hour : hour < 16 ? 1002 : 1002 + 2 * (hour - 15)),
    symbols = (unit: string) => {
      const attrs = { pressure_unit: unit },
        points = Array.from({ length: 24 }, (_, hour) => ({
          hour,
          value: convertUnit('pressure_unit', pressure(hour), 'hPa', unit),
        })),
        row = topRow(chartMarkup(pressureReading.chart, points, PEAK, context(NOW, attrs), TODAY));
      return [...row.matchAll(/ d="([^"]+)"/g)].map(match => match[1]);
    },
    metric = symbols('hPa');
  assert.equal(metric.length, 12);
  assert.equal(metric[0], 'M8 2v12M3.5 9.5 8 14l4.5-4.5');
  assert.equal(metric[6], 'M3.5 6h9M3.5 10h9');
  assert.equal(metric.at(-1), 'M8 14V2M3.5 6.5 8 2l4.5 4.5');
  assert.deepEqual(symbols('inHg'), metric);
  assert.deepEqual(symbols('kPa'), metric);
  assert.equal(topRow(drawn(pressureReading.chart, TODAY, [{ hour: 1, value: 1013 }])), '');
});
test('the wind chart has no row over its plot, whatever directions the hours give', () => {
  const points = Array.from({ length: 24 }, (_, hour) => ({ hour, value: 8, bearing: hour % 2 ? 'SW' : 180 }));
  assert.doesNotMatch(drawn(windReading.chart, TODAY, points), /chart-top/);
});
test('with nothing earlier than the hour under way, a line starts at now', () => {
  const later = context(NOW + HOUR / 2, windAttrs),
    hour = Math.floor((NOW - TODAY.start) / HOUR),
    ahead = [
      { hour, value: 60, gust: 14 },
      { hour: hour + 2, value: 62, gust: 16 },
      { hour: hour + 4, value: 58, gust: 13 },
    ],
    chart = chartMarkup(windReading.chart, ahead, WINDY, later, TODAY);
  assert.doesNotMatch(chart, /stroke-dasharray/);
  assert.equal(lines(chart).length, 2);
  assert.ok(lines(chart).every(part => /clip-path="url\(#to-come-card-wind-\d+\)"/.test(part)));
  assert.match(chart, /fill="url\(#fill-card-wind-\d+\)" clip-path="url\(#to-come-card-wind-\d+\)"/);
  // An hour earlier than that and the day has a past: dashes up to now, and the area from its start.
  const longer = [{ hour: hour - 2, value: 61, gust: 15 }, ...ahead],
    past = chartMarkup(windReading.chart, longer, WINDY, later, TODAY);
  assert.match(past, /stroke-dasharray/);
  assert.doesNotMatch(past, /fill="url\(#fill-card-wind-\d+\)" clip-path/);
  // In the day's first hour, the hour under way is all the past there is.
  const small = chartMarkup(
    windReading.chart,
    [
      { hour: 0, value: 60 },
      { hour: 1, value: 62 },
      { hour: 2, value: 58 },
    ],
    WINDY,
    context(TODAY.start + (HOUR * 3) / 4, windAttrs),
    TODAY,
  );
  assert.match(small, /stroke-dasharray/);
});
// A chart's marks, as its reading lists them.
const isMark = (item: unknown): item is ChartMark => Array.isArray(item);
const marksIn = (chart: string): readonly ChartMark[] => {
  const list: unknown = JSON.parse(attributeIn(chart, 'points') ?? '[]');
  return Array.isArray(list) ? list.filter(isMark) : [];
};
test('a line is read by the minute along the line as drawn, with what goes with it worked out between', () => {
  const chart = chartMarkup(
      humidityReading.chart,
      [
        { hour: 8.25, value: 40, dew: 30 },
        { hour: 10, value: 50 },
        { hour: 13.5, value: 70, dew: 34 },
      ],
      humidityReading.scale({ min: 0, max: 1 }, {}),
      context(NOW),
      YESTERDAY,
    ),
    line = lineIn(chart);
  // From its first reading to its last, with no marks by the hour.
  assert.deepEqual([line.from, line.to], [8.25 * 60, 13.5 * 60]);
  assert.deepEqual(marksIn(chart), []);
  // At a reading, that reading; between, the value along the line, and the dew point between the
  // two readings that have one.
  assert.equal(line.at(8.25 * 60), '40<small>%</small>\nDew point: 30°');
  assert.equal(line.at(10 * 60), '50<small>%</small>\nDew point: 31°');
  assert.equal(line.at(13.5 * 60), '70<small>%</small>\nDew point: 34°');
  // Listed from each minute it changes, which is mostly between the hours.
  assert.ok(line.reads.every((read, i) => read.label !== line.reads[i - 1]?.label));
  assert.ok(line.reads.filter(read => read.minute % 60).length > line.reads.length / 2);
  // Its line goes through each reading at the height the scale gives its value.
  const tick = Number(/<span style="top:([\d.]+)%">40%</.exec(chart)?.[1]);
  assert.ok(Math.abs(line.topAt(8.25) - tick) < 0.1);
  assert.ok(line.topAt(10) < line.topAt(9) && line.topAt(9) < tick);
});
test('a day of 25 hours is read through all of them, its hours by the clock', () => {
  // The Sunday the clocks went back: the hour after 1 AM is 1 AM again.
  const short = dayAxis(Date.UTC(2026, 10, 1, 12), CHICAGO),
    line = lineIn(
      chartMarkup(
        humidityReading.chart,
        Array.from({ length: 25 }, (_, hour) => ({ hour, value: 50 })),
        humidityReading.scale({ min: 0, max: 1 }, {}),
        context(NOW),
        short,
      ),
    ),
    clock = clockOf(context(NOW));
  assert.equal(short.hours, 25);
  assert.deepEqual([line.from, line.to], [0, 25 * 60 - 1]);
  assert.deepEqual(
    [0, 60, 120, 180].map(minute => clock(line.start + minute * 60_000)),
    ['12:00<small>AM</small>', '1:00<small>AM</small>', '1:00<small>AM</small>', '2:00<small>AM</small>'],
  );
});
test('a reading past a scale held from before it came reads as it is, its line off the plot', () => {
  const line = lineIn(
    chartMarkup(
      ACTUAL.chart,
      [
        { hour: 3, value: 300 },
        { hour: 4, value: -300 },
      ],
      PEAK,
      context(NOW),
      YESTERDAY,
    ),
  );
  assert.match(line.at(3 * 60) ?? '', /^300°/);
  // The reader keeps its dot on the plot (see charts.browser).
  assert.ok(line.topAt(3) < 0 && line.topAt(4) > 100);
});
test('each chart says what it reads', () => {
  const felt = lineIn(
      chartMarkup(
        FELT.chart,
        [
          { hour: 3, value: 71, actual: 74, condition: 'sunny' },
          { hour: 4, value: 72, actual: 75 },
        ],
        PEAK,
        context(NOW),
        YESTERDAY,
      ),
    ).at(4 * 60),
    actual = lineIn(
      chartMarkup(
        ACTUAL.chart,
        DAY_LINE.map(point => ({ ...point, condition: 'rainy' })),
        PEAK,
        context(NOW),
        YESTERDAY,
      ),
    ).at(2 * 60),
    uv = lineIn(
      chartMarkup(
        uvReading.chart,
        [
          { hour: 11, value: 7, condition: 'sunny' },
          { hour: 12, value: 3 },
        ],
        uvReading.scale({ min: 0, max: 7 }, {}),
        context(NOW),
        YESTERDAY,
      ),
    ).at(11 * 60);
  // Value, then the weather's icon: the nearest weather, where the hour has none of its own.
  assert.equal(felt, '72°<i data-icon="0"></i>\nActual: 75°');
  assert.equal(actual, '60°<i data-icon="0"></i>\n');
  assert.equal(uv, '7 <small>High</small><i data-icon="0"></i>\n');
  assert.match(
    chartMarkup(FELT.chart, [{ hour: 3, value: 71, condition: 'sunny' }], PEAK, context(NOW), YESTERDAY),
    /<template class="chart-icons">/,
  );
});
test('rain reads its level and kind, and says when it is unlikely or none', () => {
  const inches = context(NOW, { precipitation_unit: 'in' }),
    read = (point: PlotPoint) =>
      marksIn(chartMarkup(precipitationLook, [point], precipitationScale(), inches, YESTERDAY))[0]?.[2],
    wet = { hour: 13, value: 0.3, condition: 'rainy' };
  assert.equal(read({ ...wet, chance: 60 }), '1PM - 2PM\nHeavy\nRain');
  assert.equal(read({ ...wet, condition: 'snowy', chance: 60 }), '1PM - 2PM\nHeavy\nSnow');
  // A chance of 5% or nothing said of it at all.
  assert.equal(read({ ...wet, chance: 5 }), '1PM - 2PM\nHeavy\nPrecipitation Unlikely');
  assert.equal(read(wet), '1PM - 2PM\nHeavy\nRain');
  assert.equal(read({ hour: 13, value: 0, chance: 40 }), '1PM - 2PM\nNone\nNo Precipitation');
  // Bars have no dot: its place is off the chart, and the mark is at the bar's middle.
  const [mark] = marksIn(chartMarkup(precipitationLook, [wet], precipitationScale(), inches, YESTERDAY));
  assert.deepEqual(mark?.slice(0, 2), [((13 + 1 / 2) / 24) * 100, -100]);
  assert.equal(mark[3], 13);
});
const OVER = [
  { hour: 1, value: 0.1, condition: 'rainy' },
  { hour: 3, value: 0.2, condition: 'hail' },
];
const AHEAD = [
  { hour: 14, value: 0.2, condition: 'snowy' },
  { hour: 15, value: 0.2, condition: 'snowy-rainy' },
  { hour: 16, value: 0, condition: 'cloudy' },
];
const barsOf = (chart: string) => [...chart.matchAll(/<rect [^>]*rx="[\d.]+" ry="[\d.]+" fill="(#[\da-f]+)"\/>/g)];
test('precipitation’s bars take in the hours gone by, under the fade, a colour to each by its kind', () => {
  const inches = { precipitation_unit: 'in' },
    chart = chartMarkup(
      precipitationLook,
      AHEAD,
      precipitationScale(),
      context(NOW, inches),
      TODAY,
      OVER,
      'detail-reading',
    );
  assert.deepEqual(
    barsOf(chart).map(match => match[1]),
    ['#3cd3fe', '#3cd3fe', '#fff', '#6d7cff'],
  );
  // They sit in what fades, a bar 60% of its slot wide.
  assert.match(/<div class="chart-face">.*<\/div><div class="chart-marks"/.exec(chart)?.[0] ?? '', /<g mask=.*<rect /);
  assert.match(chart, /<rect x="15\.0" y="[\d.]+" width="7\.5"/);
  // A bar's hour reads like the others'.
  assert.match(chart, /1AM - 2AM\\n/);
});
test('sleet has a blue of its own, and no bars means no bars', () => {
  assert.equal(KIND_COLORS.sleet, '#0091ff');
  const dry = chartMarkup(precipitationLook, [{ hour: 3, value: 0 }], precipitationScale(), context(NOW), TOMORROW);
  assert.deepEqual(barsOf(dry), []);
  assert.doesNotMatch(dry, /data-gone/);
});
test('level names stand over the fade, and knock a pill out of the bars', () => {
  const rain = chartMarkup(precipitationLook, AHEAD, precipitationScale(), context(NOW), TODAY);
  assert.match(rain, /<div class="chart-marks"[^>]*><div class="chart-bands"><span[^>]*>Heavy.*Moderate.*Light/);
  assert.doesNotMatch(/<div class="chart-face">.*?<div class="chart-marks"/.exec(rain)?.[0] ?? '', /chart-bands/);
  assert.equal((/<mask [^>]*>(.*?)<\/mask>/.exec(rain)?.[1]?.match(/<rect /g) ?? []).length, 4);
  const uv = drawn(uvReading.chart, TODAY, DAY_LINE, uvReading.scale({ min: 0, max: 5 }, {}));
  assert.match(/<div class="chart-marks"[^>]*>.*/.exec(uv)?.[0] ?? '', /Extreme/);
  assert.doesNotMatch(uv, /<mask id="levels-/);
});
const chance = (axis: typeof TODAY, list: readonly { hour: number; value: number }[]) =>
  chartMarkup(chanceLook, list, chanceScale(), context(NOW + HOUR / 2), axis);
test('the chance runs from now on only, with what is over hatched', () => {
  const hour = Math.floor((NOW - TODAY.start) / HOUR),
    chart = chance(TODAY, [
      { hour, value: 20 },
      { hour: hour + 1, value: 60 },
      { hour: hour + 2, value: 40 },
    ]);
  assert.match(chart, /<i class="chart-hatch"><\/i>/);
  assert.match(chart, /--now-x:52\.1%/);
  assert.equal(lines(chart).length, 1);
  assert.match(lines(chart)[0] ?? '', /clip-path="url\(#to-come-card-chance-\d+\)"/);
  assert.doesNotMatch(chart, /stroke-dasharray/);
  assert.match(chart, /fill="url\(#fill-card-chance-\d+\)" clip-path="url\(#to-come-card-chance-\d+\)"/);
  // Its dot sits on the line, between the hours either side of now.
  assert.match(chart, /class="chart-dot"/);
  // Even with hours earlier in the day, it doesn't reach back past now.
  const whole = chance(TODAY, [
    { hour: 2, value: 90 },
    { hour: 8, value: 90 },
    { hour: 18, value: 40 },
  ]);
  assert.doesNotMatch(whole, /stroke-dasharray/);
  assert.match(lines(whole)[0] ?? '', /to-come/);
});
test('the chance is read from the hour under way on, an hour from start to end, and not over the hatching', () => {
  const hour = Math.floor((NOW - TODAY.start) / HOUR),
    chart = chartMarkup(
      chanceLook,
      [
        { hour, value: 20 },
        { hour: hour + 1, value: 60 },
      ],
      chanceScale(),
      context(NOW),
      TODAY,
      [{ hour: hour - 2, value: 80 }],
    ),
    marks = marksIn(chart),
    [first] = marks;
  assert.deepEqual(
    marks.map(mark => mark[3]),
    [hour, hour + 1],
  );
  assert.match(first?.[2] ?? '', /^\d+[AP]M - \d+[AP]M\n20%\n$/);
  // The line stays from now on.
  assert.doesNotMatch(chart, /stroke-dasharray/);
  assert.match(lines(chart)[0] ?? '', /to-come/);
});
test('a day gone by is hatched from end to end, and another day not at all', () => {
  const gone = chance(YESTERDAY, DAY_LINE);
  assert.match(gone, /<i class="chart-hatch"><\/i>/);
  assert.match(gone, /--now-x:100\.0%/);
  // No line, and nothing to read.
  assert.equal(lines(gone).length, 0);
  assert.match(gone, /data-points="\[\]"/);
  assert.match(gone, /data-gone/);
  assert.doesNotMatch(gone, /chart-dot|chart-rule/);
  assert.doesNotMatch(chance(TOMORROW, DAY_LINE), /chart-hatch/);
});
test('humidity is coloured by its value, and pressure’s fill by the pressure', () => {
  const humid = drawn(humidityReading.chart, TOMORROW, DAY_LINE, humidityReading.scale({ min: 0, max: 1 }, {})),
    colors = [...humid.matchAll(/id="line-card-humidity-\d+"[^>]*>(.*?)<\/linearGradient>/g)].flatMap(match =>
      [...(match[1] ?? '').matchAll(/stop-color="(#[\da-f]+)"/g)].map(stop => stop[1]),
    );
  // Every two percent, so the chart at 0, 50 and 100 has its three stops' colours, and 25 lies between two.
  assert.equal(colors.length, 51);
  assert.deepEqual([colors[0], colors.at(-1)], ['#30d158', '#bf5af2']);
  assert.equal(
    scaleColor(
      [
        [0, '#3cd3fe'],
        [50, '#0091ff'],
      ],
      25,
    ),
    colors[25],
  );
  const unit = { pressure_unit: 'hPa' },
    scale = pressureReading.scale({ min: 1000, max: 1020 }, unit),
    chart = chartMarkup(pressureReading.chart, DAY_LINE, scale, context(NOW, unit), TOMORROW),
    fill = /<linearGradient id="fill-card-pressure-\d+"[^>]*>.*?<\/linearGradient>/.exec(chart)?.[0] ?? '';
  assert.match(chart, /stroke="#db34f2"/);
  assert.match(fill, /stop-color="#db34f2" stop-opacity="0\.049".*stop-color="#db34f2" stop-opacity="0\.49"/);
  // 950 hPa to 1075, wherever those fall on a scale from 995 to 1025: far below it and far above.
  const [from, to] = [/y1="(-?[\d.]+)"/.exec(fill)?.[1], /y2="(-?[\d.]+)"/.exec(fill)?.[1]].map(Number);
  assert.ok((from ?? 0) > 150 && (to ?? 0) < 0);
  // In inches of mercury the same pressures sit on the same scale, more or less.
  const mercury = { pressure_unit: 'inHg' },
    onInches = chartMarkup(
      pressureReading.chart,
      DAY_LINE,
      pressureReading.scale({ min: 29.5, max: 30.2 }, mercury),
      context(NOW, mercury),
      TOMORROW,
    );
  assert.match(
    onInches,
    /id="fill-card-pressure-\d+" gradientUnits="userSpaceOnUse" x1="0" y1="[\d.]+" x2="0" y2="-?[\d.]+"/,
  );
});
const earlierRow = (time: number, a: object) => ({ lu: time / 1000, s: 'sunny', a });
test('earlier in a day comes from history where it has the reading, and the hours kept for the rest', () => {
  const start = TODAY.start,
    pastHours = [0, 1, 2, 3, 4].map(i => ({
      time: start + i * HOUR,
      datetime: '',
      wind_speed: 3,
      wind_gust_speed: 12,
      dew_point: 40,
    })),
    ctx = { attrs: {}, pastHours, now: NOW, timeZone: CHICAGO },
    history = {
      today: [earlierRow(start + 2.5 * HOUR, { wind_speed: 7 }), earlierRow(start + 4.2 * HOUR, { wind_speed: 8 })],
    },
    key = '2026-10-31';
  const points = earlierPoints(windReading.series, key, ctx, history);
  // The hours before history starts, then history, each reading with its hour's gust and dew point.
  assert.deepEqual(
    points.map(point => [point.hour, point.value, point.gust, point.dew]),
    [
      [0, 3, 12, 40],
      [1, 3, 12, 40],
      [2, 3, 12, 40],
      [2.5, 7, 12, 40],
      [4.2, 8, 12, 40],
    ],
  );
  // With history alone it stands as it was, and with the hours alone they do; a day with neither is empty.
  assert.deepEqual(
    earlierPoints(windReading.series, key, { ...ctx, pastHours: [] }, history).map(point => point.gust),
    [undefined, undefined],
  );
  assert.equal(earlierPoints(windReading.series, key, ctx, undefined).length, 5);
  assert.deepEqual(earlierPoints(windReading.series, '2026-11-05', ctx, history), []);
  // Yesterday's rows and hours belong to yesterday.
  const before = YESTERDAY.start + 3 * HOUR,
    yesterday = { yesterday: [earlierRow(before, { wind_speed: 9 })], today: history.today };
  assert.deepEqual(
    earlierPoints(windReading.series, '2026-10-30', ctx, yesterday).map(point => [point.hour, point.value]),
    [[3, 9]],
  );
});
test('feels-like now is the reading now, and history gives way to the hours that hold it', () => {
  const start = TODAY.start,
    hour = { time: NOW - 20 * 60_000, datetime: '', temperature: 60, apparent_temperature: 55 },
    attrs = { temperature: 61, temperature_unit: '°F' };
  // The hour under way's has already been taken into the readings now (see readingsNow).
  assert.equal(
    detailSeries(feelsSeries, [hour], { ...attrs, apparent_temperature: 55 }, NOW, CHICAGO, true).find(
      point => point.now,
    )?.value,
    55,
  );
  // A reading of its own stands, and with none it's worked out.
  assert.equal(feelsLike({ ...attrs, apparent_temperature: 58 })?.value, 58);
  assert.equal(feelsLike(attrs)?.estimated, true);
  // Rows of history only estimate it, so the hours that were forecast with it go first.
  const pastHours = [0, 1].map(i => ({
      time: start + i * HOUR,
      datetime: '',
      temperature: 50,
      apparent_temperature: 44,
    })),
    ctx = { attrs, pastHours, now: NOW, timeZone: CHICAGO },
    history = { today: [{ lu: (start + HOUR) / 1000, s: 'sunny', a: { temperature: 50 } }] };
  assert.deepEqual(
    earlierPoints(feelsSeries, '2026-10-31', ctx, history).map(point => point.value),
    [44, 44],
  );
  assert.deepEqual(
    earlierPoints(feelsSeries, '2026-10-31', { ...ctx, pastHours: [] }, history).map(point => point.value),
    [50],
  );
});
test('a gust that reads under the wind runs along it instead', () => {
  const low = [
      { hour: 2, value: 6, gust: 9 },
      { hour: 8, value: 12, gust: 9 },
    ],
    gust = /d="M[^"]*/.exec(lines(windChart(TOMORROW, low))[0] ?? '')?.[0],
    wind = /d="M[^"]*/.exec(lines(windChart(TOMORROW, low))[1] ?? '')?.[0];
  assert.equal(gust?.split(' ').at(-1), wind?.split(' ').at(-1));
});
test('the hours over count towards a reading’s reach', () => {
  const pastHours = [{ time: NOW - 5 * HOUR, datetime: '', temperature: 91 }];
  assert.deepEqual(seriesReach(ACTUAL.series, data({ pastHours })), { min: 58, max: 91 });
});
test('the reading now carries the gust and dew point read with it, not the hour under way’s', () => {
  const start = NOW - 20 * 60_000,
    entry = { time: start, datetime: '', wind_speed: 5, wind_gust_speed: 12, dew_point: 41 },
    now = (attrs: EntityAttributes) =>
      detailSeries(windReading.series, [entry], attrs, NOW, CHICAGO, true).find(point => point.now);
  // What the entity leaves out is filled in before (see readingsNow).
  assert.deepEqual(
    [now({ wind_speed: 6, wind_gust_speed: 9, dew_point: 50 })?.gust, now({ wind_speed: 6, dew_point: 50 })?.dew],
    [9, 50],
  );
  assert.deepEqual([now({ wind_speed: 6 })?.gust, now({ wind_speed: 6 })?.dew], [undefined, undefined]);
  // And a gust is never under the wind.
  assert.equal(now({ wind_speed: 15, wind_gust_speed: 12 })?.gust, 15);
});
