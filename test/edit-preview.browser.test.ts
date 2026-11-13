import { afterEach, expect, test, vi } from 'vitest';
import '../src/iweather-card.ts';
import type { IWeatherCard } from '../src/iweather-card.ts';
import type { HomeAssistant } from '../src/card/home-assistant.ts';
import { editParts, stopEditing } from '../src/card/editing.ts';

// The card Home Assistant's editor previews shows the part of it being edited. The dialog here
// stands in for Home Assistant's: a pane the preview scrolls in, and the form beside it or above.
const hass: HomeAssistant = {
  states: {
    'weather.home': {
      entity_id: 'weather.home',
      state: 'cloudy',
      attributes: {
        temperature: 58,
        temperature_unit: '°F',
        humidity: 70,
        pressure: 1012,
        pressure_unit: 'hPa',
        wind_speed: 12,
        wind_bearing: 220,
        wind_speed_unit: 'mph',
        friendly_name: 'Home',
      },
    },
  },
  locale: { language: 'en' },
};
// As long as a busy page may take to scroll, draw or let the ring go.
const SLOW = { timeout: 5000 };
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

function card(): IWeatherCard {
  const element = document.createElement('iweather-card');
  element.setConfig({ type: 'custom:iweather-card', entity: 'weather.home', weather_layout: 'page' });
  element.hass = hass;
  return element;
}
// The dialog, with the form beside the pane the preview scrolls in, or above it in one pane
// that scrolls both, as on a phone.
function dialog(beside: boolean) {
  const root = document.createElement('hui-dialog-edit-card'),
    pane = document.createElement('div'),
    form = document.createElement('div'),
    preview = card();
  pane.style.cssText = 'height:300px;width:420px;overflow:auto';
  form.style.height = '200px';
  pane.append(preview);
  if (beside) root.append(form, pane);
  else pane.prepend(form);
  root.append(pane);
  document.body.replaceChildren(root);
  return { pane, form, preview };
}
const tile = (element: IWeatherCard, id: string) =>
  element.shadowRoot?.querySelector<HTMLElement>(`[data-tile="${id}"]`) ?? null;
const rung = (element: IWeatherCard) => element.shadowRoot?.querySelector('[data-editing]') ?? null;

afterEach(() => {
  for (const form of document.querySelectorAll('div')) stopEditing(form);
  document.body.replaceChildren();
});

test('the preview rings the part being edited, and scrolls to it where it scrolls apart from the form', async () => {
  const { pane, form, preview } = dialog(true);
  await frames();
  const pressure = tile(preview, 'pressure');
  expect(pressure).not.toBeNull();
  editParts(form, ['pressure']);
  expect(rung(preview)).toBe(pressure);
  // It scrolls there smoothly, however long the page takes to.
  await vi.waitFor(() => {
    const box = pane.getBoundingClientRect(),
      part = pressure?.getBoundingClientRect();
    expect(pane.scrollTop).toBeGreaterThan(0);
    expect(part && part.top >= box.top && part.bottom <= box.bottom).toBe(true);
  }, SLOW);
  // The ring goes after a moment.
  await vi.waitFor(() => {
    expect(rung(preview)).toBeNull();
  }, SLOW);
});

test('under the form, as on a phone, the preview rings the part but holds still', async () => {
  const { pane, form, preview } = dialog(false);
  await frames();
  editParts(form, ['pressure']);
  expect(rung(preview)).toBe(tile(preview, 'pressure'));
  await wait(500);
  expect(pane.scrollTop).toBe(0);
});

test('the card built for the next change carries on with the ring, and a part not showing shows nothing', async () => {
  const { pane, form, preview } = dialog(true);
  await frames();
  editParts(form, ['wind']);
  // Home Assistant puts a new card in place of the old at each change.
  preview.remove();
  const next = card();
  pane.append(next);
  // Ringed as soon as it has drawn its tiles.
  await vi.waitFor(() => {
    expect(tile(next, 'wind')).not.toBeNull();
    expect(rung(next)).toBe(tile(next, 'wind'));
  }, SLOW);
  // No alerts are showing; the first part that is comes next.
  editParts(form, ['alerts', 'humidity']);
  expect(rung(next)).toBe(tile(next, 'humidity'));
  editParts(form, ['alerts']);
  expect(rung(next)).toBeNull();
});

test('a card outside the editor’s dialog shows nothing', async () => {
  const outside = card(),
    form = document.createElement('div');
  document.body.replaceChildren(outside, form);
  await frames();
  editParts(form, ['pressure']);
  expect(rung(outside)).toBeNull();
});
