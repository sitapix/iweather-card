import { expect, test } from 'vitest';
import type { FormSchemaItem, HomeAssistant } from '../src/card/home-assistant.ts';
import { isRecord } from '../src/lib/values.ts';
import { editing } from '../src/card/editing.ts';
import { useWords } from '../src/weather/words.ts';

// A stand-in for Home Assistant's ha-form: it keeps what the editor gives it, and the test
// plays the user by firing its value-changed events. Home Assistant fires a plain Event with
// `detail` set on it, not a CustomEvent, so this does the same.
class FakeForm extends HTMLElement {
  hass: HomeAssistant | undefined;
  schema: FormSchemaItem[] = [];
  data: Record<string, unknown> = {};
  computeLabel = (item: FormSchemaItem) => item.label ?? item.name;
  computeHelper = (item: FormSchemaItem): string | undefined => item.helper;
  change(values: Record<string, unknown>) {
    const event = new Event('value-changed', { bubbles: true, composed: true });
    this.dispatchEvent(Object.assign(event, { detail: { value: { ...this.data, ...values } } }));
  }
}
if (!customElements.get('ha-form')) customElements.define('ha-form', class extends FakeForm {});
await import('../src/card/editor.ts');
const { IWeatherCard } = await import('../src/iweather-card.ts');

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const hass = (n: number): HomeAssistant => ({
  states: { 'weather.home': { entity_id: 'weather.home', state: 'sunny', attributes: { temperature: n } } },
  locale: { language: 'en' },
});

// A field lookup across HA's unnamed sections and grids.
const fieldsOf = (schema: readonly FormSchemaItem[]): string[] =>
  schema.flatMap(item => (item.schema ? fieldsOf(item.schema) : [item.name]));

test('compact hides unused controls and keeps their saved values through edits and layout changes', async () => {
  const editor = document.createElement('iweather-card-editor'),
    sent: Record<string, unknown>[] = [],
    saved = {
      type: 'custom:iweather-card',
      entity: 'weather.home',
      weather_layout: 'page',
      forecast_hours: 12,
      forecast_days: 5,
      weather_mode: 'rain',
      glass_refraction: false,
      haptics: 'all',
      pressure_unit: 'inHg',
      pressure_entity: 'sensor.pressure',
      uv_index_entity: 'sensor.uv',
      tiles: ['wind', 'pressure'],
      averages: 'sensor.temperature_history',
      map: 'local',
      map_layers: { wind: 'https://example.com/{z}/{x}/{y}.png' },
      tap_action: { action: 'navigate', navigation_path: '/weather/details' },
      grid_options: { columns: 12, rows: 3 },
      card_mod: { style: ':host { border-radius: 20px; }' },
    };
  editor.setConfig(saved);
  editor.hass = hass(63);
  editor.addEventListener('config-changed', event => {
    if (event instanceof CustomEvent && isRecord(event.detail) && isRecord(event.detail['config']))
      sent.push(event.detail['config']);
  });
  document.body.replaceChildren(editor);
  await wait(30);
  const form = editor.shadowRoot?.querySelector('ha-form');
  if (!(form instanceof FakeForm)) throw new Error('No form.');
  form.change({ weather_layout: 'compact' });
  const hidden = [
    'forecast_hours',
    'forecast_days',
    'weather_mode',
    'glass_refraction',
    'haptics',
    'pressure_unit',
    'pressure_entity',
    'uv_index_entity',
    'apparent_temperature_entity',
    'wind_gust_speed_entity',
    'wind_bearing_entity',
    'tiles',
    'averages_source',
    'map',
  ];
  for (const name of hidden) expect(fieldsOf(form.schema)).not.toContain(name);
  expect(form.schema.find(item => item.title === 'Units')?.schema?.map(item => item.name)).toEqual([
    'temperature_unit',
  ]);
  expect(fieldsOf(form.schema)).toEqual(
    expect.arrayContaining([
      'forecast_entity',
      'condition_entity',
      'temperature_entity',
      'humidity_entity',
      'dew_point_entity',
      'wind_speed_entity',
      'visibility_entity',
      'cloud_coverage_entity',
      'precipitation_entity',
      'show_high_low',
      'time_zone',
    ]),
  );
  // Some forms report just their visible fields. That must not erase hidden settings or custom YAML.
  form.dispatchEvent(
    Object.assign(new Event('value-changed', { bubbles: true, composed: true }), {
      detail: { value: { show_high_low: false } },
    }),
  );
  expect(sent.at(-1)).toEqual({ ...saved, weather_layout: 'compact', show_high_low: false });
  editor.setConfig({ ...sent.at(-1) });
  // A clear is intentional, unlike an omitted value.
  form.change({ tap_action: undefined });
  expect(sent.at(-1)?.['tap_action']).toBeUndefined();
  expect(sent.at(-1)?.['map_layers']).toEqual(saved.map_layers);
  form.change({ weather_layout: 'page' });
  for (const name of hidden) expect(fieldsOf(form.schema)).toContain(name);
  const { averages, ...shown } = saved;
  expect(form.data).toMatchObject({
    ...shown,
    averages_source: 'sensor',
    averages_sensor: averages,
    tap_action: undefined,
    show_high_low: false,
  });
  // Reloading the saved config restores the same hidden choices, too.
  editor.remove();
  const reopened = document.createElement('iweather-card-editor');
  reopened.setConfig({ ...sent.at(-1), weather_layout: 'compact' });
  reopened.hass = hass(63);
  document.body.replaceChildren(reopened);
  await wait(30);
  const next = reopened.shadowRoot?.querySelector('ha-form');
  if (!(next instanceof FakeForm)) throw new Error('No form.');
  expect(fieldsOf(next.schema)).not.toContain('glass_refraction');
  expect(next.data['glass_refraction']).toBe(false);
  expect(next.data['pressure_entity']).toBe(saved.pressure_entity);
  reopened.remove();
});

