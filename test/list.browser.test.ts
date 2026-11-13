import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import '../src/iweather-card.ts';
import type { ForecastEntry, ForecastSubscription, HomeAssistant } from '../src/card/home-assistant.ts';
import type { IWeatherCard } from '../src/iweather-card.ts';
import { iconDetails, weatherIcon } from '../src/weather/icons.ts';
import { SYMBOLS } from '../src/weather/symbols.ts';

// The full page's daily list. Everything here is stylesheet px, with the page's zoom taken back out.
const NOW = Date.UTC(2026, 9, 27, 17, 30),
  HOUR = 3_600_000,
  DAY = 24 * HOUR,
  ZONE = 'America/Chicago',
  ZOOM = 0.8;
const start = Math.floor(NOW / HOUR) * HOUR;
const hoursOf = (count: number, entry: (index: number) => ForecastEntry = () => ({})): ForecastEntry[] =>
  Array.from({ length: count }, (_, i) => ({
    datetime: new Date(start + i * HOUR).toISOString(),
    temperature: 60,
    condition: 'cloudy',
    wind_speed: 4 + (i % 5),
    wind_gust_speed: 12,
    precipitation: 0.01,
    precipitation_probability: 30,
    ...entry(i),
  }));
const daysOf = (count: number, entry: (index: number) => ForecastEntry = () => ({})): ForecastEntry[] =>
  Array.from({ length: count }, (_, i) => ({
    datetime: new Date(NOW + i * DAY).toISOString(),
    temperature: 68,
    templow: 50,
    condition: 'cloudy',
    precipitation: 0.3,
    precipitation_probability: 40,
    wind_speed: 6,
    ...entry(i),
  }));
const hassOf = (
  hours: readonly ForecastEntry[],
  days: readonly ForecastEntry[],
  attributes: Readonly<Record<string, unknown>>,
): HomeAssistant => ({
  states: {
    'weather.home': {
      entity_id: 'weather.home',
      state: 'cloudy',
      attributes: {
        temperature: 66,
        temperature_unit: '°F',
        wind_speed: 6,
        wind_speed_unit: 'mph',
        precipitation_unit: 'in',
        friendly_name: 'Home',
        supported_features: 3,
        ...attributes,
      },
    },
  },
  locale: { language: 'en', time_format: '12' },
  config: { time_zone: ZONE, latitude: 41.9, longitude: -87.6 },
  connection: {
    subscribeMessage(callback: (message: unknown) => void, message: ForecastSubscription) {
      queueMicrotask(() => {
        callback({ forecast: message.forecast_type === 'hourly' ? hours : days });
      });
      return Promise.resolve(() => undefined);
    },
  },
});
async function page(
  hours: readonly ForecastEntry[],
  days: readonly ForecastEntry[],
  mode = 'conditions',
  attributes: Readonly<Record<string, unknown>> = {},
): Promise<IWeatherCard> {
  const card = document.createElement('iweather-card');
  card.style.cssText = 'display:block;width:1310px';
  card.setConfig({
    type: 'custom:iweather-card',
    entity: 'weather.home',
    weather_layout: 'page',
    weather_animation: false,
    open_meteo_forecast: false,
    forecast_days: days.length,
    weather_mode: mode === 'conditions' ? 'conditions' : mode === 'rain' ? 'rain' : 'wind',
  });
  card.hass = hassOf(hours, days, attributes);
  document.body.replaceChildren(card);
  await vi.waitFor(() => {
    expect(card.root.querySelectorAll('.day')).toHaveLength(days.length);
  });
  await new Promise(requestAnimationFrame);
  return card;
}
const rows = (card: IWeatherCard) => [...card.root.querySelectorAll<HTMLElement>('.day')];
const within = (parent: ParentNode, selector: string) => {
  const found = parent.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`No ${selector}.`);
  return found;
};
const box = (node: Element) => {
  const { left, right, top, bottom, width, height } = node.getBoundingClientRect();
  return {
    left: left / ZOOM,
    right: right / ZOOM,
    top: top / ZOOM,
    bottom: bottom / ZOOM,
    width: width / ZOOM,
    height: height / ZOOM,
  };
};
const openSheet = (card: IWeatherCard) => within(card.root, 'dialog[open]');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

