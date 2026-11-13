import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { EntityState } from '../src/card/home-assistant.ts';
import { UNIT_KIND_NAMES, convertForecast, convertState, convertUnit } from '../src/weather/units.ts';
import { normalizeConfig } from '../src/card/config.ts';
import { hour12Of } from '../src/lib/formats.ts';
import { schemaFor } from '../src/card/editor-schema.ts';

const close = (actual: number | undefined, expected: number, digits = 2) => {
  assert.ok(actual !== undefined);
  assert.equal(Number(actual.toFixed(digits)), expected);
};

test('converts each kind of unit', () => {
  close(convertUnit('temperature_unit', 68, '°F', '°C'), 20);
  close(convertUnit('temperature_unit', -40, '°C', '°F'), -40);
  close(convertUnit('wind_speed_unit', 10, 'm/s', 'km/h'), 36);
  close(convertUnit('wind_speed_unit', 36, 'km/h', 'mph'), 22.37);
  close(convertUnit('wind_speed_unit', 10, 'kn', 'm/s'), 5.14);
  close(convertUnit('precipitation_unit', 1, 'in', 'mm'), 25.4);
  close(convertUnit('pressure_unit', 1013.25, 'hPa', 'inHg'), 29.92);
  close(convertUnit('pressure_unit', 1013.25, 'hPa', 'kPa'), 101.33);
  close(convertUnit('pressure_unit', 30, 'inHg', 'mmHg'), 762);
  assert.equal(convertUnit('pressure_unit', 1000, 'hPa', 'mbar'), 1000);
  close(convertUnit('distance_unit', 10, 'mi', 'km'), 16.09);
});

test('Beaufort is a force from 0 to 12', () => {
  assert.equal(convertUnit('wind_speed_unit', 0.2, 'm/s', 'bft'), 0);
  assert.equal(convertUnit('wind_speed_unit', 15, 'mph', 'bft'), 4);
  assert.equal(convertUnit('wind_speed_unit', 50, 'm/s', 'bft'), 12);
});

test('values already in the chosen unit are never recalculated', () => {
  const state: EntityState = {
    entity_id: 'weather.home',
    state: 'windy',
    attributes: { wind_speed: 4, wind_speed_unit: 'Beaufort', temperature: 21.37, temperature_unit: '°C' },
  };
  assert.equal(convertState(state, { wind_speed_unit: 'bft', temperature_unit: '°C' }), state);
  assert.equal(convertState(state, { wind_speed_unit: 'auto' }), state);
});

test('unknown units and non-finite values pass through unchanged', () => {
  assert.equal(convertUnit('pressure_unit', 5, 'furlongs', 'hPa'), 5);
  assert.ok(Number.isNaN(convertUnit('temperature_unit', NaN, '°F', '°C')));
  assert.equal(convertUnit('temperature_unit', Infinity, '°F', '°C'), Infinity);
});

test('converts the entity once, rewriting its unit labels', () => {
  const state: EntityState = {
    entity_id: 'weather.home',
    state: 'sunny',
    attributes: {
      temperature: 68,
      temperature_unit: '°F',
      dew_point: 50,
      wind_speed: 10,
      wind_speed_unit: 'mph',
      pressure: 30,
      pressure_unit: 'inHg',
      visibility: 10,
      visibility_unit: 'mi',
      humidity: 40,
    },
  };
  const config = { temperature_unit: '°C', wind_speed_unit: 'auto', pressure_unit: 'hPa', distance_unit: 'km' };
  const out = convertState(state, config),
    a = out.attributes;
  close(a.temperature, 20);
  close(a.dew_point, 10);
  assert.equal(a.temperature_unit, '°C');
  assert.equal(a.wind_speed, 10);
  assert.equal(a.wind_speed_unit, 'mph');
  close(a.pressure, 1015.92);
  assert.equal(a.pressure_unit, 'hPa');
  close(a.visibility, 16.09);
  assert.equal(a.visibility_unit, 'km');
  assert.equal(a.humidity, 40);
  assert.equal(state.attributes.temperature, 68, 'the original state is untouched');
  assert.equal(convertState(state, config), out, 'cached per state, so its identity holds');
  assert.equal(convertState(state, { temperature_unit: 'auto' }), state, 'nothing to convert');
});

test('converts forecasts in the entity’s units', () => {
  const attrs = { temperature_unit: '°F', precipitation_unit: 'in' };
  const [first] = convertForecast(
    [{ temperature: 50, templow: 32, precipitation: 0.5, precipitation_probability: 40 }],
    attrs,
    { temperature_unit: '°C', precipitation_unit: 'mm' },
  );
  assert.ok(first);
  close(first.temperature, 10);
  close(first.templow, 0);
  close(first.precipitation, 12.7);
  assert.equal(first.precipitation_probability, 40);
});

test('config accepts each unit and rejects others; the editor offers them', () => {
  const config = normalizeConfig({ entity: 'weather.home' });
  for (const key of UNIT_KIND_NAMES) assert.equal(config[key], 'auto');
  assert.equal(normalizeConfig({ entity: 'weather.home', wind_speed_unit: 'bft' }).wind_speed_unit, 'bft');
  assert.throws(() => normalizeConfig({ entity: 'weather.home', pressure_unit: 'psi' }), /pressure_unit/);
  const units = schemaFor().find(item => item.title === 'Units');
  assert.ok(units?.schema);
  assert.deepEqual(
    units.schema.map(item => item.name),
    UNIT_KIND_NAMES,
  );
  const wind = units.schema.find(item => item.name === 'wind_speed_unit')?.selector;
  assert.ok(wind && 'select' in wind);
  assert.equal(wind.select.options.length, 6);
});

test("the clock follows Home Assistant's setting, and the browser's own locale for system", () => {
  assert.equal(hour12Of('12'), true);
  assert.equal(hour12Of('24'), false);
  assert.equal(hour12Of('language'), undefined);
  assert.equal(hour12Of(undefined), undefined);
  assert.equal(hour12Of('system'), new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12);
});