test('compact points source and time-zone edits at the visible tile', async () => {
  const editor = document.createElement('iweather-card-editor');
  editor.setConfig({ type: 'custom:iweather-card', entity: 'weather.home', weather_layout: 'compact' });
  editor.hass = hass(63);
  document.body.replaceChildren(editor);
  await wait(30);
  const form = editor.shadowRoot?.querySelector('ha-form');
  if (!(form instanceof FakeForm)) throw new Error('No form.');
  for (const name of ['time_zone', 'forecast_entity', 'humidity_entity', 'wind_speed_entity', 'visibility_entity']) {
    const field = Object.assign(document.createElement('span'), { schema: { name } });
    form.append(field);
    field.dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }));
    expect(editing()?.parts).toEqual(['conditions']);
    field.remove();
  }
  form.change({ humidity_entity: 'sensor.humidity' });
  expect(editing()?.parts).toEqual(['conditions']);
  editor.remove();
});

test('compact exposes native action pickers and preserves the chosen routes', async () => {
  const editor = document.createElement('iweather-card-editor'),
    sent: Record<string, unknown>[] = [];
  editor.addEventListener('config-changed', event => {
    if (event instanceof CustomEvent && isRecord(event.detail) && isRecord(event.detail['config']))
      sent.push(event.detail['config']);
  });
  editor.setConfig({ type: 'custom:iweather-card', entity: 'weather.home', weather_layout: 'compact' });
  editor.hass = hass(63);
  document.body.replaceChildren(editor);
  await wait(30);
  const form = editor.shadowRoot?.querySelector('ha-form');
  if (!(form instanceof FakeForm)) throw new Error('No form.');
  const interactions = form.schema[2];
  expect(interactions?.title).toBe('Interactions');
  expect(interactions?.expanded).toBe(true);
  expect(interactions?.schema?.map(item => [item.name, item.selector])).toEqual([
    ['tap_action', { ui_action: { default_action: 'more-info' } }],
    ['hold_action', { ui_action: { default_action: 'none' } }],
    ['double_tap_action', { ui_action: { default_action: 'none' } }],
  ]);
  expect(JSON.stringify(form.schema)).not.toContain('show_forecast');
  const actions = {
    tap_action: { action: 'navigate', navigation_path: '/dashboard-weather/forecast' },
    hold_action: { action: 'more-info', entity: 'weather.other' },
    double_tap_action: { action: 'url', url_path: 'https://example.com/weather' },
  };
  form.change(actions);
  expect(sent.at(-1)).toMatchObject(actions);
  editor.setConfig({ ...sent.at(-1) });
  expect(form.data).toMatchObject(actions);
  const card = document.createElement('iweather-card'),
    heard: unknown[] = [];
  card.setConfig({ ...sent.at(-1) });
  card.addEventListener('hass-action', event => {
    if (event instanceof CustomEvent) heard.push(event.detail);
  });
  for (const press of ['tap', 'hold', 'double_tap'] as const) card.pressed(press);
  expect(heard).toEqual(
    ['tap', 'hold', 'double_tap'].map(action => ({ config: { entity: 'weather.home', ...actions }, action })),
  );
  editor.remove();
});