test.each([5, 6, 7, 10])('%i rows share the panel equally and fill it to its foot', async count => {
  // A chance under one row's symbol makes that row's words the tallest.
  const card = await page(
      hoursOf(48),
      daysOf(count, i => (i === 1 ? { condition: 'rainy' } : {})),
    ),
    panel = box(within(card.root, '.daily')),
    all = rows(card).map(box),
    [first] = all,
    last = all.at(-1);
  if (!first || !last) throw new Error('No rows.');
  for (const row of all) expect(row.height).toBeCloseTo(panel.height / count, 1);
  expect(first.top).toBeCloseTo(panel.top, 1);
  expect(last.bottom).toBeCloseTo(panel.bottom, 1);
});

test('a row’s low adds its light to the panel, on the line of its high', async () => {
  const card = await page(hoursOf(48), daysOf(10)),
    [row] = rows(card);
  if (!row) throw new Error('No row.');
  expect(getComputedStyle(row).textShadow).toBe('none');
  const low = within(row, '.day-low');
  expect(getComputedStyle(within(low, '.lift')).backdropFilter).toBe('brightness(1.333)');
  expect(within(low, '.words g').getAttribute('fill-opacity')).toBe('0.250');
  expect(getComputedStyle(within(low, 'span')).visibility).toBe('hidden');
  const middle = (node: Element) => {
    const { top, bottom } = node.getBoundingClientRect();
    return (top + bottom) / 2;
  };
  expect(Math.abs(middle(within(low, '.words g text')) - middle(within(row, '.day-high')))).toBeLessThan(1);
});

test('a column is as wide as its longest words on any row, so that none runs over', async () => {
  const card = await page(
      hoursOf(48),
      daysOf(10, i => (i === 3 ? { temperature: 100, templow: -10 } : {})),
    ),
    all = rows(card);
  for (const row of all) {
    const low = box(within(row, '.day-low')),
      track = box(within(row, '.range-track')),
      high = box(within(row, '.day-high')),
      ink = (node: HTMLElement) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return range.getBoundingClientRect().width / ZOOM;
      };
    // Every row holds to the longest, here '-10°' and '100°'.
    expect(ink(within(row, '.day-low'))).toBeLessThanOrEqual(low.width + 0.01);
    expect(ink(within(row, '.day-high'))).toBeLessThanOrEqual(high.width + 0.01);
    expect(track.left - low.right).toBeCloseTo(10, 1);
    expect(high.left - track.right).toBeCloseTo(10, 1);
    expect(high.right).toBeCloseTo(box(row).right, 1);
  }
  const lefts = new Set(all.map(row => box(within(row, '.range-track')).left.toFixed(1)));
  expect(lefts.size).toBe(1);
  expect(box(within(all[3] ?? card, '.day-high')).width).toBeGreaterThan(32.5);
});

test('ordinary temperatures keep the columns of a day name and temperature at 15 points', async () => {
  const card = await page(hoursOf(48), daysOf(10)),
    [row] = rows(card);
  if (!row) throw new Error('No row.');
  expect(box(within(row, '.day-name')).width).toBeCloseTo(52.8, 0);
  expect(box(within(row, '.day-high')).width).toBeCloseTo(32.5, 1);
  expect(box(within(row, '.range-track')).width).toBeCloseTo(125, 1);
});

test('a chance shows by the day’s condition, not its number: rain at 5% does, cloud at 30% doesn’t', async () => {
  const card = await page(
      hoursOf(48, () => ({ precipitation_probability: undefined })),
      daysOf(10, i => ({
        condition: i === 2 ? 'rainy' : 'cloudy',
        precipitation_probability: i === 2 ? 5 : 30,
      })),
    ),
    shown = [...card.root.querySelectorAll('.day-chance')];
  expect(shown.map(chance => chance.textContent)).toEqual(['5%']);
  expect(getComputedStyle(within(card.root, '.day-chance')).color).toBe('rgb(60, 211, 254)');
});

test('a later day’s symbol goes by its total over the day: a wet day of a tenth is drizzle', async () => {
  const card = await page(
      hoursOf(10),
      daysOf(10, i => (i === 2 ? { condition: 'rainy', precipitation: 0.1 } : {})),
    ),
    held = document.createElement('i');
  held.innerHTML = SYMBOLS.drizzle;
  expect(within(rows(card)[2] ?? card.root, '.day-icon svg').outerHTML).toBe(held.innerHTML);
});

