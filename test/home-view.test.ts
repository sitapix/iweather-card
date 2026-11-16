import assert from 'node:assert/strict';
import { test } from 'vitest';
import { normalizeConfig } from '../src/card/config.ts';
import { workOut, type UpdateSources } from '../src/card/update.ts';
import { homeTints } from '../src/card/home-view.ts';
import { contextOf, formData, schemaFor } from '../src/card/editor-schema.ts';
import type { FormSchemaItem } from '../src/card/home-assistant.ts';
import type { HomeAssistant } from '../src/card/home-assistant.ts';
import { weatherText } from '../src/weather/i18n.ts';

const NOW = Date.UTC(2026, 9, 27, 19, 6);
const HOUR = 3_600_000;
const noon = (day: number) => new Date(Date.UTC(2026, 9, day, 17)).toISOString();
const hass = (attributes: Record<string, unknown> = {}): HomeAssistant => ({
  states: {
    'weather.home': {
      entity_id: 'weather.home',
      state: 'sunny',
      attributes: {
        temperature: 57,
        temperature_unit: '°F',
        wind_speed: 2,
        wind_speed_unit: 'mph',
        humidity: 47,
        uv_index: 3,
        friendly_name: 'Home',
        ...attributes,
      },
    },
    'sensor.aqi': { entity_id: 'sensor.aqi', state: '59', attributes: {} },
    'sun.sun': { entity_id: 'sun.sun', state: 'above_horizon', attributes: {} },
  },
  locale: { language: 'en', time_format: '12' },
  config: { latitude: 41.9, longitude: -87.6, time_zone: 'UTC' },
});
// Six days from today, dry until the last.
const DAILY = [27, 28, 29, 30, 31].map((day, index) => ({
  datetime: noon(day),
  condition: 'sunny',
  temperature: 54 + index,
  templow: 28 + index,
}));
const WET = {
  datetime: new Date(Date.UTC(2026, 10, 1, 17)).toISOString(),
  condition: 'rainy',
  temperature: 60,
  templow: 40,
};
const sources = (settings: Record<string, unknown> = {}, over: Partial<UpdateSources> = {}): UpdateSources => ({
  config: normalizeConfig({
    type: 'custom:iweather-card',
    entity: 'weather.home',
    weather_layout: 'homeview',
    ...settings,
  }),
  hass: hass(),
  data: { daily: { status: 'ready', forecast: [...DAILY, WET] } },
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
});
const keys = (update: ReturnType<typeof workOut>) => update.home?.columns.map(column => column.key);
const labels = (update: ReturnType<typeof workOut>) => update.home?.columns.map(column => column.label);

test('only the home view works its parts out', () => {
  assert.equal(workOut(sources({ weather_layout: 'compact' })).home, undefined);
  assert.notEqual(workOut(sources()).home, undefined);
});

test('the clock tells the time without its day period', () => {
  assert.equal(workOut(sources()).home?.clock, '7:06');
});

test('the foot opens on the four days after today, and a press turns it to the readings', () => {
  const { home } = workOut(sources());
  assert.equal(home?.row, 'days');
  assert.equal(home.other, 'details');
  assert.deepEqual(keys(workOut(sources())), ['2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31']);
  assert.deepEqual(labels(workOut(sources()))?.[0], 'Wednesday: 55°, 29°');
  assert.equal(workOut(sources({}, { homeRow: 'details' })).home?.row, 'details');
});

test('the readings are the wait for rain, the wind, the humidity and the air', () => {
  const update = workOut(sources({ homeview_row: 'details', air_quality_entity: 'sensor.aqi' }));
  assert.deepEqual(keys(update), ['precipitation', 'wind', 'humidity', 'air_quality']);
  assert.deepEqual(labels(update), ['Rain: In 5d', 'Wind: 2 mph', 'Humidity: 47%', 'AQI: 59']);
  // Each opens its own tile's sheet, and a day, having none, its day's.
  assert.deepEqual(
    update.home?.columns.map(column => column.tile),
    ['precipitation', 'wind', 'humidity', 'air_quality'],
  );
  assert.equal(workOut(sources()).home?.columns[0]?.tile, undefined);
});

test('a reading the weather lacks is left out, and the UV index fills in', () => {
  const update = workOut(sources({ homeview_row: 'details' }));
  assert.deepEqual(keys(update), ['precipitation', 'wind', 'humidity', 'uv']);
  const dry = workOut(sources({ homeview_row: 'details' }, { data: { daily: { status: 'ready', forecast: DAILY } } }));
  assert.deepEqual(keys(dry), ['wind', 'humidity', 'uv']);
});

test('rain within the day is hours off, and falling it is now', () => {
  const hours = [0, 1, 2, 3].map(index => ({
    datetime: new Date(NOW - (NOW % HOUR) + index * HOUR).toISOString(),
    condition: index === 3 ? 'snowy' : 'sunny',
    temperature: 30,
  }));
  const soon = workOut(
    sources({ homeview_row: 'details' }, { data: { hourly: { status: 'ready', forecast: hours } } }),
  );
  assert.equal(labels(soon)?.[0], 'Snow: In 2h');
  const falling = hass();
  const weather = falling.states['weather.home'];
  if (!weather) throw new Error('No weather.');
  weather.state = 'rainy';
  assert.equal(labels(workOut(sources({ homeview_row: 'details' }, { hass: falling })))?.[0], 'Rain: Now');
});

test('a row with nothing to show gives way to the other, with nothing to turn to', () => {
  const { home } = workOut(sources({}, { data: {} }));
  assert.equal(home?.row, 'details');
  assert.equal(home.other, undefined);
});

