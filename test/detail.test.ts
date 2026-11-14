import type { SkyKind } from '../src/sky/presets-data.ts';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/card/config.ts';
import type { EntityAttributes, ForecastEntry } from '../src/card/home-assistant.ts';
import type { SheetView } from '../src/cards/card.ts';
import { alertWords, alertsDetail, alertsTitle } from '../src/cards/alerts/sheet.ts';
import { averagesDetail } from '../src/cards/averages/sheet.ts';
import { chartMarkup } from '../src/sheets/chart.ts';
import { lineIn } from './chart-line.ts';
import type { DetailDay } from '../src/sheets/days.ts';
import { comparisonMarkup, compareDays } from '../src/sheets/compare.ts';
import { keepLastWords } from '../src/sheets/parts.ts';
import { ACTUAL, conditionsBody, temperatureScale } from '../src/cards/forecast/conditions.ts';
import { dayAxis, detailDays, hoursInto, sheetDays } from '../src/sheets/days.ts';
import { precipitationBody } from '../src/cards/precipitation/sheet.ts';
import { dayAmount } from '../src/cards/precipitation/totals.ts';
import { dailyDetail, dayRain } from '../src/cards/forecast/day-detail.ts';
import { placePopover } from '../src/sheets/popover.ts';
import { precipitationLook, precipitationScale, chanceLook, chanceScale } from '../src/cards/precipitation/looks.ts';
import { detailSeries, historyPoints, type ChartPoint } from '../src/sheets/series.ts';
import { nextHourDetail } from '../src/cards/next-hour/sheet.ts';
import { MOON_HOUR_PX, moonDetail, moonLive, moonSheet, moonStep } from '../src/cards/moon/sheet.ts';
import { moonGlyph } from '../src/cards/moon/rules.ts';
import { MOON_PHASE } from '../src/sky/sky.ts';
import { type DailyItem, forecasts } from '../src/weather/forecast-items.ts';
import { temperatureColor, temperatureGradient } from '../src/weather/temperature-colors.ts';
import { weatherNumber } from '../src/lib/formats.ts';
import { SYMBOLS } from '../src/weather/symbols.ts';
import type { Normal } from '../src/cards/averages/climate.ts';
import { uvReading } from '../src/cards/uv/sheet.ts';
import { humidityReading } from '../src/cards/humidity/sheet.ts';
import { windReading } from '../src/cards/wind/sheet.ts';
import { noHours, readingSheet, summarize } from '../src/sheets/reading.ts';
import { dailyItems } from '../src/weather/forecast-items.ts';
import { pressureReading } from '../src/cards/pressure/sheet.ts';
import { visibilityReading } from '../src/cards/visibility/sheet.ts';

const tz = 'America/Chicago',
  now = Date.parse('2026-10-26T18:20:00Z'),
  H = 3600000;
const hourly: ForecastEntry[] = Array.from({ length: 48 }, (_, i) => ({
  datetime: new Date(Date.parse('2026-10-26T18:00:00Z') + i * H).toISOString(),
  uv_index: Math.max(0, 4 - i),
  wind_speed: 3 + (i % 4),
  humidity: 50 + i,
  temperature: 70 - i / 2,
  precipitation: i === 20 ? 0.12 : 0,
}));
const timed = forecasts(hourly);
const attrs: EntityAttributes = {
  uv_index: 4.2,
  wind_speed: 4,
  wind_bearing: 190,
  humidity: 52,
  dew_point: 55,
  temperature: 72,
  temperature_unit: '°F',
  wind_speed_unit: 'mph',
  precipitation_unit: 'in',
};
const ctx = {
  id: 't',
  attrs,
  hourly,
  now,
  timeZone: tz,
  locale: 'en-US',
  numbers: 'en-US',
  hour12: true,
  fmt: (v: number | null | undefined, d = 0) => weatherNumber(v, 'en-US', d),
};
const axis = dayAxis(now, tz),
  otherAxis = dayAxis(now + 24 * H, tz);
const days = () => {
  const [today, tomorrow] = detailDays(hourly, now, tz);
  assert.ok(today && tomorrow);
  return { today, tomorrow };
};

test('the day picker offers today and the days the hourly forecast covers', () => {
  assert.equal(hoursInto(now, tz), 13 + 20 / 60);
  const list = detailDays(hourly, now, tz);
  assert.deepEqual(
    list.map(day => day.key),
    ['2026-10-26', '2026-10-27', '2026-10-28'],
  );
  assert.ok(list[0]?.today && !list[1]?.today);
  assert.deepEqual(
    detailDays([...hourly.slice(0, 1), { datetime: '2026-10-28T12:00:00Z' }], now, tz).map(day => day.key),
    ['2026-10-26'],
  );
});

test('every sheet offers yesterday, today and the daily forecast, eleven in all', () => {
  const days = Array.from({ length: 12 }, (_, i) => ({
      datetime: new Date(now + i * 24 * H).toISOString(),
      temperature: 70,
      templow: 50,
      condition: 'sunny',
    })),
    daily = dailyItems(days, now, tz, {}, days.length),
    list = sheetDays({ hourly: timed, pastHours: [], daily, now, timeZone: tz }, undefined);
  assert.equal(list.length, 11);
  assert.deepEqual(
    list.slice(0, 4).map(day => day.key),
    ['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28'],
  );
  assert.deepEqual([list[0]?.past, list[0]?.today, list[1]?.past, list[1]?.today], [true, false, undefined, true]);
  assert.equal(list.at(-1)?.key, '2026-11-04');
  // Each day keeps its hours, whether or not it has any.
  assert.ok((list[1]?.entries.length ?? 0) > 0 && (list[2]?.entries.length ?? 0) > 0);
  assert.deepEqual(list[0]?.entries, []);
  assert.deepEqual(list.at(-1)?.entries, []);
  assert.equal(list[3]?.daily?.high, 70);
});

test('with no daily forecast the days are those the hours reach, and today is always there', () => {
  const list = sheetDays({ hourly: timed, pastHours: [], daily: [], now, timeZone: tz }, undefined);
  assert.deepEqual(
    list.map(day => day.key),
    ['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28'],
  );
  const none = sheetDays({ hourly: [], pastHours: [], daily: [], now, timeZone: tz }, undefined);
  assert.deepEqual(
    none.map(day => [day.key, day.today]),
    [
      ['2026-10-25', false],
      ['2026-10-26', true],
    ],
  );
});

test('yesterday is what Home Assistant recorded, by the hour, filled in by the hours the forecast keeps', () => {
  const noon = Date.parse('2026-10-25T17:00:00Z'),
    kept = forecasts([
      { datetime: new Date(noon - H).toISOString(), temperature: 50, precipitation: 0.1 },
      { datetime: new Date(noon).toISOString(), temperature: 51, precipitation: 0.2, wind_gust_speed: 20 },
      { datetime: new Date(noon + H).toISOString(), temperature: 52, precipitation: 0.3 },
    ]),
    row = (time: number, a: object) => ({ lu: time / 1000, s: 'rainy', a }),
    states = [
      row(noon + 60_000, { temperature: 60, wind_speed: 7 }),
      // Later in the same hour: the last of the hour stands for it.
      row(noon + 300_000, { temperature: 61, wind_speed: 8 }),
      'nonsense',
      { lu: noon / 1000 },
    ],
    [yesterday] = sheetDays({ hourly: timed, pastHours: kept, daily: [], now, timeZone: tz }, { yesterday: states });
  assert.ok(yesterday);
  const entries = yesterday.entries;
  assert.deepEqual(
    entries.map(entry => entry.temperature),
    [50, 61, 52],
    'the record wins; the forecast carries on either side of it',
  );
  const [, hour] = entries;
  assert.ok(hour);
  assert.equal(hour.condition, 'rainy');
  assert.equal(hour.wind_speed, 8);
  assert.equal(hour.wind_gust_speed, 20, 'and fills in what the record lacks');
  assert.deepEqual([yesterday.daily?.high, yesterday.daily?.low], [61, 50]);
  assert.equal(yesterday.daily?.sky.condition, 'rainy');
});

test('a day with nothing recorded has no daily line of its own to read from', () => {
  const [yesterday] = sheetDays({ hourly: timed, pastHours: [], daily: [], now, timeZone: tz }, { yesterday: [] });
  assert.equal(yesterday?.daily, undefined);
});

test('what a day without hours says', () => {
  const later = { key: 'k', today: false, time: now, entries: [] },
    gone = { ...later, past: true as const };
  assert.equal(noHours(later, false), 'The forecast has no hourly values for this day.');
  assert.equal(noHours(later, true, 'temperatures'), 'The forecast has no hourly temperatures for this day.');
  assert.equal(noHours(gone, true), 'Looking up yesterday’s readings.');
  assert.equal(noHours(gone, false), 'Home Assistant has no record of yesterday’s values.');
});

test('series start today at the current reading and scale to the reading', () => {
  const { today, tomorrow } = days();
  const uv = detailSeries(uvReading.series, today.entries, attrs, now, tz, true);
  assert.equal(uv.find(point => point.now)?.value, 4.2);
  assert.deepEqual(uvReading.scale({ min: 0, max: 4.2 }, attrs).ticks.at(-1), 11);
  const wind = detailSeries(windReading.series, tomorrow.entries, attrs, now, tz, false);
  assert.ok(wind.every(point => !point.now));
  assert.match(summarize(windReading.summary, wind, ctx, false).text, /^On Tuesday, wind speeds will be 3 to 6 mph\.$/);
  const windToday = detailSeries(windReading.series, today.entries, attrs, now, tz, true);
  assert.match(
    summarize(windReading.summary, windToday, ctx, true).text,
    /^Wind is currently 4 mph from the south\. Today, wind speeds are 3 to 6 mph\.$/,
  );
  assert.match(
    summarize(windReading.summary, windToday, ctx, true).headline,
    /^4 mph <span class="detail-dim">S<\/span>$/,
  );
  assert.match(summarize(uvReading.summary, uv, ctx, true).headline, /4 <small>Moderate/);
  assert.equal(summarize(humidityReading.summary, [], ctx, true).headline, '—');
});