test('today’s row reads what is left of it: the wettest hour’s symbol and the worst chance', async () => {
  const wet = { condition: 'pouring', cloud_coverage: 95, precipitation: 0.8, precipitation_probability: 60 },
    card = await page(
      hoursOf(10, i => (i === 3 ? wet : { precipitation_probability: 10 })),
      daysOf(10, i => (i ? {} : { precipitation_probability: 95 })),
    ),
    [today] = rows(card);
  if (!today) throw new Error('No row.');
  expect(within(today, '.day-chance').textContent).toBe('60%');
  const symbol = document.createElement('template');
  symbol.innerHTML = weatherIcon('pouring', false, iconDetails(wet, {}));
  expect(within(today, '.day-icon svg').outerHTML).toBe(symbol.innerHTML);
  expect(today.getAttribute('aria-label')).toContain('Heavy rain');
});

test('today’s symbol goes by the wet hour’s readings, not by the weather now', async () => {
  const hours = hoursOf(10, i => (i === 3 ? { condition: 'rainy', cloud_coverage: 95, precipitation: 0.2 } : {})),
    clear = await page(hours, daysOf(10), 'conditions', { cloud_coverage: 5 }),
    held = within(clear.root, '.day-icon svg').outerHTML,
    overcast = await page(hours, daysOf(10), 'conditions', { cloud_coverage: 95 });
  expect(held).toBe(within(overcast.root, '.day-icon svg').outerHTML);
});

test('a rain row: plot, amount and chance where they stand, in the same type', async () => {
  const card = await page(hoursOf(48), daysOf(10), 'rain'),
    [row] = rows(card);
  if (!row) throw new Error('No row.');
  const panel = box(within(card.root, '.daily')),
    plot = box(within(row, '.rain-segments')),
    bars = [...row.querySelectorAll('.segment')].map(box),
    [first] = bars,
    last = bars.at(-1);
  if (!first || !last) throw new Error('No bars.');
  expect(plot.height).toBeCloseTo(30, 1);
  expect(first.width).toBeCloseTo(7.5, 1);
  expect(first.height).toBeCloseTo(30, 1);
  expect(last.left + last.width / 2 - (first.left + first.width / 2)).toBeCloseTo(125, 1);
  expect(first.left + first.width / 2 - panel.left).toBeCloseTo(97.5, 0);
  for (const selector of ['.day-name', '.day-amount', '.day-rain-chance']) {
    const style = getComputedStyle(within(row, selector));
    expect(style.fontSize).toBe('16.25px');
    expect(style.fontWeight).toBe('500');
  }
  expect(box(within(row, '.day-rain-chance')).right).toBeCloseTo(box(row).right, 1);
});

test('the now outline stays on today’s bar and nothing dims beside it', async () => {
  const card = await page(hoursOf(48), daysOf(10), 'rain'),
    [today, tomorrow] = rows(card);
  if (!today || !tomorrow) throw new Error('No rows.');
  const outlined = [...today.querySelectorAll('.segment')].findIndex(bar => bar.matches('[data-now=true]')),
    outline = getComputedStyle(within(today, '[data-now=true]'), '::after');
  // 12:30 by the clock in Chicago's daylight time.
  expect(outlined).toBe(6);
  expect(outline.borderTopWidth).toBe('1.25px');
  expect(outline.borderTopColor).toBe('rgb(255, 255, 255)');
  expect(tomorrow.querySelector('[data-now]')).toBeNull();
  for (const bar of today.querySelectorAll('.segment')) expect(getComputedStyle(bar).opacity).toBe('1');
  const dry = await page(
    hoursOf(48, () => ({ precipitation: 0 })),
    daysOf(10),
    'rain',
  );
  expect(rows(dry)[0]?.querySelectorAll('[data-now=true]'), 'on a dry bar too').toHaveLength(1);
});

test('an amount is bright beside its drop, a 0″ too, and dim without one', async () => {
  const chances = [30, 5, 40],
    card = await page(
      hoursOf(10),
      daysOf(10, i => ({ precipitation: i === 8 ? 0.3 : 0, precipitation_probability: chances[i - 6] ?? 0 })),
      'rain',
    ),
    [likely, unlikely, wet] = rows(card).slice(6, 9);
  if (!likely || !unlikely || !wet) throw new Error('No rows.');
  const shown = (row: HTMLElement) => ({
    amount: within(row, '.day-amount>span').textContent,
    drop: row.querySelector('.day-rain-chance svg') !== null,
    zero: within(row, '.day-amount').dataset['zero'],
  });
  expect(shown(likely)).toEqual({ amount: '0″', drop: true, zero: 'false' });
  expect(shown(unlikely)).toEqual({ amount: '0″', drop: false, zero: 'true' });
  expect(shown(wet)).toEqual({ amount: '.3″', drop: true, zero: 'false' });
});

