import { afterEach, expect, test, vi } from 'vitest';
import '../src/iweather-card.ts';
import type { HomeAssistant } from '../src/card/home-assistant.ts';
import { MINUTE } from '../src/lib/time.ts';

// Long enough after a minute turns for the card's tick to have come.
const JUST_AFTER = 200;

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

test('repeating invalid settings still reports the error and leaves the last valid settings', () => {
  const card = document.createElement('iweather-card'),
    valid = { entity: 'weather.home', weather_scene: false, local_only: true },
    invalid = { ...valid, forecast_days: 0 };
  card.setConfig(valid);
  const config = card.config;
  expect(() => card.setConfig(invalid)).toThrow(/forecast_days/u);
  expect(() => card.setConfig(invalid)).toThrow(/forecast_days/u);
  expect(card.config).toBe(config);
});

test('a language change through the legacy hass field redraws even when all entity references stay the same', () => {
  const card = document.createElement('iweather-card'),
    hass: HomeAssistant = {
      language: 'en',
      states: { 'weather.home': { entity_id: 'weather.home', state: 'sunny', attributes: { temperature: 20 } } },
    };
  card.setConfig({ entity: 'weather.home', weather_scene: false, local_only: true });
  card.hass = hass;
  document.body.replaceChildren(card);
  const sync = vi.spyOn(card, 'sync');
  card.hass = { ...hass, language: 'de' };
  expect(sync).toHaveBeenCalledOnce();
  expect(card.update?.locale).toBe('de');
  card.hass = { ...hass, language: 'de', states: { ...hass.states } };
  expect(sync).toHaveBeenCalledOnce();
});

test('out of sight the minute tick neither draws nor asks, and in sight it draws just after the minute turns', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], now: Date.UTC(2026, 10, 11, 12, 0, 30) });
  try {
    const card = document.createElement('iweather-card');
    card.setConfig({ entity: 'weather.home', weather_scene: false, local_only: true });
    card.hass = {
      states: { 'weather.home': { entity_id: 'weather.home', state: 'sunny', attributes: { temperature: 20 } } },
    };
    document.body.replaceChildren(card);
    const render = vi.spyOn(card, 'render'),
      asked = vi.spyOn(card.records, 'loadSupplement');
    card.visible = false;
    vi.advanceTimersByTime(MINUTE);
    expect(render).not.toHaveBeenCalled();
    card.visible = true;
    // 12:01:30, then to 12:02:00, when the clock has only just turned.
    vi.advanceTimersByTime(MINUTE / 2);
    expect(render).not.toHaveBeenCalled();
    vi.advanceTimersByTime(JUST_AFTER);
    expect(render).toHaveBeenCalledOnce();
    expect(asked).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});

test('any field Home Assistant replaces redraws, and a state the card never reads does not', () => {
  const card = document.createElement('iweather-card'),
    hass: HomeAssistant = {
      states: { 'weather.home': { entity_id: 'weather.home', state: 'sunny', attributes: { temperature: 20 } } },
      config: { unit_system: { length: 'km' } },
    };
  card.setConfig({ entity: 'weather.home', weather_scene: false, local_only: true });
  card.hass = hass;
  document.body.replaceChildren(card);
  const sync = vi.spyOn(card, 'sync'),
    named = { ...hass, formatEntityState: () => 'Sonnig' };
  // The formatters come on their own, once the translations have loaded.
  card.hass = named;
  expect(sync).toHaveBeenCalledTimes(1);
  const miles = { ...named, config: { unit_system: { length: 'mi' } } };
  card.hass = miles;
  expect(sync).toHaveBeenCalledTimes(2);
  card.hass = {
    ...miles,
    states: { ...miles.states, 'light.porch': { entity_id: 'light.porch', state: 'on', attributes: {} } },
  };
  expect(sync).toHaveBeenCalledTimes(2);
});
