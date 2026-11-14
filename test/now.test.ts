import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { EntityAttributes, HomeAssistant } from '../src/card/home-assistant.ts';
import { normalizeConfig } from '../src/card/config.ts';
import { workOut, type UpdateSources } from '../src/card/update.ts';
import { tileMarkup } from '../src/cards/index.ts';
import { tileText } from '../src/cards/shared/tile.ts';
import type { TimedEntry } from '../src/weather/forecast-items.ts';
import { weatherText } from '../src/weather/i18n.ts';
import { dewPoint, hourUnderWay, readingsNow, type NowInputs } from '../src/weather/now.ts';

const HOUR = 3_600_000,
  NOW = Date.UTC(2026, 10, 2, 18, 45);
const hour = (readings: Partial<TimedEntry> = {}, time = NOW - 45 * 60_000): TimedEntry => ({
  time,
  datetime: new Date(time).toISOString(),
  ...readings,
});
const inputs = (entity: EntityAttributes, over: Partial<NowInputs> = {}): NowInputs => ({
  entity: { temperature_unit: '°F', wind_speed_unit: 'mph', ...entity },
  sensors: new Set(),
  second: undefined,
  hour: undefined,
  ...over,
});

test('the entity’s own readings stand, and with nothing to fill it comes back as it was', () => {
  const entity = { temperature: 64, humidity: 88, dew_point: 61, temperature_unit: '°F' },
    now = readingsNow(inputs(entity, { hour: hour({ temperature: 70, humidity: 50, dew_point: 50 }) }));
  assert.equal(now.attrs.temperature, 64);
  assert.equal(now.attrs.dew_point, 61);
  assert.deepEqual(now.from, { temperature: 'entity', humidity: 'entity', dew_point: 'entity' });
  const whole = inputs({ temperature: 64 });
  assert.equal(readingsNow(whole).attrs, whole.entity);
});

test('what the entity leaves out comes from the second entity, then the hour under way', () => {
  const now = readingsNow(
    inputs(
      { temperature: 64 },
      {
        second: { uv_index: 3, pressure: 1015 },
        hour: hour({ uv_index: 5, pressure: 1000, visibility: 9, cloud_coverage: 40, wind_bearing: 'SSW' }),
      },
    ),
  );
  assert.equal(now.attrs.uv_index, 3);
  assert.equal(now.attrs.pressure, 1015);
  assert.equal(now.attrs.visibility, 9);
  assert.equal(now.attrs.cloud_coverage, 40);
  assert.equal(now.attrs.wind_bearing, 'SSW', 'a compass point counts as a bearing');
  assert.equal(now.from.uv_index, 'second');
  assert.equal(now.from.visibility, 'hour');
});

test('the height of the cloud comes from the hour, beside the entity’s own cover', () => {
  const now = readingsNow(
    inputs({ cloud_coverage: 90 }, { hour: hour({ cloud_coverage: 40, cloud_altitude: 'high' }) }),
  );
  assert.equal(now.attrs.cloud_coverage, 90);
  assert.equal(now.attrs.cloud_altitude, 'high');
  assert.equal(
    readingsNow(inputs({}, { second: { cloud_altitude: 'mid' }, hour: hour({ cloud_altitude: 'high' }) })).attrs
      .cloud_altitude,
    'mid',
  );
  assert.equal(
    readingsNow(inputs({ cloud_altitude: 'low' }, { hour: hour({ cloud_altitude: 'high' }) })).attrs.cloud_altitude,
    'low',
  );
  assert.equal(readingsNow(inputs({ cloud_coverage: 90 })).attrs.cloud_altitude, undefined);
});

test('a reading that isn’t a number is filled as if missing', () => {
  const now = readingsNow(inputs({ temperature: 64, humidity: Number.NaN }, { hour: hour({ humidity: 70 }) }));
  assert.equal(now.attrs.humidity, 70);
});

test('a dew point is worked out from a temperature and humidity taken together, before a forecast’s', () => {
  // A station's 64 °F and 88% (its own 18 °C over 16 °C, rounded), beside a forecast hour that
  // doesn't agree with them.
  const forecast = hour({ temperature: 65, humidity: 100, dew_point: 65 }),
    entity = { temperature: 64, humidity: 88 };
  const worked = readingsNow(inputs(entity, { hour: forecast }));
  assert.equal(worked.from.dew_point, 'worked out');
  assert.ok(Math.abs((worked.attrs.dew_point ?? 0) - 60.4) < 0.1, String(worked.attrs.dew_point));
  // Both from sensors is still one place's reading.
  const sensors = new Set(['temperature', 'humidity']);
  assert.equal(readingsNow(inputs(entity, { hour: forecast, sensors })).from.dew_point, 'worked out');
  // A sensor's humidity beside the entity's temperature describes two places: the forecast's stands.
  const mixed = readingsNow(inputs(entity, { hour: forecast, sensors: new Set(['humidity']) }));
  assert.equal(mixed.attrs.dew_point, 65);
  assert.equal(mixed.from.dew_point, 'hour');
  // As does a temperature now beside a humidity forecast.
  const lent = readingsNow(inputs({ temperature: 64 }, { hour: forecast }));
  assert.equal(lent.attrs.dew_point, 65);
  // With nothing to go on, there is none.
  assert.equal(readingsNow(inputs({ temperature: 64 })).attrs.dew_point, undefined);
});

