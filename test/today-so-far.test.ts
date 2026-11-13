import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { normalizeConfig } from '../src/card/config.ts';
import type { ForecastEntry, HomeAssistant } from '../src/card/home-assistant.ts';
import { WeatherRecords, type RecordsHost } from '../src/card/records.ts';
import { workOut, type UpdateSources } from '../src/card/update.ts';
import { dailyItems } from '../src/weather/forecast-items.ts';
import { weatherText } from '../src/weather/i18n.ts';

const ZONE = 'America/Chicago',
  MINUTE = 60_000,
  HOUR = 60 * MINUTE,
  // 11:05 pm on Monday 2 November, where the card is.
  NOW = Date.parse('2026-11-03T05:05:00Z'),
  MIDNIGHT = Date.parse('2026-11-02T06:00:00Z');

// A forecast told by day and night, late in the evening: only tonight is left of today.
const LATE: ForecastEntry[] = [
  { datetime: '2026-11-02T22:00:00-06:00', is_daytime: false, condition: 'cloudy', temperature: 66 },
  { datetime: '2026-11-03T06:00:00-06:00', is_daytime: true, condition: 'lightning-rainy', temperature: 74 },
  { datetime: '2026-11-03T18:00:00-06:00', is_daytime: false, condition: 'lightning-rainy', temperature: 54 },
  { datetime: '2026-11-04T06:00:00-06:00', is_daytime: true, condition: 'cloudy', temperature: 66 },
];
const range = (current: Parameters<typeof dailyItems>[3]) =>
  dailyItems(LATE, NOW, ZONE, current, 2).map(({ low, high }) => [low, high]);

test('late in the evening today runs from what was recorded since midnight to what is left of it', () => {
  assert.deepEqual(range({ low: 66, high: 66, soFar: { low: 57, high: 67 } }), [
    [57, 67],
    [66, 74],
  ]);
  assert.deepEqual(range({ low: 66, high: 66 })[0], [66, 66], 'with no history, the hours left give it a high');
  assert.deepEqual(range({})[0], [66, null], 'with nothing else, tonight’s low and no high');
});

test('by day today’s range is widened by what was recorded, and by the hours left', () => {
  const morning = Date.parse('2026-11-02T16:00:00Z'),
    entries: ForecastEntry[] = [
      { datetime: '2026-11-02T06:00:00-06:00', is_daytime: true, temperature: 64 },
      { datetime: '2026-11-02T18:00:00-06:00', is_daytime: false, temperature: 66 },
    ],
    [today] = dailyItems(entries, morning, ZONE, { low: 61, high: 64, soFar: { low: 57, high: 65 } }, 1);
  assert.deepEqual([today?.low, today?.high], [57, 65], 'a day can’t be milder than it has already been');
  const daily = [{ datetime: '2026-11-02T12:00:00-06:00', temperature: 70, templow: 50 }],
    [plain] = dailyItems(daily, morning, ZONE, { low: 60, high: 68, soFar: { low: 55, high: 62 } }, 1);
  assert.deepEqual([plain?.low, plain?.high], [50, 70], 'a whole day’s forecast that already spans it stays');
});

// Home Assistant's history of the weather entity since midnight, in its compressed form.
const row = (time: number, temperature: number, unit = '°F') => ({
  s: 'cloudy',
  a: { temperature, temperature_unit: unit },
  lu: time / 1000,
});
type Message = Parameters<NonNullable<HomeAssistant['callWS']>>[0];
const host = (settings: Record<string, unknown>, answer: (message: Message) => unknown) => {
  const asked = vi.fn((message: Message) => Promise.resolve(answer(message))),
    redraws = vi.fn(),
    hass: HomeAssistant = {
      states: {
        'weather.home': { entity_id: 'weather.home', state: 'cloudy', attributes: { temperature_unit: '°F' } },
        'sensor.yard': { entity_id: 'sensor.yard', state: '19', attributes: { unit_of_measurement: '°C' } },
      },
      callWS: asked,
    };
  const card: RecordsHost = {
    config: normalizeConfig({ entity: 'weather.home', weather_layout: 'page', ...settings }),
    readHass: hass,
    forecasts: { answered: true, own: {}, supplement: undefined, supply: () => undefined },
    timeZone: ZONE,
    inSight: true,
    redrawTiles: redraws,
  };
  return { records: new WeatherRecords(card), asked, redraws };
};