test('history fills earlier today and compares with yesterday', () => {
  const states = [
    { lu: Date.parse('2026-10-25T17:00:00Z') / 1000, a: { uv_index: 5 } },
    { lu: Date.parse('2026-10-25T18:00:00Z') / 1000, a: { uv_index: 4 } },
    { last_updated: '2026-10-25T19:00:00Z', attributes: { uv_index: 2 } },
    { a: {} },
  ];
  assert.deepEqual(
    historyPoints(uvReading.series, states).map(point => point.value),
    [5, 4, 2],
  );
  assert.equal(historyPoints(uvReading.series, states, tz)[0]?.hour, 12);
  const at = (...values: number[]) => values.map((value, hour) => ({ hour, value }));
  assert.equal(
    compareDays(uvReading.compare, at(4.2, 3), at(4, 3.6), ctx)?.text,
    'The peak UV index today is similar to yesterday.',
  );
  assert.equal(
    compareDays(uvReading.compare, at(4.2), at(5), ctx)?.text,
    'The peak UV index today is lower than yesterday.',
  );
  assert.equal(
    compareDays(windReading.compare, at(12), at(5), ctx)?.text,
    'The wind speed today is higher than yesterday.',
  );
  // With gusts on both days, the peak gusts are compared.
  const gusts = compareDays(
    windReading.compare,
    [{ hour: 0, value: 5, gust: 11 }],
    [{ hour: 0, value: 4, gust: 12.4 }],
    ctx,
  );
  assert.equal(gusts?.text, 'The peak gust speed today is lower than yesterday.');
  assert.deepEqual(gusts.shown, ['11 mph', '12 mph']);
  assert.match(comparisonMarkup(gusts), /--share:0\.917"><span>Today/);
  assert.equal(
    compareDays(humidityReading.compare, at(40, 40), at(60), ctx)?.text,
    'The average humidity today is lower than yesterday.',
  );
  assert.equal(compareDays(uvReading.compare, [], at(5), ctx), null);
  // Readings without a comparison sentence get none.
  assert.equal(compareDays(pressureReading.compare, at(1013), at(1010), ctx), null);
});

test('summaries name the day and read as they show', () => {
  const time = Date.parse('2026-10-27T17:00:00Z'),
    day = (...values: number[]) => values.map((value, hour) => ({ hour, time: time + hour * H, value }));
  const inches = { ...ctx, attrs: { ...attrs, pressure_unit: 'inHg', visibility_unit: 'mi' } };
  assert.equal(
    summarize(pressureReading.summary, day(30.12, 30.08), inches, false).text,
    'On Tuesday, the average pressure will be 30.10 inHg, and the lowest pressure will be 30.08 inHg.',
  );
  assert.equal(
    summarize(pressureReading.summary, day(30.1, 30.1), inches, false).text,
    'On Tuesday, the average pressure will be 30.10 inHg all day.',
  );
  assert.equal(
    summarize(visibilityReading.summary, day(13, 22), inches, false).text,
    'On Tuesday, the visibility will be perfectly clear, at 13 to 22 mi.',
  );
  assert.equal(
    summarize(visibilityReading.summary, day(0.5, 8), inches, false).text,
    'On Tuesday, the lowest visibility will be moderate at 0.5 mi, and the highest will be clear at 8 mi.',
  );
  // UV of Moderate or more from its first reading at that level to the reading after its last.
  assert.equal(
    summarize(uvReading.summary, day(0, 1, 3, 5, 2, 4, 1, 0), ctx, false).text,
    'Sun protection recommended from 2<small>PM</small> to 6<small>PM</small>.',
  );
  assert.equal(summarize(uvReading.summary, day(0, 1, 2), ctx, false).text, 'Low levels all day.');
  const { today } = days();
  assert.match(
    summarize(
      humidityReading.summary,
      detailSeries(humidityReading.series, today.entries, attrs, now, tz, true),
      ctx,
      true,
    ).text,
    /^Today, the average humidity is \d+%\. The dew point is 55° all day\.$/,
  );
});

test('the chart marks now, labels UV levels and draws earlier hours dashed', () => {
  const { today } = days(),
    points = detailSeries(uvReading.series, today.entries, attrs, now, tz, true);
  const scale = uvReading.scale({ min: 0, max: 4.2 }, attrs),
    html = chartMarkup(uvReading.chart, points, scale, ctx, axis, [{ hour: 9, value: 2, past: true }]);
  assert.match(html, /class="chart-dot" style="left:55\.6%/);
  assert.match(html, /Very High/);
  assert.match(html, /stroke-dasharray="7.5 12.5"/);
  // Read by the minute, from the earliest reading to the day's last minute: the value and its level.
  const line = lineIn(
    chartMarkup(uvReading.chart, points, scale, ctx, axis, [{ hour: 9, value: 2, past: true }], 'reading'),
  );
  assert.deepEqual([line.from, line.to], [9 * 60, 24 * 60 - 1]);
  assert.equal(line.at(9 * 60), '2 <small>Low</small>\n');
  assert.ok(Math.abs(line.topAt(9) - 84.5) < 0.1);
  assert.doesNotMatch(chartMarkup(precipitationLook, points, precipitationScale(), ctx, axis), /chart-dot/);
});

const sheet = { ...ctx, condition: 'partlycloudy', daily: [], pastHours: [] };
const dayForm = (condition: string) => ({ condition, night: false });
const inputs = { history: undefined, reach: null, pending: false, nowName: 'Partly Cloudy', named: String };
test('condition names and unfamiliar temperature units stay text in the forecast sheets', () => {
  const { today, tomorrow } = days(),
    outside = '<img src=x onerror=alert(1)>',
    conditions = { ...sheet, condition: outside, hourly: [{ ...hourly[0], condition: outside }] },
    html = conditionsBody(conditions, today, 'temperature', { ...inputs, nowName: outside });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
  const later = conditionsBody(
    { ...sheet, attrs: { ...attrs, temperature_unit: outside } },
    tomorrow,
    'temperature',
    inputs,
  );
  assert.doesNotMatch(later, /<img/);
  assert.match(later, /&lt;img/);
  const next = nextHourDetail(
    conditions,
    {
      title: 'Rain Forecasted',
      text: 'Rain for the next hour',
      series: [1, 1],
      chart: [1, 1],
      past: 0,
      unit: 'mm',
      felt: undefined,
    },
    String,
  );
  assert.doesNotMatch(next, /<img/);
  assert.match(next, /&lt;img/);
});
test("a sheet heads a day with the symbol its row shows, and today's follows the night", () => {
  const { today, tomorrow } = days();
  const shown = (day: Parameters<typeof conditionsBody>[1]) => conditionsBody(sheet, day, 'temperature', inputs);
  const clear = { high: 60, low: 40, condition: 'clear-night' };
  assert.ok(
    shown({ ...today, daily: { ...clear, sky: { condition: 'clear-night', night: true } } }).includes(SYMBOLS.moon),
  );
  assert.ok(shown({ ...tomorrow, daily: { ...clear, sky: dayForm('clear-night') } }).includes(SYMBOLS.sun));
  // Explicit partly-cloudy keeps its symbol even when today's measured cover is high.
  const covered = { ...sheet, attrs: { ...attrs, cloud_coverage: 85 } };
  const partly = { high: 60, low: 40, condition: 'partlycloudy', sky: dayForm('partlycloudy') };
  assert.ok(conditionsBody(covered, { ...today, daily: partly }, 'temperature', inputs).includes(SYMBOLS['cloud-sun']));
  assert.ok(
    conditionsBody(covered, { ...tomorrow, daily: partly }, 'temperature', inputs).includes(SYMBOLS['cloud-sun']),
  );
});
test('a precipitation total takes its colour once there is any', () => {
  const { today, tomorrow } = days();
  const dry = conditionsBody(
    { ...sheet, hourly: [] },
    { ...tomorrow, daily: { high: 72, low: 53, condition: 'sunny', precipitation: 0, sky: dayForm('sunny') } },
    'temperature',
    inputs,
  );
  assert.match(dry, /<dd><span>Precipitation<\/span><b>0″/);
  // A sensor's total says nothing of what fell, but is coloured all the same.
  const wet = conditionsBody({ ...sheet, lastDay: 0.3 }, today, 'temperature', inputs);
  assert.match(
    wet,
    /Last 24 Hours<\/dt><dd><span><i style="background:#3cd3fe"><\/i>Precipitation<\/span><b style="color:#3cd3fe">/,
  );
});
test('a range bar names only the part of the temperature scale it shows', () => {
  const percents = (stops: string) => [...stops.matchAll(/(-?[\d.]+)%/g)].map(match => Number(match[1]));
  const warm = percents(temperatureGradient(66, 77, '°F'));
  assert.equal(warm[0], 0);
  assert.equal(warm.at(-1), 100);
  assert.ok(warm.every(at => at >= 0 && at <= 100));
  // 70° falls between the two, so its stop stays.
  assert.equal(warm.length, 3);
  // The same in Celsius, across more of the scale.
  assert.ok(percents(temperatureGradient(-20, 30, '°C')).every(at => at >= 0 && at <= 100));
});
test('a day’s line reaches the edge of its chart', () => {
  const points = Array.from({ length: 24 }, (_, hour) => ({ hour, value: 60 + hour }));
  const chart = chartMarkup(ACTUAL.chart, points, temperatureScale({ min: 60, max: 83 }), sheet, otherAxis);
  const width = Number(/viewBox="0 0 ([\d.]+)/.exec(chart)?.[1]),
    line = /<path d="([^"]+)" fill="none"/.exec(chart)?.[1] ?? '';
  assert.ok(width > 0);
  assert.match(line, new RegExp(`[ CL]${width}(\\.0)? [\\d.]+$`));
});
test('the chance chart leaves a step clear above 100%, with a plain line', () => {
  const scale = chanceScale();
  assert.equal(scale.max, 120);
  assert.equal(scale.ticks.at(-1), 100);
  const chart = chartMarkup(
    chanceLook,
    [
      { hour: 1, value: 40 },
      { hour: 2, value: 60 },
      { hour: 3, value: 50 },
      { hour: 4, value: 70 },
    ],
    scale,
    sheet,
    otherAxis,
  );
  assert.match(chart, /stroke-width="2\.5"/);
  assert.doesNotMatch(chart, /d="M[^"]*C/);
});
test('the Conditions sheet shows a day’s range, hours, chance, totals and summary', () => {
  const { today, tomorrow } = days();
  const day = {
    ...tomorrow,
    daily: { high: 72, low: 53, condition: 'cloudy', precipitation: 0.12, sky: dayForm('cloudy') },
  };
  const actual = conditionsBody(sheet, day, 'temperature', inputs),
    feels = conditionsBody(sheet, day, 'feels_like', inputs);
  assert.match(actual, /72° <span class="low">53°<\/span>/);
  assert.match(actual, /Fahrenheit \(°F\)/);
  assert.match(actual, /data-variant="temperature" aria-pressed="true"/);
  assert.match(feels, /data-variant="feels_like" aria-pressed="true"[\s\S]*humidity, sunlight, or wind/);
  assert.match(
    actual,
    /Precipitation Total<\/h3><div class="detail-panel"><dl class="sheet-rows"><div><dd><span><i[^>]*><\/i>Rain<\/span><b[^>]*>\.1″/,
  );
  // Another day: its low and high with their hours, how it feels, no comparison.
  assert.match(
    actual,
    /Tuesday’s low will be 53° between 11<small>PM<\/small> and 12<small>AM<\/small>, and the high will be 65° between 12<small>AM<\/small> and 1<small>AM<\/small>\. The temperature range will feel like /,
  );
  assert.doesNotMatch(actual, /Daily Comparison/);
  // A day beyond the hourly forecast keeps its range but has no chart.
  const later = conditionsBody(
    sheet,
    {
      key: 'x',
      today: false,
      time: now + 5 * 86400000,
      entries: [],
      daily: { high: 70, low: 58, condition: 'rainy', precipitation_probability: 80, sky: dayForm('rainy') },
    },
    'temperature',
    inputs,
  );
  assert.match(later, /no hourly temperatures/);
  // Today: the temperature now, the paragraph, and the range against yesterday's.
  const yesterday = [60, 79].map((temperature, i) => ({
    s: 'sunny',
    a: { temperature },
    lu: now / 1000 - 86400 + i * 3600,
  }));
  const todaySheet = conditionsBody(
    { ...sheet, lastDay: 0 },
    { ...today, daily: { high: 75, low: 52, sky: dayForm('sunny') } },
    'temperature',
    { ...inputs, history: { today: [], yesterday } },
  );
  assert.match(todaySheet, /class="chart-dot"/);
  assert.match(todaySheet, /H:75° L:52°/);
  assert.match(
    todaySheet,
    /<h3>Forecast<\/h3><div class="detail-panel"><p>72° now and partly cloudy\. Today’s temperature range is from 52° to 75° and feels like /,
  );
  assert.match(todaySheet, /Last 24 Hours<\/dt><dd><span>Precipitation<\/span><b>0″/);
  assert.match(
    todaySheet,
    /The high temperature today is similar to yesterday\.[\s\S]*Yesterday<\/span><b class="low">60°/,
  );
  assert.match(conditionsBody(sheet, today, 'feels_like', inputs), /Actual: 72°/);
});

