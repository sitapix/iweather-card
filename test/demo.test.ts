import assert from 'node:assert/strict';
import { test } from 'vitest';
import { normalizeConfig } from '../src/card/config.ts';
import { House } from '../demo/house.ts';
import { ATTRIBUTION, type Place, forecastUrl, liveWorld, placesFrom } from '../demo/live.ts';
import {
  ALERTS,
  ENTITY,
  NOON,
  SUNRISE,
  SUNSET,
  WEATHERS,
  cardSettings,
  sampleWorld,
  sunAt,
  sunState,
  weatherById,
  withAlert,
  yaml,
} from '../demo/world.ts';
import { zoneAt } from '../demo/scene-clock.ts';

// The demo's sample weather and its real weather, as the card is handed them.

const NOW = Date.UTC(2026, 10, 9, 22, 30);
const HOUR = 3_600_000;
const localHour = (zone: string, time: number) =>
  Number(new Intl.DateTimeFormat('en', { hour: 'numeric', hourCycle: 'h23', timeZone: zone }).format(time));

test('the sun rises at 6, stands highest at noon, sets at 18 and is lowest at midnight', () => {
  assert.deepEqual(sunAt(SUNRISE), { elevation: 0, rising: true });
  assert.deepEqual(sunAt(NOON), { elevation: 55, rising: false });
  assert.deepEqual(sunAt(SUNSET), { elevation: 0, rising: false });
  assert.deepEqual(sunAt(0), { elevation: -40, rising: true });
  assert.ok(sunAt(0).elevation < sunAt(2).elevation && sunAt(0).elevation < sunAt(22).elevation, 'lowest at midnight');
  for (let hour = 7; hour < SUNSET; hour++) assert.ok(sunAt(hour).elevation > 0, `up at ${hour}`);
  for (const hour of [19, 21, 23, 1, 5]) assert.ok(sunAt(hour).elevation < 0, `down at ${hour}`);
});

test("each hour's zone puts the clock at that hour now", () => {
  for (let hour = 0; hour < 24; hour++) assert.equal(localHour(zoneAt(hour, NOW), NOW), hour, `hour ${hour}`);
  assert.equal(zoneAt(22, NOW), 'UTC');
});

test("sun.sun's next rising, noon and setting come after now, at 6, 12 and 18 on the scene's clock", () => {
  for (const hour of [0, 6, 13, 18, 23]) {
    const { attributes } = sunState(hour, NOW),
      zone = zoneAt(hour, NOW);
    for (const [name, at] of [
      ['next_rising', SUNRISE],
      ['next_noon', NOON],
      ['next_setting', SUNSET],
    ] as const) {
      const time = Date.parse(String(attributes[name]));
      assert.ok(time > NOW && time <= NOW + 24 * HOUR, `${name} at ${hour}`);
      assert.equal(localHour(zone, time), at, `${name} at ${hour}`);
    }
  }
});

test('every sample weather gives the card a whole day and ten days, in either units', () => {
  for (const weather of WEATHERS)
    for (const hour of [3, 13, 21])
      for (const units of ['us', 'metric'] as const) {
        const world = sampleWorld({ weather, hour, units }, NOW),
          state = world.states[ENTITY],
          hourly = world.forecasts.hourly ?? [],
          daily = world.forecasts.daily ?? [];
        const night = hour < SUNRISE || hour >= SUNSET;
        assert.equal(
          state?.state,
          weather.condition === 'sunny' && night ? 'clear-night' : weather.condition,
          `${weather.id} at ${hour}`,
        );
        assert.equal(state.attributes.temperature_unit, units === 'us' ? '°F' : '°C');
        assert.equal(hourly[0]?.datetime, new Date(Math.floor(NOW / HOUR) * HOUR).toISOString());
        assert.equal(hourly.length, 240 - hour);
        assert.equal(daily.length, 10);
        // Nothing for the card to fill from elsewhere: every hour has a chance and a gust.
        assert.ok(
          hourly.every(entry => entry.precipitation_probability !== undefined && entry.wind_gust_speed !== undefined),
        );
        assert.equal(world.states['sun.sun']?.attributes.elevation, sunAt(hour).elevation);
        assert.equal(localHour(world.config.time_zone ?? '', NOW), hour);
      }
});

