import assert from 'node:assert/strict';
import { type Mock, afterEach, beforeEach, test, vi } from 'vitest';
import { normalizeConfig } from '../src/card/config.ts';
import { WeatherRecords } from '../src/card/records.ts';
import { configFrom, formData, schemaFor } from '../src/card/editor-schema.ts';
import type { Connection, ForecastEntry, FormSchemaItem, HomeAssistant } from '../src/card/home-assistant.ts';
import {
  ForecastSources,
  extendForecast,
  fillForecast,
  forecastLacks,
  supplementForecast,
} from '../src/weather/forecast.ts';
import { dailyItems, forecastItems, forecasts, hoursToTell } from '../src/weather/forecast-items.ts';
import { dailyDetail } from '../src/cards/forecast/day-detail.ts';
import {
  OPEN_METEO_UNITS,
  type Supplement,
  cloudAltitude,
  openMeteoForecast,
  parseSupplement,
} from '../src/weather/open-meteo.ts';
import type { Fetcher } from '../src/lib/asking.ts';
import { codeCondition } from '../src/weather/weather-codes.ts';
import { convertForecast, convertForecastBetween } from '../src/weather/units.ts';
import { SECOND } from '../src/lib/time.ts';
import { detailDays } from '../src/sheets/days.ts';

const MINUTE = 60_000,
  HOUR = 60 * MINUTE,
  DAY = 24 * HOUR,
  ZONE = 'America/Chicago';
// 12:30 in Chicago, and midnight the day before there, which is where an answer starts.
const NOW = Date.UTC(2026, 9, 27, 17, 30),
  YESTERDAY = Date.UTC(2026, 9, 26, 5);
const seconds = (time: number) => time / 1000;

// An answer in the service's shape: 12 days, 288 hours, one UTC offset throughout.
function answer(hourly: Record<string, unknown[]> = {}, daily: Record<string, unknown[]> = {}, start = YESTERDAY) {
  const hours = Array.from({ length: 288 }, (_, i) => seconds(start) + i * 3600),
    days = Array.from({ length: 12 }, (_, i) => seconds(start) + i * 86400),
    all = <T>(value: T) => hours.map(() => value),
    each = <T>(value: T) => days.map(() => value);
  return {
    utc_offset_seconds: -18000,
    hourly: {
      time: hours,
      precipitation_probability: hours.map((_, i) => i % 100),
      wind_gusts_10m: all(10),
      wind_speed_10m: all(4),
      wind_direction_10m: all(200),
      apparent_temperature: all(20),
      dew_point_2m: all(10),
      visibility: all(16000),
      precipitation: all(0.5),
      snowfall: all(0),
      weather_code: all(3),
      temperature_2m: all(18),
      cloud_cover: all(90),
      cloud_cover_low: all(80),
      cloud_cover_mid: all(40),
      cloud_cover_high: all(20),
      ...hourly,
    },
    daily: {
      time: days,
      weather_code: each(61),
      temperature_2m_max: each(20),
      temperature_2m_min: each(10),
      precipitation_sum: each(3),
      precipitation_probability_max: each(70),
      wind_speed_10m_max: each(8),
      wind_gusts_10m_max: each(14),
      sunrise: days.map(time => time + 7 * 3600),
      sunset: days.map(time => time + 18 * 3600),
      ...daily,
    },
  };
}
const parsed = (body: unknown = answer(), at = NOW): Supplement => {
  const supplement = parseSupplement(body, at);
  if (!supplement) throw new Error('No supplement.');
  return supplement;
};
const iso = (time: number) => new Date(time).toISOString();
const hoursFrom = (time: number, count: number, entry: ForecastEntry = {}): ForecastEntry[] =>
  Array.from({ length: count }, (_, i) => ({ datetime: iso(time + i * HOUR), ...entry }));
const ready = (forecast: readonly ForecastEntry[]) => ({ status: 'ready' as const, forecast });

test('a weather code reads as the condition it describes, and an unknown one as nothing', () => {
  const expected: Record<number, string> = {
    0: 'sunny',
    2: 'partlycloudy',
    3: 'cloudy',
    48: 'fog',
    53: 'rainy',
    57: 'snowy-rainy',
    65: 'pouring',
    67: 'snowy-rainy',
    75: 'snowy',
    82: 'pouring',
    95: 'lightning-rainy',
    99: 'hail',
  };
  for (const [code, condition] of Object.entries(expected)) assert.equal(codeCondition(Number(code)), condition);
  assert.equal(codeCondition(42), undefined);
  assert.equal(codeCondition(null), undefined);
});

test('an answer becomes hours and days in the names the card holds them under', () => {
  const { hours, days } = parsed();
  assert.equal(hours.length, 288);
  assert.equal(days.length, 12);
  assert.deepEqual(hours[0], {
    datetime: iso(YESTERDAY),
    is_daytime: false,
    condition: 'cloudy',
    precipitation_probability: 0,
    wind_gust_speed: 10,
    wind_speed: 4,
    wind_bearing: 200,
    apparent_temperature: 20,
    dew_point: 10,
    visibility: 16000,
    precipitation: 0.5,
    temperature: 18,
    cloud_coverage: 90,
    cloud_altitude: 'low',
  });
  const [day] = days;
  assert.ok(day);
  assert.equal(day.condition, 'rainy');
  assert.equal(day.temperature, 20);
  assert.equal(day.templow, 10);
  assert.equal(day.precipitation, 3);
  assert.equal(day.precipitation_probability, 70);
  assert.equal(day.wind_gust_speed, 14);
});

test('a reading sent as null is left out, never made a zero', () => {
  const { hours } = parsed(answer({ precipitation_probability: [null], visibility: [null], cloud_cover_mid: [null] }));
  assert.equal('precipitation_probability' in (hours[0] ?? {}), false);
  assert.equal('visibility' in (hours[0] ?? {}), false);
  assert.equal('cloud_altitude' in (hours[0] ?? {}), false, 'a height needs the cover at all three');
});

test('the cloud is at the height that holds the most of it, low winning a tie, then mid', () => {
  assert.equal(cloudAltitude(80, 40, 20), 'low');
  assert.equal(cloudAltitude(10, 60, 20), 'mid');
  assert.equal(cloudAltitude(10, 20, 60), 'high');
  assert.equal(cloudAltitude(50, 50, 10), 'low');
  assert.equal(cloudAltitude(50, 10, 50), 'low');
  assert.equal(cloudAltitude(10, 50, 50), 'mid');
  assert.equal(cloudAltitude(0, 0, 0), 'low', 'a sky with no cloud at all');
});