test('today’s temperatures so far are asked of Home Assistant from midnight where the card is', async () => {
  const { records, asked, redraws } = host({}, () => ({
    'weather.home': [row(MIDNIGHT, 59), row(MIDNIGHT + 3 * HOUR, 57), row(MIDNIGHT + 16 * HOUR, 67), row(NOW, 66)],
  }));
  await records.loadSoFar(NOW);
  assert.deepEqual(records.soFar, { low: 57, high: 67, unit: '°F' });
  assert.equal(redraws.mock.calls.length, 1);
  const [message] = asked.mock.calls[0] ?? [];
  assert.ok(message?.type === 'history/history_during_period');
  assert.deepEqual(message.entity_ids, ['weather.home']);
  assert.equal(message.start_time, new Date(MIDNIGHT).toISOString());
  assert.equal(message.minimal_response, false, 'the temperature is one of its attributes');
  await records.loadSoFar(NOW + 20 * MINUTE);
  assert.equal(asked.mock.calls.length, 1, 'kept for half an hour');
  await records.loadSoFar(NOW + 31 * MINUTE);
  assert.equal(asked.mock.calls.length, 2);
  const start = (call: number) => {
    const message = asked.mock.calls[call]?.[0];
    return message?.type === 'history/history_during_period' ? message.start_time : undefined;
  };
  assert.equal(start(1), new Date(MIDNIGHT).toISOString());
  // Just after midnight: yesterday's go at once, and the new date is asked for from its start.
  const asking = records.loadSoFar(NOW + HOUR);
  assert.equal(records.soFar, undefined);
  await asking;
  assert.equal(start(2), new Date(MIDNIGHT + 24 * HOUR).toISOString());
});

test('a temperature sensor set gives today’s temperatures, in its own unit', async () => {
  const { records, asked } = host({ temperature_entity: 'sensor.yard' }, () => ({
    'sensor.yard': [
      { s: '68', a: { unit_of_measurement: '°F' }, lu: MIDNIGHT / 1000 },
      { s: 'unavailable', lu: (MIDNIGHT + HOUR) / 1000 },
      { s: '21', a: { unit_of_measurement: '°C' }, lu: (MIDNIGHT + 15 * HOUR) / 1000 },
    ],
  }));
  await records.loadSoFar(NOW);
  assert.deepEqual(records.soFar, { low: 20, high: 21, unit: '°C' });
  const [message] = asked.mock.calls[0] ?? [];
  assert.ok(message?.type === 'history/history_during_period');
  assert.deepEqual(message.entity_ids, ['sensor.yard']);
  assert.equal(message.minimal_response, false);
});

test('readings from before a change of unit still count, and a card with no days asks nothing', async () => {
  const { records } = host({}, () => ({ 'weather.home': [row(MIDNIGHT, 59), row(MIDNIGHT + HOUR, 16, '°C')] }));
  await records.loadSoFar(NOW);
  assert.deepEqual(records.soFar, { low: 15, high: 16, unit: '°C' });
  const quiet = host({ weather_layout: 'compact', show_daily: false, show_high_low: false }, () => ({}));
  await quiet.records.loadSoFar(NOW);
  assert.equal(quiet.asked.mock.calls.length, 0);
});

// --- Worked out -------------------------------------------------------------------------
const sources = (attributes: Record<string, unknown>, soFar: UpdateSources['records']['soFar']): UpdateSources => ({
  config: normalizeConfig({ type: 'custom:iweather-card', entity: 'weather.home', weather_layout: 'page' }),
  hass: {
    states: {
      'weather.home': {
        entity_id: 'weather.home',
        state: 'cloudy',
        attributes: { friendly_name: 'Home', ...attributes },
      },
    },
    locale: { language: 'en' },
    config: { latitude: 38.6, longitude: -90.2, time_zone: ZONE },
  },
  data: { twice_daily: { status: 'ready', forecast: LATE } },
  supplied: false,
  awaited: false,
  nowcast: undefined,
  timeZone: ZONE,
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
    soFar,
  },
  now: NOW,
});
const today = (update: ReturnType<typeof workOut>) => {
  const [first] = update.days;
  return [first?.low, first?.high];
};

test('today’s row takes the temperatures recorded since midnight, in the card’s unit, and the reading now', () => {
  assert.deepEqual(today(workOut(sources({ temperature: 66, temperature_unit: '°F' }, undefined))), [66, 66]);
  assert.deepEqual(
    today(workOut(sources({ temperature: 66, temperature_unit: '°F' }, { low: 57, high: 67, unit: '°F' }))),
    [57, 67],
  );
  const [low, high] = today(
    workOut(sources({ temperature: 19.5, temperature_unit: '°C' }, { low: 57, high: 67, unit: '°F' })),
  );
  assert.equal(low?.toFixed(1), '13.9');
  assert.equal(high, 19.5, 'the reading now is part of today');
});