test('metric weather is the same weather, converted', () => {
  const weather = weatherById('snow'),
    us = sampleWorld({ weather, hour: 13, units: 'us' }, NOW),
    metric = sampleWorld({ weather, hour: 13, units: 'metric' }, NOW),
    [usAttributes, metricAttributes] = [us, metric].map(world => world.states[ENTITY]?.attributes ?? {});
  assert.equal(metricAttributes?.wind_speed, Math.round(weather.wind * 1.609344 * 10) / 10);
  assert.equal(metricAttributes.pressure, Math.round(weather.pressure * 33.8639));
  assert.equal(
    metric.forecasts.daily?.[0]?.temperature,
    Math.round(((((us.forecasts.daily?.[0]?.temperature ?? 0) - 32) * 5) / 9) * 10) / 10,
  );
  assert.equal(usAttributes?.wind_speed_unit, 'mph');
  assert.equal(metricAttributes.wind_speed_unit, 'km/h');
});

test('an alert fit for the weather joins the house only when asked for', () => {
  const world = sampleWorld({ weather: weatherById('thunderstorm'), hour: 13, units: 'us' }, NOW);
  assert.equal(withAlert(world, false, NOW), world);
  const alerted = withAlert(world, true, NOW).states[ALERTS];
  assert.equal(alerted?.state, '1');
  assert.match(JSON.stringify(alerted.attributes['Alerts']), /Severe Thunderstorm Warning/);
});

test('the settings shown are the ones the card takes, and read as YAML', () => {
  assert.equal(
    yaml(cardSettings({ layout: 'page', alert: true })),
    [
      'type: custom:iweather-card',
      'entity: weather.home',
      'weather_layout: page',
      'map: rainviewer',
      'averages: open-meteo',
      'alert_entities:',
      '  - sensor.weather_alerts',
    ].join('\n'),
  );
  assert.equal(yaml(cardSettings({ layout: 'auto', alert: true })), 'type: custom:iweather-card\nentity: weather.home');
  for (const layout of ['page', 'expanded', 'auto', 'compact', 'strip'] as const) {
    const settings = cardSettings({ layout, alert: true });
    assert.equal(normalizeConfig(settings).weather_layout, layout);
  }
});

test('the house answers each forecast subscription, and tells it of each new forecast', async () => {
  const first = sampleWorld({ weather: weatherById('rain'), hour: 13, units: 'us' }, NOW),
    second = sampleWorld({ weather: weatherById('snow'), hour: 13, units: 'us' }, NOW),
    house = new House(first),
    heard: unknown[] = [];
  const stop = await house.connection.subscribeMessage(message => heard.push(message), {
    type: 'weather/subscribe_forecast',
    entity_id: ENTITY,
    forecast_type: 'daily',
  });
  await Promise.resolve();
  assert.deepEqual(heard, [{ forecast: first.forecasts.daily }]);
  const hass = house.hass(second, 'de', 'dark');
  assert.deepEqual(heard.at(-1), { forecast: second.forecasts.daily });
  assert.equal(hass.connection, house.connection);
  assert.equal(hass.locale?.language, 'de');
  assert.equal(hass.themes?.darkMode, true);
  house.hass(second, 'de', 'dark');
  assert.equal(heard.length, 2, 'the same world is no news');
  assert.ok(house.hass(withAlert(second, true, NOW), 'en', 'light').states[ALERTS]);
  assert.equal(heard.length, 2, 'alert and presentation changes leave the forecast alone');
  stop();
  house.hass(first, 'en', 'light');
  assert.equal(heard.length, 2, 'no word after unsubscribing');
});

// --- Real weather -----------------------------------------------------------------------------
const PARIS: Place = { name: 'Paris', detail: 'Île-de-France, France', latitude: 48.8534, longitude: 2.3488 };