test('a gust from elsewhere is no less than the wind now, and the entity’s own is as sent', () => {
  const gust = (entity: EntityAttributes, lent: number) =>
    readingsNow(inputs(entity, { hour: hour({ wind_gust_speed: lent }) })).attrs.wind_gust_speed;
  assert.equal(gust({ wind_speed: 7 }, 5), 7, 'a model’s gust under the wind now reads as the wind');
  assert.equal(gust({ wind_speed: 7 }, 12), 12);
  assert.equal(gust({ wind_speed: 7, wind_gust_speed: 6 }, 12), 6, 'the entity’s own stands');
});

test('the hour under way is the last to start by now, while it lasts', () => {
  const at = (offset: number) => hour({ temperature: offset }, NOW + offset * HOUR);
  const hourly = [at(-1.75), at(-0.75), at(0.25), at(1.25)];
  assert.equal(hourUnderWay(hourly, NOW)?.temperature, -0.75);
  // A forecast that starts just after now lends its first hour.
  assert.equal(hourUnderWay([at(0.25), at(1.25)], NOW)?.temperature, 0.25);
  assert.equal(hourUnderWay([at(1.5), at(2.5)], NOW), undefined, 'not one that starts later');
  // Steps of three hours last three hours; an hour long gone lends nothing.
  assert.equal(hourUnderWay([at(-2.5), at(0.5)], NOW)?.temperature, -2.5);
  assert.equal(hourUnderWay([at(-4), at(-1.5)], NOW), undefined);
  assert.equal(hourUnderWay([], NOW), undefined);
});

test('the dew point comes from the temperature and humidity in any unit', () => {
  const near = (value: number | undefined, expected: number, within = 0.2) =>
    assert.ok(value !== undefined && Math.abs(value - expected) < within, `${String(value)} vs ${expected}`);
  near(dewPoint(18, 88.1, '°C'), 16);
  near(dewPoint(64.4, 88.1, '°F'), 60.8);
  near(dewPoint(30, 100, '°C'), 30, 0.01);
  near(dewPoint(-10, 70, '°C'), -14.6, 0.3);
  near(dewPoint(291.15, 88.1, 'K'), 289.15);
  assert.equal(dewPoint(18, 0, '°C'), undefined);
  assert.equal(dewPoint(18, 88, undefined), undefined, 'a temperature in no known unit');
  assert.equal(dewPoint(18, 88, 'furlongs'), undefined);
});

// The card as a whole, on an entity with no dew point, feels-like, UV or visibility of its own.
const SPARSE = { temperature: 64, humidity: 88, wind_speed: 8, temperature_unit: '°F', wind_speed_unit: 'mph' };
const sources = (
  attributes: EntityAttributes,
  over: Partial<UpdateSources> = {},
  extra = {},
  condition = 'cloudy',
): UpdateSources => {
  const hass: HomeAssistant = {
    states: {
      'weather.home': { entity_id: 'weather.home', state: condition, attributes },
      'sun.sun': { entity_id: 'sun.sun', state: 'above_horizon', attributes: {} },
      ...extra,
    },
    locale: { language: 'en' },
    config: { latitude: 38.6, longitude: -90.2, time_zone: 'UTC' },
  };
  return {
    config: normalizeConfig({ type: 'custom:iweather-card', entity: 'weather.home' }),
    hass,
    data: {
      hourly: {
        status: 'ready',
        forecast: [0, 1, 2].map(offset => ({
          datetime: new Date(NOW + (offset + 0.25) * HOUR).toISOString(),
          temperature: 65,
          humidity: 100,
          dew_point: 65,
          apparent_temperature: 66,
          uv_index: 1,
          visibility: 6,
          wind_gust_speed: 15,
        })),
      },
    },
    supplied: false,
    awaited: false,
    nowcast: undefined,
    timeZone: 'UTC',
    prefersDark: false,
    text: locale => weatherText(locale ?? 'en'),
    mode: undefined,
    narrow: false,
    id: 'card1',
    records: {
      earlier: undefined,
      recent: undefined,
      lastDay: undefined,
      airYesterday: undefined,
      recentRain: undefined,
      climate: undefined,
    },
    now: NOW,
    ...over,
  };
};
const tile = (update: ReturnType<typeof workOut>, id: Parameters<typeof tileMarkup>[0]) =>
  tileText(tileMarkup(id, update.ctx) ?? '');