test('what is no answer brings nothing', () => {
  for (const body of [null, 'busy', {}, { hourly: {} }, { hourly: { time: [] }, daily: { time: [] } }])
    assert.equal(parseSupplement(body, NOW), null);
});

test('the sun sets the night, in polar night and polar day too', () => {
  const clear = answer({ weather_code: Array.from({ length: 288 }, () => 0) });
  const hours = (body: unknown) => parsed(body).hours;
  const at = (list: readonly ForecastEntry[], hour: number) => list[hour];
  assert.equal(at(hours(clear), 3)?.condition, 'clear-night');
  assert.equal(at(hours(clear), 3)?.is_daytime, false);
  assert.equal(at(hours(clear), 12)?.condition, 'sunny');
  assert.equal(at(hours(clear), 12)?.is_daytime, true);
  // With the sun down all day, it rises and sets at midnight; up all day, a day apart.
  const midnights = clear.daily.time,
    dark = answer({ weather_code: clear.hourly.weather_code }, { sunrise: midnights, sunset: midnights }),
    light = answer(
      { weather_code: clear.hourly.weather_code },
      { sunrise: midnights, sunset: midnights.map(time => time + 86400) },
    );
  assert.ok(hours(dark).every(hour => hour.is_daytime === false));
  assert.ok(
    hours(light)
      .slice(0, 24)
      .every(hour => hour.is_daytime === true),
  );
  // Without sun times, no hour says.
  assert.equal(at(hours(answer({}, { sunrise: [], sunset: [] })), 3)?.is_daytime, undefined);
});

test('rain with snow in it is a mix, whichever the code settled on', () => {
  const snowing = Array.from({ length: 288 }, () => 0.4),
    rain = Array.from({ length: 288 }, () => 63),
    { hours } = parsed(answer({ weather_code: rain, snowfall: snowing }));
  assert.equal(hours[0]?.condition, 'snowy-rainy');
  assert.equal(parsed(answer({ weather_code: rain })).hours[0]?.condition, 'rainy');
});

// Chicago's clocks went back at 2 AM on 1 November 2026. One offset holds across an answer, so
// the day after reads as 23:00 on the day before: as the service really sends it.
const FALL_BACK = { before: Date.UTC(2026, 9, 31, 5), day: Date.UTC(2026, 10, 1, 5) } as const;
test('a day keeps its date across a clock change that puts its midnight on the day before', () => {
  const start = FALL_BACK.before,
    { days } = parsed(answer({}, {}, start), start),
    dates = dailyItems(days, start, ZONE, {}, 12).map(day => new Date(day.time).toISOString().slice(0, 10));
  assert.deepEqual(dates.slice(0, 4), ['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03']);
  assert.equal(new Set(dates).size, 12, 'no date twice, none missed');
});

test('hours match by the epoch through both of a fall-back night’s one o’clocks', () => {
  const own: ForecastEntry[] = [
    { datetime: '2026-11-01T00:00:00-05:00' },
    { datetime: '2026-11-01T01:00:00-05:00' },
    { datetime: '2026-11-01T01:00:00-06:00' },
    { datetime: '2026-11-01T02:00:00-06:00' },
  ];
  const chances = Array.from({ length: 288 }, (_, i) => i),
    { hours } = parsed(answer({ precipitation_probability: chances }, {}, FALL_BACK.day));
  const filled = fillForecast(own, hours, HOUR / 2, ['precipitation_probability']);
  assert.deepEqual(
    filled.map(entry => entry.precipitation_probability),
    [0, 1, 2, 3],
    'each stamp takes its own hour, the repeated one included',
  );
});

test('hours match by the epoch across the spring change, when an hour is skipped', () => {
  // 2 AM on 14 March 2027 doesn't happen: 1 AM CST is followed by 3 AM CDT.
  const own: ForecastEntry[] = [{ datetime: '2027-03-14T01:00:00-06:00' }, { datetime: '2027-03-14T03:00:00-05:00' }];
  const start = Date.parse('2027-03-14T00:00:00-06:00'),
    chances = Array.from({ length: 288 }, (_, i) => i),
    { hours } = parsed(answer({ precipitation_probability: chances }, {}, start));
  assert.deepEqual(
    fillForecast(own, hours, HOUR / 2, ['precipitation_probability']).map(entry => entry.precipitation_probability),
    [1, 2],
  );
});

test('an entity stamping half past, and a half-hour zone, still meet their hours', () => {
  const half: ForecastEntry[] = [{ datetime: '2026-10-27T17:30:00Z' }],
    { hours } = parsed(answer({ precipitation_probability: Array.from({ length: 288 }, (_, i) => i) }));
  const filled = fillForecast(half, hours, HOUR / 2, ['precipitation_probability'])[0];
  assert.ok(filled?.precipitation_probability !== undefined, 'half an hour from either neighbour is within reach');
  const kolkata = Date.parse('2026-10-26T00:00:00+05:30');
  const own: ForecastEntry[] = [{ datetime: '2026-10-26T03:00:00+05:30' }],
    local = parsed(answer({ precipitation_probability: Array.from({ length: 288 }, (_, i) => i) }, {}, kolkata));
  assert.equal(
    fillForecast(own, local.hours, HOUR / 2, ['precipitation_probability'])[0]?.precipitation_probability,
    3,
  );
});

test('within the entity’s hours it wins field by field, and the rest of the hour stays its own', () => {
  const own: ForecastEntry[] = [
    {
      datetime: iso(Date.UTC(2026, 9, 27, 18)),
      temperature: 70,
      condition: 'sunny',
      wind_speed: 3,
      precipitation_probability: 15,
      precipitation: 0,
    },
    {
      datetime: iso(Date.UTC(2026, 9, 27, 19)),
      temperature: 71,
      condition: 'sunny',
      wind_speed: 3,
      wind_gust_speed: 2,
    },
  ];
  const { hourly } = supplementForecast({ hourly: ready(own) }, parsed(), ZONE),
    [first, second] = hourly?.forecast ?? [];
  assert.ok(first && second);
  assert.equal(first.precipitation_probability, 15, 'its own chance stands');
  assert.equal(first.wind_gust_speed, 10, 'and a gust it lacks is lent');
  assert.equal(first.temperature, 70);
  assert.equal(first.condition, 'sunny');
  assert.equal(first.dew_point, 10);
  assert.equal(first.visibility, 16000);
  assert.equal(first.apparent_temperature, 20);
  assert.equal(first.wind_bearing, undefined, 'only what the list names is lent inside its range');
  assert.equal(first.cloud_coverage, 90, 'an hour is lent its cover');
  assert.equal(first.cloud_altitude, 'low', 'and the height of its cloud');
  assert.equal(first.precipitation, 0, 'its own amount stands, none included');
  assert.equal(second.precipitation, 0.5, 'and an hour with no amount is lent one');
  assert.equal(second.wind_gust_speed, 2, 'its own gust stands, even under its wind');
  assert.notEqual(second.precipitation_probability, undefined, 'hour by hour: the next hour lacks a chance');
});