test('a search names each place with its region and country', () => {
  assert.deepEqual(
    placesFrom({
      results: [
        { name: 'Paris', admin1: 'Île-de-France', country: 'France', latitude: 48.85, longitude: 2.35 },
        { name: 'Paris', admin1: 'Texas', country: 'United States', latitude: 33.66, longitude: -95.56 },
        { name: 'Singapore', admin1: 'Singapore', country: 'Singapore', latitude: 1.29, longitude: 103.85 },
        { name: 'Nowhere' },
      ],
    }),
    [
      { name: 'Paris', detail: 'Île-de-France, France', latitude: 48.85, longitude: 2.35 },
      { name: 'Paris', detail: 'Texas, United States', latitude: 33.66, longitude: -95.56 },
      { name: 'Singapore', detail: '', latitude: 1.29, longitude: 103.85 },
    ],
  );
  assert.deepEqual(placesFrom({}), []);
});

test('the forecast is asked for in the units shown', () => {
  assert.match(forecastUrl(PARIS, 'us'), /temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch/);
  assert.match(forecastUrl(PARIS, 'metric'), /wind_speed_unit=kmh/);
  assert.match(forecastUrl(PARIS, 'metric'), /latitude=48\.853&longitude=2\.349/);
});

// Two hours and two days of an answer, the first hour already over.
const SECONDS = NOW / 1000,
  START = SECONDS - (SECONDS % 3600) - 3600,
  MIDNIGHT = SECONDS - (SECONDS % 86_400);
const ANSWER = {
  timezone: 'Europe/Paris',
  current_units: { visibility: 'ft' },
  hourly_units: { visibility: 'ft' },
  current: {
    temperature_2m: 48.2,
    relative_humidity_2m: 91,
    weather_code: 0,
    is_day: 0,
    snowfall: 0,
    pressure_msl: 1013.2,
    visibility: 52_800,
    wind_speed_10m: 4.1,
    wind_direction_10m: 45,
  },
  hourly: {
    time: [START, START + 3600, START + 7200],
    weather_code: [61, 61, 71],
    snowfall: [0, 0.2, 0.4],
    is_day: [0, 0, 0],
    temperature_2m: [48, 47, 33],
    precipitation_probability: [90, 80, 70],
    pressure_msl: [1013, 1012, 1011],
    visibility: [26_400, 26_400, 5280],
  },
  daily: {
    time: [MIDNIGHT, MIDNIGHT + 86_400],
    weather_code: [63, 3],
    temperature_2m_max: [50, 57],
    temperature_2m_min: [42, 48],
  },
};

test("a place's forecast becomes the weather now, the hours from the one under way, and the days", () => {
  const world = liveWorld(ANSWER, PARIS, 'us', NOW),
    state = world.states[ENTITY];
  assert.equal(state?.state, 'clear-night');
  assert.equal(state.attributes.temperature, 48.2);
  assert.equal(state.attributes.pressure, 29.92);
  assert.equal(state.attributes.visibility, 10);
  assert.equal(state.attributes.pressure_unit, 'inHg');
  assert.equal(state.attributes.latitude, PARIS.latitude);
  assert.equal(state.attributes.attribution, ATTRIBUTION);
  assert.equal(world.states['sun.sun'], undefined, 'the card works out the sun where the weather is');
  assert.deepEqual(world.config, { location_name: 'Home', time_zone: 'Europe/Paris' });
  assert.deepEqual(
    world.forecasts.hourly?.map(({ condition, visibility }) => [condition, visibility]),
    [
      ['snowy-rainy', 5],
      ['snowy', 1],
    ],
  );
  assert.deepEqual(
    world.forecasts.daily?.map(({ datetime, condition }) => [datetime, condition]),
    [
      [new Date((MIDNIGHT + 43_200) * 1000).toISOString(), 'rainy'],
      [new Date((MIDNIGHT + 86_400 + 43_200) * 1000).toISOString(), 'cloudy'],
    ],
  );
  assert.equal(liveWorld(ANSWER, PARIS, 'metric', NOW).states[ENTITY]?.attributes.pressure, 1013);
  assert.throws(() => liveWorld({ error: true }, PARIS, 'us', NOW), /no forecast/);
});