test('a day reads one total, wherever it is named', () => {
  // Hours across the whole day that say more than its daily forecast does.
  const start = Date.parse('2026-10-27T05:00:00Z'),
    wholeDay = Array.from({ length: 24 }, (_, i) => ({
      datetime: new Date(start + i * H).toISOString(),
      time: start + i * H,
      condition: 'rainy',
      precipitation: 0.05,
    })),
    item: DailyItem = {
      time: start + 12 * H,
      today: false,
      high: 60,
      low: 50,
      condition: 'rainy',
      precipitation: 0.3,
      sky: dayForm('rainy'),
    },
    day: DetailDay = { key: '2026-10-27', today: false, time: start + 12 * H, entries: wholeDay, daily: item },
    at = { ...sheet, hourly: wholeDay, daily: [item], pastHours: [] };
  const info = dailyDetail(wholeDay, [item], tz).get('2026-10-27');
  assert.equal(dayRain(item, info).total?.toFixed(2), '1.20');
  assert.match(precipitationBody(at, day), /1\.2″<\/div><div class="detail-sub">Total for the day/);
  assert.match(precipitationBody(at, day), /<b style="color:#3cd3fe">1\.2″/);
  // Hours under half of it are no total for it: the forecast's stands everywhere.
  const few = wholeDay.slice(0, 4),
    short = { ...at, hourly: few };
  assert.equal(dayAmount(short, item, item), 0.3);
  assert.match(precipitationBody(short, { ...day, entries: few }), /\.3″<\/div><div class="detail-sub">Total/);
});
test('the Precipitation sheet totals the day and tells what fell and is expected', () => {
  const { today, tomorrow } = days();
  const rainy = precipitationBody(sheet, tomorrow);
  assert.match(rainy, /\.1″<\/div><div class="detail-sub">Total for the day/);
  assert.match(rainy, /On Tuesday, the total rainfall will be \.1″\./);
  assert.match(rainy, /9AM - 10AM\\n(Light|Moderate)\\nRain/);
  assert.equal(
    /<h3>Daily Summary<\/h3><div class="detail-panel"><p>([^<]*)/.exec(
      precipitationBody({ ...sheet, lastDay: 0 }, today),
    )?.[1],
    'There has been 0″ of precipitation in the last 24 hours. Today’s total precipitation will be 0″. In the next 24 hours, .1″ of precipitation is expected.',
  );
});
test('with nothing in the next 24 hours, the summary tells when the next falls and how much', () => {
  const { today } = days();
  // Today and the days after it, each with its amount and condition.
  const ahead = (...forecast: readonly (readonly [number, string])[]) =>
      dailyItems(
        forecast.map(([precipitation, condition], i) => ({
          datetime: new Date(now + i * 24 * H).toISOString(),
          temperature: 70,
          templow: 50,
          condition,
          precipitation,
        })),
        now,
        tz,
        {},
        forecast.length,
      ),
    summary = (daily: readonly DailyItem[]) =>
      /<h3>Daily Summary<\/h3><div class="detail-panel"><p>([^<]*)/.exec(
        precipitationBody({ ...sheet, hourly: [], lastDay: 0, daily }, { ...today, entries: [] }),
      )?.[1] ?? '';
  assert.equal(
    summary(ahead([0, 'sunny'], [0, 'sunny'], [0.2, 'rainy'])),
    'There has been 0″ of precipitation in the last 24 hours. Today’s total precipitation will be 0″. Next expected is .2″ Wed.',
  );
  assert.match(summary(ahead([0, 'sunny'], [0.2, 'rainy'])), / \.2″ expected tomorrow\.$/);
  assert.match(summary(ahead([0, 'sunny'], [0, 'sunny'], [0.4, 'snowy'])), / Next snow is \.4″ Wed\.$/);
  // Nothing ahead, nothing said of it.
  assert.match(summary(ahead([0, 'sunny'], [0, 'sunny'])), /will be 0″\.$/);
});

// Readings on a day, for its sentences.
const readings = (from: number, ...values: readonly number[]): ChartPoint[] =>
  values.map((value, i) => ({ hour: i, time: from + i * H, value }));
const TOMORROW = now + 24 * H,
  YESTERDAY = now - 24 * H;