test('a lent gust never falls under the wind of the hour it joins, in the units shown', () => {
  const own: ForecastEntry[] = [{ datetime: iso(Date.UTC(2026, 9, 27, 18)), wind_speed: 30 }];
  const { hourly } = supplementForecast({ hourly: ready(own) }, parsed(), ZONE);
  assert.equal(hourly?.forecast[0]?.wind_gust_speed, 30);
  // Beyond the entity's range, both are the supplement's, and converted first.
  const sources = new ForecastSources(
    () => {},
    list => convertForecastBetween(list, OPEN_METEO_UNITS, { wind_speed_unit: 'mph' }, undefined),
  );
  sources.supply(parsed(answer({ wind_gusts_10m: [3], wind_speed_10m: [5] })), ZONE);
  const [hour] = sources.supplement?.converted.hours ?? [];
  assert.ok(hour?.wind_speed !== undefined && Math.abs(hour.wind_speed - 11.18) < 0.01);
  assert.equal(hour.wind_gust_speed, hour.wind_speed);
});

test('now’s column reads the wind now, and a gust from the hour under way can’t fall under it', () => {
  const state = { state: 'cloudy', attributes: { wind_speed: 7 } },
    hour = [{ datetime: iso(Date.UTC(2026, 9, 27, 17)), wind_speed: 4, wind_gust_speed: 5 }],
    [now] = forecastItems(hour, 'hourly', state, NOW, 24, ZONE);
  assert.ok(now);
  assert.equal(now.wind_speed, 7);
  assert.equal(now.wind_gust_speed, 7);
});

test('hours outside the entity’s come whole, and those already over are kept apart', () => {
  const start = Date.UTC(2026, 9, 27, 18),
    own = hoursFrom(start, 3),
    other = parsed().hours,
    { forecast, earlier } = extendForecast(own, other, HOUR / 2, NOW);
  const after = forecast.slice(3);
  assert.ok(after[1]);
  assert.equal(after[1].datetime, iso(start + 3 * HOUR));
  assert.equal(after[1].temperature, 18, 'whole, with every reading');
  // Noon's hour, under way when asked, stands for now; everything before it is past.
  assert.equal(after[0]?.datetime, iso(Date.UTC(2026, 9, 27, 17)));
  assert.equal(earlier.at(-1)?.datetime, iso(Date.UTC(2026, 9, 27, 16)));
  assert.equal(earlier[0]?.datetime, iso(YESTERDAY));
  assert.equal(earlier.length + forecast.length, other.length, 'not an hour lost, and own’s three stand in for theirs');
  // A forecast with nothing is all extension.
  const none = extendForecast([], other, HOUR / 2, NOW);
  assert.equal(none.forecast.length + none.earlier.length, other.length);
  assert.ok(none.earlier.every(entry => Date.parse(entry.datetime ?? '') + HOUR <= NOW));
});
test('an hour the entity drops, as the one that repeats when the clocks go back, comes in its place', () => {
  const at = (hour: number) => ({ datetime: new Date(NOW + hour * HOUR).toISOString(), temperature: 60 + hour }),
    own = [at(1), at(2), at(4), at(5)],
    other = [at(1), at(2), { ...at(3), temperature: 99 }, at(4), at(5)].map(entry => ({ ...entry, wind_speed: 1 })),
    { forecast, earlier } = extendForecast(own, other, HOUR / 2, NOW);
  assert.deepEqual(
    forecasts(forecast).map(entry => entry.temperature),
    [61, 62, 99, 64, 65],
  );
  assert.deepEqual(earlier, []);
  // The entity's own hours stand as they were: only the hole is lent.
  assert.deepEqual(forecast.slice(0, 4), own);
});

test('the strip keeps to the hours from now, with the hour under way behind Now', () => {
  const own = hoursFrom(Date.UTC(2026, 9, 27, 18), 48, { temperature: 70 }),
    state = { state: 'cloudy', attributes: { temperature: 70 } };
  const before = forecastItems(own, 'hourly', state, NOW, 24, ZONE);
  const { hourly } = supplementForecast({ hourly: ready(own) }, parsed(), ZONE),
    after = forecastItems(hourly?.forecast, 'hourly', state, NOW, 24, ZONE);
  assert.deepEqual(
    after.map(item => item.time),
    before.map(item => item.time),
    'the same hours in the same places',
  );
  assert.equal(after[0]?.precipitation_probability, 36, 'now reads the hour under way, which the entity skipped');
  assert.equal(before[0]?.precipitation_probability, undefined);
});

test('days fill by local date, entity’s first, then the days it doesn’t reach', () => {
  // Stamped at midnight local, or as UTC's noon: neither is the supplement's time of day.
  const own: ForecastEntry[] = [
    { datetime: '2026-10-27T05:00:00Z', temperature: 80, condition: 'sunny', wind_speed: 20 },
    { datetime: '2026-10-28T17:00:00Z', temperature: 81, condition: 'sunny', precipitation_probability: 5 },
  ];
  // A chance of its own for each day, so a day that took another's would show.
  const chances = Array.from({ length: 12 }, (_, i) => 10 * i),
    supplement = parsed(answer({}, { precipitation_probability_max: chances })),
    data = supplementForecast({ daily: ready(own) }, supplement, ZONE),
    days = dailyItems(data.daily?.forecast, NOW, ZONE, {}, 10);
  assert.equal(days.length, 10);
  const [today, tomorrow, after] = days;
  assert.ok(today && tomorrow && after);
  assert.equal(today.temperature, 80, 'the entity’s day stays its own');
  assert.equal(today.condition, 'sunny');
  assert.equal(today.precipitation_probability, 10, 'and takes its own date’s chance, which it lacked');
  assert.equal(today.wind_gust_speed, 20, 'with a gust no less than its wind');
  assert.equal(tomorrow.precipitation_probability, 5);
  assert.equal(after.temperature, 20, 'then the supplement’s days, whole');
  assert.equal(after.condition, 'rainy');
  assert.equal(after.low, 10);
});

