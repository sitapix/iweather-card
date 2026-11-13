import { expect, test, vi } from 'vitest';
import { normalizeConfig } from '../src/card/config.ts';
import type { EntityState, HomeAssistant } from '../src/card/home-assistant.ts';
import { WeatherRecords, type RecordsHost } from '../src/card/records.ts';
import { withSensors, sensorReadings } from '../src/weather/sources.ts';

const NOW = Date.parse('2026-11-03T18:00:00Z'),
  HOUR = 3_600_000;
const home = (attributes: EntityState['attributes'] = {}): EntityState => ({
  entity_id: 'weather.home',
  state: 'cloudy',
  attributes: {
    temperature: 20,
    temperature_unit: '°C',
    precipitation_unit: 'mm',
    pressure_unit: 'hPa',
    ...attributes,
  },
});

test('blank and unavailable reading sources leave the weather reading intact, while zero is retained', () => {
  for (const state of [' ', '\t\n', 'unavailable', '0']) {
    const hass: HomeAssistant = {
        states: {
          'weather.home': home(),
          'sensor.temperature': { entity_id: 'sensor.temperature', state, attributes: { unit_of_measurement: '°C' } },
        },
      },
      config = { entity: 'weather.home', temperature_entity: 'sensor.temperature' };
    expect(withSensors(hass, config).states['weather.home']?.attributes.temperature).toBe(state === '0' ? 0 : 20);
    expect(sensorReadings(hass, config).has('temperature')).toBe(state === '0');
  }
  const hass: HomeAssistant = {
    states: {
      'weather.home': home(),
      'weather.other': { entity_id: 'weather.other', state: 'unavailable', attributes: { temperature: 35 } },
    },
  };
  expect(
    withSensors(hass, { entity: 'weather.home', temperature_entity: 'weather.other' }).states['weather.home']
      ?.attributes.temperature,
  ).toBe(20);
});

test('a weather source can supply a compass-point wind direction', () => {
  const hass: HomeAssistant = {
    states: {
      'weather.home': home(),
      'weather.other': { entity_id: 'weather.other', state: 'windy', attributes: { wind_bearing: 'SW' } },
    },
  };
  const config = { entity: 'weather.home', wind_bearing_entity: 'weather.other' };
  expect(withSensors(hass, config).states['weather.home']?.attributes.wind_bearing).toBe(225);
  expect(sensorReadings(hass, config).has('wind_bearing')).toBe(true);
});

function recordsHost(settings: object = {}, answer: unknown = {}) {
  const callWS = vi.fn((_message: Parameters<NonNullable<HomeAssistant['callWS']>>[0]) => Promise.resolve(answer)),
    card = {
      config: normalizeConfig({ entity: 'weather.home', weather_layout: 'page', ...settings }),
      readHass: {
        states: {
          'weather.home': home(),
          'weather.other': {
            entity_id: 'weather.other',
            state: 'cloudy',
            attributes: { pressure: 100.5, pressure_unit: 'kPa', temperature: 18, temperature_unit: '°C' },
          },
          'sensor.pressure': { entity_id: 'sensor.pressure', state: '101', attributes: { unit_of_measurement: 'kPa' } },
          'sensor.rain': { entity_id: 'sensor.rain', state: '6', attributes: { unit_of_measurement: 'mm' } },
        },
        callWS,
      },
      forecasts: { answered: true, own: {}, supplement: undefined, supply: () => undefined },
      timeZone: 'UTC',
      inSight: true,
      redrawTiles: vi.fn(),
    } satisfies RecordsHost;
  return { card, records: new WeatherRecords(card), callWS };
}

test('pressure history follows a configured sensor and converts its reading into display units', async () => {
  const { records, callWS } = recordsHost(
    { pressure_entity: 'sensor.pressure' },
    {
      'sensor.pressure': [{ s: '100.5', a: { unit_of_measurement: 'kPa' }, lu: (NOW - 3 * HOUR) / 1000 }],
    },
  );
  await records.loadEarlier(NOW);
  expect(records.earlier).toEqual({ pressure: 1005, pressure_unit: 'hPa' });
  expect(callWS).toHaveBeenCalledWith(
    expect.objectContaining({ entity_ids: ['sensor.pressure'], no_attributes: false }),
  );
});

test('pressure history from another weather source uses its attributes and discards the previous entity immediately', async () => {
  const { card, records, callWS } = recordsHost(
    {},
    {
      'weather.home': [{ a: { pressure: 1000, pressure_unit: 'hPa' } }],
    },
  );
  await records.loadEarlier(NOW);
  card.config = normalizeConfig({ entity: 'weather.home', weather_layout: 'page', pressure_entity: 'weather.other' });
  callWS.mockResolvedValue({ 'weather.other': [{ a: { pressure: 100.5, pressure_unit: 'kPa' } }] });
  const asking = records.loadEarlier(NOW);
  expect(records.earlier).toBeUndefined();
  await asking;
  expect(records.earlier).toEqual({ pressure: 1005, pressure_unit: 'hPa' });
  expect(callWS).toHaveBeenLastCalledWith(
    expect.objectContaining({ entity_ids: ['weather.other'], no_attributes: false }),
  );
});

test('an unavailable pressure override falls back to the primary weather history', async () => {
  const { card, records, callWS } = recordsHost(
    { pressure_entity: 'sensor.pressure' },
    {
      'weather.home': [{ a: { pressure: 1000, pressure_unit: 'hPa' } }],
    },
  );
  card.readHass.states['sensor.pressure'].state = 'unavailable';
  await records.loadEarlier(NOW);
  expect(records.earlier).toEqual({ pressure: 1000, pressure_unit: 'hPa' });
  expect(callWS).toHaveBeenCalledWith(expect.objectContaining({ entity_ids: ['weather.home'] }));
});