test('the figures take the sky’s hue, lighter than the sky, and grey under a grey one', () => {
  assert.deepEqual(homeTints('#2d4baa'), { tint: 'hsl(226 90% 70%)', pale: 'hsl(226 90% 86%)' });
  assert.deepEqual(homeTints('#808080'), { tint: 'hsl(0 0% 70%)', pale: 'hsl(0 0% 86%)' });
  assert.deepEqual(homeTints('#c8dcf0'), { tint: 'hsl(210 90% 96%)', pale: 'hsl(210 90% 96%)' });
});

// Every field's name in a form, sections opened.
const names = (items: readonly FormSchemaItem[]): string[] =>
  items.flatMap(item => [...(item.name ? [item.name] : []), ...(item.schema ? names(item.schema) : [])]);
const form = (settings: Record<string, unknown> = {}) =>
  names(
    schemaFor(
      contextOf(
        formData({ type: 'custom:iweather-card', entity: 'weather.home', weather_layout: 'homeview', ...settings }),
        undefined,
      ),
    ),
  );

test('the home view’s form offers its own settings, and none of another layout’s', () => {
  const shown = form();
  for (const name of [
    'show_clock',
    'show_high_low',
    'homeview_row',
    'sheet_style',
    'glass_refraction',
    'glass_strength',
  ])
    assert.ok(shown.includes(name), name);
  for (const name of [
    'show_forecast',
    'forecast_hours',
    'show_daily',
    'forecast_days',
    'weather_mode',
    'show_name',
    'name',
    'place_name',
    'size',
    'top_padding',
    'tiles',
    'map',
    'averages_source',
    'alert_entities',
    'pressure_unit',
    'distance_unit',
    'pressure_entity',
  ])
    assert.ok(!shown.includes(name), name);
  assert.equal(shown.filter(name => name === 'glass_refraction').length, 1);
});

test('the home view’s form shows a field only where it changes something', () => {
  assert.ok(!form().includes('air_quality_scale'));
  assert.ok(form({ air_quality_entity: 'sensor.aqi' }).includes('air_quality_scale'));
  assert.ok(!form({ glass_refraction: false }).includes('glass_strength'));
  for (const settings of [{ weather_scene: false }, { low_power: true }]) {
    const shown = form(settings);
    assert.ok(!shown.includes('glass_refraction'), JSON.stringify(settings));
    assert.ok(!shown.includes('glass_strength'), JSON.stringify(settings));
  }
  assert.ok(!form({ weather_scene: false }).includes('weather_animation'));
  assert.ok(form({ low_power: true }).includes('weather_animation'));
});

// The other layouts' forms, by the same rule.
const formOf = (layout: string, settings: Record<string, unknown> = {}) =>
  form({ weather_layout: layout, ...settings });

test('a forecast’s length and view show with the forecast', () => {
  for (const layout of ['auto', 'expanded', 'page']) {
    const shown = formOf(layout);
    for (const name of ['forecast_hours', 'forecast_days', 'weather_mode']) assert.ok(shown.includes(name), name);
    assert.ok(!formOf(layout, { show_forecast: false }).includes('forecast_hours'), layout);
    assert.ok(formOf(layout, { show_forecast: false }).includes('weather_mode'), layout);
    assert.ok(!formOf(layout, { show_forecast: false, show_daily: false }).includes('weather_mode'), layout);
  }
  assert.ok(!formOf('expanded', { show_daily: false }).includes('forecast_days'));
  // The page's tiles and sheets go by the days whether or not its list shows them.
  assert.ok(formOf('page', { show_daily: false }).includes('forecast_days'));
});

test('a name hidden asks for no name, and a sky off for nothing of the sky', () => {
  for (const layout of ['auto', 'compact', 'strip', 'expanded', 'page']) {
    const unnamed = formOf(layout, { show_name: false });
    assert.ok(unnamed.includes('show_name') && !unnamed.includes('name') && !unnamed.includes('place_name'), layout);
    const still = formOf(layout, { weather_scene: false });
    for (const name of ['weather_animation', 'low_power', 'glass_refraction']) assert.ok(!still.includes(name), name);
    assert.ok(!formOf(layout, { low_power: true }).includes('glass_refraction'), layout);
  }
  // The page's map still names its pin by the town.
  assert.ok(formOf('page', { show_name: false, map: 'rainviewer' }).includes('place_name'));
});

test('the page asks about a service only while it uses it, and about a tile only while it has it', () => {
  const online = formOf('page', { map: 'rainviewer' });
  for (const name of ['open_meteo_forecast', 'radar_refresh_minutes', 'forecast_refresh_minutes', 'averages_source'])
    assert.ok(online.includes(name), name);
  assert.ok(!formOf('page').includes('radar_refresh_minutes'));
  assert.ok(!formOf('page', { open_meteo_forecast: false }).includes('forecast_refresh_minutes'));
  const local = formOf('page', { map: 'rainviewer', local_only: true });
  for (const name of [
    'open_meteo_forecast',
    'radar_refresh_minutes',
    'forecast_refresh_minutes',
    'map_precipitation_animation',
  ])
    assert.ok(!local.includes(name), name);
  assert.ok(local.includes('map'));
  const fewer = formOf('page', { map: 'rainviewer', tiles: ['wind', 'humidity'] });
  assert.ok(!fewer.includes('averages_source'));
  // The map stays without its tile, as the wind's and the air's sheets draw it too.
  for (const name of ['map', 'map_wind_animation', 'radar_refresh_minutes']) assert.ok(fewer.includes(name), name);
  assert.ok(!formOf('page').includes('air_quality_scale'));
  assert.ok(formOf('page', { air_quality_entity: 'sensor.aqi' }).includes('air_quality_scale'));
});