test('a forecast the entities have nothing of takes the supplement’s, whole', () => {
  const failed = { status: 'error' as const, forecast: [] },
    data = supplementForecast({ hourly: failed, daily: failed }, parsed(), ZONE);
  assert.ok(data.hourly && data.daily);
  assert.equal(data.hourly.status, 'ready');
  assert.equal(data.daily.status, 'ready');
  assert.ok(data.hourly.forecast.length > 200);
  assert.equal(supplementForecast({}, parsed(), ZONE).daily?.forecast.length, 12);
});

test('days given twice a day grow in place, with no daily forecast beside them', () => {
  const own: ForecastEntry[] = [
    { datetime: '2026-10-27T13:00:00Z', temperature: 70, is_daytime: true },
    { datetime: '2026-10-28T01:00:00Z', temperature: 50, is_daytime: false },
  ];
  const data = supplementForecast({ twice_daily: ready(own) }, parsed(), ZONE);
  assert.equal(data.daily, undefined);
  const days = dailyItems(data.twice_daily?.forecast, NOW, ZONE, {}, 10);
  assert.equal(days.length, 10);
  assert.ok(days[0]);
  assert.equal(days[0].high, 70);
  assert.equal(days[0].low, 50);
});

test('a forecast lacks what any hour leaves out, or days short of the list', () => {
  const whole = hoursFrom(NOW, 48, {
      precipitation_probability: 0,
      precipitation: 0,
      wind_gust_speed: 0,
      cloud_coverage: 0,
    }),
    ten = Array.from({ length: 10 }, (_, i) => ({ datetime: iso(NOW + i * DAY) })),
    lacks = (hourly: readonly ForecastEntry[], daily: readonly ForecastEntry[], days = 10) =>
      forecastLacks({ hourly: ready(hourly), daily: ready(daily) }, days, NOW, ZONE);
  assert.equal(lacks(whole, ten), false, 'zeros are readings');
  assert.equal(lacks(whole, ten.slice(0, 9)), true);
  assert.equal(lacks(whole, ten.slice(0, 6), 6), false, 'a list set shorter needs no more');
  assert.equal(lacks([], ten), true);
  assert.equal(lacks([{ ...whole[0], wind_gust_speed: undefined }, ...whole.slice(1)], ten), true);
  assert.equal(
    lacks([{ ...whole[0], precipitation: undefined }, ...whole.slice(1)], ten),
    true,
    'a chance is no amount',
  );
  assert.equal(lacks([...whole.slice(1), { datetime: iso(NOW) }], ten), true, 'hour by hour: one hour short will do');
  assert.equal(
    lacks(
      whole.map(entry => ({ ...entry, cloud_coverage: undefined })),
      ten,
    ),
    true,
    'a condition is no cover',
  );
  const twice = ten.map(entry => ({ ...entry, is_daytime: true }));
  assert.equal(forecastLacks({ hourly: ready(whole), twice_daily: ready(twice) }, 10, NOW, ZONE), false);
});

test('a sentence speaks of two days, however far the forecast runs', () => {
  const hours = hoursFrom(YESTERDAY, 288);
  const told = hoursToTell(hours, NOW);
  assert.equal(told[0]?.time, Date.UTC(2026, 9, 27, 17));
  assert.equal(told.at(-1)?.time, Date.UTC(2026, 9, 29, 17));
});

test('the setting defaults on, sits under local only on the full page, and only there', () => {
  assert.equal(normalizeConfig({ entity: 'weather.home' }).open_meteo_forecast, true);
  assert.equal(normalizeConfig({ entity: 'weather.home' }).forecast_days, 10);
  assert.throws(() => normalizeConfig({ entity: 'weather.home', open_meteo_forecast: 'yes' }), /true or false/);
  const names = (items: readonly FormSchemaItem[]): string[] =>
    items.flatMap(item => [item.name, ...names(item.schema ?? [])]);
  const page = names(schemaFor({ layout: 'page' }));
  assert.equal(page[page.indexOf('local_only') + 1], 'open_meteo_forecast');
  assert.equal(names(schemaFor({ layout: 'expanded' })).includes('open_meteo_forecast'), false);
  assert.equal(configFrom({ ...formData({}), entity: 'weather.home' })['open_meteo_forecast'], undefined);
  assert.equal(formData({})['open_meteo_forecast'], true);
  assert.equal(configFrom({ ...formData({}), open_meteo_forecast: false })['open_meteo_forecast'], false);
});

test('local only overrides what would reach out, and keeps what stays in Home Assistant', () => {
  const entity = 'weather.home',
    tiles = 'https://tiles.home.arpa/{z}/{x}/{y}.png',
    local = (settings: object) => normalizeConfig({ entity, local_only: true, ...settings });
  assert.equal(normalizeConfig({ entity }).local_only, false);
  assert.throws(() => local({ local_only: 'yes' }), /true or false/);
  assert.equal(local({ open_meteo_forecast: true }).open_meteo_forecast, false);
  assert.equal(local({ averages: 'open-meteo' }).averages, undefined);
  assert.equal(local({ averages: 'sensor.outdoor_temperature' }).averages, 'sensor.outdoor_temperature');
  // No tiles of the user's own, no ground to draw on.
  assert.equal(local({ map: 'rainviewer' }).map, undefined);
  assert.equal(local({ map: 'local' }).map, undefined);
  // On their tiles, Home Assistant's data and no radar.
  assert.equal(local({ map: 'rainviewer', map_tile_url: tiles }).map, 'local');
  assert.equal(local({ map: 'local', map_tile_url: tiles }).map, 'local');
  assert.equal(local({ map: 'rainviewer', map_tile_url: tiles }).map_tile_url, tiles);
  assert.equal(local({ map: 'none', map_tile_url: tiles }).map, undefined);
  // Turned off again, what was set stands.
  const online = { map: 'rainviewer', averages: 'open-meteo' } as const;
  assert.equal(normalizeConfig({ entity, ...online }).map, 'rainviewer');
  assert.equal(normalizeConfig({ entity, ...online }).averages, 'open-meteo');
});

