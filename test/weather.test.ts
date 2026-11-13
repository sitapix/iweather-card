import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import type { Connection, ForecastEntry, ForecastSubscription, Unsubscribe } from '../src/card/home-assistant.ts';
import { WEATHER_DEFAULTS, sceneCondition } from '../src/weather/conditions.ts';
import {
  forecasts,
  forecastTypes,
  todayRange,
  forecastItems,
  rainMetric,
  dailyItems,
  daysFromHours,
} from '../src/weather/forecast-items.ts';
import { weatherNumber } from '../src/lib/formats.ts';
import { HOUR, MINUTE } from '../src/lib/time.ts';
import { windDirection } from '../src/lib/compass.ts';
import { rangeStyles, temperatureRange } from '../src/weather/temperature-colors.ts';
import {
  type ForecastData,
  WeatherForecast,
  forecastEntries,
  pageTarget,
  withHourlyDays,
} from '../src/weather/forecast.ts';
import { normalizeConfig } from '../src/card/config.ts';
import { configFrom, formData, partsOf, schemaFor } from '../src/card/editor-schema.ts';

const SCHEMA = schemaFor({ layout: 'page', averages: 'sensor', map: 'rainviewer' });
const now = Date.parse('2026-10-21T06:30:00Z');
const state = { state: 'clear-night', attributes: { temperature: 0, wind_speed: 0, wind_bearing: 0 } };
const settle = () =>
  new Promise<void>(resolve => {
    setImmediate(resolve);
  });

test('the card accepts real weather entities, fills defaults and rejects invalid settings', () => {
  const config = normalizeConfig({ type: 'custom:iweather-card', entity: 'weather.home' });
  assert.equal(config.weather_scene, true);
  assert.equal(config.glass_refraction, true);
  assert.equal(config.map_precipitation_animation, true);
  assert.equal(config.forecast_hours, 24);
  assert.equal(config.show_name, true);
  assert.equal(config.top_padding, 50);
  assert.equal(normalizeConfig({ ...config, top_padding: 0 }).top_padding, 0);
  assert.equal(normalizeConfig({ ...config, top_padding: 200 }).top_padding, 200);
  for (const options of [
    { entity: 'sensor.temp' },
    { entity: 'weatherXhome' },
    { forecast_hours: 0 },
    { forecast_hours: 49 },
    { forecast_hours: 2.5 },
    { forecast_days: 11 },
    { top_padding: -1 },
    { top_padding: 201 },
    { top_padding: 50.5 },
    { top_padding: '50' },
    { top_padding: null },
    { weather_animation: 1 },
    { glass_refraction: 'false' },
    { glass_refraction: null },
    { map_precipitation_animation: 'false' },
    { map_precipitation_animation: null },
    { weather_mode: 'humidity' },
    { weather_layout: 'tall' },
    { time_zone: 'Mars/Olympus' },
  ])
    assert.throws(() => normalizeConfig({ ...config, ...options }));
  assert.throws(() => normalizeConfig(undefined), /configuration/);
  const entity = SCHEMA.find(field => field.name === 'entity')?.selector;
  assert.ok(entity && 'entity' in entity);
  assert.deepEqual(entity.entity.domain, ['weather']);
  assert.equal(JSON.stringify(SCHEMA).includes('glass_refraction'), true);
});