test('with no chance on any row the column goes, and the amount takes the right edge', async () => {
  const none = { precipitation_probability: undefined },
    card = await page(
      hoursOf(48, () => none),
      daysOf(10, () => none),
      'rain',
    );
  expect(card.root.querySelector('.day-rain-chance')).toBeNull();
  for (const row of rows(card)) expect(box(within(row, '.day-amount')).right).toBeCloseTo(box(row).right, 1);
});

test('a chance on one day keeps the column for them all, and a row without one leaves it empty', async () => {
  const card = await page(
      hoursOf(48, () => ({ precipitation_probability: undefined })),
      daysOf(10, i => ({ precipitation_probability: i === 4 ? 40 : undefined })),
      'rain',
    ),
    all = rows(card);
  expect(card.root.querySelectorAll('.day-rain-chance')).toHaveLength(1);
  const rights = new Set(all.map(row => box(within(row, '.day-amount')).right.toFixed(1)));
  expect(rights.size).toBe(1);
  expect(box(within(all[0] ?? card, '.day-amount')).right).toBeLessThan(box(all[0] ?? card).right - 40);
});

test('each row holds the light a press adds, shaped by its place in the list', async () => {
  const card = await page(hoursOf(10), daysOf(10)),
    list = rows(card),
    light = (row: HTMLElement | undefined) => {
      if (!row) throw new Error('No row.');
      return within(row, '.day-press');
    },
    corners = (row: HTMLElement | undefined) => getComputedStyle(light(row)).borderRadius.split(' ');
  // A grey of .8 at 7%, added: the backdrop raised by 1 / .93 under it leaves 14 levels on any glass.
  const held = light(list[0]);
  expect(within(held, 'g').getAttribute('fill')).toBe('rgb(204 204 204)');
  expect(within(held, 'g').getAttribute('fill-opacity')).toBe('0.070');
  expect(within(held, '.lift').style.getPropertyValue('--lift')).toBe('1.075');
  expect(held.getAttribute('aria-hidden')).toBe('true');
  expect(getComputedStyle(within(held, '.lift')).display, 'nothing to filter until it’s pressed').toBe('none');
  // Edge to edge: from the panel's left side to its right.
  const panel = box(within(card.root, '.daily')),
    row = box(list[0] ?? held),
    style = getComputedStyle(held);
  expect(Number.parseFloat(style.left) + row.left - panel.left).toBeCloseTo(0, 0);
  expect(panel.right - (row.right - Number.parseFloat(style.right))).toBeCloseTo(0, 0);
  // The panel's corners at the list's ends, none between, and all four on a row alone.
  const [round = '', ...rest] = corners(list[0]);
  expect(round).not.toBe('0px');
  expect(rest.at(-1)).toBe('0px');
  expect(corners(list[4])).toEqual(['0px']);
  expect(corners(list.at(-1))[0]).toBe('0px');
  const alone = await page(hoursOf(10), daysOf(1));
  expect(corners(rows(alone)[0])).toEqual([round]);
});

test('a day with no hours keeps its bars in their tint, undimmed, with its amount', async () => {
  const card = await page(hoursOf(10), daysOf(10), 'rain'),
    row = rows(card)[6];
  if (!row) throw new Error('No row.');
  expect(row.querySelectorAll('.segment')).toHaveLength(12);
  expect(row.querySelector('.segment span')).toBeNull();
  expect(row.querySelector('.day-tint rect')).toBeTruthy();
  expect(row.querySelector('[data-empty]')).toBeNull();
  expect(within(row, '.day-amount>span').textContent).toBe('.3″');
  expect(getComputedStyle(row).opacity).toBe('1');
  expect(getComputedStyle(within(row, '.rain-segments')).opacity).toBe('1');
});

test('a wind row with too few hours is its text alone, from the day’s forecast', async () => {
  const card = await page(hoursOf(10), daysOf(10), 'wind'),
    row = rows(card)[6];
  if (!row) throw new Error('No row.');
  expect(within(row, '.wind-spark').childElementCount).toBe(0);
  expect(getComputedStyle(within(row, '.wind-spark')).backgroundColor).toBe('rgba(0, 0, 0, 0)');
  expect(within(row, '.day-wind').firstChild?.textContent).toBe('6');
  expect(within(row, '.day-wind small>span').textContent).toBe('mph');
  expect(row.getAttribute('aria-label')).toContain('6 mph');
});