test('the editor offers local only on the full page, above the settings it overrides', () => {
  const names = (items: readonly FormSchemaItem[]): string[] =>
    items.flatMap(item => [item.name, ...names(item.schema ?? [])]);
  const page = names(schemaFor({ layout: 'page' }));
  // First in its section, before the forecast, the map and the averages it can keep at home.
  for (const name of ['open_meteo_forecast', 'map', 'averages_source'])
    assert.ok(page.indexOf('local_only') < page.indexOf(name), name);
  assert.equal(names(schemaFor({ layout: 'expanded' })).includes('local_only'), false);
  assert.equal(configFrom({ ...formData({}), entity: 'weather.home' })['local_only'], undefined);
  assert.equal(configFrom({ ...formData({}), local_only: true })['local_only'], true);
});

test('the days with hours are those with a few of them, and today', () => {
  const hours = hoursFrom(Date.UTC(2026, 9, 27, 22), 60),
    keys = detailDays(hours, NOW, ZONE).map(day => day.key);
  assert.deepEqual(keys, ['2026-10-27', '2026-10-28', '2026-10-29'], 'the fourth day has only five');
});

test('the hours of a whole day reach its rows, and past the entity’s forty-eight', () => {
  const own = hoursFrom(Date.UTC(2026, 9, 27, 18), 48, { wind_speed: 3, precipitation: 0 });
  const { hourly } = supplementForecast({ hourly: ready(own) }, parsed(), ZONE),
    detail = dailyDetail(
      hourly?.forecast,
      [Date.UTC(2026, 9, 26, 18), Date.UTC(2026, 10, 3, 18)].map(time => ({ time, today: false })),
      ZONE,
    );
  const day = detail.get('2026-11-03');
  assert.ok(day);
  assert.ok(day.range, 'a chart on a day the entity never reached');
  assert.ok(Math.abs(day.total - 12) < 1e-9);
  assert.equal(day.chance, 99);
  assert.equal(detail.get('2026-10-26')?.range, null, 'yesterday’s hours aren’t in the forecast');
});

test('an entity that gives a chance and no amount has its days’ amounts from the hours lent', () => {
  const own = hoursFrom(Date.UTC(2026, 9, 27, 5), 48, { precipitation_probability: 90 });
  const { hourly } = supplementForecast({ hourly: ready(own) }, parsed(), ZONE),
    day = dailyDetail(hourly?.forecast, [{ time: Date.UTC(2026, 9, 28, 18), today: false }], ZONE).get('2026-10-28');
  assert.ok(day);
  assert.ok(Math.abs(day.total - 12) < 1e-9, 'every hour of a day within its range');
  assert.ok(day.segments.every(segment => segment.amount === 0.5));
  assert.equal(day.chance, 90, 'beside its own chance');
});

// --- Asking -----------------------------------------------------------------------------
const storage = () => {
  const held = new Map<string, string>();
  return {
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => void held.set(key, value),
    clear: () => held.clear(),
  };
};
const good: Fetcher = () => Promise.resolve({ ok: true, json: () => Promise.resolve(answer()) });
let asked: Mock<Fetcher>;
beforeEach(() => {
  asked = vi.fn<Fetcher>(good);
  vi.stubGlobal('fetch', asked);
  vi.stubGlobal('localStorage', storage());
});
afterEach(() => {
  vi.unstubAllGlobals();
});
const urlOf = (call = 0): URL => new URL(asked.mock.calls[call]?.[0] ?? '');

test('one request names every reading, the zone and fixed units', async () => {
  await openMeteoForecast(41.9, -87.6, ZONE, NOW);
  assert.equal(asked.mock.calls.length, 1);
  const url = urlOf(),
    param = (name: string) => url.searchParams.get(name);
  assert.equal(`${url.origin}${url.pathname}`, 'https://api.open-meteo.com/v1/forecast');
  assert.deepEqual(param('hourly')?.split(',').toSorted(), [
    'apparent_temperature',
    'cloud_cover',
    'cloud_cover_high',
    'cloud_cover_low',
    'cloud_cover_mid',
    'dew_point_2m',
    'precipitation',
    'precipitation_probability',
    'pressure_msl',
    'relative_humidity_2m',
    'snowfall',
    'temperature_2m',
    'uv_index',
    'visibility',
    'weather_code',
    'wind_direction_10m',
    'wind_gusts_10m',
    'wind_speed_10m',
  ]);
  assert.deepEqual(param('daily')?.split(',').toSorted(), [
    'precipitation_probability_max',
    'precipitation_sum',
    'sunrise',
    'sunset',
    'temperature_2m_max',
    'temperature_2m_min',
    'weather_code',
    'wind_gusts_10m_max',
    'wind_speed_10m_max',
  ]);
  assert.equal(param('past_days'), '1');
  assert.equal(param('forecast_days'), '11');
  assert.equal(param('timeformat'), 'unixtime');
  assert.equal(param('timezone'), ZONE);
  assert.equal(param('wind_speed_unit'), 'ms');
  assert.equal(param('precipitation_unit'), 'mm');
  assert.equal(param('temperature_unit'), 'celsius');
  await openMeteoForecast(41.9, -87.6, undefined, NOW);
  assert.equal(urlOf(1).searchParams.get('timezone'), 'auto', 'without a zone, the place’s own');
});

test('cards asking together share a request, and a page opened within the hour asks again for nothing', async () => {
  const [one, two] = await Promise.all([
    openMeteoForecast(41.9, -87.6, ZONE, NOW),
    openMeteoForecast(41.9, -87.6, ZONE, NOW),
  ]);
  assert.equal(asked.mock.calls.length, 1);
  assert.equal(one, two);
  const again = await openMeteoForecast(41.9, -87.6, ZONE, NOW + 59 * MINUTE);
  assert.equal(asked.mock.calls.length, 1);
  assert.equal(again?.at, NOW, 'as old as it is');
  await openMeteoForecast(41.9, -87.6, ZONE, NOW + HOUR);
  assert.equal(asked.mock.calls.length, 2, 'an hour on, it is asked again');
  await openMeteoForecast(40, -87.6, ZONE, NOW + HOUR);
  assert.equal(asked.mock.calls.length, 3, 'nor does it stand for another place');
});

test('each card applies its refresh interval to the shared saved forecast', async () => {
  await openMeteoForecast(41.9, -87.6, ZONE, NOW);
  const [slower, faster] = await Promise.all([
    openMeteoForecast(41.9, -87.6, ZONE, NOW + 15 * MINUTE, { maxAge: 2 * HOUR }),
    openMeteoForecast(41.9, -87.6, ZONE, NOW + 15 * MINUTE, { maxAge: 15 * MINUTE }),
  ]);
  assert.equal(slower?.at, NOW, 'a saved answer keeps its retrieval time');
  assert.equal(faster?.at, NOW + 15 * MINUTE, 'the shorter interval cannot share a stale cache hit');
  assert.equal(asked.mock.calls.length, 2);
  const later = await openMeteoForecast(41.9, -87.6, ZONE, NOW + 90 * MINUTE, { maxAge: 2 * HOUR });
  assert.equal(later?.at, faster.at);
  assert.equal(asked.mock.calls.length, 2, 'a longer interval can reuse data beyond the default hour');
});