const told = (...rest: Parameters<typeof summarize>) => summarize(...rest);
test('another day heads a sheet with its range, its average or its peak, and yesterday’s sentences are over', () => {
  const at = { ...ctx, attrs: { ...attrs, visibility_unit: 'mi', pressure_unit: 'inHg' } };
  const gusty = readings(TOMORROW, 5, 9).map(point => ({ ...point, gust: 18 }));
  assert.deepEqual(told(windReading.summary, gusty, at, false), {
    headline: '5–9 mph',
    sub: 'Gusts up to 18 mph',
    text: 'On Tuesday, wind speeds will be 5 to 9 mph, with gusts up to 18 mph.',
  });
  const humid = told(humidityReading.summary, readings(TOMORROW, 60, 70), at, false);
  assert.deepEqual([humid.headline, humid.sub], ['65<small>%</small>', 'Average']);
  const pressed = told(pressureReading.summary, readings(TOMORROW, 30, 30.2), at, false);
  assert.deepEqual([pressed.headline, pressed.sub], ['30.10 <small>inHg</small>', 'Average']);
  // A day's change shows: a whole kilopascal would hide it.
  const metric = { ...at, attrs: { ...at.attrs, pressure_unit: 'kPa' } };
  assert.equal(
    told(pressureReading.summary, readings(TOMORROW, 101, 101.6), metric, false).headline,
    '101.3 <small>kPa</small>',
  );
  const seen = told(visibilityReading.summary, readings(TOMORROW, 0.1, 12), at, false);
  assert.deepEqual([seen.headline, seen.sub], ['0.1–12 <small>mi</small>', 'Poor to perfectly clear']);
  // A pair of one is one, and one distance isn't a range.
  const clear = told(visibilityReading.summary, readings(TOMORROW, 12, 15), at, false);
  assert.deepEqual([clear.headline, clear.sub], ['12–15 <small>mi</small>', 'Perfectly clear']);
  assert.equal(told(visibilityReading.summary, readings(TOMORROW, 12, 12), at, false).headline, '12 <small>mi</small>');
  const peak = told(uvReading.summary, readings(TOMORROW, 1, 6, 2), at, false);
  assert.equal(peak.headline, '6 <small>High</small>');
  assert.equal(peak.sub, 'World Health Organization UVI');
  // Yesterday, in its own tense.
  const gone = (summary: Parameters<typeof summarize>[0], ...values: readonly number[]) =>
    told(summary, [], at, false, readings(YESTERDAY, ...values)).text;
  assert.equal(gone(uvReading.summary, 0, 4, 1), 'Yesterday, the highest UV index was 4.');
  assert.equal(gone(windReading.summary, 5, 9), 'Yesterday, wind speeds were 5 to 9 mph.');
  assert.equal(gone(windReading.summary, 5, 5), 'Yesterday, wind speeds were around 5 mph all day.');
  assert.equal(gone(humidityReading.summary, 60, 70), 'Yesterday, the average humidity was 65%.');
  assert.equal(
    gone(pressureReading.summary, 30, 30.2),
    'Yesterday, the average pressure was 30.10 inHg, and the lowest pressure was 30.00 inHg.',
  );
  assert.equal(gone(visibilityReading.summary, 12, 12), 'Yesterday, the visibility was perfectly clear, at 12 mi.');
});
// A whole sheet's view of the day, for what only a sheet draws.
const VIEW: SheetView = {
  ctx: {
    ...ctx,
    hourly: forecasts(hourly),
    pastHours: [],
    daily: [],
    sun: undefined,
    config: normalizeConfig({ type: 'custom:iweather-card', entity: 'weather.home' }),
    hass: undefined,
    mode: undefined,
    dark: false,
    atHome: true,
    pinName: '',
    placeName: '',
    condition: 'sunny',
    latitude: undefined,
    longitude: undefined,
    earlier: undefined,
    climate: undefined,
  },
  title: 'UV Index',
  day: undefined,
  days: [],
  variant: '',
  month: 0,
  moonOffset: 0,
  history: null,
  reach: null,
  canAsk: false,
  dayBand: undefined,
  alerts: [],
  nextHour: undefined,
  named: String,
  nowName: '',
  mapLayer: undefined,
};
test('a day’s UV reads its level as it shows, and heads its summary with the date', () => {
  assert.match(told(uvReading.summary, readings(TOMORROW, 2.6), ctx, false).headline, /^3 <small>Moderate/);
  const { tomorrow, today } = days(),
    drawn = (day: DetailDay) => readingSheet(uvReading)({ ...VIEW, day });
  assert.match(drawn(tomorrow), /<h3 class="detail-now">Oct 27, 2026<\/h3>/);
  assert.match(drawn(today), /<h3 class="detail-now">Now, 1:20<small>PM<\/small><\/h3>/);
  assert.equal(
    told(uvReading.summary, readings(TOMORROW - 4 * H, 1, 3, 5, 1), ctx, false).text,
    'Sun protection recommended from 10<small>AM</small> to 12<small>PM</small>.',
  );
  assert.equal(
    told(uvReading.summary, readings(TOMORROW, 4, 5), ctx, false).text,
    'Sun protection recommended all day.',
  );
});
test('UV top rows show rounded index numbers including zero, without needing weather conditions', () => {
  const start = Date.parse('2026-10-27T05:00:00Z'),
    values = [0, 0, 0, 0, 0.6, 1.6, 2.7, 2.3, 1.2, 0.4, 0, 0],
    entries = Array.from({ length: 24 }, (_, hour) => ({
      datetime: new Date(start + hour * H).toISOString(),
      time: start + hour * H,
      uv_index: values[Math.floor(hour / 2)] ?? 0,
    })),
    day: DetailDay = { key: '2026-10-27', today: false, time: start, entries },
    markup = readingSheet(uvReading)({ ...VIEW, day, days: [day] }),
    row = /<div class="chart-top"[^>]*>(.*?)<\/div>/.exec(markup)?.[1] ?? '',
    numbers = [...row.matchAll(/<span[^>]*>(.*?)<\/span>/g)].map(match => match[1]);
  assert.deepEqual(numbers, ['0', '0', '0', '0', '1', '2', '3', '2', '1', '0', '0', '0']);
  assert.doesNotMatch(row, /<svg|data-past/);
});
test('visibility goes no further than can be told, in its heading and its sentences', () => {
  const at = { ...ctx, attrs: { ...attrs, visibility_unit: 'mi' } },
    far = told(visibilityReading.summary, readings(TOMORROW, 30, 40), at, false);
  assert.equal(far.headline, '25 <small>mi</small>');
  assert.equal(far.text, 'On Tuesday, the visibility will be perfectly clear, at 25 mi.');
});
test('wind reads as much as it has: gusts now, and none at all left unsaid', () => {
  const at = { ...ctx, hourly },
    plain = detailSeries(windReading.series, days().today.entries, attrs, now, tz, true);
  assert.equal(told(windReading.summary, plain, at, true).sub, '');
  const gusting = hourly.map(entry => ({ ...entry, time: Date.parse(entry.datetime ?? ''), wind_gust_speed: 11 })),
    filled = detailSeries(windReading.series, gusting.slice(0, 5), { ...attrs, wind_gust_speed: 11 }, now, tz, true);
  assert.equal(told(windReading.summary, filled, at, true).sub, 'Gusts: 11 mph');
  // A day that only reads the same has one speed and no dash, and with no gusts, nothing under it.
  const steady = told(windReading.summary, readings(TOMORROW, 7, 7), at, false);
  assert.deepEqual([steady.headline, steady.sub], ['7 mph', '']);
});
test('a day with a daily forecast but no hours reads what that has, and still says the hours are missing', () => {
  const { tomorrow } = days(),
    daily = { high: 70, low: 50, sky: { condition: 'cloudy', night: false } },
    bare = { ...tomorrow, entries: [] },
    sheet = (spec: Parameters<typeof readingSheet>[0], forecast: object) =>
      readingSheet(spec)({ ...VIEW, day: { ...bare, daily: { ...daily, ...forecast } } }),
    head = (drawn: string) => /detail-headline">(.*?)<\/div><div class="detail-sub">(.*?)<\/div>/.exec(drawn)?.slice(1);
  const wind = sheet(windReading, { wind_speed: 12.4, wind_gust_speed: 21 });
  assert.deepEqual(head(wind), ['12 mph', 'Gusts up to 21 mph']);
  assert.match(wind, /The forecast has no hourly values for this day\./);
  assert.deepEqual(head(sheet(windReading, { wind_speed: 12.4 })), ['12 mph', '']);
  assert.deepEqual(head(sheet(uvReading, { uv_index: 6 })), ['6 <small>High</small>', 'World Health Organization UVI']);
  // What the daily forecast doesn't have, it can't read.
  assert.deepEqual(head(sheet(windReading, {})), ['—', '']);
  assert.deepEqual(head(readingSheet(windReading)({ ...VIEW, day: bare })), ['—', '']);
});
test('humidity says the dew point it has now, and nothing without one', () => {
  const { dew_point: _, ...without } = attrs,
    at = { ...ctx, attrs: without },
    lent = hourly.map(entry => ({ ...entry, time: Date.parse(entry.datetime ?? ''), dew_point: 41 }));
  // Wherever the reading now came from (see readingsNow), and not the hour under way's.
  assert.equal(
    told(
      humidityReading.summary,
      detailSeries(humidityReading.series, lent.slice(0, 5), { ...without, dew_point: 48 }, now, tz, true),
      at,
      true,
    ).sub,
    'Dew point: 48°',
  );
  assert.equal(
    told(
      humidityReading.summary,
      detailSeries(humidityReading.series, days().today.entries, without, now, tz, true),
      at,
      true,
    ).sub,
    '',
  );
});
const hoursBefore = (count: number, more: ForecastEntry = {}) =>
  Array.from({ length: count }, (_, i) => ({
    time: now - (now % H) - (i + 1) * H,
    datetime: '',
    condition: 'rainy',
    precipitation: 0.01,
    precipitation_probability: 50,
    ...more,
  })).toReversed();
test('the last 24 hours come from a sensor, or else the hours over if they reach that far', () => {
  const { today } = days(),
    last = (body: string) => /Last 24 Hours<\/dt><dd><span>(.*?)<\/span><b[^>]*>([^<]*)/.exec(body)?.slice(1),
    told24 = (body: string) => /There has been ([^ ]+) of precipitation in the last 24 hours\./.exec(body)?.[1];
  // 26 hours over, 24 of them in the last 24: .01″ each, of rain.
  const hours = precipitationBody({ ...sheet, pastHours: hoursBefore(26) }, today);
  assert.deepEqual(last(hours), ['<i style="background:#3cd3fe"></i>Rain', '.25″']);
  assert.equal(told24(hours), '.25″');
  // A sensor knows better, and says nothing of what fell.
  const sensor = precipitationBody({ ...sheet, pastHours: hoursBefore(26), lastDay: 0.4 }, today);
  assert.deepEqual(last(sensor), ['<i style="background:#3cd3fe"></i>Precipitation', '.4″']);
  // Short of a day there's no telling.
  const short = precipitationBody({ ...sheet, pastHours: hoursBefore(20) }, today);
  assert.equal(last(short), undefined);
  assert.equal(told24(short), undefined);
  // Without their amounts, nor is there.
  const blank = hoursBefore(26, { precipitation: undefined });
  assert.equal(last(precipitationBody({ ...sheet, pastHours: blank }, today)), undefined);
  assert.doesNotMatch(precipitationBody(sheet, today), /Last 24 Hours/);
});
test('yesterday compares from the hours over where history lacks the reading', () => {
  const { today } = days(),
    miles = { ...attrs, visibility_unit: 'mi' },
    start = dayAxis(now, tz).start,
    hours = Array.from({ length: 24 }, (_, i) => ({ time: start - (24 - i) * H, datetime: '', visibility: 8 })),
    hourly = today.entries.map(entry => ({ ...entry, visibility: 12 })),
    view: SheetView = {
      ...VIEW,
      ctx: { ...VIEW.ctx, attrs: miles, hourly, pastHours: hours },
      day: { ...today, entries: hourly },
      history: { yesterday: [], today: [] },
    },
    drawn = readingSheet(visibilityReading)(view);
  assert.match(drawn, /Visibility today is greater than yesterday\./);
  // While history is on its way, its place is held rather than filled twice.
  const waiting = readingSheet(visibilityReading)({ ...view, history: undefined, canAsk: true });
  assert.match(waiting, /data-pending/);
  // The Conditions sheet's range too.
  const conditions = conditionsBody(
    { ...sheet, pastHours: hours.map(hour => ({ ...hour, temperature: 60 })) },
    today,
    'temperature',
    { ...inputs, history: { today: [], yesterday: [] } },
  );
  assert.match(conditions, /Yesterday<\/span><b class="low">60°/);
});
test('a chance nobody gave isn’t none, and a chance for the day alone has no chart', () => {
  const { today, tomorrow } = days(),
    daily = { high: 72, low: 53, condition: 'rainy', sky: dayForm('rainy') };
  // The forecast here has no chance on its hours or days.
  assert.doesNotMatch(conditionsBody(sheet, { ...today, daily }, 'temperature', inputs), /detail-chance|chance:/);
  assert.doesNotMatch(precipitationBody(sheet, tomorrow), /detail-chance|chance:/);
  const offered = conditionsBody(
    sheet,
    { ...tomorrow, daily: { ...daily, precipitation_probability: 85 } },
    'temperature',
    inputs,
  );
  assert.match(offered, /Tuesday’s chance: 85%/);
  assert.doesNotMatch(offered, /data-chart="chance"/);
  // An hour's chance of 0% is a chance, and reads.
  const dry = hourly.map(entry => ({ ...entry, precipitation_probability: 0 })),
    [first] = detailDays(dry, now, tz);
  assert.ok(first);
  assert.match(precipitationBody({ ...sheet, hourly: dry }, first), /Today’s chance: 0%/);
});
test('a day past the hours shows its total, with no chart', () => {
  const later: DetailDay = { key: '2026-11-03', today: false, time: Date.parse('2026-11-03T18:00:00Z'), entries: [] },
    daily = {
      time: later.time,
      datetime: '2026-11-03T18:00:00Z',
      precipitation: 0.1,
      precipitation_probability: 85,
      condition: 'rainy',
      high: 60,
      low: 50,
      today: false,
      sky: dayForm('rainy'),
    },
    body = precipitationBody({ ...sheet, daily: [daily] }, later);
  assert.match(body, /\.1″<\/div><div class="detail-sub">Total for the day/);
  assert.match(body, /Tuesday’s chance: 85%/);
  assert.doesNotMatch(body, /class="chart"/);
  assert.match(body, /On Tuesday, the total rainfall will be \.1″\./);
  // With nothing to tell, there's no total to label.
  assert.match(precipitationBody(sheet, later), /—<\/div><div class="detail-sub"><\/div>/);
});
test('yesterday charts what is known of it, its chance hatched, in the past tense', () => {
  const key = '2026-10-25',
    time = Date.parse('2026-10-25T17:00:00Z'),
    gone: DetailDay = { key, today: false, time, entries: [] },
    hours = Array.from({ length: 24 }, (_, i) => ({
      time: time - 12 * H + i * H,
      datetime: '',
      condition: i < 12 ? 'rainy' : 'cloudy',
      precipitation: i < 12 ? 0.02 : 0,
      precipitation_probability: i < 12 ? 70 : 10,
      temperature: 50 + i / 2,
    })),
    with_hours = { ...sheet, pastHours: hours };
  const rain = precipitationBody(with_hours, gone);
  assert.match(rain, /data-chart="precipitation"[^>]*data-gone/);
  assert.match(rain, /Yesterday, the total rainfall was \.25″\./);
  assert.match(rain, /Sunday’s chance: 70%/);
  assert.match(rain, /data-chart="chance"[^>]*--now-x:100\.0%.*class="chart-hatch"/);
  // A day over with hours of its own is no different: nothing counts twice, and no chance is drawn.
  const listed = precipitationBody(with_hours, { ...gone, entries: hours });
  assert.match(listed, /Yesterday, the total rainfall was \.25″\./);
  assert.doesNotMatch(listed, /stroke="#3cd3fe"/);
  const felt = conditionsBody(with_hours, gone, 'feels_like', inputs);
  assert.match(felt, /data-chart="feels_like"[^>]*data-gone/);
  assert.match(felt, /<div class="detail-sub">Feels Like<\/div>/);
  assert.match(felt, /Sunday’s low was 50°/);
  assert.match(felt, /The temperature range felt like /);
  // Its symbol is its own weather, not today's.
  assert.ok(conditionsBody(with_hours, gone, 'temperature', inputs).includes(SYMBOLS.rain));
  // With nothing known of it, it says so, as any day with no hours.
  assert.match(conditionsBody(sheet, gone, 'temperature', inputs), /no hourly temperatures/);
  assert.doesNotMatch(precipitationBody(sheet, gone), /class="chart"/);
});