test('a wind row: its range and unit in one type, and a chart 125 × 30', async () => {
  const card = await page(hoursOf(72), daysOf(10), 'wind'),
    row = rows(card)[1];
  if (!row) throw new Error('No row.');
  const words = within(row, '.day-wind'),
    unit = within(words, 'small');
  expect(words.firstChild?.textContent).toBe('4 - 8');
  expect(getComputedStyle(words).fontSize).toBe('16.25px');
  expect(getComputedStyle(unit).fontSize).toBe('16.25px');
  expect(getComputedStyle(words).fontWeight).toBe('500');
  expect(getComputedStyle(unit).fontWeight).toBe('500');
  // The unit adds its light to the panel: white at 25% over a lift of 1 / .75, under its own words.
  expect(getComputedStyle(within(unit, '.lift')).backdropFilter).toBe('brightness(1.333)');
  expect(within(unit, '.words g').getAttribute('fill-opacity')).toBe('0.250');
  expect(getComputedStyle(within(unit, 'span')).visibility).toBe('hidden');
  const plot = box(within(row, '.wind-spark')),
    panel = box(within(card.root, '.daily'));
  expect(plot.width).toBeCloseTo(125, 1);
  expect(plot.height).toBeCloseTo(30, 1);
  expect(plot.left - panel.left).toBeCloseTo(110.6, 0);
  expect(box(words).right).toBeCloseTo(box(row).right, 1);
});

test('without gusts a wind row has no band', async () => {
  const card = await page(
    hoursOf(72, () => ({ wind_gust_speed: undefined })),
    daysOf(10),
    'wind',
  );
  expect(card.root.querySelector('.wind-spark path[fill-opacity]')).toBeNull();
  expect(card.root.querySelector('.wind-spark .day-line path')).toBeTruthy();
});

test.each([
  ['wind', 'wind'],
  ['rain', 'precipitation'],
  ['conditions', 'conditions'],
])('a row in the %s view opens the %s sheet, on its own day, from the top', async (mode, sheet) => {
  const card = await page(hoursOf(48), daysOf(10), mode),
    row = rows(card)[6];
  if (!row) throw new Error('No row.');
  row.click();
  await vi.waitFor(() => {
    expect(openSheet(card).dataset['id']).toBe(sheet);
  });
  expect(card.sheets.detail?.day).toBe(row.dataset['key']);
  expect(card.sheets.detail?.sheet.scrollTop).toBe(0);
});

test('the keyboard opens a row as a press does, and the sheet goes back to it', async () => {
  const card = await page(hoursOf(48), daysOf(10), 'wind'),
    row = rows(card)[2];
  if (!row) throw new Error('No row.');
  row.focus();
  expect(row.tabIndex).toBe(0);
  const pressed = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true, cancelable: true });
  row.dispatchEvent(pressed);
  expect(pressed.defaultPrevented).toBe(true);
  await vi.waitFor(() => {
    expect(openSheet(card).dataset['id']).toBe('wind');
  });
  expect(card.sheets.detail?.day).toBe(row.dataset['key']);
  card.sheets.detail?.dialog.close();
  await vi.waitFor(() => {
    expect(card.root.activeElement).toBe(row);
  });
});

test('whoever is on a row stays on it as the list is drawn again', async () => {
  const card = await page(hoursOf(48), daysOf(10), 'rain'),
    row = rows(card)[2];
  if (!row) throw new Error('No row.');
  row.focus();
  within(card.root, '.modes [data-mode=wind]').click();
  await vi.waitFor(() => {
    expect(rows(card)[2]?.dataset['mode']).toBe('wind');
  });
  expect(rows(card)[2]).not.toBe(row);
  expect(card.root.activeElement).toBe(rows(card)[2]);
});

test('a day with no hours at all opens on that day too', async () => {
  const card = await page(hoursOf(10), daysOf(10), 'wind'),
    row = rows(card)[8];
  if (!row) throw new Error('No row.');
  row.click();
  await vi.waitFor(() => {
    expect(openSheet(card).dataset['id']).toBe('wind');
  });
  expect(card.sheets.detail?.day).toBe(row.dataset['key']);
});