test('a saved forecast from a clock ahead of now is fetched again', async () => {
  await openMeteoForecast(41.9, -87.6, ZONE, NOW + HOUR);
  const current = await openMeteoForecast(41.9, -87.6, ZONE, NOW);
  assert.equal(current?.at, NOW);
  assert.equal(asked.mock.calls.length, 2);
});

// A card as the records see it: a weather entity's forecasts, a home, and a page.
function aCard(hourly: readonly ForecastEntry[], daily: readonly ForecastEntry[], settings: object = {}) {
  const connection: Connection = {
    subscribeMessage(callback, message) {
      queueMicrotask(() => {
        callback({ forecast: message.forecast_type === 'hourly' ? hourly : daily });
      });
      return Promise.resolve(() => {});
    },
  };
  const hassAt = (latitude: number): HomeAssistant => ({
    states: { 'weather.home': { entity_id: 'weather.home', state: 'cloudy', attributes: {} } },
    config: { latitude, longitude: -87.6 },
  });
  const forecasts = new ForecastSources(
    () => {},
    list => list,
  );
  const host = {
    config: normalizeConfig({ entity: 'weather.home', weather_layout: 'page', ...settings }),
    readHass: hassAt(41.9),
    forecasts,
    timeZone: ZONE,
    inSight: true,
    redrawTiles: vi.fn(),
  };
  return {
    host,
    forecasts,
    hassAt,
    records: new WeatherRecords(host),
    answers: async () => {
      forecasts.update(connection, 'weather.home', ['hourly', 'daily']);
      await new Promise(resolve => setTimeout(resolve));
    },
  };
}
const FULL = hoursFrom(NOW, 48, {
    temperature: 70,
    precipitation_probability: 10,
    precipitation: 0,
    wind_gust_speed: 9,
    cloud_coverage: 60,
  }),
  PARTIAL = hoursFrom(NOW, 48, { temperature: 70, precipitation_probability: 10 }),
  TEN = Array.from({ length: 10 }, (_, i) => ({ datetime: iso(NOW + i * DAY), temperature: 75 }));

test('an entity that sends everything causes no request at all', async () => {
  const { records, answers, forecasts, host } = aCard(FULL, TEN);
  await answers();
  await records.loadSupplement(NOW);
  await records.loadSupplement(NOW + 2 * HOUR);
  assert.equal(asked.mock.calls.length, 0);
  assert.equal(forecasts.supplement, undefined);
  assert.deepEqual(forecasts.data, forecasts.own);
  assert.equal(host.redrawTiles.mock.calls.length, 0);
});

test('a partial entity is filled, and keeps what it sends', async () => {
  const { records, answers, forecasts, host } = aCard(PARTIAL, TEN);
  await answers();
  await records.loadSupplement(NOW);
  assert.equal(asked.mock.calls.length, 1);
  assert.equal(host.redrawTiles.mock.calls.length, 1);
  const [hour] = forecasts.data.hourly?.forecast ?? [];
  assert.ok(hour);
  assert.equal(hour.precipitation_probability, 10);
  assert.equal(hour.wind_gust_speed, 10);
  assert.equal(hour.temperature, 70);
  assert.ok((forecasts.data.hourly?.earlier?.length ?? 0) > 0);
  assert.equal(forecasts.own.hourly?.forecast[0]?.wind_gust_speed, undefined, 'what the decision reads stays its own');
});

test('nothing is asked until the entity has answered', async () => {
  const { records, answers } = aCard(PARTIAL, TEN);
  await records.loadSupplement(NOW);
  assert.equal(asked.mock.calls.length, 0, 'not before it is asked');
  await answers();
  await records.loadSupplement(NOW);
  assert.equal(asked.mock.calls.length, 1);
});

test('the setting, the layout, a missing home and an unavailable entity each keep it quiet', async () => {
  for (const settings of [{ open_meteo_forecast: false }, { weather_layout: 'expanded' }]) {
    const { records, answers } = aCard(PARTIAL, TEN, settings);
    await answers();
    await records.loadSupplement(NOW);
  }
  const homeless = aCard(PARTIAL, TEN);
  homeless.host.readHass = { ...homeless.host.readHass, config: {} };
  await homeless.answers();
  await homeless.records.loadSupplement(NOW);
  const down = aCard(PARTIAL, TEN);
  down.host.readHass = {
    ...down.host.readHass,
    states: { 'weather.home': { entity_id: 'weather.home', state: 'unavailable', attributes: {} } },
  };
  await down.answers();
  await down.records.loadSupplement(NOW);
  assert.equal(asked.mock.calls.length, 0);
});

test('switched off, what was held goes at once', async () => {
  const { records, answers, forecasts, host } = aCard(PARTIAL, TEN);
  await answers();
  await records.loadSupplement(NOW);
  assert.ok(forecasts.supplement);
  host.config = normalizeConfig({ ...host.config, open_meteo_forecast: false });
  void records.loadSupplement(NOW + MINUTE);
  assert.equal(forecasts.supplement, undefined);
  assert.equal(forecasts.data.hourly?.forecast[0]?.wind_gust_speed, undefined);
});

test('hourly while in sight, and not at all while out of it', async () => {
  const { records, answers, host } = aCard(PARTIAL, TEN);
  await answers();
  await records.loadSupplement(NOW);
  await records.loadSupplement(NOW + 59 * MINUTE);
  assert.equal(asked.mock.calls.length, 1);
  host.inSight = false;
  await records.loadSupplement(NOW + HOUR);
  assert.equal(asked.mock.calls.length, 1);
  host.inSight = true;
  await records.loadSupplement(NOW + HOUR);
  assert.equal(asked.mock.calls.length, 2);
});

test('a saved answer counts its hour from when it was asked for, not from the page that read it', async () => {
  await openMeteoForecast(41.9, -87.6, ZONE, NOW);
  const { records, answers, forecasts } = aCard(PARTIAL, TEN);
  await answers();
  await records.loadSupplement(NOW + 50 * MINUTE);
  assert.equal(asked.mock.calls.length, 1, 'the page opened later has it at once');
  assert.ok(forecasts.supplement);
  await records.loadSupplement(NOW + HOUR);
  assert.equal(asked.mock.calls.length, 2);
});

