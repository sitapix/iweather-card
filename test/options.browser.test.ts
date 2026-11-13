import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import '../src/iweather-card.ts';
import type { ForecastSubscription, HomeAssistant } from '../src/card/home-assistant.ts';
import type { IWeatherCard } from '../src/iweather-card.ts';
import { optionsMarkup, SYSTEM_MENU } from '../src/sheets/options.ts';

// A sheet's options: the units its readings are in, each picked from a menu and kept on this device.
const HOUR = 3_600_000,
  KEPT = 'iweather-units';
const hourly = () =>
  Array.from({ length: 48 }, (_, i) => ({
    datetime: new Date(Date.now() + i * HOUR).toISOString(),
    temperature: 60 + (i % 7),
    apparent_temperature: 58 + (i % 7),
    condition: 'rainy',
    precipitation: 0.1,
    precipitation_probability: 40,
    wind_speed: 8,
    wind_bearing: 200,
    uv_index: 3,
    humidity: 70,
    pressure: 1012,
    visibility: 9,
  }));
const daily = () =>
  Array.from({ length: 10 }, (_, i) => ({
    datetime: new Date(Date.now() + i * 24 * HOUR).toISOString(),
    temperature: 66,
    templow: 50,
    condition: 'rainy',
    precipitation: 0.1,
    precipitation_probability: 40,
  }));
const hass = (): HomeAssistant => ({
  states: {
    'weather.home': {
      entity_id: 'weather.home',
      state: 'rainy',
      attributes: {
        temperature: 62,
        temperature_unit: '°F',
        humidity: 70,
        uv_index: 3,
        pressure: 1012,
        pressure_unit: 'hPa',
        visibility: 9,
        visibility_unit: 'mi',
        wind_speed: 8,
        wind_bearing: 200,
        wind_speed_unit: 'mph',
        precipitation_unit: 'in',
        friendly_name: 'Chicago',
        supported_features: 3,
      },
    },
  },
  locale: { language: 'en', time_format: '12' },
  config: { location_name: 'Home', time_zone: 'America/Chicago', latitude: 41.9, longitude: -87.6 },
  connection: {
    subscribeMessage(callback: (message: unknown) => void, message: ForecastSubscription) {
      queueMicrotask(() => {
        callback({ forecast: message.forecast_type === 'hourly' ? hourly() : daily() });
      });
      return Promise.resolve(() => undefined);
    },
  },
});
async function page(config: object = {}): Promise<IWeatherCard> {
  const card = document.createElement('iweather-card');
  card.style.cssText = 'display:block;width:1100px';
  card.setConfig({
    type: 'custom:iweather-card',
    entity: 'weather.home',
    weather_layout: 'page',
    open_meteo_forecast: false,
    weather_animation: false,
    ...config,
  });
  card.hass = hass();
  document.body.replaceChildren(card);
  await vi.waitFor(() => {
    expect(card.root.querySelector('.tile[data-tile=pressure]')).toBeTruthy();
  });
  // Settled: the forecast's first answers, which come a frame after it is put on the page.
  await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
  return card;
}
function part(root: ParentNode, selector: string): HTMLElement {
  const node = root.querySelector(selector);
  if (!(node instanceof HTMLElement)) throw new Error(`No ${selector}.`);
  return node;
}
const open = (card: IWeatherCard, tile: string) => {
  const pressed = part(card.root, `.tile[data-tile=${tile}]`);
  pressed.scrollIntoView({ block: 'center' });
  pressed.click();
  for (const animation of part(card.root, 'dialog[open] .sheet').getAnimations()) animation.finish();
  const dialog = card.root.querySelector('dialog[open]');
  if (!(dialog instanceof HTMLDialogElement)) throw new Error('No sheet.');
  return dialog;
};
// Each option's name, what it shows, and its menu's choices with the one checked: the glass menu
// drawn now, not one shrinking away, or the system's.
const options = (dialog: HTMLElement) =>
  [...dialog.querySelectorAll<HTMLElement>('.sheet-option')].map(row => ({
    name: part(row, '.option-name').textContent,
    shows: part(row, '.option-value>span').textContent,
    choices: [
      ...[...row.querySelectorAll<HTMLElement>('.glass-menu:not([data-leaving]) [data-choice]')].map(
        choice => `${choice.getAttribute('aria-checked') === 'true' ? '✓ ' : ''}${choice.textContent}`,
      ),
      ...[...row.querySelectorAll('option')].map(choice => `${choice.selected ? '✓ ' : ''}${choice.textContent}`),
    ],
  }));