test('glass refraction keeps its default out of YAML and preserves an explicit off setting', () => {
  const saved = { entity: 'weather.home', glass_refraction: false },
    shown = formData(saved);
  assert.equal(normalizeConfig(saved).glass_refraction, false);
  assert.equal(shown['glass_refraction'], false);
  assert.equal(configFrom(shown)['glass_refraction'], false);
  assert.equal(configFrom({ ...shown, glass_refraction: true })['glass_refraction'], undefined);
});
test('precipitation animation defaults on and preserves its off setting through the editor', () => {
  const saved = { entity: 'weather.home', map_precipitation_animation: false },
    shown = formData(saved);
  assert.equal(normalizeConfig(saved).map_precipitation_animation, false);
  assert.equal(formData({ entity: 'weather.home' })['map_precipitation_animation'], true);
  assert.equal(shown['map_precipitation_animation'], false);
  assert.equal(configFrom(shown)['map_precipitation_animation'], false);
  assert.equal(configFrom({ ...shown, map_precipitation_animation: true })['map_precipitation_animation'], undefined);
});
test('forecast requests honor supported features and disabled sections', () => {
  assert.deepEqual(forecastTypes(3, WEATHER_DEFAULTS), ['hourly', 'daily']);
  assert.deepEqual(forecastTypes(1, WEATHER_DEFAULTS), ['daily']);
  assert.deepEqual(forecastTypes(4, WEATHER_DEFAULTS), ['twice_daily']);
  assert.deepEqual(forecastTypes(0, WEATHER_DEFAULTS), []);
  assert.deepEqual(forecastTypes(3, { show_daily: false, show_high_low: false, show_forecast: false }), []);
  assert.deepEqual(forecastTypes(3, { show_daily: false, show_high_low: false, show_forecast: true }), ['hourly']);
});
test('forecasts ignore malformed timestamps, deduplicate and sort without mutating the provider data', () => {
  const input = [
    { datetime: '2026-10-21T08:00:00Z', temperature: 15 },
    null,
    { datetime: 'bad' },
    { datetime: '2026-10-21T07:00:00Z', temperature: 14 },
    { datetime: '2026-10-21T08:00:00Z', temperature: 16 },
  ];
  assert.deepEqual(
    forecasts(forecastEntries({ forecast: input })).map(item => item.temperature),
    [14, 16],
  );
  assert.deepEqual(input[0], { datetime: '2026-10-21T08:00:00Z', temperature: 15 });
});
test('high and low use the location date across midnight and retain zero', () => {
  const daily = [
    { datetime: '2026-10-21T17:00:00Z', temperature: 0, templow: -7 },
    { datetime: '2026-10-22T17:00:00Z', temperature: 4, templow: 0 },
  ];
  assert.deepEqual(todayRange(daily, now, 'America/Chicago'), { high: 0, low: -7 });
  assert.deepEqual(todayRange(daily, Date.parse('2026-10-21T01:00:00Z'), 'America/Chicago'), { high: null, low: null });
  assert.deepEqual(todayRange([{ datetime: '2026-10-21T17:00:00Z', temperature: 0 }], now, 'America/Chicago'), {
    high: 0,
    low: null,
  });
});
test('twice daily ranges combine day and night without inventing a low', () => {
  const entries = [
    { datetime: '2026-10-21T12:00:00Z', temperature: 18, is_daytime: true },
    { datetime: '2026-10-21T23:00:00Z', temperature: 0, is_daytime: false },
  ];
  assert.deepEqual(todayRange(entries, now, 'America/Chicago'), { high: 18, low: 0 });
});
test('Now uses actual conditions; hourly items omit old hours and retain current-hour precipitation', () => {
  const entries = [
    { datetime: '2026-10-21T05:00:00Z', temperature: 8 },
    { datetime: '2026-10-21T06:00:00Z', temperature: 9, precipitation: 0.02 },
    { datetime: '2026-10-21T07:00:00Z', temperature: 10 },
    { datetime: '2026-10-21T08:00:00Z', temperature: 11 },
  ];
  const items = forecastItems(entries, 'hourly', state, now, 2),
    [live, next] = items;
  assert.equal(items.length, 2);
  assert.ok(live && next);
  assert.equal(live.temperature, 0);
  assert.equal(live.condition, 'clear-night');
  assert.equal(live.precipitation, 0.02);
  assert.equal(next.temperature, 10);
  const [later] = forecastItems(entries.slice(2), 'hourly', state, now, 2);
  assert.ok(later);
  assert.equal(later.precipitation, undefined);
});
test('hourly forecast preserves both occurrences of a repeated daylight-saving hour', () => {
  const entries = [
    { datetime: '2026-11-01T06:00:00Z', temperature: 5 },
    { datetime: '2026-11-01T07:00:00Z', temperature: 6 },
  ];
  const items = forecastItems(entries, 'hourly', state, Date.parse('2026-11-01T05:30:00Z'), 12, 'America/Chicago'),
    [, first, second] = items;
  assert.equal(items.length, 3);
  assert.ok(first && second);
  assert.notEqual(first.time, second.time);
});
test('precipitation amounts never masquerade as probability and missing values never become zero', () => {
  assert.equal(rainMetric([{ precipitation: 0 }]), 'precipitation');
  assert.equal(rainMetric([{ precipitation_probability: 0 }]), 'precipitation_probability');
  assert.equal(weatherNumber(null, 'en'), '—');
  assert.equal(weatherNumber(undefined, 'en'), '—');
  assert.equal(weatherNumber(0, 'en'), '0');
  assert.equal(weatherNumber(0.02, 'en', 2), '0.02');
  assert.equal(windDirection(0), 'N');
  assert.equal(windDirection(360), 'N');
  assert.equal(windDirection('SSW'), 'SSW');
  assert.equal(windDirection(undefined), '');
});
test('scenery follows actual conditions and solar state, with an unavailable fallback', () => {
  assert.deepEqual(sceneCondition(state, undefined), { condition: 'clear-night', night: true });
  assert.deepEqual(sceneCondition({ state: 'partlycloudy' }, { state: 'below_horizon' }), {
    condition: 'partlycloudy',
    night: true,
  });
  assert.equal(sceneCondition({ state: 'unavailable' }, undefined).condition, 'unavailable');
  assert.equal(sceneCondition({ state: 'sunny' }, { state: 'below_horizon' }).night, true, 'sunny after dark');
  assert.equal(sceneCondition({ state: 'sunny' }, { state: 'above_horizon' }).night, false);
});
test('daily rows combine twice-daily periods, skip past dates and honor the requested count', () => {
  const input = [
    { datetime: '2026-10-20T17:00:00Z', temperature: 80, templow: 50 },
    { datetime: '2026-10-21T12:00:00Z', temperature: 74, is_daytime: true, condition: 'sunny' },
    { datetime: '2026-10-21T23:00:00Z', temperature: 47, is_daytime: false, condition: 'clear-night' },
    { datetime: '2026-10-22T17:00:00Z', temperature: 76, templow: 51 },
  ];
  const days = dailyItems(input, now, 'America/Chicago', { condition: 'rainy', night: true }, 2),
    [today, tomorrow] = days;
  assert.equal(days.length, 2);
  assert.ok(today && tomorrow);
  assert.equal(today.today, true);
  assert.equal(today.condition, 'sunny');
  assert.equal(today.high, 74);
  assert.equal(today.low, 47);
  assert.equal(tomorrow.today, false);
  assert.deepEqual(today.sky, { condition: 'rainy', night: true }, 'today shows the weather now');
});
test('a day told by day and night takes the low of the night before it, and today the lowest hour left', () => {
  const zone = 'America/Chicago',
    morning = Date.parse('2026-10-21T15:00:00Z'),
    entries = [
      { datetime: '2026-10-21T13:00:00Z', temperature: 70, is_daytime: true },
      { datetime: '2026-10-21T23:00:00Z', temperature: 50, is_daytime: false },
      { datetime: '2026-10-22T13:00:00Z', temperature: 72, is_daytime: true },
      { datetime: '2026-10-22T23:00:00Z', temperature: 55, is_daytime: false },
      { datetime: '2026-10-23T13:00:00Z', temperature: 74, is_daytime: true },
      { datetime: '2026-10-23T23:00:00Z', temperature: 60, is_daytime: false },
    ],
    lows = (rest: { low?: number }) => dailyItems(entries, morning, zone, rest, 3).map(day => [day.high, day.low]);
  assert.deepEqual(lows({ low: 58 }), [
    [70, 58],
    [72, 50],
    [74, 55],
  ]);
  assert.equal(lows({})[0]?.[1], 50, 'with no hours to go by, today keeps tonight’s');
  const small = [{ datetime: '2026-10-21T07:00:00Z', temperature: 48, is_daytime: false }, ...entries];
  assert.equal(dailyItems(small, morning, zone, { low: 58 }, 1)[0]?.low, 48, 'a night under way is today’s own');
});
test('every day but today shows the day form, whatever its forecast entry is', () => {
  const noon = (date: string) => `2026-10-${date}T17:00:00Z`;
  const days = dailyItems(
    [
      { datetime: noon('21'), condition: 'sunny' },
      // A daily forecast made after dark, and a day with only its night left to it.
      { datetime: noon('22'), condition: 'clear-night' },
      { datetime: noon('23'), condition: 'cloudy', is_daytime: false },
    ],
    now,
    'America/Chicago',
    { condition: 'clear-night', night: true },
  );
  assert.deepEqual(
    days.map(day => day.sky),
    [
      { condition: 'clear-night', night: true },
      { condition: 'clear-night', night: false },
      { condition: 'cloudy', night: false },
    ],
  );
  assert.deepEqual(dailyItems([{ datetime: noon('21'), condition: 'sunny' }], now, 'America/Chicago', {})[0]?.sky, {
    condition: 'sunny',
    night: false,
  });
});
test('daily range bars share one temperature scale and only today gets the actual-temperature marker', () => {
  const items = [
    { low: 47, high: 74, today: true },
    { low: 51, high: 76 },
    { low: null, high: 73 },
  ];
  const bars = temperatureRange(items, '°F', 51),
    [first, second, third] = bars;
  assert.ok(first && second);
  assert.equal(first.left, 0);
  assert.equal(first.width, (27 / 29) * 100);
  // Today's reading as a share of today's own range, which keeps its dot inside the bar.
  assert.equal(first.current, 4 / 27);
  assert.equal(second.left, (4 / 29) * 100);
  assert.equal(second.current, null);
  assert.equal(third, null);
  const [still] = temperatureRange([{ low: 0, high: 0, today: true }], '°C', 0);
  assert.ok(still);
  assert.equal(still.current, 0.5);
  assert.equal(temperatureRange([{ low: 2, high: 0 }], '°C', 0)[0], null);
});
test('today’s bar blends the scale plainly, and every other day’s in OKLab', () => {
  const [today, other] = temperatureRange(
    [
      { low: 56, high: 69, today: true },
      { low: 56, high: 69 },
      { low: 48, high: 70 },
    ],
    '°F',
    60,
  );
  assert.ok(today && other);
  assert.equal(today.space, 'srgb');
  assert.equal(other.space, 'oklab');
  // Both run the same stretch of the scale, and today's stays the stronger between its stops.
  assert.match(rangeStyles(today).fill, /linear-gradient\(90deg in srgb,#b8d060 0%,#f3cd10 100%\)/);
  assert.match(rangeStyles(other).fill, /linear-gradient\(90deg in oklab,#c3d389 0%,#f5ce38 100%\)/);
});
test('forecast subscriptions are reused on state updates and are cleaned up on disconnect', async () => {
  const calls: { callback: (message: unknown) => void; message: ForecastSubscription }[] = [],
    stops: string[] = [],
    stream = new WeatherForecast(() => {});
  const connection: Connection = {
    subscribeMessage(callback, message) {
      calls.push({ callback, message });
      return Promise.resolve(() => stops.push(message.forecast_type));
    },
  };
  stream.update(connection, 'weather.home', ['hourly', 'daily']);
  await settle();
  stream.update(connection, 'weather.home', ['hourly', 'daily']);
  await settle();
  assert.equal(calls.length, 2);
  const [first] = calls;
  assert.ok(first);
  first.callback({ forecast: [{ temperature: 1 }] });
  assert.equal(stream.data.hourly?.forecast[0]?.temperature, 1);
  stream.stop();
  await settle();
  assert.deepEqual(stops, ['hourly', 'daily']);
  first.callback({ forecast: [{ temperature: 99 }] });
  assert.deepEqual(stream.data, {});
});
test('late subscription resolutions and old entity events cannot leak into a new weather card', async () => {
  const pending: { callback?: (message: unknown) => void; resolve?: (stop: Unsubscribe) => void } = {};
  let stopped = 0;
  const old: Connection = {
    subscribeMessage(callback) {
      pending.callback = callback;
      return new Promise<Unsubscribe>(resolve => {
        pending.resolve = resolve;
      });
    },
  };
  const next: Connection = {
    subscribeMessage(callback) {
      callback({ forecast: [{ temperature: 3 }] });
      return Promise.resolve(() => {});
    },
  };
  const stream = new WeatherForecast(() => {});
  stream.update(old, 'weather.old', ['hourly']);
  await settle();
  stream.update(next, 'weather.new', ['hourly']);
  await settle();
  assert.ok(pending.callback && pending.resolve);
  pending.callback({ forecast: [{ temperature: 90 }] });
  pending.resolve(() => {
    stopped++;
  });
  await settle();
  assert.equal(stopped, 1);
  assert.equal(stream.data.hourly?.forecast[0]?.temperature, 3);
  stream.stop();
});
test('a forecast that failed is asked for again by itself, less and less often', async () => {
  vi.useFakeTimers();
  try {
    let calls = 0;
    const connection: Connection = {
      subscribeMessage(callback) {
        calls++;
        if (calls < 3) return Promise.reject(new Error('invalid_entity_id'));
        callback({ forecast: [{ datetime: '2026-10-27T12:00:00Z', temperature: 3 }] });
        return Promise.resolve(() => undefined);
      },
    };
    const stream = new WeatherForecast(() => {});
    stream.update(connection, 'weather.home', ['hourly']);
    await vi.advanceTimersByTimeAsync(0);
    assert.equal(stream.data.hourly?.status, 'error');
    assert.equal(calls, 1);
    await vi.advanceTimersByTimeAsync(2000);
    assert.equal(calls, 2);
    await vi.advanceTimersByTimeAsync(3999);
    assert.equal(calls, 2, 'the next wait is twice as long');
    await vi.advanceTimersByTimeAsync(1);
    assert.equal(calls, 3);
    assert.equal(stream.data.hourly.status, 'ready');
    await vi.advanceTimersByTimeAsync(3_600_000);
    assert.equal(calls, 3, 'answered, it is left alone');
    stream.stop();
  } finally {
    vi.useRealTimers();
  }
});
test('a forecast that never answers stops saying loading', async () => {
  vi.useFakeTimers();
  try {
    let stopped = 0;
    const connection: Connection = {
      subscribeMessage() {
        return Promise.resolve(() => {
          stopped++;
        });
      },
    };
    const stream = new WeatherForecast(() => {});
    stream.update(connection, 'weather.home', ['hourly']);
    await vi.advanceTimersByTimeAsync(19_999);
    assert.equal(stream.data.hourly?.status, 'loading');
    await vi.advanceTimersByTimeAsync(1);
    assert.equal(stream.data.hourly.status, 'error');
    assert.equal(stopped, 1, 'the silent subscription is let go before the next is made');
    stream.stop();
  } finally {
    vi.useRealTimers();
  }
});
test('stopping leaves nothing to ask again', async () => {
  vi.useFakeTimers();
  try {
    let calls = 0;
    const connection: Connection = {
      subscribeMessage() {
        calls++;
        return Promise.reject(new Error('unavailable'));
      },
    };
    const stream = new WeatherForecast(() => {});
    stream.update(connection, 'weather.home', ['hourly']);
    await vi.advanceTimersByTimeAsync(0);
    stream.stop();
    await vi.advanceTimersByTimeAsync(600_000);
    assert.equal(calls, 1);
  } finally {
    vi.useRealTimers();
  }
});
test('an update with nothing in it leaves the forecast showing', async () => {
  let send: (event: unknown) => void = () => undefined;
  const connection: Connection = {
    subscribeMessage(callback) {
      send = callback;
      return Promise.resolve(() => undefined);
    },
  };
  const stream = new WeatherForecast(() => {});
  stream.update(connection, 'weather.home', ['hourly']);
  await settle();
  send({ forecast: [] });
  assert.equal(stream.data.hourly?.status, 'ready', 'a first answer of nothing is an answer');
  send({ forecast: [{ datetime: '2026-10-27T12:00:00Z', temperature: 3 }] });
  send({ forecast: [] });
  assert.equal(stream.data.hourly.forecast.length, 1);
  stream.stop();
});
test('a card built again shows the last forecast at once, in its own units', async () => {
  const connection: Connection = {
    subscribeMessage(callback) {
      callback({ forecast: [{ datetime: '2026-10-27T12:00:00Z', temperature: 3 }] });
      return Promise.resolve(() => undefined);
    },
  };
  const first = new WeatherForecast(() => {});
  first.update(connection, 'weather.home', ['hourly']);
  await settle();
  first.stop();
  const doubled = (list: readonly ForecastEntry[]) => list.map(entry => ({ ...entry, temperature: 6 })),
    next = new WeatherForecast(() => {}, doubled);
  next.update({ subscribeMessage: () => new Promise(() => undefined) }, 'weather.home', ['hourly']);
  assert.equal(next.data.hourly?.status, 'loading', 'another connection keeps its own');
  next.stop();
  next.update(connection, 'weather.other', ['hourly']);
  assert.equal(next.data.hourly.status, 'loading', 'and another entity');
  next.stop();
  next.update(connection, 'weather.home', ['hourly']);
  assert.equal(next.data.hourly.status, 'ready');
  assert.equal(next.data.hourly.forecast[0]?.temperature, 6);
  next.stop();
});
test('a forecast kept too long is not shown', async () => {
  vi.useFakeTimers();
  try {
    const connection: Connection = {
      subscribeMessage(callback) {
        callback({ forecast: [{ datetime: '2026-10-27T12:00:00Z', temperature: 3 }] });
        return Promise.resolve(() => undefined);
      },
    };
    const first = new WeatherForecast(() => {});
    first.update(connection, 'weather.home', ['hourly']);
    await vi.advanceTimersByTimeAsync(0);
    first.stop();
    await vi.advanceTimersByTimeAsync(300_000);
    const next = new WeatherForecast(() => {});
    next.update(connection, 'weather.home', ['hourly']);
    assert.equal(next.data.hourly?.status, 'loading');
    next.stop();
  } finally {
    vi.useRealTimers();
  }
});
test('a hidden page holds no subscription, and keeps what it was showing', async () => {
  let live = 0,
    made = 0;
  const connection: Connection = {
    subscribeMessage(callback) {
      live++;
      made++;
      callback({ forecast: [{ datetime: '2026-10-27T12:00:00Z', temperature: made }] });
      return Promise.resolve(() => {
        live--;
      });
    },
  };
  const stream = new WeatherForecast(() => {});
  stream.update(connection, 'weather.home', ['hourly', 'daily']);
  await settle();
  assert.equal(live, 2);
  stream.suspend();
  await settle();
  assert.equal(live, 0);
  assert.equal(stream.data.hourly?.status, 'ready');
  stream.update(connection, 'weather.home', ['hourly', 'daily']);
  await settle();
  assert.equal(live, 0, 'a state change while hidden asks for nothing');
  stream.resume();
  await settle();
  assert.equal(live, 2);
  assert.equal(made, 4);
  stream.stop();
  await settle();
  assert.equal(live, 0);
});
test('subscription errors remain visible without retrying on every HA state change', async () => {
  let calls = 0;
  const connection: Connection = {
    subscribeMessage() {
      calls++;
      return Promise.reject(new Error('unavailable'));
    },
  };
  const stream = new WeatherForecast(() => {});
  stream.update(connection, 'weather.home', ['hourly']);
  await settle();
  assert.equal(stream.data.hourly?.status, 'error');
  stream.update(connection, 'weather.home', ['hourly']);
  await settle();
  assert.equal(calls, 1);
  stream.stop();
  stream.update(connection, 'weather.home', ['hourly']);
  await settle();
  assert.equal(calls, 2);
  stream.stop();
});
test('a removed card cancels subscriptions before they start and connection replacements resubscribe', async () => {
  let calls = 0;
  const connection: Connection = {
    subscribeMessage() {
      calls++;
      return Promise.resolve(() => {});
    },
  };
  const stream = new WeatherForecast(() => {});
  stream.update(connection, 'weather.home', ['hourly']);
  stream.stop();
  await settle();
  assert.equal(calls, 0);
  stream.update(connection, 'weather.home', ['hourly']);
  await settle();
  stream.update({ ...connection }, 'weather.home', ['hourly']);
  await settle();
  assert.equal(calls, 2);
  stream.stop();
});

test('weather and lunar position determine what the scene draws', async () => {
  const {
    scenePreset,
    moonPhase,
    moonAltitude,
    moonTilt,
    skyMoonPhase,
    lightningBolt,
    cloudFlash,
    windMetersPerSecond,
  } = await import('../src/sky/sky.ts');
  const storm = scenePreset({ condition: 'lightning-rainy', elevation: 30 });
  assert.ok(storm.lightning && storm.rain > 0 && !storm.sun);
  assert.equal(scenePreset({ condition: 'clear-night', night: true, elevation: -30, moonAltitude: 30 }).moon, true);
  assert.equal(scenePreset({ condition: 'clear-night', night: true, elevation: -30, moonAltitude: -5 }).moon, false);
  assert.equal(scenePreset({ condition: 'clear-night', night: true, elevation: -30 }).moon, false);
  // Only clear of the horizon's haze, only with the sun low, and never as a new moon.
  assert.equal(scenePreset({ condition: 'clear-night', night: true, elevation: -30, moonAltitude: 8 }).moon, false);
  assert.equal(scenePreset({ condition: 'sunny', elevation: 20, moonAltitude: 30 }).moon, false);
  assert.equal(scenePreset({ condition: 'sunny', elevation: 5, moonAltitude: 30 }).moon, true);
  assert.equal(scenePreset({ condition: 'cloudy', elevation: -1, moonAltitude: 30, cloudCover: 75 }).moon, true);
  assert.equal(scenePreset({ condition: 'cloudy', elevation: -1, moonAltitude: 30 }).moon, false);
  assert.equal(
    scenePreset({ condition: 'clear-night', night: true, elevation: -30, moonAltitude: 30, moonPhase: 0 }).moon,
    false,
  );
  assert.equal(
    scenePreset({ condition: 'clear-night', night: true, elevation: -30, moonAltitude: 30, moonPhase: 0.1 }).moon,
    true,
  );
  assert.ok(scenePreset({ condition: 'clear-night', night: true }).stars > 0.5);
  const [covered] = scenePreset({ condition: 'sunny', cloudCover: 60 }).clouds,
    [clear] = scenePreset({ condition: 'sunny', cloudCover: 0 }).clouds;
  assert.ok(covered !== undefined && clear !== undefined && covered > clear);
  assert.ok(
    scenePreset({ condition: 'rainy', windSpeed: 12 }).windAngle >
      scenePreset({ condition: 'rainy', windSpeed: 0 }).windAngle,
  );
  assert.equal(scenePreset({ condition: 'bogus' }).condition, 'bogus');
  assert.ok(Math.abs(moonPhase(Date.UTC(2000, 0, 6, 18, 14))) < 0.001);
  assert.ok(Math.abs(moonPhase(Date.UTC(2026, 9, 26, 4, 12)) - 0.5) < 0.03, 'Oct 2026 full moon');
  // The sky's moon is one of 28 pictures: full within 24° of full, new beyond 156°.
  assert.equal(skyMoonPhase(0.5), 0.5);
  assert.equal(skyMoonPhase(0.47), 0.5, 'a day before full still shows full');
  assert.equal(skyMoonPhase(0.53), 0.5, 'a day after full still shows full');
  assert.equal(skyMoonPhase(0.4), 13 / 28, '36° from full: the first step out, waxing');
  assert.equal(skyMoonPhase(0.25), 7 / 28, 'first quarter');
  assert.equal(skyMoonPhase(0.75), 21 / 28, 'last quarter');
  assert.equal(skyMoonPhase(0.02), 0, 'a thin crescent shows new');
  assert.equal(skyMoonPhase(0.98), 0);
  const shape = { reach: 25, roughness: 10, branches: 3, spread: 25 };
  assert.deepEqual(lightningBolt(7, shape), lightningBolt(7, shape));
  const [main, ...branches] = lightningBolt(7, shape),
    [top] = main?.points ?? [],
    foot = main?.points.at(-1);
  assert.equal(main?.points.length, 129);
  assert.equal(branches.length, 3);
  // The bolt lands on the other side of the middle from where it leaves the clouds.
  assert.ok(top && foot && top[0] * foot[0] < 0 && Math.abs(foot[0]) >= 3);
  // The light behind the clouds keeps its own two-second clock: never at zero odds, always at
  // full odds, dark as each two seconds turn over, and up in the sky.
  assert.equal(cloudFlash(13.4, 0), null);
  assert.equal(cloudFlash(14, 1)?.value, 0);
  const lit = cloudFlash(14.36, 1);
  assert.ok(lit && lit.value > 1.9 && lit.y >= 10 && lit.y <= 45 && Math.abs(lit.x) <= 20);
  const evening = moonAltitude(Date.UTC(2026, 9, 21, 2), 38.6, -90.2),
    dawnAltitude = moonAltitude(Date.UTC(2026, 9, 21, 9), 38.6, -90.2);
  assert.ok(evening !== undefined && evening > 20, 'waxing moon up in the evening');
  assert.ok(dawnAltitude !== undefined && dawnAltitude < 0, 'set before dawn');
  assert.equal(moonAltitude(0, undefined, undefined), undefined);
  // Evening waxing gibbous over St. Louis is lit on its right; Sydney sees it mirrored.
  const tilt = moonTilt(Date.UTC(2026, 9, 22, 2), 38.6, -90.2);
  assert.ok(tilt !== undefined && Math.abs(tilt) < Math.PI / 4, 'lit side faces right');
  const south = moonTilt(Date.UTC(2026, 9, 21, 10), -33.9, 151.2);
  assert.ok(south !== undefined && Math.abs(south) > (Math.PI * 3) / 4, 'southern hemisphere lit side faces left');
  assert.equal(moonTilt(0, undefined, undefined), undefined);
  // A day past full the face turns with the Moon's axis: high in the west over Mumbai it
  // leans about 119° clockwise, low in the west over Tokyo at dawn about 72°.
  const turn = (latitude: number, longitude: number) =>
    ((moonTilt(Date.UTC(2026, 9, 27, 21, 30), latitude, longitude) ?? Number.NaN) * 180) / Math.PI;
  assert.ok(Math.abs(turn(19.08, 72.88) - 119) < 3, 'Mumbai');
  assert.ok(Math.abs(turn(35.68, 139.69) - 72) < 3, 'Tokyo');
  assert.ok(Math.abs(windMetersPerSecond(10, 'mph') - 4.4704) < 1e-9);
  assert.equal(windMetersPerSecond(undefined, 'mph'), 0);
  assert.ok(Math.abs(windMetersPerSecond(4, 'Beaufort') - 6.688) < 0.01);
});
test('scene inputs read sun elevation, cloud cover and wind in meters per second', async () => {
  const { sceneInputs } = await import('../src/weather/conditions.ts');
  const inputs = sceneInputs(
    { state: 'clear-night', attributes: { cloud_coverage: 0.8, wind_speed: 3.6, wind_speed_unit: 'km/h' } },
    { state: 'below_horizon', attributes: { elevation: -56.9, rising: true } },
  );
  assert.equal(inputs.night, true);
  assert.equal(inputs.elevation, -56.9);
  assert.equal(inputs.cloudCover, 0.8);
  assert.ok(inputs.windSpeed !== undefined && Math.abs(inputs.windSpeed - 1) < 1e-9);
  assert.equal(sceneInputs({ state: 'sunny', attributes: {} }, undefined).elevation, undefined);
});
test('scene inputs read the dew point now in °C', async () => {
  const { sceneInputs } = await import('../src/weather/conditions.ts');
  const own = sceneInputs({ state: 'cloudy', attributes: { dew_point: 50, temperature_unit: '°F' } }, undefined);
  assert.ok(own.dewPoint !== undefined && Math.abs(own.dewPoint - 10) < 1e-9);
  // An hour's is already among the readings now where it should be (see readingsNow), so the sky
  // takes none of its own.
  const at = Date.parse('2026-10-31T06:20:00Z'),
    hour = [{ datetime: '2026-10-31T06:00:00Z', dew_point: 41 }];
  assert.equal(
    sceneInputs({ state: 'cloudy', attributes: { temperature_unit: '°F' } }, undefined, {}, at, hour).dewPoint,
    undefined,
  );
  assert.equal(sceneInputs({ state: 'cloudy', attributes: {} }, undefined).dewPoint, undefined);
});

test('temperature bar colors read Celsius, Fahrenheit and Kelvin alike', () => {
  const day = [{ low: 10, high: 25, today: false }],
    asF = [{ low: 50, high: 77, today: false }],
    asK = [{ low: 283.15, high: 298.15, today: false }];
  const [c] = temperatureRange(day, '°C', undefined),
    [f] = temperatureRange(asF, '°F', undefined),
    [k] = temperatureRange(asK, 'K', undefined);
  assert.ok(c && f && k);
  assert.deepEqual(f.gradient, c.gradient);
  assert.deepEqual(k.gradient, c.gradient);
});

test('weather text follows the HA language with regional and English fallbacks', async () => {
  const { weatherText, weatherLanguage, textTable, KEYS } = await import('../src/weather/i18n.ts');
  for (const [code, values] of Object.entries(textTable))
    assert.equal(values.length, KEYS.length, `${code} has every string`);
  for (const [code, values] of Object.entries(textTable)) {
    assert.ok(values[KEYS.indexOf('last_updated')]?.includes('{time}'), `${code} says when`);
    assert.ok(values[KEYS.indexOf('weather_for')]?.includes('{place}'), `${code} says where`);
  }
  assert.equal(weatherText('de')('conditions'), 'Bedingungen');
  assert.equal(weatherText('pt-BR')('retry'), 'Tentar novamente');
  assert.equal(weatherLanguage('zh-TW'), 'zh-Hant');
  assert.equal(weatherLanguage('zh-Hans'), 'zh-Hans');
  assert.equal(weatherLanguage('zh-Hant-TW'), 'zh-Hant');
  assert.equal(weatherLanguage('zh-Hans-HK'), 'zh-Hans');
  assert.equal(weatherLanguage('zh-Latn-TW'), 'zh-Hant');
  assert.equal(weatherLanguage('nn'), 'nb');
  assert.equal(weatherText('xx')('conditions'), 'Conditions');
  assert.equal(weatherText('en').today, 'Today');
  assert.equal(weatherText('en').now, 'Now');
  assert.equal(weatherText('de').today, 'Heute');
  assert.equal(windDirection(90, weatherText('de').compass), 'O');
  assert.equal(windDirection(90), 'E');
});

test('precipitation and wind detail follow their thresholds, day segments and sun events', async () => {
  const { precipitationIntensity, precipitationAmount } = await import('../src/weather/precipitation.ts');
  const { withSunEvents } = await import('../src/weather/forecast-items.ts');
  const { dailyDetail } = await import('../src/cards/forecast/day-detail.ts');
  assert.equal(precipitationIntensity(0, 'mm'), 0);
  assert.ok(precipitationIntensity(1, 'mm') < 1 / 3);
  assert.ok(precipitationIntensity(5, 'mm') > 1 / 3 && precipitationIntensity(5, 'mm') < 2 / 3);
  assert.ok(precipitationIntensity(0.5, 'in') > 2 / 3);
  assert.equal(precipitationAmount(0.05, 'in', 'en'), '.05″');
  assert.equal(precipitationAmount(0, 'in', 'en'), '0″');
  assert.equal(precipitationAmount(1.5, 'in', 'de'), '1,5″');
  const hourly = [0, 1, 13, 14].map(hour => ({
    datetime: `2026-10-21T${String(hour).padStart(2, '0')}:00:00Z`,
    precipitation: hour === 13 ? 0.1 : 0,
    wind_speed: hour + 1,
    wind_gust_speed: hour === 14 ? 20 : undefined,
  }));
  const day = dailyDetail(hourly, [{ time: Date.UTC(2026, 9, 21, 12), today: false }], 'UTC').get('2026-10-21');
  assert.ok(day);
  const { segments } = day,
    [night, , , dawn, , , afternoon] = segments;
  assert.equal(segments.length, 12);
  assert.ok(night && dawn && afternoon);
  assert.equal(afternoon.amount, 0.1);
  assert.equal(dawn.amount, null);
  assert.equal(afternoon.day, true);
  assert.equal(night.day, false);
  assert.equal(day.range, null, 'four hours is too little for a daily chart');
  assert.equal(segments.at(7)?.speed, 15);
  assert.equal(segments.at(7)?.gust, 20);
  assert.ok(Math.abs(day.total - 0.1) < 1e-9);
  const items = [
    { time: Date.UTC(2026, 9, 21, 11) },
    { time: Date.UTC(2026, 9, 21, 12) },
    { time: Date.UTC(2026, 9, 21, 13) },
  ];
  const merged = withSunEvents(items, {
    attributes: { next_rising: '2026-10-21T12:16:00Z', next_setting: '2026-10-21T23:14:00Z' },
  });
  assert.equal(merged.length, 4);
  assert.equal(merged[2]?.sun, 'sunrise');
  assert.equal(withSunEvents(items, undefined).length, 3);
  // Hours that start between a sunset and the next sunrise are night, whatever their
  // condition: 6 PM before a 6:05 sunset is day, 7 PM night, 7 AM before a 7:24 sunrise night.
  const day24 = Array.from({ length: 24 }, (_, i) => ({
      time: Date.UTC(2026, 9, 28, 19 + i),
      condition: 'partlycloudy',
    })),
    marked = withSunEvents(day24, {
      attributes: { next_rising: '2026-10-29T12:24:48Z', next_setting: '2026-10-28T23:05:08Z' },
    }),
    nightAt = (utc: number) => marked.find(item => !item.sun && item.time === Date.UTC(2026, 9, 28, utc))?.night;
  assert.deepEqual(
    marked.filter(item => item.sun).map(item => item.sun),
    ['sunset', 'sunrise'],
  );
  assert.equal(nightAt(23), false, '6 PM');
  assert.equal(nightAt(24), true, '7 PM');
  assert.equal(nightAt(36), true, '7 AM');
  assert.equal(nightAt(37), false, '8 AM');
  // Near the poles the next sunrise can be weeks away: no hour is marked.
  const polar = withSunEvents(day24, {
    attributes: { next_rising: '2026-12-20T12:00:00Z', next_setting: '2026-12-20T09:00:00Z' },
  });
  assert.ok(polar.every(item => item.night === undefined));
  const full = dailyDetail(
    Array.from({ length: 24 }, (_, hour) => ({
      datetime: `2026-10-22T${String(hour).padStart(2, '0')}:00:00Z`,
      wind_speed: hour % 5,
    })),
    [{ time: Date.UTC(2026, 9, 22, 12), today: false }],
    'UTC',
  ).get('2026-10-22');
  assert.ok(full);
  assert.deepEqual(full.range, [0, 4]);
});

test('scene changes ease in while animating and settle at once in a still frame', async () => {
  const { WeatherScene } = await import('../src/sky/scene.ts');
  const { scenePreset } = await import('../src/sky/sky.ts');
  const scene = new WeatherScene(null);
  scene.preset = scenePreset({ condition: 'cloudy' });
  scene.advance(1000);
  const rainy = scenePreset({ condition: 'rainy' });
  scene.preset = rainy;
  const early = scene.advance(1100).rain;
  assert.ok(early > 0 && early < rainy.rain * 0.3, 'rain starts with a few drops');
  assert.ok(scene.ramping);
  let level = early;
  for (let time = 1200; time < 6000; time += 100) level = scene.advance(time).rain;
  assert.equal(level, rainy.rain);
  assert.equal(scene.ramping, false);
  scene.preset = scenePreset({ condition: 'sunny' });
  assert.ok(scene.advance(6100).rain > 0, 'stopping rain tapers off');
  assert.equal(scene.advance(0).rain, 0, 'a still frame cuts straight to the new scene');
});

// The editor: sections appear where they apply, and the settings keep only what was chosen.
test('the editor shows what applies and writes only what differs from the defaults', async () => {
  const { schemaFor, formData, configFrom, contextOf, filled } = await import('../src/card/editor-schema.ts');
  type Items = ReturnType<typeof schemaFor>;
  const titles = (context: Parameters<typeof schemaFor>[0]) =>
    schemaFor(context).flatMap(item => (item.title ? [item.title] : []));
  for (const title of ['Full page', 'Map and online services', 'Alerts and sensors']) {
    assert.equal(titles({ layout: 'auto' }).includes(title), false, title);
    assert.ok(titles({ layout: 'page' }).includes(title), title);
  }
  const page = (context: Parameters<typeof schemaFor>[0]) => JSON.stringify(schemaFor({ layout: 'page', ...context }));
  assert.equal(page({ averages: 'open-meteo' }).includes('averages_sensor'), false);
  assert.ok(page({ averages: 'sensor' }).includes('averages_sensor'));
  assert.equal(page({ map: 'none' }).includes('map_tile_url'), false);
  assert.ok(page({ map: 'local' }).includes('"name":"map_layers"'));
  // The form shows every default; the settings drop them again.
  const config = { type: 'custom:iweather-card', entity: 'weather.home', weather_layout: 'page' };
  const data = formData(config);
  assert.equal(data['forecast_hours'], 24);
  assert.equal(data['averages_source'], 'none');
  assert.deepEqual(configFrom(data), config);
  // Every choice shows a value on a new card rather than an empty box, and none is starred as
  // required: buttons show no star, and a dropdown's × puts its default back.
  const selects = (items: Items): { name: string; mode: string; required: boolean; columns?: number }[] =>
    items.flatMap(item => [
      ...(item.selector && 'select' in item.selector && item.selector.select.multiple !== true
        ? [
            {
              name: item.name,
              mode: item.selector.select.mode,
              required: item.required === true,
              ...(item.selector.select.box_max_columns === undefined
                ? {}
                : { columns: item.selector.select.box_max_columns }),
            },
          ]
        : []),
      ...selects(item.schema ?? []),
    ]);
  const full = selects(schemaFor({ layout: 'page', averages: 'sensor', map: 'local' }));
  assert.ok(full.some(({ mode }) => mode === 'dropdown'));
  for (const { name, mode, required } of full) {
    assert.notEqual(data[name], undefined, `${name} shows a value`);
    assert.equal(required, mode === 'box', `${name} is required only as buttons`);
    if (mode === 'dropdown') {
      assert.equal(filled({ ...data, [name]: undefined })[name], data[name], `${name} shows its default again`);
      assert.equal(filled({ ...data, [name]: '' })[name], data[name], `${name} shows its default again`);
    }
  }
  // Three choices stand side by side, two to a row where the editor is narrow; four, two by two.
  const columns = (narrow: boolean) =>
    Object.fromEntries(
      selects(schemaFor({ layout: 'page', narrow })).flatMap(({ name, columns: n }) =>
        n === undefined ? [] : [[name, n]],
      ),
    );
  assert.deepEqual(columns(false), { weather_layout: 2, weather_mode: 2, size: 3, sheet_style: 3, haptics: 3 });
  assert.deepEqual(columns(true), { weather_layout: 2, weather_mode: 2, size: 2, sheet_style: 2, haptics: 2 });
  // Averages as a source and a sensor; overlays without the blanks.
  assert.deepEqual(configFrom({ ...data, averages_source: 'open-meteo' })['averages'], 'open-meteo');
  assert.equal(configFrom({ ...data, averages_source: 'sensor' })['averages'], undefined);
  assert.equal(
    configFrom({ ...data, averages_source: 'sensor', averages_sensor: 'sensor.outside' })['averages'],
    'sensor.outside',
  );
  assert.equal(formData({ ...config, averages: 'sensor.outside' })['averages_sensor'], 'sensor.outside');
  assert.deepEqual(
    configFrom({ ...data, map: 'local', map_layers: { wind: 'https://t/{z}/{x}/{y}.png', temperature: '' } })[
      'map_layers'
    ],
    { wind: 'https://t/{z}/{x}/{y}.png' },
  );
  // A sensor still to be chosen keeps its field showing.
  assert.equal(contextOf({ ...data, averages_source: 'sensor' }, undefined).averages, 'sensor');
});

// The preview shows the part of the card a setting changes while it is edited (see editing.ts).
test('every field says which part of the card it changes, unless it changes the whole', () => {
  type Item = (typeof SCHEMA)[number];
  const fields = (items: readonly Item[]): Item[] =>
    items.flatMap(item => (item.type ? fields(item.schema ?? []) : [item]));
  // The overlays' fields go by their section's part, the map.
  assert.deepEqual(
    fields(SCHEMA)
      .filter(item => partsOf(item).length === 0)
      .map(item => item.name)
      .toSorted(),
    [
      'air_quality',
      'entity',
      'forecast_refresh_minutes',
      'haptics',
      'local_only',
      'open_meteo_forecast',
      'precipitation',
      'radar_refresh_minutes',
      'temperature',
      'weather_layout',
      'wind',
      'zone',
    ],
  );
  const section = (title: string) => SCHEMA.find(item => item.title === title);
  assert.deepEqual(partsOf(section('Alerts and sensors')), ['alerts', 'next_hour', 'air_quality', 'averages']);
  assert.deepEqual(partsOf(section('Map and online services')), ['map']);
  assert.deepEqual(partsOf(section('Full page')), ['tiles', 'conditions']);
});

test('a page of the hourly strip is a viewport, and goes to the end rather than stop just short', () => {
  // 1000 wide, 2600 to scroll, gaps of 35.
  const page = (forward: boolean, from: number) => pageTarget(forward, from, 1000, 2600, 35);
  assert.equal(page(true, 0), 1000);
  assert.equal(page(true, 1000), 2000);
  assert.equal(page(false, 2000), 1000);
  // A press on the way carries on from where the last was headed.
  assert.equal(page(true, page(true, 0)), 2000);
  // Past either end it stops there; within a gap of one, it goes there.
  assert.equal(page(true, 2000), 2600);
  assert.equal(page(true, 1565), 2565);
  assert.equal(page(true, 1565.1), 2600);
  assert.equal(page(false, 900), 0);
  assert.equal(page(false, 1034), 0);
  assert.equal(page(false, 1035), 35);
});

test("a night's temperature is no high", () => {
  const evening = Date.parse('2026-01-15T23:00:00Z'),
    tonight = { datetime: '2026-01-16T00:00:00Z', temperature: 45, is_daytime: false };
  assert.deepEqual(todayRange([tonight], evening, 'America/Chicago'), { high: null, low: 45 });
  const day = { ...tonight, datetime: '2026-01-15T18:00:00Z', temperature: 61, is_daytime: true };
  assert.deepEqual(todayRange([day, tonight], evening, 'America/Chicago'), { high: 61, low: 45 });
});

test('the full page asks for both forecasts, whatever its panels show', () => {
  const hidden = { show_forecast: false, show_daily: false, show_high_low: false };
  assert.deepEqual(forecastTypes(3, hidden), []);
  assert.deepEqual(forecastTypes(3, { ...hidden, weather_layout: 'page' }), ['hourly', 'daily']);
  assert.deepEqual(forecastTypes(5, { ...hidden, weather_layout: 'page' }), ['daily']);
});
test('an entity with only hours has its days made from them', () => {
  const now = Date.parse('2026-10-27T15:00:00Z'),
    timeZone = 'UTC',
    hour = (at: string, temperature: number, condition: string, more: ForecastEntry = {}): ForecastEntry => ({
      datetime: at,
      temperature,
      condition,
      ...more,
    }),
    whole = Array.from({ length: 24 }, (_, i) =>
      hour(`2026-10-28T${String(i).padStart(2, '0')}:00:00Z`, 40 + i, i < 6 ? 'clear-night' : 'sunny', {
        precipitation: 0.1,
        precipitation_probability: i,
        wind_speed: i,
      }),
    ),
    days = daysFromHours(
      [
        hour('2026-10-27T15:00:00Z', 60, 'cloudy'),
        hour('2026-10-27T16:00:00Z', 62, 'rainy'),
        hour('2026-10-27T17:00:00Z', 58, 'cloudy'),
        ...whole,
        hour('2026-10-29T00:00:00Z', 50, 'sunny'),
      ],
      now,
      timeZone,
    );
  assert.equal(days.length, 2, 'a day with only an hour left in the forecast says too little');
  assert.deepEqual(
    [days[0]?.temperature, days[0]?.templow, days[0]?.condition],
    [62, 58, 'rainy'],
    "today's hours, its wettest sky",
  );
  assert.deepEqual([days[1]?.temperature, days[1]?.templow], [63, 40]);
  assert.equal(days[1]?.condition, 'sunny', 'clear nights count as the day form of their sky');
  assert.ok(Math.abs((days[1].precipitation ?? 0) - 2.4) < 1e-9, 'amounts add up');
  assert.equal(days[1].precipitation_probability, 23, 'chances take the highest');
  assert.equal(days[1].wind_speed, 23);
  assert.equal('uv_index' in days[1], false, 'and nothing is made up');
});
test('days come from hours only where nothing else will bring them', () => {
  const hours = { status: 'ready' as const, forecast: [{ datetime: '2026-10-27T15:00:00Z', temperature: 3 }] },
    now = Date.parse('2026-10-27T15:00:00Z'),
    made = (data: ForecastData, awaited = false) => withHourlyDays(data, awaited, now, 'UTC');
  assert.equal(made({ hourly: hours }).daily?.forecast.length, 1);
  assert.equal(made({ hourly: hours }, true).daily, undefined, 'days are on their way from elsewhere');
  const loading = { status: 'loading' as const, forecast: [] };
  assert.equal(made({ hourly: hours, daily: loading }).daily, loading, 'or from the entity');
  const failed = { status: 'error' as const, forecast: [] };
  assert.equal(made({ hourly: hours, daily: failed }).daily?.forecast.length, 1, 'but not if they failed');
  const twice = { status: 'ready' as const, forecast: hours.forecast };
  assert.equal(made({ hourly: hours, twice_daily: twice }).daily, undefined);
});
test('days made from hours follow new readings, local midnight and the configured zone', () => {
  const entry = { datetime: '2026-11-01T04:30:00Z', temperature: 12 },
    now = Date.parse(entry.datetime),
    hourly = { status: 'ready' as const, forecast: [entry] },
    days = (time: number, zone: string) => withHourlyDays({ hourly }, false, time, zone).daily,
    daily = days(now, 'America/Chicago');
  assert.equal(daily?.forecast[0]?.temperature, 12);
  assert.equal(days(now + MINUTE, 'America/Chicago'), daily);
  assert.equal(days(now + HOUR, 'America/Chicago')?.forecast.length, 0);
  assert.equal(days(now + HOUR, 'UTC')?.forecast.length, 1);
  const changed = { ...hourly, forecast: [{ ...entry, temperature: 0 }] };
  assert.equal(withHourlyDays({ hourly: changed }, false, now, 'UTC').daily?.forecast[0]?.temperature, 0);
});
test('an entity with only hours is asked for them when only days are shown', () => {
  const config = { show_forecast: false, show_daily: true, show_high_low: false };
  assert.deepEqual(forecastTypes(2, config), ['hourly']);
  assert.deepEqual(forecastTypes(3, config), ['daily']);
  assert.deepEqual(forecastTypes(2, { ...config, show_daily: false }), []);
});
test('a card saved with an older setting loads as it was set', () => {
  const card = { type: 'custom:iweather-card', entity: 'weather.home' };
  assert.deepEqual(normalizeConfig({ ...card, tap_behavior: 'none' }).tap_action, { action: 'none' });
  assert.equal(normalizeConfig({ ...card, tap_behavior: 'more-info' }).tap_action, undefined);
  assert.equal(normalizeConfig({ ...card, tap_behavior: 'auto' }).tap_action, undefined);
  assert.deepEqual(
    normalizeConfig({ ...card, tap_behavior: 'none', tap_action: { action: 'toggle' } }).tap_action,
    { action: 'toggle' },
    'what was set since wins',
  );
  assert.deepEqual(configFrom(formData({ ...card, tap_behavior: 'none' })), {
    ...card,
    tap_action: { action: 'none' },
  });
  assert.throws(() => normalizeConfig({ ...card, hold_action: 'toggle' }), /hold_action must be an action/u);
});

test('a day stamped at midnight falls on the date it names, wherever the card is', async () => {
  const { namedDays, dateKey } = await import('../src/weather/forecast-items.ts');
  const day = (datetime: string, timeZone: string) => {
    const [entry] = namedDays([{ datetime }], timeZone);
    return dateKey(Date.parse(entry?.datetime ?? ''), timeZone);
  };
  // Midnight UTC is the evening before in Denver, and the next morning in Auckland.
  assert.equal(day('2026-11-03T00:00:00+00:00', 'America/Denver'), '2026-11-03');
  assert.equal(day('2026-11-03T00:00:00Z', 'Pacific/Auckland'), '2026-11-03');
  assert.equal(day('2026-11-03T00:00:00+08:00', 'America/Los_Angeles'), '2026-11-03');
  assert.equal(day('2026-11-03', 'Pacific/Kiritimati'), '2026-11-03', 'a bare date');
  // On the day the clocks change.
  assert.equal(day('2026-03-29T00:00:00Z', 'Europe/Berlin'), '2026-03-29');
  // Any other hour is a moment in its day, read where the card is.
  const [moment] = namedDays([{ datetime: '2026-11-02T22:00:00+00:00' }], 'Asia/Tokyo');
  assert.equal(moment?.datetime, '2026-11-02T22:00:00+00:00');
  const list = [{ datetime: '2026-11-02T11:00:00+00:00' }];
  assert.equal(namedDays(list, 'Europe/Zurich'), list, 'with nothing to move, the same list');
});

test('a sensor’s reading is as precise as the user has Home Assistant show it', async () => {
  const { withSensors } = await import('../src/weather/sources.ts');
  const hass = (precision?: number) => ({
    states: {
      'weather.home': { entity_id: 'weather.home', state: 'sunny', attributes: { temperature_unit: '°C' } },
      'sensor.out': {
        entity_id: 'sensor.out',
        state: '21.4567',
        attributes: { unit_of_measurement: '°C' },
      },
    },
    ...(precision === undefined ? {} : { entities: { 'sensor.out': { display_precision: precision } } }),
  });
  const read = (precision?: number) =>
    withSensors(hass(precision), { entity: 'weather.home', temperature_entity: 'sensor.out' }).states['weather.home']
      ?.attributes.temperature;
  assert.equal(read(), 21.4567);
  assert.equal(read(1), 21.5);
  assert.equal(read(0), 21);
});

test('a subscription quiet for two hours is asked again, with its forecast showing meanwhile', async () => {
  vi.useFakeTimers();
  try {
    let calls = 0,
      stopped = 0;
    const connection: Connection = {
      subscribeMessage(callback) {
        calls++;
        if (calls === 1) callback({ forecast: [{ datetime: '2026-10-27T12:00:00Z', temperature: 3 }] });
        return Promise.resolve(() => {
          stopped++;
        });
      },
    };
    const { WeatherForecast } = await import('../src/weather/forecast.ts');
    const stream = new WeatherForecast(() => {});
    stream.update(connection, 'weather.home', ['hourly']);
    await vi.advanceTimersByTimeAsync(0);
    assert.equal(calls, 1);
    await vi.advanceTimersByTimeAsync(2 * 3_600_000 - 1);
    assert.equal(calls, 1, 'not before');
    await vi.advanceTimersByTimeAsync(1);
    assert.equal(calls, 2);
    assert.equal(stopped, 1, 'the quiet one let go');
    assert.equal(stream.data.hourly?.forecast[0]?.temperature, 3);
    stream.stop();
  } finally {
    vi.useRealTimers();
  }
});

test('haptic feedback is the moon’s ticks unless set, and a setting saved as on or off keeps its meaning', async () => {
  const { normalizeConfig } = await import('../src/card/config.ts');
  const haptics = (value?: unknown) =>
    normalizeConfig({ entity: 'weather.home', ...(value === undefined ? {} : { haptics: value }) }).haptics;
  assert.equal(haptics(), 'moon');
  assert.equal(haptics('all'), 'all');
  assert.equal(haptics('off'), 'off');
  assert.equal(haptics(true), 'all');
  assert.equal(haptics(false), 'off');
  assert.throws(() => haptics('loud'), /haptics must be one of: moon, all, off/u);
});