test('the configured forecast interval governs requests and immediately honors a shorter setting', async () => {
  const { records, answers, host, forecasts } = aCard(PARTIAL, TEN, { forecast_refresh_minutes: 120 });
  await answers();
  await records.loadSupplement(NOW);
  await records.loadSupplement(NOW + HOUR);
  assert.equal(asked.mock.calls.length, 1);
  host.config = normalizeConfig({ ...host.config, forecast_refresh_minutes: 15 });
  await records.loadSupplement(NOW + HOUR);
  assert.equal(asked.mock.calls.length, 2);
  assert.equal(forecasts.supplement?.raw.at, NOW + HOUR);
  await records.loadSupplement(NOW + HOUR + 14 * MINUTE);
  assert.equal(asked.mock.calls.length, 2);
  host.inSight = false;
  await records.loadSupplement(NOW + HOUR + 15 * MINUTE);
  assert.equal(asked.mock.calls.length, 2, 'a shorter interval does not bypass visibility');
  host.inSight = true;
  await records.loadSupplement(NOW + HOUR + 15 * MINUTE);
  assert.equal(asked.mock.calls.length, 3);
});

test('a pending supplement stays one request and applies its response only once', async () => {
  let reply: ((value: Awaited<ReturnType<Fetcher>>) => void) | undefined;
  asked.mockImplementation(
    () =>
      new Promise(resolve => {
        reply = resolve;
      }),
  );
  const { records, answers, host } = aCard(PARTIAL, TEN, { forecast_refresh_minutes: 15 });
  await answers();
  const loading = records.loadSupplement(NOW);
  await records.loadSupplement(NOW + 15 * MINUTE);
  assert.equal(asked.mock.calls.length, 1);
  reply?.({ ok: true, json: () => Promise.resolve(answer()) });
  await loading;
  assert.equal(host.redrawTiles.mock.calls.length, 1);
});

test('a failed call changes nothing, says nothing, and is tried again after a while', async () => {
  asked.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
  const spoken = vi.spyOn(console, 'error');
  const { records, answers, forecasts, host } = aCard(PARTIAL, TEN);
  await answers();
  const before = forecasts.data;
  await records.loadSupplement(NOW);
  assert.equal(forecasts.data.hourly, before.hourly);
  assert.equal(forecasts.supplement, undefined);
  assert.equal(host.redrawTiles.mock.calls.length, 1, 'only to give back the room held for it');
  assert.equal(spoken.mock.calls.length, 0);
  await records.loadSupplement(NOW + 14 * MINUTE);
  assert.equal(asked.mock.calls.length, 1);
  // A well-formed body under an error status is no answer either.
  asked.mockImplementation(() => Promise.resolve({ ok: false, status: 429, json: () => Promise.resolve(answer()) }));
  await records.loadSupplement(NOW + 15 * MINUTE);
  assert.equal(asked.mock.calls.length, 2, 'an error status counts as a failure');
  assert.equal(forecasts.supplement, undefined);
  assert.equal(host.redrawTiles.mock.calls.length, 1, 'a second failure has nothing to give back');
  asked.mockImplementation(good);
  await records.loadSupplement(NOW + 30 * MINUTE);
  assert.notEqual(forecasts.supplement, undefined);
});

test('a refresh that fails keeps the forecast held', async () => {
  const { records, answers, forecasts } = aCard(PARTIAL, TEN);
  await answers();
  await records.loadSupplement(NOW);
  const held = forecasts.supplement;
  asked.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
  await records.loadSupplement(NOW + HOUR);
  assert.equal(forecasts.supplement, held);
});

test('a change of place drops the old place’s hours at once, and its late reply stays out', async () => {
  const { records, answers, forecasts, host, hassAt } = aCard(PARTIAL, TEN);
  await answers();
  await records.loadSupplement(NOW);
  assert.ok(forecasts.supplement);
  // The card moves twice before anything comes back, and the later place answers first.
  const replies: ((value: Awaited<ReturnType<Fetcher>>) => void)[] = [],
    reply = (index: number) => replies[index]?.({ ok: true, json: () => Promise.resolve(answer()) });
  asked.mockImplementation(() => new Promise(resolve => replies.push(resolve)));
  host.readHass = hassAt(30);
  const moving = records.loadSupplement(NOW + MINUTE);
  assert.equal(forecasts.supplement, undefined, 'gone before anything is drawn');
  assert.equal(urlOf(1).searchParams.get('latitude'), '30.000');
  host.readHass = hassAt(20);
  const moved = records.loadSupplement(NOW + 2 * MINUTE);
  assert.equal(urlOf(2).searchParams.get('latitude'), '20.000');
  reply(1);
  await moved;
  const landed = forecasts.supplement;
  assert.ok(landed, 'the place still asked for lands');
  reply(0);
  await moving;
  assert.equal(forecasts.supplement, landed, 'the place left behind stays out');
  assert.equal(host.redrawTiles.mock.calls.length, 2, 'the first place, then this one');
});

test('a change of time zone asks again, as the dates are the zone’s', async () => {
  const { records, answers, host } = aCard(PARTIAL, TEN);
  await answers();
  await records.loadSupplement(NOW);
  host.timeZone = 'Europe/Oslo';
  await records.loadSupplement(NOW + MINUTE);
  assert.equal(asked.mock.calls.length, 2);
  assert.equal(urlOf(1).searchParams.get('timezone'), 'Europe/Oslo');
});

test('another entity starts afresh, as what is held is in the last one’s units', async () => {
  const { records, answers, forecasts, host } = aCard(PARTIAL, TEN);
  await answers();
  await records.loadSupplement(NOW);
  const held = forecasts.supplement;
  host.config = normalizeConfig({ ...host.config, entity: 'weather.other' });
  host.readHass = {
    ...host.readHass,
    states: { 'weather.other': { entity_id: 'weather.other', state: 'cloudy', attributes: {} } },
  };
  await records.loadSupplement(NOW + MINUTE);
  assert.ok(forecasts.supplement);
  assert.notEqual(forecasts.supplement, held);
  assert.equal(asked.mock.calls.length, 1, 'the same hours, saved, with no second request');
});