test('the wind sheet goes on from gusts to the Beaufort scale, in the unit shown', () => {
  const { today } = days(),
    drawn = (speed: string) =>
      readingSheet(windReading)({
        ...VIEW,
        ctx: { ...VIEW.ctx, attrs: { ...attrs, wind_speed_unit: speed } },
        day: today,
      }),
    headings = (markup: string) => [...markup.matchAll(/<h3[^>]*>([^<]+)<\/h3>/g)].map(match => match[1]);
  assert.deepEqual(headings(drawn('mph')).slice(-3), [
    'About Wind Speed and Gusts',
    'Beaufort Scale',
    'About the Beaufort Scale',
  ]);
  const about = /About Wind Speed and Gusts<\/h3><div class="detail-panel"><p>([^<]+)/.exec(drawn('mph'))?.[1];
  assert.equal(
    about,
    'Wind speed is averaged over a short period. Gusts are brief bursts above that average, usually lasting under 20 seconds.',
  );
  assert.equal(
    drawn('mph')
      .match(/<tbody>.*<\/tbody>/s)?.[0]
      .match(/<tr>/g)?.length,
    13,
  );
  assert.match(drawn('mph'), /<i style="background:#22b9d2"><\/i>0<\/td><td>Calm<\/td><td>&lt; 1<\/td>/);
  assert.match(drawn('mph'), /<i style="background:#e81854"><\/i>12<\/td><td>Hurricane-force<\/td><td>&gt; 73<\/td>/);
  assert.match(drawn('km/h'), /<th scope="col">Description<\/th><th scope="col">km\/h<\/th>/);
  assert.match(drawn('km/h'), /<td>Hurricane-force<\/td><td>&gt; 117<\/td>/);
  // On the Beaufort scale itself, the first column is all there is to say of a speed.
  assert.doesNotMatch(drawn('Beaufort'), /<th scope="col">Description<\/th><th/);
  assert.match(drawn('Beaufort'), /Hurricane-force<\/td><\/tr>/);
});
test('the humidity sheet closes with its two notes, the dew point’s last', () => {
  const { today } = days(),
    drawn = readingSheet(humidityReading)({ ...VIEW, day: today }),
    notes = [...drawn.matchAll(/detail-about"><h3>([^<]+)<\/h3><div class="detail-panel"><p>([^<]+)/g)];
  assert.deepEqual(
    notes.map(note => note[1]),
    ['About Relative Humidity', 'About Dew Point'],
  );
  assert.equal(
    notes[1]?.[2],
    'The dew point is the temperature the air would need to cool to for dew to form. It tells you how humid the air feels better than relative humidity does: the higher it is, the muggier it feels.',
  );
});
// A record for October, its normals and its months; and thirty days of rain.
const OCTOBER_DATES = Array.from({ length: 30 }, (_, i) =>
  new Date(Date.parse('2026-09-26') + i * 24 * H).toISOString().slice(0, 10),
);
const averagesCtx = (months: { high: number; low: number; precipitation: number }[], extra: object = {}) => {
  const normal: Normal = { high: 63, low: 45, range: [55, 70], span: [37, 71], rain: 0.11 },
    keys = Array.from({ length: 60 }, (_, i) =>
      new Date(Date.parse('2026-09-20') + i * 24 * H).toISOString().slice(5, 10),
    );
  return {
    ...ctx,
    daily: [{ time: now, high: 69, low: 55, today: true, sky: dayForm('sunny') }],
    climate: { normals: Object.fromEntries(keys.map(key => [key, normal])), since: 1991, years: 30, months },
    recentRain: { dates: OCTOBER_DATES, amounts: OCTOBER_DATES.map(() => 0.035), total: 1.05 },
    ...extra,
  };
};
const A_YEAR_OF_MONTHS = [
  [26, 40],
  [28, 45],
  [37, 56],
  [47, 68],
  [58, 77],
  [67, 85],
  [72, 89],
  [70, 87],
  [62, 81],
  [51, 69],
  [39, 56],
  [29, 44],
].map(([low = 0, high = 0], i) => ({ low, high, precipitation: 2 + i / 4 }));
test('a month’s bar sits on the year’s lows and highs, in its own stretch of the colours', () => {
  const drawn = averagesDetail(averagesCtx(A_YEAR_OF_MONTHS)),
    july =
      /<span>Jul<\/span><b class="low">72°<\/b><span class="range-track"><span class="range-fill" style="([^"]+)"/.exec(
        drawn,
      )?.[1];
  // From (72 − 26) ÷ (89 − 26) of the way across to the end of it.
  assert.match(july ?? '', /^left:73\.0\d*%;width:26\.9\d*%/);
  // The colours run from low to high across the whole track, so July's stretch starts well past its
  // low: at 72 + (89 − 72) × 73%.
  const [start] = /#[0-9a-f]{6}/.exec(july ?? '') ?? [];
  assert.equal(start, temperatureColor(72 + (89 - 72) * ((72 - 26) / (89 - 26)), '°F'));
  // The month it is keeps its place for a screen reader, and only that.
  assert.match(drawn, /<div aria-current="true"><span>Oct<\/span>/);
  assert.equal(drawn.match(/aria-current/g)?.length, 1);
});
test('the Averages chart is framed, its line and band each spread over the height of the scale', () => {
  const today = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      value: hour === 14 ? 69 : hour === 5 ? 55 : 62,
    })),
    band = { low: Array.from({ length: 24 }, () => 38), high: Array.from({ length: 24 }, () => 73) },
    drawn = averagesDetail(averagesCtx(A_YEAR_OF_MONTHS), 'temperature', { today, band }),
    chart = /<div class="chart"[^>]*>/.exec(drawn)?.[0] ?? '',
    gradient = (name: string) =>
      [
        ...(new RegExp(`id="${name}-t-average-[^"]*".*?</linearGradient>`).exec(drawn)?.[0] ?? '').matchAll(
          /stop-color="(#\w+)"/g,
        ),
      ].map(match => match[1]);
  assert.match(chart, /data-chart="average"/);
  assert.match(chart, /data-framed/);
  // Each reading's lowest at the foot of the scale and its highest at the top.
  assert.equal(gradient('line')[0], temperatureColor(55, '°F'));
  assert.equal(gradient('line').at(-1), temperatureColor(69, '°F'));
  assert.equal(gradient('fill')[0], temperatureColor(38, '°F'));
  assert.equal(gradient('fill').at(-1), temperatureColor(73, '°F'));
  assert.match(drawn, /id="fill-t-average-[^"]*"[^>]*>(<stop [^>]*stop-opacity="0.5"\/>)+<\/linearGradient>/);
  // The line over all of it, and no now on a chart of the whole day.
  assert.match(drawn, /<svg class="chart-lifted"[^>]*><rect [^>]*fill="url\(#line-t-average-[^"]*\)"/);
  assert.doesNotMatch(drawn, /chart-dot|chart-rule|stroke-dasharray/);
  // The legend's dots show each reading's colours, the hottest at the top.
  assert.match(
    drawn,
    new RegExp(
      `<i style="background:linear-gradient\\(in oklab,${temperatureColor(69, '°F')} 0%.*?${temperatureColor(55, '°F')} 100%\\)"></i>Today`,
    ),
  );
  assert.match(
    drawn,
    /<i class="band" style="background:linear-gradient\(in oklab,.*?<\/i>Normal Range \(38° to 73°\)/s,
  );
});
test('the rain chart leaves its top to the two totals, and its lines run straight', () => {
  const drawn = averagesDetail(averagesCtx(A_YEAR_OF_MONTHS), 'precipitation'),
    plot = 275;
  assert.match(drawn, /<div class="chart rain-chart"[^>]*data-framed/);
  // The scale's top, 6 in, stands 75 px down.
  assert.match(drawn, new RegExp(`<span style="top:${((75 / plot) * 100).toFixed(1)}%">6</span>`));
  assert.match(drawn, /<span style="top:100.0%">0 in<\/span>/);
  const [average, actual] = [
    ...drawn.matchAll(/<path d="(M[^"]+)" fill="none" stroke="([^"]+)" stroke-width="5"([^>]*)>/g),
  ];
  assert.doesNotMatch(actual?.[1] ?? '', /C/);
  assert.equal(actual?.[2], '#3cd3fe');
  assert.match(actual[3] ?? '', /stroke-linecap="butt"/);
  assert.doesNotMatch(average?.[1] ?? '', /C/);
  assert.match(average?.[3] ?? '', /stroke-dasharray="10 10" stroke-linecap="round"/);
  // A dot each at today, its rule, and the rules every ten days back from it.
  assert.equal(drawn.match(/class="chart-dot/g)?.length, 2);
  assert.match(drawn, /<i class="chart-rule" style="left:75\.0%"><\/i>/);
  assert.deepEqual(
    [...drawn.matchAll(/<i class="chart-hour"( data-last)? style="left:([\d.]+)%"/g)].map(match => match[2]),
    ['50.0', '25.0', '100'],
  );
  // The units of a total in millimetres stand smaller beside it.
  const metric = averagesDetail(
    averagesCtx(A_YEAR_OF_MONTHS, { attrs: { ...attrs, precipitation_unit: 'mm' } }),
    'precipitation',
  );
  assert.match(metric, /<b class="rain-total">[\d.]+ <small>mm<\/small><\/b>/);
});
test('the Averages sheet has a temperature tab and a precipitation tab', () => {
  const day = 86400000,
    keys = Array.from({ length: 60 }, (_, i) =>
      new Date(Date.parse('2026-09-20') + i * day).toISOString().slice(5, 10),
    ),
    dates = Array.from({ length: 30 }, (_, i) =>
      new Date(Date.parse('2026-09-26') + i * day).toISOString().slice(0, 10),
    );
  const normal: Normal = { high: 63, low: 45, range: [55, 70], span: [37, 71], rain: 0.11 };
  const climate = {
    normals: Object.fromEntries(keys.map(key => [key, normal])),
    since: 1991,
    years: 30,
    months: Array.from({ length: 12 }, (_, i) => ({ high: 40 + i * 4, low: 25 + i * 3, precipitation: 2 + i / 4 })),
  };
  const averages = {
    ...ctx,
    daily: [{ time: now, high: 80, low: 58, today: true, sky: dayForm('sunny') }],
    climate,
    recentRain: { dates, amounts: dates.map(() => 0.035), total: 1.05 },
  };
  const temperature = averagesDetail(averages);
  assert.match(temperature, /data-variant="temperature" aria-pressed="true"/);
  assert.match(temperature, /\+17° above average<\/div><div class="detail-sub">Average high: 63°/);
  assert.match(
    temperature,
    /For October 26, the normal temperature range is 37° to 71°, and the average high is 63°\. Today’s high temperature is 80°\./,
  );
  assert.match(temperature, /For October, the average daily low is 52°, and the average daily high is 76°\./);
  const rain = averagesDetail(averages, 'precipitation');
  assert.match(rain, /−2\.25″ from average<\/div><div class="detail-sub">30-day average: 3\.3″/);
  assert.match(
    rain,
    /Historically, the average total precipitation for September 26 through October 25 is 3\.3″\. Today, the total for the last 30 days is 1\.05″\./,
  );
  assert.match(rain, /For October, the average total precipitation is 4\.25″\./);
  assert.match(rain, /About Average Precipitation/);
});

test('the alerts sheet sets each alert out as its source does', () => {
  const alert = {
    event: 'Flash Flood Warning',
    text: undefined,
    severity: 'Severe',
    starts: Date.parse('2026-10-30T06:29:00Z'),
    ends: Number.NaN,
    description: 'The National Weather Service has issued\na warning.\n\n* Until 430 AM CDT.',
    urgency: 'immediate',
    responses: ['avoid', 'none'],
    area: 'Shawnee, KS',
    source: 'National Weather Service',
    sent: Number.NaN,
    url: 'https://example.com/a',
  };
  const html = alertsDetail(ctx, [alert, { ...alert, event: 'Flood Watch', responses: [], urgency: 'unknown' }], 0);
  const sections = /<details[^>]*>(.*?)<\/details>/.exec(html)?.[1] ?? '';
  assert.deepEqual(
    [...sections.matchAll(/<h4>(.*?)<\/h4>/g)].map(match => match[1]),
    [
      'Severity: <span>Severe</span>',
      'Weather Event Onset',
      'Description',
      'Action Recommended',
      'Urgency',
      'Affected Area',
      'Issued By',
    ],
  );
  assert.match(sections, /Significant threat to life or property/);
  assert.match(sections, /1:29 AM \(CDT\), October 30/);
  // Wrapped lines run together, paragraphs stay apart; "none" goes when anything is recommended.
  assert.match(sections, /<p>The National Weather Service has issued a warning\.<\/p><p>\* Until 430 AM CDT\.<\/p>/);
  assert.match(sections, /<p>Avoid the weather event as instructed in the Description\.<\/p>/);
  assert.match(sections, /Take action immediately\./);
  assert.match(sections, /<a href="https:\/\/example\.com\/a"[^>]*>View Alert Source<\/a>/);
  // The one picked is open; the other, with nothing to do and an unknown urgency, has neither row.
  assert.match(html, /<details class="alert-detail" open><summary>Flash Flood Warning/);
  const second = html.split('</details>')[1] ?? '';
  assert.match(second, /<details class="alert-detail"><summary>Flood Watch/);
  assert.doesNotMatch(second, /Action Recommended|Urgency/);
  assert.deepEqual([alertsTitle(1), alertsTitle(2)], ['Severe Weather Alert', '2 Severe Weather Alerts']);
});

test('the alert panel says when the first alert holds, then the rest', () => {
  const at = (time: string) => Date.parse(`2026-10-30T${time}Z`),
    flood: { event: string; starts: number; ends: number; source: string | undefined } = {
      event: 'Flood Advisory',
      starts: at('06:00:00'),
      ends: at('09:00:00'),
      source: 'National Weather Service',
    },
    none = Number.NaN,
    said = (alerts: (typeof flood)[], time: string, zoned = true) => alertWords({ ...ctx, zoned }, alerts, at(time));
  // Under way, until its end; ahead, by its start even with an end; begun with no end or past it,
  // since its start.
  assert.deepEqual(said([flood], '07:00:00'), {
    title: 'Flood Advisory',
    sentence: 'Flood Advisory. These conditions are expected to last until 4:00 AM (CDT), Friday, October 30.',
    source: 'National Weather Service',
    count: 1,
  });
  const sentence = (alerts: (typeof flood)[], time: string, zoned = true) => said(alerts, time, zoned).sentence;
  assert.equal(
    sentence([flood], '05:00:00'),
    'Flood Advisory. These conditions are expected by 1:00 AM (CDT), Friday, October 30.',
  );
  assert.equal(
    sentence([{ ...flood, ends: none }], '07:00:00'),
    'Flood Advisory. These conditions started at 1:00 AM (CDT), Friday, October 30.',
  );
  assert.equal(
    sentence([flood], '10:00:00'),
    'Flood Advisory. These conditions started at 1:00 AM (CDT), Friday, October 30.',
  );
  assert.equal(
    sentence([{ ...flood, starts: none }], '07:00:00'),
    'Flood Advisory. These conditions are expected to last until 4:00 AM (CDT), Friday, October 30.',
  );
  // With no times, or only an end that has passed, the alerts in effect.
  assert.equal(sentence([{ ...flood, starts: none, ends: none }], '07:00:00'), 'Alert in effect: Flood Advisory.');
  assert.equal(sentence([{ ...flood, starts: none }], '10:00:00'), 'Alert in effect: Flood Advisory.');
  // The zone is left off for a reader in it.
  assert.equal(
    sentence([flood], '07:00:00', false),
    'Flood Advisory. These conditions are expected to last until 4:00 AM, Friday, October 30.',
  );
  // More than one: a repeated event counts once, the title counts the rest, the sentence names
  // them, and who issued them is the first that says.
  const watch = { ...flood, event: 'Flood Watch', source: 'NWS Topeka KS' },
    surf = { ...flood, event: 'High Surf Advisory', starts: none, ends: none };
  const two = said([{ ...flood, source: undefined }, watch, flood], '07:00:00');
  assert.deepEqual(two, {
    title: 'Flood Advisory & 1 More',
    sentence:
      'Flood Advisory. These conditions are expected to last until 4:00 AM (CDT), Friday, October 30. Additional alert: Flood Watch.',
    source: 'NWS Topeka KS',
    count: 2,
  });
  assert.equal(
    sentence([flood, watch, surf], '07:00:00'),
    'Flood Advisory. These conditions are expected to last until 4:00 AM (CDT), Friday, October 30. Additional alerts: Flood Watch, High Surf Advisory.',
  );
  assert.equal(sentence([surf, flood], '07:00:00'), 'Alerts in effect: High Surf Advisory, Flood Advisory.');
  // A title with the others counted, past 25 characters, gives the first event alone, however long.
  assert.equal(said([surf, flood], '07:00:00').title, 'High Surf Advisory');
  assert.equal(
    said([{ ...flood, event: 'Severe Thunderstorm Warning' }], '07:00:00').title,
    'Severe Thunderstorm Warning',
  );
  assert.equal(said([{ ...flood, event: 'Special Weather Statement' }], '07:00:00').title, 'Special Weather Statement');
});

test('the next hour sheet reads each minute and tells the rest of the day', () => {
  const series = Array.from({ length: 60 }, (_, i) => (i < 30 ? 4 : 0));
  const html = nextHourDetail(
    sheet,
    {
      title: 'Rain Stopping',
      text: 'Rain stopping in 30 min',
      series,
      chart: series,
      past: 0,
      unit: 'mm',
      felt: undefined,
    },
    String,
  );
  assert.match(html, /Rain Stopping<\/div><div class="detail-sub">Precipitation Intensity/);
  assert.equal((html.match(/<rect /g) ?? []).length, 30);
  const points = /data-points="([^"]*)"/.exec(html)?.[1]?.replaceAll('&quot;', '"').replaceAll('&lt;', '<') ?? '[]';
  const marks: unknown = JSON.parse(points);
  assert.ok(Array.isArray(marks));
  assert.equal(marks.length, 60);
  assert.match(String(marks[45]), /None/);
  assert.match(html, /<h3>Forecast<\/h3><div class="detail-panel"><p>Rain stopping in 30 min\./);
});