test('every tile reads the readings now with what the entity leaves out filled in', () => {
  const update = workOut(sources(SPARSE));
  assert.match(tile(update, 'humidity'), /The dew point is 60° right now/);
  assert.match(tile(update, 'feels_like'), /66°/);
  assert.match(tile(update, 'uv'), /\b1\b/);
  assert.match(tile(update, 'visibility'), /\b6\b/);
  assert.match(tile(update, 'wind'), /Gusts: 15/);
  assert.equal(update.state?.attributes, update.attrs, 'the state the sky and strip read is the same');
  assert.equal(update.inputs.humidity, 88);
});

test('a second weather entity’s readings now come in the first’s units', () => {
  const config = normalizeConfig({
      type: 'custom:iweather-card',
      entity: 'weather.home',
      forecast_entity: 'weather.second',
    }),
    second = {
      'weather.second': {
        entity_id: 'weather.second',
        state: 'cloudy',
        attributes: { temperature: 18, temperature_unit: '°C', pressure: 1015, pressure_unit: 'hPa', uv_index: 4 },
      },
    };
  const update = workOut(sources({ ...SPARSE, pressure_unit: 'inHg' }, { config }, second));
  assert.ok(Math.abs((update.attrs.pressure ?? 0) - 29.97) < 0.01, String(update.attrs.pressure));
  assert.equal(update.attrs.pressure_unit, 'inHg');
  assert.equal(update.attrs.uv_index, 4);
  assert.equal(update.attrs.temperature, 64, 'the first’s own temperature stands');
  // An unavailable second entity lends nothing.
  const gone = { 'weather.second': { ...second['weather.second'], state: 'unavailable' } };
  assert.equal(workOut(sources(SPARSE, { config }, gone)).attrs.uv_index, 1);
});

test('an unavailable entity is left as it is', () => {
  assert.deepEqual(workOut(sources({}, {}, {}, 'unavailable')).attrs, {});
  assert.equal(workOut(sources(SPARSE, { hass: undefined })).state, undefined);
});

test('a value an integration sends to mean it has none counts as missing', async () => {
  const { forecastEntries } = await import('../src/weather/forecast.ts');
  // A share below nothing, and a gust of nothing in a wind.
  const now = readingsNow(
    inputs(
      { humidity: -99, wind_speed: 14, wind_gust_speed: 0 },
      { hour: hour({ humidity: 70, wind_gust_speed: 22 }) },
    ),
  );
  assert.equal(now.attrs.humidity, 70);
  assert.equal(now.attrs.wind_gust_speed, 22);
  const alone = readingsNow(inputs({ wind_speed: 14, wind_gust_speed: 0 }));
  assert.equal(alone.attrs.wind_gust_speed, undefined, 'with nothing else to go by, none');
  assert.equal(alone.from.wind_gust_speed, undefined);
  assert.equal(readingsNow(inputs({ wind_speed: 0, wind_gust_speed: 0 })).from.wind_gust_speed, 'entity', 'calm');
  const [entry] = forecastEntries({
    forecast: [
      { datetime: 'x', precipitation_probability: -99, humidity: 120, uv_index: -1, wind_speed: 9, wind_gust_speed: 0 },
    ],
  });
  assert.deepEqual(entry, { datetime: 'x', wind_speed: 9 });
});

test('an entity with no condition to give keeps its readings, and borrows a condition where it can', async () => {
  const { conditionLabel, weatherAvailable } = await import('../src/weather/conditions.ts');
  assert.equal(weatherAvailable({ state: 'unknown', attributes: { temperature: 9 } }), true);
  assert.equal(weatherAvailable({ state: 'unknown', attributes: {} }), false, 'not yet anything to read');
  assert.equal(weatherAvailable({ state: 'unavailable', attributes: { temperature: 9 } }), false);
  assert.equal(conditionLabel('unknown'), '');
  assert.equal(conditionLabel(''), '', 'nothing said');
  assert.equal(weatherAvailable({ state: '', attributes: { temperature: 9 } }), true);
  assert.equal(conditionLabel('Éclaircies'), 'Éclaircies', 'an integration’s own, as written');
  assert.equal(conditionLabel('unavailable'), 'Weather unavailable');
  // Nothing else to go by: the readings, and no word for the sky.
  const alone = workOut(sources(SPARSE, { data: {} }, {}, 'unknown'));
  assert.equal(alone.available, true);
  assert.equal(alone.conditionText, '');
  assert.match(tile(alone, 'humidity'), /The dew point is 60° right now/);
  // The hour under way has one.
  const hours = sources(SPARSE).data.hourly?.forecast ?? [];
  const cloudy = workOut(
    sources(
      SPARSE,
      { data: { hourly: { status: 'ready', forecast: hours.map(hour => ({ ...hour, condition: 'cloudy' })) } } },
      {},
      'unknown',
    ),
  );
  assert.equal(cloudy.state?.state, 'cloudy');
  assert.equal(cloudy.conditionText, 'Cloudy');
});