// Whether the hand is a computer's (see SYSTEM_MENU), whatever the browser running the tests has.
const computer = (is: boolean) => {
  const media = window.matchMedia.bind(window);
  vi.spyOn(window, 'matchMedia').mockImplementation(query =>
    media(query === SYSTEM_MENU ? (is ? 'all' : 'not all') : query),
  );
};
// A unit picked as a hand would: the row's button opens the menu, and a click on a choice takes it.
async function pick(dialog: HTMLElement, kind: string, name: string) {
  part(dialog, `.sheet-option[data-option=${kind}]>button`).click();
  const menu = part(dialog, `.sheet-option[data-option=${kind}]>.glass-menu:not([hidden])`),
    choice = [...menu.querySelectorAll<HTMLElement>('[data-choice]')].find(each => each.textContent === name);
  if (!choice) throw new Error(`No ${name}.`);
  choice.click();
  await vi.waitFor(() => {
    expect(part(dialog, `.sheet-option[data-option=${kind}] .option-menu`).hidden).toBe(true);
  });
}
const sentences = (dialog: HTMLElement) => part(dialog, '.detail-summary').textContent;

// A finger, unless a test says otherwise: the card's own menu.
beforeEach(() => {
  computer(false);
});
afterEach(() => {
  document.body.replaceChildren();
  localStorage.removeItem(KEPT);
  vi.restoreAllMocks();
});

test('a sheet of readings in a unit ends with its options, and one of readings in none has none', async () => {
  const card = await page(),
    pressure = open(card, 'pressure');
  expect(pressure.querySelector('.sheet>section:last-of-type h3')?.textContent).toBe('Options');
  expect(options(pressure)).toEqual([
    {
      name: 'Unit',
      shows: 'hPa',
      choices: [
        'Millibars (mbar)',
        'Inches of mercury (inHg)',
        'Millimeters of mercury (mmHg)',
        '✓ Hectopascals (hPa)',
        'Kilopascals (kPa)',
      ],
    },
  ]);
  pressure.close();
  // The conditions name each of their two, and their temperatures can follow Home Assistant's units.
  const conditions = open(card, 'feels_like');
  expect(options(conditions)).toEqual([
    {
      name: 'Temperature',
      shows: 'Use system setting (°F)',
      choices: ['Celsius (°C)', 'Fahrenheit (°F)', '✓ Use system setting (°F)'],
    },
    { name: 'Precipitation', shows: 'in', choices: ['✓ Inches (in)', 'Millimeters (mm)'] },
  ]);
  conditions.close();
  for (const [tile, shows] of [
    ['wind', 'mph'],
    ['visibility', 'mi'],
    ['precipitation', 'in'],
  ] as const) {
    const sheet = open(card, tile);
    expect(options(sheet).map(option => option.shows)).toEqual([shows]);
    sheet.close();
  }
  for (const tile of ['uv', 'humidity']) {
    const sheet = open(card, tile);
    expect(sheet.querySelector('.detail-options')).toBeNull();
    sheet.close();
  }
});

