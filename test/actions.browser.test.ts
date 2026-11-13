import { afterEach, expect, test, vi } from 'vitest';
import '../src/iweather-card.ts';
import type { IWeatherCard } from '../src/iweather-card.ts';

// What pressing the conditions does: Home Assistant's own actions, or its dialog by default.
const hass = {
  states: {
    'weather.home': {
      entity_id: 'weather.home',
      state: 'cloudy',
      attributes: { temperature: 68, temperature_unit: '°F', friendly_name: 'Chicago' },
    },
  },
};
function card(extra: object) {
  const made: IWeatherCard = document.createElement('iweather-card');
  made.setConfig({
    type: 'custom:iweather-card',
    entity: 'weather.home',
    weather_animation: false,
    ...extra,
  });
  made.hass = hass;
  document.body.replaceChildren(made);
  const heard: unknown[] = [],
    note = (event: Event) => {
      heard.push([event.type, event instanceof CustomEvent ? event.detail : undefined]);
    };
  made.addEventListener('hass-action', note);
  made.addEventListener('hass-more-info', note);
  return { made, heard, target: made.parts.current };
}
const down = (node: HTMLElement) =>
  node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true, pointerId: 3, button: 0 }));
const up = (node: HTMLElement) => node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 3 }));
const entity = 'weather.home';
const config = (set: object) => ({
  entity,
  tap_action: undefined,
  hold_action: undefined,
  double_tap_action: undefined,
  ...set,
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

test('a tap opens the entity, and answers at once', () => {
  const { heard, target } = card({});
  target.click();
  expect(heard).toEqual([['hass-more-info', { entityId: entity }]]);
});

test('a tap performs the action set for it', () => {
  const tap_action = { action: 'navigate', navigation_path: '/lovelace/weather' },
    { heard, target } = card({ tap_action });
  target.click();
  expect(heard).toEqual([['hass-action', { config: config({ tap_action }), action: 'tap' }]]);
});

test('a tap set to nothing does nothing', () => {
  const { heard, target } = card({ tap_action: { action: 'none' } });
  target.click();
  expect(heard).toEqual([]);
});

test('disabled hold and double tap leave compact taps immediate', () => {
  vi.useFakeTimers();
  const { heard, target } = card({
    weather_layout: 'compact',
    hold_action: { action: 'none' },
    double_tap_action: { action: 'none' },
  });
  target.click();
  expect(heard).toEqual([['hass-more-info', { entityId: entity }]]);
  down(target);
  vi.advanceTimersByTime(600);
  up(target);
  target.click();
  expect(heard).toHaveLength(2);
  const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  target.dispatchEvent(menu);
  expect(menu.defaultPrevented).toBe(false);
});

test('a hold performs its action, and the tap as it lifts is not taken for one', () => {
  vi.useFakeTimers();
  const hold_action = { action: 'more-info' },
    { heard, target } = card({ hold_action });
  down(target);
  vi.advanceTimersByTime(499);
  expect(heard).toEqual([]);
  vi.advanceTimersByTime(1);
  expect(heard).toEqual([['hass-action', { config: config({ hold_action }), action: 'hold' }]]);
  up(target);
  target.click();
  expect(heard).toHaveLength(1);
});

test('a press let go early, or moved off, is no hold', () => {
  vi.useFakeTimers();
  const { heard, target } = card({ hold_action: { action: 'more-info' } });
  down(target);
  vi.advanceTimersByTime(100);
  up(target);
  vi.advanceTimersByTime(1000);
  down(target);
  target.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 40 }));
  vi.advanceTimersByTime(1000);
  expect(heard).toEqual([]);
});

test('two taps perform the double tap, and one waits to see', () => {
  vi.useFakeTimers();
  const double_tap_action = { action: 'toggle' },
    { heard, target } = card({ double_tap_action });
  target.click();
  target.click();
  vi.advanceTimersByTime(1000);
  expect(heard).toEqual([['hass-action', { config: config({ double_tap_action }), action: 'double_tap' }]]);
  heard.length = 0;
  target.click();
  expect(heard).toEqual([]);
  vi.advanceTimersByTime(250);
  expect(heard).toEqual([['hass-more-info', { entityId: entity }]]);
});

test('a hold set makes the browser keep its menu to itself', () => {
  const { target } = card({ hold_action: { action: 'more-info' } }),
    menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  target.dispatchEvent(menu);
  expect(menu.defaultPrevented).toBe(true);
});