test('sheets go below, above, left or right, on the first side all of them fit', () => {
  const rect = (left: number, top: number, width: number, height: number) => ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  });
  const base = { width: 320, height: 640, vw: 1400, vh: 1000 };
  // Below it, centred on it and 13 from it, the tail over its middle.
  const below = placePopover({ ...base, anchor: rect(500, 100, 400, 50) });
  assert.equal(below.side, 'below');
  assert.equal(below.top, 150 + 13);
  assert.equal(below.left, 700 - 160);
  assert.equal(below.arrowX, 160);
  // Above it, when the foot of the screen is too close.
  const above = placePopover({ ...base, anchor: rect(500, 850, 400, 50) });
  assert.equal(above.side, 'above');
  assert.equal(above.top, 850 - 13 - 640);
  // Left of it, when neither fits, level with its middle.
  const left = placePopover({ ...base, anchor: rect(800, 300, 200, 200) });
  assert.equal(left.side, 'left');
  assert.equal(left.left, 800 - 13 - 320);
  assert.equal(left.top, 400 - 320);
  assert.equal(left.arrowY, 320);
  // Right of it, the last of the four.
  const right = placePopover({ ...base, anchor: rect(100, 300, 200, 200) });
  assert.equal(right.side, 'right');
  assert.equal(right.left, 313);
  // Every anchor keeps to the one order, a tile as a row: fitting below beats any room beside it.
  assert.equal(placePopover({ ...base, anchor: rect(100, 100, 200, 200) }).side, 'below');
  assert.equal(placePopover({ ...base, anchor: rect(1100, 800, 200, 200) }).side, 'above');
  // The fit is the whole sheet, with 12 left to the screen's edge.
  assert.equal(placePopover({ ...base, anchor: rect(500, 300, 400, 35) }).side, 'below');
  assert.equal(placePopover({ ...base, anchor: rect(500, 300, 400, 36) }).side, 'left');
  // A wide row on a short screen: nothing fits whole, so the roomiest side is shortened.
  const short = placePopover({ ...base, vw: 900, vh: 700, anchor: rect(40, 120, 820, 50) });
  assert.equal(short.side, 'below');
  assert.equal(short.maxHeight, 700 - 170 - 13 - 12);
  // A phone: no side has room, so it rises as a sheet within the screen.
  const phone = placePopover({ ...base, width: 366, vw: 390, vh: 500, anchor: rect(16, 200, 170, 170) });
  assert.equal(phone.side, 'sheet');
  assert.equal(phone.maxHeight, 476);
  // Scrolled away entirely, it closes.
  assert.equal(placePopover({ ...base, anchor: rect(100, -400, 200, 200) }).side, 'gone');
});

