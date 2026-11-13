import assert from 'node:assert/strict';
import { test } from 'vitest';
import { normalizeConfig } from '../src/card/config.ts';
import { configFrom, formData, schemaFor } from '../src/card/editor-schema.ts';

const base = { type: 'custom:iweather-card', entity: 'weather.home' };
const intervals = [
  { name: 'radar_refresh_minutes', fallback: 5, min: 1, max: 60 },
  { name: 'forecast_refresh_minutes', fallback: 60, min: 15, max: 360 },
] as const;

for (const { name, fallback, min, max } of intervals) {
  test(`${name} keeps its default and accepts both whole-minute limits`, () => {
    assert.equal(normalizeConfig(base)[name], fallback);
    for (const value of [min, max]) assert.equal(normalizeConfig({ ...base, [name]: value })[name], value);
  });

  test(`${name} rejects invalid YAML values instead of changing the refresh schedule`, () => {
    for (const value of [undefined, null, '', String(fallback), true, NaN, Infinity, min - 1, max + 1, min + 0.5])
      assert.throws(() => normalizeConfig({ ...base, [name]: value }), {
        message: `The setting ${name} must be a whole number from ${min} to ${max}.`,
      });
  });
}

test('the editor shows refresh defaults without adding them to existing YAML', () => {
  const data = formData(base);
  assert.equal(data['radar_refresh_minutes'], 5);
  assert.equal(data['forecast_refresh_minutes'], 60);
  assert.deepEqual(configFrom(data), base);
});

test('custom refresh settings survive editor round trips and can return to defaults', () => {
  const custom = { ...base, radar_refresh_minutes: 10, forecast_refresh_minutes: 120 };
  assert.deepEqual(configFrom(formData(custom)), custom);
  assert.equal(normalizeConfig(configFrom(formData(custom))).radar_refresh_minutes, 10);
  assert.equal(normalizeConfig(configFrom(formData(custom))).forecast_refresh_minutes, 120);
  assert.deepEqual(configFrom({ ...formData(custom), radar_refresh_minutes: 5, forecast_refresh_minutes: 60 }), base);
  assert.deepEqual(
    configFrom({ ...formData(custom), radar_refresh_minutes: undefined, forecast_refresh_minutes: '' }),
    base,
  );
  const local = normalizeConfig({ ...custom, local_only: true });
  assert.equal(local.radar_refresh_minutes, 10);
  assert.equal(local.forecast_refresh_minutes, 120);
});

test('refresh controls stay in a collapsed section under online services with bounded native number inputs', () => {
  for (const map of ['none', 'rainviewer', 'local'] as const) {
    const services = schemaFor({ layout: 'page', map }).find(item => item.title === 'Map and online services');
    const refresh = services?.schema?.find(item => item.title === 'Refresh intervals');
    assert.ok(refresh);
    assert.equal(refresh.type, 'expandable');
    assert.notEqual(refresh.expanded, true);
    assert.equal(refresh.name, '');
    assert.ok(refresh.schema);
    assert.deepEqual(
      refresh.schema.map(item => item.name),
      intervals.map(item => item.name),
    );
    for (const field of refresh.schema) {
      const interval = intervals.find(item => item.name === field.name);
      assert.ok(interval);
      assert.deepEqual(field.selector, { number: { min: interval.min, max: interval.max, step: 1, mode: 'box' } });
      assert.match(field.label ?? '', /\(minutes\)$/u);
      assert.match(field.helper ?? '', /Your integrations keep their own update intervals\./u);
    }
    assert.match(refresh.schema[0]?.helper ?? '', /RainViewer.*new radar frames/u);
    assert.match(refresh.schema[1]?.helper ?? '', /Open-Meteo for the forecast it fills in/u);
    assert.doesNotMatch(services?.schema?.find(item => item.name === 'open_meteo_forecast')?.helper ?? '', /hourly/u);
  }
  for (const layout of ['auto', 'compact', 'expanded'] as const)
    assert.ok(!JSON.stringify(schemaFor({ layout })).includes('refresh_minutes'));
});