test('a unit picked shows the sheet in it, and is kept until the card’s own setting changes', async () => {
  let card = await page(),
    sheet = open(card, 'pressure');
  expect(sentences(sheet)).toContain('1,012 hPa');
  // Its chart's scale too, which the sheet otherwise holds while it is open.
  const scale = () => part(sheet, '.chart').textContent;
  expect(scale()).toContain('1,010');
  await pick(sheet, 'pressure_unit', 'Inches of mercury (inHg)');
  expect(sentences(sheet)).toContain('29.88 inHg');
  expect(scale()).not.toContain('1,0');
  expect(scale()).toContain('30');
  expect(options(sheet)[0]?.shows).toBe('inHg');
  expect(options(sheet)[0]?.choices).toContain('✓ Inches of mercury (inHg)');
  // Its tile follows too, and so does the card drawn afresh.
  expect(part(card.root, '.tile[data-tile=pressure]').textContent).toContain('inHg');
  card = await page();
  sheet = open(card, 'pressure');
  expect(options(sheet)[0]?.shows).toBe('inHg');
  sheet.close();
  // A unit set on the card since is the newer word; set back, the pick stands again.
  card = await page({ pressure_unit: 'mbar' });
  sheet = open(card, 'pressure');
  expect(options(sheet)[0]?.shows).toBe('mbar');
  sheet.close();
  card = await page();
  sheet = open(card, 'pressure');
  expect(options(sheet)[0]?.shows).toBe('inHg');
});

test('temperatures picked in Celsius go back to following Home Assistant from the same menu', async () => {
  const card = await page(),
    sheet = open(card, 'feels_like'),
    // Feels like 58 °F, and 14 °C.
    felt = () => part(card.root, '.tile[data-tile=feels_like]').textContent;
  expect(felt()).toMatch(/58°/u);
  await pick(sheet, 'temperature_unit', 'Celsius (°C)');
  expect(options(sheet)[0]).toMatchObject({
    shows: '°C',
    choices: ['✓ Celsius (°C)', 'Fahrenheit (°F)', 'Use system setting (°F)'],
  });
  expect(felt()).toMatch(/14°/u);
  await pick(sheet, 'temperature_unit', 'Use system setting (°F)');
  expect(options(sheet)[0]?.shows).toBe('Use system setting (°F)');
  expect(felt()).toMatch(/58°/u);
});

test('from the foot, a menu with no room under its row rises over it, out of the row’s unit and back into it', async () => {
  const card = await page({ sheet_style: 'sheet' }),
    sheet = open(card, 'pressure');
  sheet.scrollTop = sheet.scrollHeight;
  const row = part(sheet, '.sheet-option[data-option=pressure_unit]'),
    unit = part(row, '.option-value');
  part(row, ':scope>button').click();
  const menu = part(row, '.option-menu');
  expect(menu.hidden).toBe(false);
  expect(menu.hasAttribute('data-rising')).toBe(true);
  // At rest its foot and right edge are the unit's.
  const motion = menu.getAnimations();
  for (const animation of motion) animation.finish();
  const rest = menu.getBoundingClientRect(),
    from = unit.getBoundingClientRect();
  expect(rest.bottom).toBeCloseTo(from.bottom, 0);
  expect(rest.right).toBeCloseTo(from.right, 0);
  expect(rest.top).toBeLessThan(from.top - rest.height / 2);
  // As it sets out it is the unit's size where the unit is; it doesn't drop from the unit's top.
  part(row, ':scope>button').click();
  part(row, ':scope>button').click();
  const opening = menu.getAnimations().find(animation => animation.effect?.getComputedTiming().duration !== 0);
  expect(opening).toBeDefined();
  for (const animation of menu.getAnimations()) {
    animation.pause();
    animation.currentTime = 0;
  }
  const start = menu.getBoundingClientRect();
  expect(start.bottom).toBeCloseTo(from.bottom, 0);
  expect(start.right).toBeCloseTo(from.right, 0);
  expect(start.height).toBeLessThan(rest.height / 2);
  // Held and pulled 200 px over its top, it leans after the finger by 3.74% of its height with the
  // corner it shares with the unit where it was: its foot rises by that, its top twice as far.
  for (const animation of menu.getAnimations()) animation.finish();
  const point = (y: number) => ({
    bubbles: true,
    composed: true,
    pointerId: 3,
    pointerType: 'touch',
    clientX: rest.left + rest.width / 2,
    clientY: y,
  });
  menu.dispatchEvent(new PointerEvent('pointerdown', point(rest.top + rest.height / 2)));
  menu.dispatchEvent(new PointerEvent('pointermove', point(rest.top - 200)));
  const leant = menu.getBoundingClientRect();
  expect((rest.bottom - leant.bottom) / rest.height).toBeCloseTo(0.0374, 3);
  expect((rest.top - leant.top) / rest.height).toBeCloseTo(2 * 0.0374, 3);
  expect(leant.right).toBeCloseTo(rest.right, 1);
  menu.dispatchEvent(new PointerEvent('pointercancel', point(rest.top - 200)));
});