test('the card picker starts from a weather entity, and suggests three layouts for them alone', () => {
  const states = { 'light.lamp': { entity_id: 'light.lamp', state: 'on', attributes: {} }, ...hass(1).states };
  // One not yet on the dashboard, then one that is, then any Home Assistant knows of.
  expect(IWeatherCard.getStubConfig({ states }, ['light.lamp', 'weather.new'], ['weather.used'])['entity']).toBe(
    'weather.new',
  );
  expect(IWeatherCard.getStubConfig({ states }, ['light.lamp'], ['weather.used'])['entity']).toBe('weather.used');
  expect(IWeatherCard.getStubConfig({ states })['entity']).toBe('weather.home');
  expect(IWeatherCard.getStubConfig({ states: {} })['entity']).toBe('weather.home');
  const entry = window.customCards?.find(card => card.type === 'iweather-card');
  expect(entry?.getEntitySuggestion?.({ states }, 'light.lamp')).toBeNull();
  const type = 'custom:iweather-card',
    entity = 'weather.home';
  expect(entry?.getEntitySuggestion?.({ states }, entity)).toEqual([
    { label: 'Full page', config: { type, entity, weather_layout: 'page' } },
    { label: 'Forecast', config: { type, entity } },
    { label: 'Compact', config: { type, entity, weather_layout: 'compact' } },
  ]);
  // The labels are read as the picker asks, in the page's language.
  useWords('de', { 'Full page': 'Ganze Seite', Forecast: 'Vorhersage', Compact: 'Kompakt' });
  try {
    const suggested = entry?.getEntitySuggestion?.({ states }, entity) ?? [],
      list = 'config' in suggested ? [suggested] : suggested;
    expect(list.map(each => each.label)).toEqual(['Ganze Seite', 'Vorhersage', 'Kompakt']);
  } finally {
    useWords('en', {});
  }
});

test('the editor shows what applies, sends typing after a pause and passes state sparingly', async () => {
  const editor = document.createElement('iweather-card-editor'),
    sent: Record<string, unknown>[] = [];
  editor.addEventListener('config-changed', event => {
    const detail: unknown = event instanceof CustomEvent ? event.detail : undefined,
      config = isRecord(detail) ? detail['config'] : undefined;
    if (isRecord(config)) sent.push(config);
  });
  editor.setConfig({ type: 'custom:iweather-card', entity: 'weather.home' });
  editor.hass = hass(1);
  document.body.replaceChildren(editor);
  await wait(50);
  const form = editor.shadowRoot?.querySelector('ha-form');
  if (!(form instanceof FakeForm)) throw new Error('No form.');
  const titles = () => form.schema.flatMap(item => (item.title ? [item.title] : []));
  expect(titles()).not.toContain('Full page');
  const look = form.schema.find(item => item.title === 'Look'),
    refraction = look?.schema?.find(item => item.name === 'glass_refraction');
  expect(refraction?.selector).toEqual({ boolean: {} });
  expect(form.data['glass_refraction']).toBe(true);
  form.change({ glass_refraction: false });
  expect(sent.at(-1)?.['glass_refraction']).toBe(false);
  form.change({ glass_refraction: true });
  expect(sent.at(-1)?.['glass_refraction']).toBeUndefined();
  // A choice goes out at once, and the full page's section appears.
  form.change({ weather_layout: 'page' });
  expect(sent.at(-1)).toEqual({ type: 'custom:iweather-card', entity: 'weather.home', weather_layout: 'page' });
  expect(titles()).toContain('Full page');
  // Home Assistant hands the settings back; the form keeps what it shows.
  const shown = form.data;
  editor.setConfig({ ...sent.at(-1) });
  expect(form.data).toBe(shown);
  // Typing waits for a pause, unless the field is left.
  const before = sent.length;
  form.change({ name: 'Ho' });
  form.change({ name: 'Home' });
  expect(sent.length).toBe(before);
  await wait(500);
  expect(sent.length).toBe(before + 1);
  expect(sent.at(-1)?.['name']).toBe('Home');
  form.change({ name: 'Home!' });
  editor.shadowRoot?.dispatchEvent(new FocusEvent('focusout'));
  expect(sent.at(-1)?.['name']).toBe('Home!');
  // A number is typed too: 1 on the way to 12 is no setting to show.
  const typed = sent.length;
  form.change({ forecast_hours: 1 });
  form.change({ forecast_hours: 12 });
  expect(sent.length).toBe(typed);
  await wait(500);
  expect(sent.at(-1)?.['forecast_hours']).toBe(12);
  // Refresh intervals also wait until typing is finished, including a temporarily
  // out-of-range first digit; leaving the field commits the whole value.
  const refreshing = sent.length;
  form.change({ forecast_refresh_minutes: 1 });
  form.change({ forecast_refresh_minutes: 120 });
  expect(sent.length).toBe(refreshing);
  editor.shadowRoot?.dispatchEvent(new FocusEvent('focusout'));
  expect(sent.at(-1)?.['forecast_refresh_minutes']).toBe(120);
  const radar = sent.length;
  form.change({ radar_refresh_minutes: 1 });
  form.change({ radar_refresh_minutes: 10 });
  expect(sent.length).toBe(radar);
  editor.shadowRoot?.dispatchEvent(new FocusEvent('focusout'));
  expect(sent.at(-1)?.['radar_refresh_minutes']).toBe(10);
  editor.setConfig({ ...sent.at(-1) });
  expect(form.data['forecast_refresh_minutes']).toBe(120);
  expect(form.data['radar_refresh_minutes']).toBe(10);
  // Choosing a sensor for the averages keeps its field until one is picked.
  form.change({ averages_source: 'sensor' });
  expect(JSON.stringify(form.schema)).toContain('averages_sensor');
  expect(sent.at(-1)?.['averages']).toBeUndefined();
  // State reaches the form at most every two seconds.
  const first = form.hass;
  editor.hass = hass(2);
  editor.hass = hass(3);
  expect(form.hass).toBe(first);
});