test('one order over a whole page: each tile takes the first side the whole sheet fits on', () => {
  const box = (left: number, top: number, bottom: number) => ({
      left,
      top,
      width: 290,
      height: bottom - top,
      right: left + 290,
      bottom,
    }),
    sheet = { width: 320, height: 640, vw: 1048, vh: 1084 };
  const place = (top: number, bottom: number, left = 771.5) =>
    placePopover({ ...sheet, anchor: box(left, top, bottom) });
  // Just room below, with 10.5 to spare.
  assert.equal(place(263.5, 408.5).side, 'below');
  assert.equal(place(263.5, 408.5).top, 421.5);
  // No room below, room above.
  assert.equal(place(743.5, 888.5).side, 'above');
  assert.equal(place(743.5, 888.5).top, 90.5);
  assert.equal(place(904, 1049).top, 251);
  // Neither, so left of it, level with its middle.
  const left = place(423.5, 568.5);
  assert.equal(left.side, 'left');
  assert.equal(left.left, 438.5);
  assert.equal(left.top, 176);
  assert.equal(place(583.5, 728.5).side, 'left');
  // Hard against the left of the window, right is the last that's left.
  assert.equal(place(423.5, 568.5, 20).side, 'right');
  // An hourly column opens from its panel, so it centres on that.
  const panel = placePopover({
    ...sheet,
    anchor: { left: 117, right: 771, width: 654, top: 40, bottom: 176, height: 136 },
  });
  assert.equal(panel.side, 'below');
  assert.equal(panel.left, 284);
});

test('a step along the moon strip lands on the midnight of the day before or after', () => {
  // Three days and then one of 25 hours.
  const midnights = [0, 84, 168, 255.5, 339.5];
  assert.equal(moonStep(100, true, midnights), 168);
  assert.equal(moonStep(100, false, midnights), 0);
  // From each landing, the next step is a whole day on: presses never stall, and one that came to
  // rest a shade short of it still counts as there.
  assert.equal(moonStep(168, true, midnights), 255.5);
  assert.equal(moonStep(167.75, true, midnights), 255.5);
  assert.equal(moonStep(168, false, midnights), 84);
  // Past either end there is nowhere to go.
  assert.equal(moonStep(339.5, true, midnights), undefined);
  assert.equal(moonStep(0, false, midnights), undefined);
});

const moonAt = (time: string, timeZone: string, more: object = {}) => ({
  ...VIEW.ctx,
  now: Date.parse(time),
  timeZone,
  latitude: 38.63,
  longitude: -90.2,
  ...more,
});
const momentOf = ([hero]: [string, string]) => />([^<]*)<\/span>$/.exec(hero)?.[1];

test('a day the moon doesn’t rise or set keeps the row, with a dash', () => {
  const rows = (date: string) =>
      [...moonLive(moonAt(date, 'America/Chicago'))[1].matchAll(/<dt>(Moon(?:rise|set))<\/dt><dd>(.*?)<\/dd>/g)].map(
        ([, label, value]) => [label, value],
      ),
    month = Array.from({ length: 30 }, (_, i) => rows(new Date(Date.UTC(2026, 9, i + 1, 18)).toISOString()));
  // Each day has both rows, and over a month the moon runs late past midnight once each way.
  assert.ok(month.every(day => day.length === 2));
  assert.equal(month.flat().filter(([, value]) => value === '-').length, 2);
  assert.ok(month.flat().every(([, value]) => !/[MTWFS][a-z]{2}/.test(value ?? '')));
});

test('the moon reads the hour it is in, by the clock where it is read', () => {
  const chicago = 'America/Chicago';
  // 12:42 is 12 AM, and so is 12:59.
  assert.equal(momentOf(moonLive(moonAt('2026-10-31T05:42:00Z', chicago))), 'Saturday, October 31 at 12 AM');
  assert.equal(momentOf(moonLive(moonAt('2026-10-31T05:59:59Z', chicago))), 'Saturday, October 31 at 12 AM');
  assert.equal(momentOf(moonLive(moonAt('2026-10-31T06:00:00Z', chicago))), 'Saturday, October 31 at 1 AM');
  // Half an hour off the world's hours. 11:55 in Kolkata and 12:05 in Adelaide stay in their hours.
  assert.equal(momentOf(moonLive(moonAt('2026-10-31T06:25:00Z', 'Asia/Kolkata'))), 'Saturday, October 31 at 11 AM');
  assert.equal(momentOf(moonLive(moonAt('2026-10-31T06:35:00Z', 'Asia/Kolkata'))), 'Saturday, October 31 at 12 PM');
  assert.equal(
    momentOf(moonLive(moonAt('2026-10-30T13:35:00Z', 'Australia/Adelaide'))),
    'Saturday, October 31 at 12 AM',
  );
  // On a 24-hour clock the hour stands as a time.
  assert.equal(
    momentOf(moonLive(moonAt('2026-10-31T12:42:00Z', 'Europe/London', { hour12: false }))),
    'Saturday, October 31 at 12:00',
  );
});

test('a moon on any day but today loses its weekday and reads second to its phase', () => {
  const ctx = moonAt('2026-10-31T05:42:00Z', 'America/Chicago'),
    today = moonLive(ctx, 12 * H),
    later = moonLive(ctx, 39 * H);
  assert.equal(momentOf(today), 'Saturday, October 31 at 12 PM');
  assert.doesNotMatch(today[0], /data-away/);
  assert.equal(momentOf(later), 'November 1 at 2 PM');
  assert.match(later[0], /data-away/);
  assert.equal(momentOf(moonLive(ctx, -6 * H)), 'October 30 at 6 PM');
});

const stripOf = (html: string) => ({
  origin: Number(/data-origin="([\d.]+)"/.exec(html)?.[1]),
  midnights: (/data-midnights="([\d.,]+)"/.exec(html)?.[1] ?? '').split(',').map(Number),
  ticks: /<path d="([^"]*)"\/><path d="[^"]*" data-midnight\/>/.exec(html)?.[1]?.split('M').length,
});

test('the moon strip starts from the hour now is in, with twelve ticks to a day of 84 px', () => {
  assert.equal(MOON_HOUR_PX * 24, 84);
  const { origin, midnights, ticks } = stripOf(moonDetail(moonAt('2026-06-15T05:42:00Z', 'America/Chicago')));
  // 12:42 is at 12 on the strip, a whole number of hours from its start.
  assert.ok(midnights.includes(origin), `${origin} is at a midnight`);
  assert.equal(((ticks ?? 1) - 1 + midnights.length) / midnights.length, 12);
  // In half-hour zones too.
  const kolkata = stripOf(moonDetail(moonAt('2026-06-15T07:10:00Z', 'Asia/Kolkata')));
  assert.equal(Number.isInteger(kolkata.origin / MOON_HOUR_PX), true);
  assert.equal((kolkata.origin / MOON_HOUR_PX) % 24, 12);
  // Its days are as long as the clocks make them: 1 November 2026 has 25 hours in Chicago.
  const { midnights: autumn } = stripOf(moonDetail(moonAt('2026-10-31T05:42:00Z', 'America/Chicago'))),
    lengths = autumn.slice(1).map((midnight, i) => midnight - (autumn[i] ?? 0));
  assert.deepEqual(
    [...new Set(lengths)].toSorted((a, b) => a - b),
    [84, 87.5],
  );
});