test('when the entity starts sending everything, the supplement goes', async () => {
  let hourly = PARTIAL;
  const { records, forecasts, host } = aCard(PARTIAL, TEN),
    connection: Connection = {
      subscribeMessage(callback, message) {
        queueMicrotask(() => {
          callback({ forecast: message.forecast_type === 'hourly' ? hourly : TEN });
        });
        return Promise.resolve(() => {});
      },
    };
  forecasts.update(connection, 'weather.home', ['hourly', 'daily']);
  await new Promise(resolve => setTimeout(resolve));
  await records.loadSupplement(NOW);
  assert.ok(forecasts.supplement);
  hourly = FULL;
  forecasts.stop();
  forecasts.update(connection, 'weather.home', ['hourly', 'daily']);
  await new Promise(resolve => setTimeout(resolve));
  await records.loadSupplement(NOW + MINUTE);
  assert.equal(forecasts.supplement, undefined);
  assert.equal(host.redrawTiles.mock.calls.length, 1);
});

test('held supplements convert again when the units change, without asking', () => {
  let unit = 'mph';
  const sources = new ForecastSources(
    () => {},
    list => convertForecastBetween(list, OPEN_METEO_UNITS, { wind_speed_unit: unit }, undefined),
  );
  sources.supply(parsed(), ZONE);
  const inMiles = sources.supplement?.converted.hours[0]?.wind_speed;
  unit = 'km/h';
  sources.refresh();
  const inKilometers = sources.supplement?.converted.hours[0]?.wind_speed;
  assert.ok(inMiles !== undefined && Math.abs(inMiles - 8.95) < 0.01);
  assert.ok(inKilometers !== undefined && Math.abs(inKilometers - 14.4) < 0.01);
});

test('held forecasts all convert again before the card is told, so nothing is drawn half in the old units', async () => {
  let unit = 'mph';
  const told: (number | undefined)[][] = [],
    connection: Connection = {
      subscribeMessage(callback, message) {
        queueMicrotask(() => {
          callback({ forecast: message.forecast_type === 'hourly' ? hoursFrom(NOW, 2, { wind_speed: 10 }) : [] });
        });
        return Promise.resolve(() => {});
      },
    },
    sources = new ForecastSources(
      () => {
        told.push([
          sources.main.data.hourly?.forecast[0]?.wind_speed,
          sources.supplement?.converted.hours[0]?.wind_speed,
        ]);
      },
      (list, source) =>
        source === 'open_meteo'
          ? convertForecastBetween(list, OPEN_METEO_UNITS, { wind_speed_unit: unit }, undefined)
          : convertForecast(list, { wind_speed_unit: 'mph' }, { wind_speed_unit: unit }),
    );
  sources.supply(parsed(), ZONE);
  sources.update(connection, 'weather.home', ['hourly']);
  await new Promise(resolve => setTimeout(resolve));
  unit = 'km/h';
  told.length = 0;
  sources.refresh();
  // Told once, with the entity's ten miles an hour and the supplement's 4 m/s both in km/h.
  assert.equal(told.length, 1);
  const [[own, supplied] = []] = told;
  assert.ok(own !== undefined && Math.abs(own - 16.09) < 0.01);
  assert.ok(supplied !== undefined && Math.abs(supplied - 14.4) < 0.01);
});

test('every unit comes through one conversion', () => {
  const [hour] = convertForecastBetween(
    parsed().hours,
    OPEN_METEO_UNITS,
    {
      temperature_unit: '°F',
      wind_speed_unit: 'mph',
      precipitation_unit: 'in',
      visibility_unit: 'mi',
    },
    undefined,
  );
  assert.ok(hour);
  assert.ok(Math.abs((hour.temperature ?? 0) - 64.4) < 0.01);
  assert.ok(Math.abs((hour.dew_point ?? 0) - 50) < 0.01);
  assert.ok(Math.abs((hour.apparent_temperature ?? 0) - 68) < 0.01);
  assert.ok(Math.abs((hour.wind_gust_speed ?? 0) - 22.37) < 0.01);
  assert.ok(Math.abs((hour.precipitation ?? 0) - 0.0197) < 0.001);
  assert.ok(Math.abs((hour.visibility ?? 0) - 9.94) < 0.01);
  // Percentages and bearings are nobody's unit.
  assert.equal(hour.cloud_coverage, 90);
  assert.equal(hour.wind_bearing, 200);
});

test('merged forecasts are the same objects until something changes', async () => {
  const { records, answers, forecasts } = aCard(PARTIAL, TEN);
  await answers();
  await records.loadSupplement(NOW);
  assert.equal(forecasts.data, forecasts.data);
  forecasts.supply(parsed(), ZONE);
  assert.notEqual(forecasts.data.hourly?.forecast[0], undefined);
});

test('every day has humidity, pressure and UV, in the entity’s units, its own values first', () => {
  const body = {
      hourly: { time: [NOW / SECOND], relative_humidity_2m: [64], pressure_msl: [1013.25], uv_index: [3.5] },
      daily: { time: [NOW / SECOND] },
    },
    supplement = parseSupplement(body, NOW);
  assert.ok(supplement);
  const [hour] = supplement.hours;
  assert.deepEqual([hour?.humidity, hour?.pressure, hour?.uv_index], [64, 1013.25, 3.5]);
  const [converted] = convertForecastBetween([{ pressure: 1013.25 }], OPEN_METEO_UNITS, { pressure_unit: 'inHg' }, {});
  assert.ok(Math.abs((converted?.pressure ?? 0) - 29.92) < 0.01);
  // Inside the entity's own hours they're lent too, past the ones it gives.
  const own: ForecastEntry[] = [{ datetime: iso(NOW), temperature: 70, humidity: 50 }],
    [first] = supplementForecast({ hourly: ready(own) }, supplement, ZONE).hourly?.forecast ?? [];
  assert.deepEqual([first?.humidity, first?.pressure, first?.uv_index], [50, 1013.25, 3.5]);
});

test('changing entities drops a stored supplement before the replacement subscription answers', async () => {
  const { records, answers, forecasts, host } = aCard(PARTIAL, TEN);
  await answers();
  await records.loadSupplement(NOW);
  assert.ok(forecasts.supplement);
  host.config = normalizeConfig({ entity: 'weather.away', weather_layout: 'page' });
  forecasts.update({ subscribeMessage: () => Promise.resolve(() => {}) }, 'weather.away', ['hourly']);
  assert.equal(forecasts.answered, false);
  await records.loadSupplement(NOW);
  assert.equal(forecasts.supplement, undefined);
  assert.equal(asked.mock.calls.length, 1);
  forecasts.stop();
});