test('on a computer a unit opens the system’s own menu, over the unit, and keeps the keyboard there', async () => {
  vi.restoreAllMocks();
  computer(true);
  const card = await page(),
    sheet = open(card, 'pressure'),
    row = part(sheet, '.sheet-option[data-option=pressure_unit]');
  // No button and no glass menu: a select, named for the row, unseen over the unit it shows.
  expect(row.querySelector('button, .glass-menu')).toBeNull();
  const select = part(row, 'select');
  if (!(select instanceof HTMLSelectElement)) throw new Error('No select.');
  expect(select.getAttribute('aria-label')).toBe('Unit');
  expect(options(sheet)).toEqual([
    {
      name: 'Unit',
      shows: 'hPa',
      choices: [
        'Millibars (mbar)',
        'Inches of mercury (inHg)',
        'Millimeters of mercury (mmHg)',
        '✓ Hectopascals (hPa)',
        'Kilopascals (kPa)',
      ],
    },
  ]);
  expect(getComputedStyle(select).opacity).toBe('0');
  const over = select.getBoundingClientRect(),
    unit = part(row, '.option-value').getBoundingClientRect();
  for (const side of ['left', 'top'] as const) expect(over[side]).toBeLessThan(unit[side]);
  for (const side of ['right', 'bottom'] as const) expect(over[side]).toBeGreaterThan(unit[side]);
  // Picked from it, the sheet is in that unit, and the keyboard is on the row's select drawn afresh.
  select.focus();
  select.value = 'inHg';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  expect(sentences(sheet)).toContain('29.88 inHg');
  expect(options(sheet)[0]?.shows).toBe('inHg');
  expect(options(sheet)[0]?.choices).toContain('✓ Inches of mercury (inHg)');
  const focused = card.root.activeElement;
  expect(focused).not.toBe(select);
  expect(focused?.matches('select[data-option=pressure_unit]')).toBe(true);
});

test.each([false, true])('integration unit text survives the options menu (desktop: %s)', desktop => {
  vi.restoreAllMocks();
  computer(desktop);
  const dialog = document.createElement('div'),
    raw = '°X <local> & "unit"';
  dialog.innerHTML = optionsMarkup(['temperature_unit', 'pressure_unit'], {
    setting: () => 'auto',
    own: () => raw,
    pick: () => {},
  });
  const [temperature, pressure] = options(dialog);
  expect(temperature?.shows).toBe(`Use system setting (${raw})`);
  expect(temperature?.choices).toContain(`✓ Use system setting (${raw})`);
  expect(pressure?.shows).toBe(raw);
  expect(dialog.querySelector('local')).toBeNull();
});

test('a focused tile survives a reading update and a rank change', async () => {
  const card = await page({ air_quality_entity: 'sensor.aqi' });
  const original = card.readHass,
    state = original?.states['weather.home'];
  if (!original || !state) throw new Error('No weather entity.');
  const update = (humidity: number, aqi: number) => {
    card.hass = {
      ...original,
      states: {
        ...original.states,
        'weather.home': { ...state, attributes: { ...state.attributes, humidity } },
        'sensor.aqi': { entity_id: 'sensor.aqi', state: String(aqi), attributes: {} },
      },
    };
  };
  update(73, 30);
  const tile = part(card.root, '[data-tile=humidity][data-detail]');
  tile.focus();
  expect(card.root.activeElement).toBe(tile);
  update(81, 30);
  expect(card.root.activeElement).toBe(part(card.root, '[data-tile=humidity]'));
  expect(card.root.activeElement?.textContent).toContain('81');
  const air = part(card.root, '[data-tile=air_quality]');
  air.focus();
  update(81, 180);
  const raised = part(card.root, '[data-tile=air_quality]');
  expect(raised.dataset['rank']).not.toBe(air.dataset['rank']);
  expect(card.root.activeElement).toBe(raised);
});