test('the moon sheet dates the month’s new and full moons', () => {
  const october = moonDetail(moonAt('2026-10-31T05:42:00Z', 'America/Chicago')),
    rowsOf = (html: string) =>
      [...(/class="moon-grid".*$/s.exec(html)?.[0] ?? '').matchAll(/<dt>(.*?)<\/dt><dd>(.*?)<\/dd>/g)].map(m => [
        m[1],
        m[2],
      ]);
  assert.deepEqual(rowsOf(october), [
    ['New Moon', 'Sat, Oct 10'],
    ['Full Moon', 'Mon, Oct 26'],
  ]);
  // They follow the month shown.
  assert.deepEqual(rowsOf(moonDetail(moonAt('2026-10-31T05:42:00Z', 'America/Chicago'), 1)), [
    ['New Moon', 'Mon, Nov 9'],
    ['Full Moon', 'Tue, Nov 24'],
  ]);
  // May 2026 has two full moons, and each has its row.
  assert.deepEqual(
    rowsOf(moonDetail(moonAt('2026-05-15T17:00:00Z', 'America/Chicago'))).map(row => row[1]),
    ['Sat, May 16', 'Fri, May 1', 'Sun, May 31'],
  );
});

test('a calendar day’s symbol is the phase that comes on it, or the crescent or gibbous moon between', () => {
  // November 2026: its last quarter on the 1st, new moon on the 9th, first quarter on the 17th and
  // full moon on the 24th.
  const html = moonDetail(moonAt('2026-11-07T08:00:00Z', 'America/Chicago')),
    symbols = new Map(
      [...html.matchAll(/<b>(\d+)<\/b><canvas[^>]*><\/canvas><i class="moon-glyph">(.*?)<\/i>/g)].map(match => [
        Number(match[1]),
        match[2],
      ]),
    ),
    waxingCrescent = 0.125,
    waxingGibbous = 0.375,
    waningGibbous = 0.625,
    waningCrescent = 0.875;
  assert.equal(symbols.size, 30);
  assert.equal(symbols.get(1), moonGlyph(MOON_PHASE.lastQuarter));
  assert.equal(symbols.get(9), moonGlyph(MOON_PHASE.new));
  assert.equal(symbols.get(17), moonGlyph(MOON_PHASE.firstQuarter));
  assert.equal(symbols.get(24), moonGlyph(MOON_PHASE.full));
  for (const [days, phase] of [
    [[2, 8], waningCrescent],
    [[10, 16], waxingCrescent],
    [[18, 23], waxingGibbous],
    [[25, 30], waningGibbous],
  ] as const)
    for (const day of days) assert.equal(symbols.get(day), moonGlyph(phase), `the ${day}th`);
});

test('a calendar day shows its moon as the day starts, to the nearest tenth lit, upside down in the south', () => {
  // The twenty moons a day can show, by the phase each is drawn at: new, then 30° to 150° of the
  // cycle in steps of 15°, full, and back. 5 and 15 are the half moons.
  const pictures = [
    0,
    ...Array.from({ length: 9 }, (_, i) => (i + 2) / 24),
    0.5,
    ...Array.from({ length: 9 }, (_, i) => 1 - (10 - i) / 24),
  ];
  const moons = (html: string) =>
    [...html.matchAll(/<b>\d+<\/b><canvas class="moon-disc" data-phase="([\d.]+)" data-turn="([\d.]+)"/g)].map(m => ({
      moon: pictures.findIndex(phase => Math.abs(phase - Number(m[1])) < 0.0001),
      turn: Number(m[2]),
    }));
  const october = moons(moonDetail(moonAt('2026-10-31T05:42:00Z', 'America/Chicago')));
  assert.deepEqual(
    october.map(day => day.moon),
    [12, 13, 15, 16, 17, 18, 19, 19, 0, 0, 0, 0, 1, 1, 2, 3, 4, 5, 6, 6, 7, 8, 9, 10, 10, 10, 10, 11, 11, 12, 13],
  );
  assert.ok(october.every(day => day.turn === 0));
  // Days that share a moon share its picture: the new moon's, and the first quarter's at a quarter.
  const phases = [
    ...moonDetail(moonAt('2026-10-31T05:42:00Z', 'America/Chicago')).matchAll(
      /<b>(?:9|10|18)<\/b><canvas class="moon-disc" data-phase="([\d.]+)"/g,
    ),
  ].map(m => m[1]);
  assert.deepEqual(phases, ['0.0000', '0.0000', '0.2500']);
  // The day starts where the card is: Tokyo's start 14 hours before Chicago's, so there the half
  // moon comes a day later.
  const tokyo = moons(moonDetail(moonAt('2026-10-31T05:42:00Z', 'Asia/Tokyo', { latitude: 35.68, longitude: 139.69 })));
  assert.equal(october.findIndex(day => day.moon === 5) + 1, 18);
  assert.equal(tokyo.findIndex(day => day.moon === 5) + 1, 19);
  const south = moons(moonDetail(moonAt('2026-10-31T05:42:00Z', 'America/Chicago', { latitude: -33.87 })));
  assert.deepEqual(
    south.map(day => day.moon),
    october.map(day => day.moon),
  );
  assert.ok(south.every(day => Math.abs(day.turn - Math.PI) < 0.001));
});

test('the moon sheet explains illumination, then distance', () => {
  const html = moonSheet({
    ...VIEW,
    ctx: moonAt('2026-10-31T05:42:00Z', 'America/Chicago'),
    title: 'Moon',
    month: 0,
    moonOffset: 0,
  });
  assert.ok(html.indexOf('<h3>About Illumination') > html.indexOf('moon-grid'));
  assert.ok(html.indexOf('<h3>About Moon Distance') > html.indexOf('<h3>About Illumination'));
});

test('UV reads to 11, going higher only for a peak past 9, with a line at every tick', () => {
  const scale = (value: number) => uvReading.scale({ min: 0, max: value }, {});
  assert.equal(scale(4).ticks.at(-1), 11);
  assert.equal(scale(9).ticks.at(-1), 11);
  assert.equal(scale(10).ticks.at(-1), 12);
  assert.equal(scale(12.5).ticks.at(-1), 14);
  const chart = chartMarkup(
    uvReading.chart,
    [
      { hour: 13, value: 5, now: true },
      { hour: 14, value: 4 },
    ],
    scale(5),
    ctx,
    axis,
  );
  assert.equal((chart.match(/class="grid"/g) ?? []).length, 12);
  assert.match(chart, /--now-x:/);
  assert.match(chart, /<span style="top:[\d.]+%">Moderate/);
});

test('visibility reads against a fixed scale, with its unit on the lowest number', () => {
  const miles = visibilityReading.scale({ min: 10, max: 24 }, { visibility_unit: 'mi' });
  assert.deepEqual(miles.ticks, [0, 5, 10, 15, 20, 25, 30]);
  assert.equal(miles.max, 30);
  assert.equal(visibilityReading.scale({ min: 10, max: 24 }, { visibility_unit: 'km' }).ticks.at(-1), 45);
  // A clearer day leaves the scale as it is; a unit it doesn't know keeps the usual scale.
  assert.equal(visibilityReading.scale({ min: 10, max: 33 }, { visibility_unit: 'mi' }).ticks.at(-1), 30);
  assert.notEqual(visibilityReading.scale({ min: 10, max: 2000 }, { visibility_unit: 'm' }).ticks.at(-1), 30);
  const chart = chartMarkup(
    visibilityReading.chart,
    [
      { hour: 13, value: 22, now: true },
      { hour: 14, value: 24 },
    ],
    miles,
    { ...ctx, attrs: { visibility_unit: 'mi' } },
    axis,
  );
  assert.match(chart, />0 mi</);
  assert.match(chart, />30</);
  assert.doesNotMatch(chart, /30 mi/);
  assert.match(chart, /--now-x:55\.6%/);
});

test('a paragraph never ends on a word of its own', () => {
  assert.equal(
    keepLastWords('<p>The peak gust is higher than yesterday.</p>'),
    '<p>The peak gust is higher than&nbsp;yesterday.</p>',
  );
  // A word with its small letters is one word, and a heading is left alone.
  assert.equal(
    keepLastWords('<h3>Now and then</h3><p>Rain from 12<small>PM</small> to 3<small>PM</small>.</p>'),
    '<h3>Now and then</h3><p>Rain from 12<small>PM</small> to&nbsp;3<small>PM</small>.</p>',
  );
  assert.equal(
    keepLastWords('<p>Calm.</p><p class="chart-legend"><span>Last 30 days</span></p>'),
    '<p>Calm.</p><p class="chart-legend"><span>Last 30 days</span></p>',
  );
});

test('the forecast paragraph says what the temperature comes with', () => {
  const { now } = ctx,
    today = (condition: string) => ({
      key: 'today',
      today: true,
      time: now,
      entries: [],
      daily: { high: 75, low: 52, condition, sky: dayForm(condition) },
    });
  const paragraph = (condition: string, nowSky: SkyKind, nowName = 'Cloudy') =>
    conditionsBody({ ...sheet, condition, lastDay: 0 }, today(condition), 'temperature', {
      ...inputs,
      nowName,
      nowSky,
    }).match(/<h3>Forecast<\/h3><div class="detail-panel"><p>(.*?)\./)?.[1];
  assert.equal(paragraph('partlycloudy', 'partlyCloudyMidAltitude', 'Partly Cloudy'), '72° now and partly cloudy');
  assert.equal(paragraph('rainy', 'rain'), '72° now and raining');
  assert.equal(paragraph('snowy', 'snow'), '72° now and snowing');
  assert.equal(paragraph('hail', 'hail'), '72° now with hail');
  assert.equal(paragraph('fog', 'foggy'), '72° now with fog');
  assert.equal(paragraph('fog', 'haze'), '72° now with haze');
  assert.equal(paragraph('rainy', 'freezingRain'), '72° now with freezing rain');
  assert.equal(paragraph('snowy', 'blizzard'), '72° now with an ongoing blizzard');
  assert.equal(paragraph('snowy-rainy', 'wintryMix'), '72° now with wintry mix');
  assert.equal(paragraph('exceptional', 'tropicalStorm'), '72° now with an ongoing tropical storm');
  assert.equal(paragraph('exceptional', 'blowingDust'), '72° now with blowing dust');
  assert.equal(paragraph('exceptional', 'smoky'), '72° now with smoky conditions');
  assert.equal(paragraph('lightning-rainy', 'strongStorms'), '72° now with severe thunderstorms');
  // A windy day is that, whatever sky it comes with.
  assert.equal(paragraph('windy', 'mostlyClear', 'Windy'), '72° now with windy conditions');
});
