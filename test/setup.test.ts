import { expect, test } from 'vitest';
import { SETUP_PRESETS, setupSource } from '../src/card/setup.ts';
import { suggestWeatherEntity } from '../src/card/weather-entity.ts';
import { configFrom, formData } from '../src/card/editor-schema.ts';
import { normalizeConfig } from '../src/card/config.ts';
import type { HomeAssistant } from '../src/card/home-assistant.ts';

const hass: HomeAssistant = {
  states: {
    'weather.offline': { entity_id: 'weather.offline', state: 'unavailable', attributes: { supported_features: 3 } },
    'weather.station': {
      entity_id: 'weather.station',
      state: 'sunny',
      attributes: { temperature: 0, supported_features: 0 },
    },
    'weather.daily': {
      entity_id: 'weather.daily',
      state: 'cloudy',
      attributes: { temperature: 4, supported_features: 1 },
    },
    'weather.forecast': {
      entity_id: 'weather.forecast',
      state: 'cloudy',
      attributes: { temperature: 4, supported_features: 3 },
    },
    'weather.nights': {
      entity_id: 'weather.nights',
      state: 'cloudy',
      attributes: { temperature: 4, supported_features: 4 },
    },
  },
};

test('the picker skips offline sources and prefers hourly and daily coverage within each suggestion group', () => {
  expect(suggestWeatherEntity(hass)).toBe('weather.forecast');
  expect(suggestWeatherEntity(hass, ['weather.offline'], ['weather.daily'])).toBe('weather.daily');
  expect(suggestWeatherEntity(hass, ['weather.station', 'weather.forecast'])).toBe('weather.forecast');
  // An available suggestion still takes priority over a better provider already on the dashboard.
  expect(suggestWeatherEntity(hass, ['weather.daily'], ['weather.forecast'])).toBe('weather.daily');
  expect(suggestWeatherEntity(hass, ['weather.nights', 'weather.daily'])).toBe('weather.nights');
  expect(suggestWeatherEntity(undefined, ['light.lamp', 'weather.suggested'])).toBe('weather.suggested');
  expect(
    suggestWeatherEntity({
      states: { 'weather.offline': { entity_id: 'weather.offline', state: 'unavailable', attributes: {} } },
    }),
  ).toBe('weather.offline');
  expect(suggestWeatherEntity({ states: {} })).toBe('weather.home');
});

test('source guidance distinguishes missing setup, a deleted entity and an offline integration', () => {
  expect(setupSource({}, undefined)).toEqual({ forecasts: [] });
  expect(setupSource({}, { states: {} }).message).toContain('Add a weather integration');
  expect(setupSource({}, hass).message).toBe('Choose a weather entity below.');
  expect(setupSource({ entity: 'weather.deleted' }, hass).message).toContain('can’t find');
  expect(setupSource({ entity: 'weather.offline' }, hass).message).toContain('unavailable');
  expect(setupSource({ entity: 'weather.station' }, hass).message).toContain('current weather only');
});

test('forecast guidance includes a working fallback without advertising an unavailable source', () => {
  expect(setupSource({ entity: 'weather.forecast' }, hass).forecasts).toEqual(['Hourly forecast', 'Daily forecast']);
  expect(setupSource({ entity: 'weather.station', forecast_entity: 'weather.nights' }, hass).forecasts).toEqual([
    'Day and night',
  ]);
  expect(setupSource({ entity: 'weather.station', forecast_entity: 'weather.offline' }, hass).forecasts).toEqual([]);
  expect(setupSource({ entity: 'weather.station', forecast_entity: 'weather.forecast' }, hass).message).toBeUndefined();
  // Older or unusual providers that omit capabilities are unknown, not observation-only.
  expect(
    setupSource(
      { entity: 'weather.unknown' },
      {
        states: {
          'weather.unknown': { entity_id: 'weather.unknown', state: 'sunny', attributes: {} },
        },
      },
    ).message,
  ).toBeUndefined();
});

test('every starting point produces a valid card without overwriting user data or privacy', () => {
  const existing = {
    type: 'custom:iweather-card',
    entity: 'weather.station',
    forecast_entity: 'weather.forecast',
    temperature_entity: 'sensor.outdoor',
    local_only: true,
    open_meteo_forecast: false,
    temperature_unit: '°C',
    map: 'local',
    map_tile_url: 'https://example.com/{z}/{x}/{y}.png',
    tiles: ['wind', 'sun'],
    alert_entities: ['sensor.alerts'],
    tap_action: { action: 'navigate', navigation_path: '/weather' },
    grid_options: { columns: 6, rows: 3 },
    card_mod: { style: ':host { color: red; }' },
  };
  for (const preset of SETUP_PRESETS) {
    const config = configFrom({ ...formData(existing), ...preset.config });
    expect(config).toMatchObject(existing);
    expect(normalizeConfig(config)).toMatchObject(preset.config);
    expect(config).not.toHaveProperty('preset');
  }
});
