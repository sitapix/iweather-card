import { expect, test } from 'vitest';
import { schemaFor } from '../src/card/editor-schema.ts';

test('compact counts only missing readings that can affect its weather', () => {
  const attributes = {
    temperature: 63,
    humidity: 60,
    dew_point: 52,
    wind_speed: 8,
    visibility: 10,
    cloud_coverage: 25,
  };
  // Pressure, UV, gusts, wind direction and feels-like are absent, but Compact does not use them.
  const compact = schemaFor({ layout: 'compact', attributes });
  expect(compact.find(item => item.title?.startsWith('Data sources'))?.title).toBe('Data sources');
  const page = schemaFor({ layout: 'page', attributes });
  expect(page.find(item => item.title?.startsWith('Data sources'))?.title).toBe('Data sources · 5 missing');
  const missing = schemaFor({ layout: 'compact', attributes: { temperature: 63 } });
  expect(missing.find(item => item.title?.startsWith('Data sources'))?.title).toBe('Data sources · 5 missing');
  // No entity data is not a list of missing sensors to configure.
  expect(schemaFor({ layout: 'compact' }).find(item => item.title?.startsWith('Data sources'))?.title).toBe(
    'Data sources',
  );
});
