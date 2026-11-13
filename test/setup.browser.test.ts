import { afterEach, expect, test } from 'vitest';
import type { FormSchemaItem, HomeAssistant } from '../src/card/home-assistant.ts';
import { isRecord } from '../src/lib/values.ts';

class SetupForm extends HTMLElement {
  hass: HomeAssistant | undefined;
  schema: FormSchemaItem[] = [];
  data: Record<string, unknown> = {};
  change(value: Record<string, unknown>) {
    this.dispatchEvent(
      Object.assign(new Event('value-changed', { bubbles: true, composed: true }), { detail: { value } }),
    );
  }
}
if (!customElements.get('ha-form')) customElements.define('ha-form', SetupForm);
await import('../src/card/editor.ts');
const hass: HomeAssistant = {
  states: {
    'weather.home': {
      entity_id: 'weather.home',
      state: 'sunny',
      attributes: { temperature: 23, supported_features: 3 },
    },
  },
  language: 'en',
};
const saved = {
  type: 'custom:iweather-card',
  entity: 'weather.home',
  weather_layout: 'compact',
  local_only: true,
  temperature_entity: 'sensor.patio',
  temperature_unit: '°C',
  tiles: ['sun', 'wind'],
  grid_options: { columns: 6, rows: 3 },
  tap_action: { action: 'navigate', navigation_path: '/weather' },
  card_mod: { style: ':host { border-radius: 16px; }' },
};

function mount(config: Record<string, unknown> = saved) {
  const editor = document.createElement('iweather-card-editor'),
    sent: Record<string, unknown>[] = [];
  editor.setConfig(config);
  editor.hass = hass;
  editor.addEventListener('config-changed', event => {
    if (!(event instanceof CustomEvent) || !isRecord(event.detail) || !isRecord(event.detail['config'])) return;
    sent.push(event.detail['config']);
    editor.setConfig(event.detail['config']);
  });
  document.body.replaceChildren(editor);
  const root = editor.shadowRoot;
  if (!root) throw new Error('Missing editor root');
  const click = (selector: string) => {
    const button = root.querySelector(selector);
    if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button: ${selector}`);
    button.click();
  };
  return { editor, root, sent, click };
}
afterEach(() => document.body.replaceChildren());

test('a starting point survives HA echoes and Undo restores the exact saved settings', () => {
  const { root, sent, click } = mount();
  click('[data-preset="wall"]');
  expect(sent.at(-1)).toMatchObject({
    ...saved,
    weather_layout: 'page',
    size: 'extra_large',
    low_power: true,
    forecast_days: 5,
  });
  expect(root.querySelector('.quick-result button')?.hasAttribute('hidden')).toBe(false);
  click('.quick-result button');
  expect(sent.at(-1)).toEqual(saved);
  expect(root.activeElement).toBe(root.querySelector('summary'));
  expect(root.querySelector('.quick-result button')?.hasAttribute('hidden')).toBe(true);
});

test('manual changes retire Undo so it cannot discard subsequent work', () => {
  const { root, sent, click } = mount();
  click('[data-preset="page"]');
  const form = root.querySelector('ha-form');
  if (!(form instanceof SetupForm)) throw new Error('Missing form');
  form.change({ local_only: false });
  expect(sent.at(-1)?.['local_only']).toBeUndefined();
  expect(root.querySelector('.quick-result button')?.hasAttribute('hidden')).toBe(true);
  expect(root.querySelector('.quick-result span')?.textContent).toBe('');
});

test('pending typed values are kept by a preset and included when undoing it', async () => {
  const { root, sent, click } = mount();
  const form = root.querySelector('ha-form');
  if (!(form instanceof SetupForm)) throw new Error('Missing form');
  form.change({ name: 'Garden' });
  click('[data-preset="forecast"]');
  expect(sent.at(-1)).toMatchObject({ name: 'Garden', weather_layout: 'expanded' });
  click('.quick-result button');
  expect(sent.at(-1)).toEqual({ ...saved, name: 'Garden' });
  await new Promise(resolve => setTimeout(resolve, 450));
  expect(sent).toHaveLength(2);
});

test('source feedback follows entity changes and localizes without replacing focused controls', async () => {
  const { editor, root } = mount();
  const button = root.querySelector('[data-preset="page"]');
  const details = root.querySelector('details');
  if (!(button instanceof HTMLButtonElement) || !details) throw new Error('Missing setup');
  details.open = true;
  button.focus();
  expect(root.querySelector('.setup-source')?.textContent).toContain('Hourly forecast');
  editor.setConfig({ ...saved, entity: 'weather.deleted' });
  expect(root.querySelector('.setup-source')?.textContent).toContain('can’t find');
  editor.hass = { ...hass, language: 'fr' };
  await expect.poll(() => root.querySelector('summary')?.textContent).toBe('Configuration rapide');
  expect(root.querySelector('.setup-source')?.textContent).toContain('ne trouve pas');
  expect(root.activeElement).toBe(button);
  expect(details.open).toBe(true);
});

test('setup choices fit a narrow editor and remain keyboard focusable', () => {
  const { editor, root } = mount();
  editor.style.width = '280px';
  const details = root.querySelector('details');
  if (!details) throw new Error('Missing setup');
  details.open = true;
  const edge = editor.getBoundingClientRect(),
    buttons = root.querySelectorAll<HTMLButtonElement>('.quick-option'),
    [first, second] = buttons;
  if (!first || !second) throw new Error('Missing presets');
  expect(second.offsetTop).toBeGreaterThan(first.offsetTop);
  for (const button of buttons) {
    button.focus();
    expect(root.activeElement).toBe(button);
    const rect = button.getBoundingClientRect();
    expect(rect.left).toBeGreaterThanOrEqual(edge.left);
    expect(rect.right).toBeLessThanOrEqual(edge.right);
    expect(rect.height).toBeGreaterThanOrEqual(44);
  }
  editor.style.width = '540px';
  expect(second.offsetTop).toBe(first.offsetTop);
});
