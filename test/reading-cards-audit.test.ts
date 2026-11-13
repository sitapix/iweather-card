import assert from 'node:assert/strict';
import { test } from 'vitest';
import { normalizeConfig } from '../src/card/config.ts';
import type { HomeAssistant } from '../src/card/home-assistant.ts';
import { airNow } from '../src/cards/air-quality/rules.ts';
import { pollutantIds, pollutantIndex, pollutantSensors } from '../src/cards/air-quality/sheet.ts';
import { statisticsClimate } from '../src/cards/averages/climate.ts';
import { precipitationTile } from '../src/cards/precipitation/tile.ts';
import { pressureTrend } from '../src/cards/pressure/rules.ts';
import { pressureTile } from '../src/cards/pressure/tile.ts';
import type { TileContext } from '../src/cards/shared/context.ts';
import { tileText } from '../src/cards/shared/tile.ts';
import { uvAdvice } from '../src/cards/uv/rules.ts';
import { weatherNumber } from '../src/lib/formats.ts';
import { DAY, HOUR } from '../src/lib/time.ts';
import { dailyItems, forecasts } from '../src/weather/forecast-items.ts';

const NOW = Date.parse('2026-11-03T18:30:00Z');
const context = (extra: Partial<TileContext> = {}): TileContext => ({
  id: 'audit',
  attrs: { precipitation_unit: 'mm' },
  hourly: [],
  pastHours: [],
  daily: [],
  sun: undefined,
  config: normalizeConfig({ entity: 'weather.home' }),
  hass: undefined,
  locale: 'en-US',
  numbers: 'en-US',
  timeZone: 'America/Chicago',
  now: NOW,
  hour12: true,
  mode: undefined,
  condition: undefined,
  latitude: undefined,
  longitude: undefined,
  atHome: true,
  dark: false,
  pinName: '',
  placeName: '',
  earlier: undefined,
  climate: undefined,
  fmt: (value, digits = 0) => weatherNumber(value, 'en-US', digits),
  ...extra,
});

test('pressure in pascals has the same trend and gauge position as hectopascals', () => {
  for (const change of [-150, -30, 0, 30, 150])
    assert.equal(
      pressureTrend(101300, 101300 + change, 'Pa', undefined),
      pressureTrend(1013, 1013 + change / 100, 'hPa', undefined),
    );
  const mark = (pressure: number, pressure_unit: string) =>
    pressureTile(context({ attrs: { pressure, pressure_unit } }))?.match(/class="mark" style="--a:([^;]+)deg/)?.[1];
  assert.equal(mark(102340, 'Pa'), mark(1023.4, 'hPa'));
});

test('a zero pressure without a known unit keeps a finite gauge position', () => {
  const tile = pressureTile(context({ attrs: { pressure: 0 } }));
  assert.ok(tile);
  assert.doesNotMatch(tile, /NaN|Infinity/);
  assert.match(tile, /class="mark" style="--a:0\.0deg/);
});

test('precipitation in the hour underway is included in the next-day tile total', () => {
  const hourly = forecasts([
      { datetime: '2026-11-03T18:00:00Z', precipitation: 3 },
      { datetime: '2026-11-03T19:00:00Z', precipitation: 2 },
      { datetime: new Date(NOW + DAY).toISOString(), precipitation: 8 },
    ]),
    daily = dailyItems([{ datetime: '2026-11-03T18:00:00Z', precipitation: 5 }], NOW, 'America/Chicago', {});
  assert.match(tileText(precipitationTile(context({ hourly, daily })) ?? ''), /5 mm expected in next 24h/);
});

test('tomorrow remains the next calendar date across both daylight-saving changes', () => {
  for (const [time, today, tomorrow] of [
    ['2026-03-07T23:30:00-06:00', '2026-03-07T12:00:00-06:00', '2026-03-08T12:00:00-05:00'],
    ['2026-11-01T00:30:00-05:00', '2026-11-01T12:00:00-06:00', '2026-11-02T12:00:00-06:00'],
  ]) {
    assert.ok(time && today && tomorrow);
    const now = Date.parse(time),
      daily = dailyItems(
        [
          { datetime: today, precipitation: 0 },
          { datetime: tomorrow, precipitation: 3 },
        ],
        now,
        'America/Chicago',
        {},
      );
    assert.match(tileText(precipitationTile(context({ daily, now })) ?? ''), /3 mm expected tomorrow/);
  }
});

test('UV advice does not use a later date as the end of today’s protection window', () => {
  const ctx = context(),
    tomorrow = [{ datetime: new Date(NOW + DAY).toISOString(), uv_index: 0 }];
  assert.equal(uvAdvice(5, tomorrow, NOW, ctx.timeZone, ctx), 'Use sun protection for the rest of the day.');
  const afternoon = [{ datetime: new Date(NOW + HOUR).toISOString(), uv_index: 5 }, ...tomorrow];
  assert.match(uvAdvice(1, afternoon, NOW, ctx.timeZone, ctx), /^Use sun protection at /);
});

test('blank air quality and pollutant sensor states are missing rather than zero', () => {
  for (const state of ['', ' ', '\t']) {
    const hass: HomeAssistant = {
      states: { 'sensor.air': { entity_id: 'sensor.air', state, attributes: { device_class: 'pm25' } } },
      entities: { 'sensor.air': { device_id: 'air' }, 'sensor.index': { device_id: 'air' } },
    };
    assert.equal(airNow({ config: { air_quality_entity: 'sensor.air' }, hass }), undefined);
    assert.deepEqual(pollutantSensors(hass, 'sensor.index'), []);
  }
});

test('pollutant dependencies follow state availability without an entity registry change', () => {
  const entities = { 'sensor.air': { device_id: 'air' }, 'sensor.pm25': { device_id: 'air' } },
    initial: HomeAssistant = { entities, states: {} };
  assert.deepEqual(pollutantIds(initial, 'sensor.air'), []);
  const loaded: HomeAssistant = {
    entities,
    states: { 'sensor.pm25': { entity_id: 'sensor.pm25', state: '0', attributes: { device_class: 'pm25' } } },
  };
  assert.deepEqual(pollutantIds(loaded, 'sensor.air'), ['sensor.pm25']);
  assert.equal(pollutantSensors(loaded, 'sensor.air')[0]?.value, 0);
});

test('gas pollutant indexes agree for parts per million and parts per billion', () => {
  for (const kind of ['ozone', 'nitrogen_dioxide', 'sulphur_dioxide'])
    assert.equal(pollutantIndex(kind, 0.07, 'ppm'), pollutantIndex(kind, 70, 'ppb'));
  assert.equal(pollutantIndex('carbon_monoxide', 4.4, 'ppm'), pollutantIndex('carbon_monoxide', 4400, 'ppb'));
});

test('malformed statistics rows do not discard valid climate history', async () => {
  const climate = await statisticsClimate(
    {
      states: {},
      config: { time_zone: 'UTC' },
      callWS: () =>
        Promise.resolve({
          'sensor.temperature': [
            null,
            { start: 'invalid', max: 20, min: 10 },
            { start: '2024-11-03T00:00:00Z', max: 20, min: 10 },
            { start: '2025-11-03T00:00:00Z', max: 22, min: 12 },
          ],
        }),
    },
    'sensor.temperature',
    '°C',
  );
  assert.equal(climate?.normals['11-03']?.high, 21);
});
