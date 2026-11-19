import { expect, test } from 'vitest';
import { type WeatherLayout, normalizeConfig } from '../src/card/config.ts';
import { configFrom, contextOf, filled, formData, schemaFor } from '../src/card/editor-schema.ts';

test('the font dropdown and saved font name follow the selection in every layout', () => {
  const saved = { type: 'custom:iweather-card', entity: 'weather.home' };
  const form = formData(saved);
  expect(form['font']).toBe('auto');
  expect(configFrom(form)).toEqual(saved);
  const layouts: WeatherLayout[] = ['auto', 'compact', 'strip', 'homeview', 'expanded', 'page'];
  for (const weather_layout of layouts) {
    for (const font of ['auto', 'theme', 'rounded', 'custom']) {
      const data = { ...form, weather_layout, font, font_family: 'Times New Roman' };
      const fields = schemaFor(contextOf(data, undefined)).find(section => section.title === 'Appearance')?.schema;
      const dropdown = fields?.find(field => field.name === 'font');
      expect(dropdown?.selector).toEqual({
        select: {
          mode: 'dropdown',
          options: [
            { value: 'auto', label: 'Automatic' },
            { value: 'theme', label: 'Dashboard theme' },
            { value: 'rounded', label: 'Rounded' },
            { value: 'custom', label: 'Custom…' },
          ],
        },
      });
      expect(fields?.some(field => field.name === 'font_family')).toBe(font === 'custom');
      expect(normalizeConfig(configFrom(data))).toMatchObject({ font, font_family: 'Times New Roman' });
    }
  }
  expect(configFrom(filled({ ...form, font: '' }))).toEqual(saved);
  expect(normalizeConfig({ ...saved, font: 'custom', font_family: '  Georgia  ' }).font_family).toBe('Georgia');
  expect(normalizeConfig({ ...saved, font: 'custom', font_family: '  ' }).font_family).toBeUndefined();
});

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