test('the form speaks the language of Home Assistant, and English where it has no other', async () => {
  const editor = document.createElement('iweather-card-editor');
  editor.setConfig({ type: 'custom:iweather-card', entity: 'weather.home', weather_layout: 'page' });
  document.body.append(editor);
  editor.hass = { ...hass(1), locale: { language: 'de' } };
  const form = editor.shadowRoot?.querySelector('ha-form');
  if (!form) throw new Error('No form.');
  const first = () => form.schema[0]?.label;
  await expect.poll(first).not.toBe('Weather entity');
  const layout = form.schema.find(item => item.name === 'weather_layout'),
    options = layout?.selector && 'select' in layout.selector ? layout.selector.select.options : [];
  expect(options[0]?.label).not.toBe('Automatic');
  expect(options[0]?.value).toBe('auto');
  editor.hass = { ...hass(2), locale: { language: 'ar' } };
  await expect.poll(first).toBe('Weather entity');
  editor.remove();
});

test('the editor tells the preview what a field, a section or a change is about, and narrows its choices', async () => {
  const editor = document.createElement('iweather-card-editor');
  editor.setConfig({ type: 'custom:iweather-card', entity: 'weather.home', weather_layout: 'page' });
  editor.hass = hass(1);
  editor.style.width = '600px';
  document.body.replaceChildren(editor);
  await wait(50);
  const form = editor.shadowRoot?.querySelector('ha-form');
  if (!(form instanceof FakeForm)) throw new Error('No form.');
  // Home Assistant's form keeps each field's and section's record on the element showing it.
  const shown = (schema: unknown, inside: Element = form) => {
    const element = Object.assign(document.createElement('span'), { schema });
    inside.append(element);
    return element;
  };
  const parts = () => editing()?.parts;
  shown({ name: 'map', selector: {} }).dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }));
  expect(parts()).toEqual(['map']);
  // A field with no part of its own, as an overlay, is about its section's.
  const overlays = shown({ type: 'expandable', name: 'map_layers', schema: [{ name: 'wind' }] });
  shown({ name: 'wind', selector: {} }, overlays).dispatchEvent(
    new FocusEvent('focusin', { bubbles: true, composed: true }),
  );
  expect(parts()).toEqual(['map']);
  // A section opened is about each of its fields' parts in turn.
  const section = shown({
    type: 'expandable',
    name: '',
    schema: [{ name: 'alert_entities' }, { name: 'averages_source' }],
  });
  section.dispatchEvent(
    Object.assign(new Event('expanded-changed', { bubbles: true, composed: true }), { detail: { expanded: true } }),
  );
  expect(parts()).toEqual(['alerts', 'averages']);
  // A value changed is about its part.
  form.change({ tiles: ['wind', 'moon'] });
  expect(parts()).toEqual(['tiles']);
  // A dropdown cleared shows its default again, and leaves the settings.
  form.change({ map: 'local' });
  form.change({ map: undefined });
  expect(form.data['map']).toBe('none');
  // A narrow editor, as on a phone, puts two choices to a row.
  const columns = () => {
    const page = form.schema.find(item => item.title === 'Full page'),
      size = page?.schema?.find(item => item.name === 'size');
    return size?.selector && 'select' in size.selector ? size.selector.select.box_max_columns : undefined;
  };
  expect(columns()).toBe(3);
  editor.style.width = '360px';
  await expect.poll(columns).toBe(2);
  editor.remove();
  expect(editing()).toBeUndefined();
});