test('a pressure sensor’s historical unit is used even when its current unit has changed', async () => {
  const { records } = recordsHost(
    { pressure_entity: 'sensor.pressure' },
    {
      'sensor.pressure': [{ s: '1000', a: { unit_of_measurement: 'hPa' }, lu: (NOW - 3 * HOUR) / 1000 }],
    },
  );
  await records.loadEarlier(NOW);
  expect(records.earlier).toEqual({ pressure: 1000, pressure_unit: 'hPa' });
});

test('rain history is recalculated immediately when display units change', async () => {
  const { card, records, callWS } = recordsHost(
    { precipitation_entity: 'sensor.rain' },
    {
      'sensor.rain': [
        { s: '0', lu: (NOW - 6 * HOUR) / 1000 },
        { s: '25.4', lu: NOW / 1000 },
      ],
    },
  );
  await records.loadRecent(NOW);
  expect(records.lastDay).toBeCloseTo(25.4);
  card.readHass.states['weather.home'] = home({ precipitation_unit: 'in' });
  const asking = records.loadRecent(NOW);
  expect(records.lastDay).toBeUndefined();
  await asking;
  expect(records.lastDay).toBeCloseTo(1);
  expect(callWS).toHaveBeenCalledTimes(2);
});

test('a removed rain source cannot repopulate the card from a delayed response', async () => {
  const { card, records, callWS } = recordsHost({ precipitation_entity: 'sensor.rain' });
  let finish: (answer: unknown) => void = () => undefined;
  callWS.mockReturnValue(
    new Promise(resolve => {
      finish = resolve;
    }),
  );
  const asking = records.loadRecent(NOW);
  card.config = normalizeConfig({ entity: 'weather.home', weather_layout: 'page' });
  await records.loadRecent(NOW);
  finish({
    'sensor.rain': [
      { s: '0', lu: (NOW - HOUR) / 1000 },
      { s: '9', lu: NOW / 1000 },
    ],
  });
  await asking;
  expect(records.lastDay).toBeUndefined();
  expect(records.recent).toBeUndefined();
});

test('today’s temperature history supports a weather entity used as a reading source', async () => {
  const { records, callWS } = recordsHost(
    { temperature_entity: 'weather.other' },
    {
      'weather.other': [
        { a: { temperature: 12, temperature_unit: '°C' } },
        { a: { temperature: 18, temperature_unit: '°C' } },
      ],
    },
  );
  await records.loadSoFar(NOW);
  expect(records.soFar).toEqual({ low: 12, high: 18, unit: '°C' });
  expect(callWS).toHaveBeenCalledWith(expect.objectContaining({ entity_ids: ['weather.other'], no_attributes: false }));
});

test('an explicit rate-sensor outage ends the measured interval and leaves the day total unknown', async () => {
  const { card, records } = recordsHost(
    { precipitation_entity: 'sensor.rain' },
    {
      'sensor.rain': [
        { s: '1', lu: (NOW - 6 * HOUR) / 1000 },
        { s: 'unavailable', lu: (NOW - 5.5 * HOUR) / 1000 },
        { s: '0', lu: NOW / 1000 },
      ],
    },
  );
  card.readHass.states['sensor.rain'].attributes.unit_of_measurement = 'mm/h';
  await records.loadRecent(NOW);
  expect(records.recent).toEqual({ hours: 6, amount: 0.5, partial: true });
  expect(records.lastDay).toBeUndefined();
});

test('discard normals and pending responses when the averages source is removed', async () => {
  const { card, records, callWS } = recordsHost({ averages: 'sensor.outside' });
  const answer = { 'sensor.outside': [2024, 2025].map(year => ({ start: Date.UTC(year, 0, 1), max: 20, min: 10 })) };
  callWS.mockResolvedValueOnce(answer);
  await records.loadClimate();
  expect(records.climate?.years).toBe(2);
  let finish = (_value: unknown) => {};
  callWS.mockReturnValue(
    new Promise(resolve => {
      finish = resolve;
    }),
  );
  card.readHass.states['weather.home'] = home({ temperature_unit: 'K' });
  const pending = records.loadClimate();
  expect(records.climate?.years).toBe(2);
  card.config = normalizeConfig({ entity: 'weather.home', weather_layout: 'page' });
  await records.loadClimate();
  finish(answer);
  await pending;
  expect(records.climate).toBeUndefined();
  expect(records.climateKey).toBeUndefined();
});

test('recent rain converts during a unit change and cannot return after its source is removed', async () => {
  const { card, records } = recordsHost({ averages: 'open-meteo' });
  const setUnit = (unit: string) => {
    card.readHass.states['weather.home'] = home({ latitude: 10, longitude: 20, precipitation_unit: unit });
  };
  const daily = {
    time: Array.from({ length: 31 }, (_, i) => `2025-01-${String(i + 1).padStart(2, '0')}`),
    precipitation_sum: Array.from({ length: 31 }, () => 10),
  };
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ daily }));
  try {
    setUnit('mm');
    await records.loadRecentRain();
    expect(records.recentRain?.rain?.total).toBe(300);
    let finish = (_response: Response) => {};
    fetcher.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    );
    setUnit('cm');
    const pending = records.loadRecentRain();
    expect(records.recentRain?.rain?.total).toBe(30);
    card.config = normalizeConfig({ entity: 'weather.home', weather_layout: 'page' });
    await records.loadRecentRain();
    finish(Response.json({ daily }));
    await pending;
    expect(records.recentRain).toBeUndefined();
  } finally {
    fetcher.mockRestore();
  }
});
