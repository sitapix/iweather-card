import { afterEach, expect, test, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { MOON_HOUR_PX, MOON_TICK } from '../src/cards/moon/sheet.ts';
import '../src/iweather-card.ts';
import type { ForecastEntry, ForecastSubscription, HomeAssistant } from '../src/card/home-assistant.ts';
import type { IWeatherCard } from '../src/iweather-card.ts';
import { comparisonMarkup } from '../src/sheets/compare.ts';
import { SHEET_TAIL, sheetOutline } from '../src/sheets/popover.ts';

// What every sheet shares, as the styles draw it. Lengths are the sheet's own px, which a
// standard card draws at .8. e2e/sheet.spec.ts holds the frame to the other engines.
const ZOOM = 0.8,
  HOUR = 3_600_000;
const NEAR = 0.1;

const hourly = (length = 48) =>
  Array.from({ length }, (_, i) => ({
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
const hassWith = (located = true, hours = 48): HomeAssistant => ({
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
    'sun.sun': {
      entity_id: 'sun.sun',
      state: 'above_horizon',
      attributes: {
        elevation: 40,
        rising: true,
        next_rising: new Date(Date.now() + 18 * HOUR).toISOString(),
        next_setting: new Date(Date.now() + 6 * HOUR).toISOString(),
        next_noon: new Date(Date.now() + 2 * HOUR).toISOString(),
      },
    },
  },
  locale: { language: 'en', time_format: '12' },
  config: {
    location_name: 'Home',
    time_zone: 'America/Chicago',
    ...(located ? { latitude: 41.9, longitude: -87.6 } : {}),
  },
  connection: {
    subscribeMessage(callback: (message: unknown) => void, message: ForecastSubscription) {
      queueMicrotask(() => {
        callback({ forecast: message.forecast_type === 'hourly' ? hourly(hours) : daily() });
      });
      return Promise.resolve(() => undefined);
    },
  },
});
async function page(hass = hassWith(), config: object = {}): Promise<IWeatherCard> {
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
  card.hass = hass;
  document.body.replaceChildren(card);
  await vi.waitFor(() => {
    expect(card.root.querySelector('.tile[data-tile=uv]')).toBeTruthy();
  });
  // Settled: the forecast's first answers, which come a frame after it is put on the page.
  await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
  return card;
}
function part(card: IWeatherCard, selector: string): HTMLElement {
  const node = card.root.querySelector(selector);
  if (!(node instanceof HTMLElement)) throw new Error(`No ${selector}.`);
  return node;
}
// A sheet past its opening scale, so that its boxes read true.
const landed = (card: IWeatherCard) => {
  for (const animation of part(card, 'dialog[open] .sheet').getAnimations()) animation.finish();
  return part(card, 'dialog[open]');
};
const open = (card: IWeatherCard, tile: string) => {
  // A press lands on a tile on the screen, and the page is taller than this window.
  const pressed = part(card, `.tile[data-tile=${tile}]`);
  pressed.scrollIntoView({ block: 'center' });
  pressed.click();
  return landed(card);
};
const closed = (card: IWeatherCard) => {
  const dialog = card.root.querySelector('dialog[open]');
  if (dialog instanceof HTMLDialogElement) dialog.close();
};
// Where a part sits in the sheet, in the sheet's own px, from its rounded rectangle's top.
// Yesterday's page comes first.
const TODAY_CHART = '.chart-page:nth-child(2) .chart';
const fromTop = (card: IWeatherCard, selector: string) =>
  (part(card, `dialog[open] ${selector}`).getBoundingClientRect().top -
    part(card, 'dialog[open]').getBoundingClientRect().top) /
  ZOOM;
const settled = () =>
  new Promise<void>(done => {
    requestAnimationFrame(() => requestAnimationFrame(() => done()));
  });

afterEach(() => {
  document.body.replaceChildren();
});

test('a sheet keeps keyboard focus on its day controls and tabs after drawing again', async () => {
  const card = await page();
  open(card, 'feels_like');
  for (const selector of ['[data-step="1"]', '[data-variant=temperature]', '.detail-days [aria-pressed=true]']) {
    const button = part(card, `dialog[open] ${selector}`);
    button.focus();
    button.click();
    expect(card.root.activeElement).toBe(part(card, `dialog[open] ${selector}`));
  }
});

test('reaching the last day keeps keyboard focus in the day picker', async () => {
  const card = await page();
  open(card, 'uv');
  const buttons = card.root.querySelectorAll<HTMLElement>('dialog[open] .detail-days button'),
    previous = buttons.item(buttons.length - 2);
  previous.click();
  const next = part(card, 'dialog[open] [data-step="1"]');
  next.focus();
  next.click();
  expect(card.root.activeElement).toBe(part(card, 'dialog[open] .detail-days [aria-pressed=true]'));
});

test('every sheet is one size in the styles, with nothing written on it to hold it there', async () => {
  const card = await page();
  for (const tile of [
    'uv',
    'wind',
    'humidity',
    'pressure',
    'visibility',
    'feels_like',
    'precipitation',
    'moon',
    'sun',
  ]) {
    const dialog = open(card, tile),
      sheet = part(card, 'dialog[open] .sheet'),
      box = dialog.getBoundingClientRect();
    expect(box.width, tile).toBeCloseTo(400 * ZOOM, 1);
    expect(box.height, tile).toBeCloseTo(800 * ZOOM, 1);
    expect(sheet.style.minHeight, tile).toBe('');
    expect(sheet.style.height, tile).toBe('');
    closed(card);
    await settled();
  }
  card.remove();
});

test('a tab and a day leave the sheet where it is, and what follows the tabs too', async () => {
  const card = await page(),
    dialog = open(card, 'feels_like'),
    frame = () => {
      const { left, top, width, height } = dialog.getBoundingClientRect();
      return [left, top, width, height];
    },
    at = frame(),
    chance = fromTop(card, '.detail-chance'),
    press = (selector: string) => {
      part(card, `dialog[open] ${selector}`).click();
      expect(frame()).toEqual(at);
      expect(Math.abs(fromTop(card, '.detail-chance') - chance)).toBeLessThan(NEAR);
    };
  // The note is one line on one tab and two on the other, in a place for two.
  const slot = () => part(card, 'dialog[open] .detail-note').getBoundingClientRect().height / ZOOM;
  expect(slot()).toBeCloseTo(32.5, 1);
  press('[data-variant=temperature]');
  expect(slot()).toBeCloseTo(32.5, 1);
  press('[data-variant=feels_like]');
  press('[data-step="1"]');
  card.remove();
});

test('a sheet with nothing to show but a note hugs it', async () => {
  const card = await page(hassWith(false));
  card.sheets.open('sun', part(card, '.tile[data-tile=uv]'));
  const dialog = landed(card);
  expect(part(card, 'dialog[open] .detail-text').textContent).toContain('home location');
  const box = dialog.getBoundingClientRect(),
    note = part(card, 'dialog[open] .detail-text').getBoundingClientRect();
  expect(box.height).toBeLessThan(800 * ZOOM);
  expect(box.bottom - note.bottom).toBeCloseTo(25 * ZOOM, 0);
  card.remove();
});

test('the title and what follows it keep their places from the top', async () => {
  const card = await page();
  open(card, 'uv');
  const title = part(card, 'dialog[open] .sheet>header h2').getBoundingClientRect(),
    dialog = part(card, 'dialog[open]').getBoundingClientRect();
  expect((title.top + title.height / 2 - dialog.top) / ZOOM).toBeCloseTo(40, 0);
  expect(fromTop(card, '.detail-days')).toBeCloseTo(92.5, 1);
  expect(fromTop(card, '.detail-date')).toBeCloseTo(158.75, 1);
  expect(fromTop(card, '.detail-reading')).toBeCloseTo(215, 1);
  expect(fromTop(card, TODAY_CHART)).toBeCloseTo(284.4, 1);
  const date = getComputedStyle(part(card, 'dialog[open] .detail-date'), '::after');
  expect(date.left).toBe('7.5px');
  expect(date.height).toBe('1.25px');
  expect(date.backgroundColor).toBe('rgba(255, 255, 255, 0.1)');
  const sheet = part(card, 'dialog[open] .sheet').getBoundingClientRect(),
    chart = part(card, `dialog[open] ${TODAY_CHART}`).getBoundingClientRect();
  expect((chart.left - dialog.left) / ZOOM).toBeCloseTo(12.5, 1);
  expect((dialog.right - chart.right) / ZOOM).toBeCloseTo(12.5, 1);
  expect(sheet.width).toBeGreaterThanOrEqual(dialog.width);
  card.remove();
});

test('a section’s rule runs from edge to edge, 1.25 at white .10', async () => {
  const card = await page();
  open(card, 'uv');
  const section = part(card, 'dialog[open] .detail-compare'),
    dialog = part(card, 'dialog[open]').getBoundingClientRect(),
    rule = getComputedStyle(section, '::before');
  expect(rule.height).toBe('1.25px');
  expect(rule.backgroundColor).toBe('rgba(255, 255, 255, 0.1)');
  const reach = parseFloat(rule.left) * ZOOM;
  expect(section.getBoundingClientRect().left + reach).toBeCloseTo(dialog.left, 0);
  card.remove();
});

test('at rest the title bar isn’t there, and once scrolled it takes the title without moving it', async () => {
  const card = await page(),
    dialog = open(card, 'uv'),
    sheet = part(card, 'dialog[open] .sheet'),
    band = part(card, 'dialog[open] .sheet-band'),
    own = part(card, 'dialog[open] .sheet>header h2'),
    copy = part(card, 'dialog[open] .sheet-band h2'),
    glass = () => getComputedStyle(band, '::before'),
    at = own.getBoundingClientRect();
  expect(glass().opacity).toBe('0');
  expect(getComputedStyle(own).visibility).toBe('visible');
  expect(getComputedStyle(copy).visibility).toBe('hidden');
  expect(band.getBoundingClientRect().height / ZOOM).toBeCloseTo(80, 1);
  sheet.scrollTop = 120;
  await vi.waitFor(() => {
    expect(dialog.hasAttribute('data-scrolled')).toBe(true);
  });
  await vi.waitFor(() => {
    expect(glass().opacity).toBe('1');
  });
  expect(getComputedStyle(own).opacity).toBe('0');
  expect(getComputedStyle(copy).visibility).toBe('visible');
  const moved = copy.getBoundingClientRect();
  expect(moved.top).toBeCloseTo(at.top, 1);
  expect(moved.left).toBeCloseTo(at.left, 1);
  // A white .10 hairline at the foot, and the sheet running on under the bar to its very top.
  expect(glass().borderBottomWidth).toBe('1.25px');
  expect(glass().borderBottomColor).toBe('rgba(255, 255, 255, 0.1)');
  expect(glass().backdropFilter).toContain('blur');
  expect(sheet.getBoundingClientRect().top).toBeCloseTo(band.getBoundingClientRect().top, 0);
  expect(getComputedStyle(sheet).paddingTop).toBe('0px');
  card.remove();
});

test('a row is 46.25 from the next, a rule centred between them and none after the last', async () => {
  const card = await page();
  open(card, 'sun');
  for (const list of ['.sun-rows', '.sun-months']) {
    const rows = [...part(card, `dialog[open] ${list}`).children];
    expect(rows.length, list).toBeGreaterThan(1);
    const [first, second] = rows;
    if (!first || !second) throw new Error('No rows.');
    expect((second.getBoundingClientRect().top - first.getBoundingClientRect().top) / ZOOM, list).toBeCloseTo(46.25, 1);
    expect(first.getBoundingClientRect().height / ZOOM, list).toBeCloseTo(20, 1);
    const rule = getComputedStyle(second, '::before');
    expect(rule.height).toBe('1.25px');
    expect(rule.backgroundColor).toBe('rgba(255, 255, 255, 0.1)');
    // Centred in the gap: as far from the row above as from the row below.
    expect(parseFloat(rule.top)).toBeCloseTo(-(26.25 + 1.25) / 2, 1);
    expect(getComputedStyle(first, '::before').content).toBe('none');
  }
  card.remove();
});

test('a row’s label is bright and its value dim and hardly heavier', async () => {
  const card = await page();
  open(card, 'sun');
  const label = getComputedStyle(part(card, 'dialog[open] .sun-rows dt')),
    value = getComputedStyle(part(card, 'dialog[open] .sun-rows dd')),
    month = getComputedStyle(part(card, 'dialog[open] .sun-months dt'));
  expect([label.fontSize, label.fontWeight, label.color]).toEqual(['16.25px', '400', 'rgba(255, 255, 255, 0.85)']);
  expect([value.fontSize, value.fontWeight, value.color]).toEqual(['16.25px', '450', 'rgba(255, 255, 255, 0.55)']);
  expect([month.fontSize, month.fontWeight, month.color]).toEqual(['16.25px', '600', 'rgba(255, 255, 255, 0.85)']);
  card.remove();
});

test('the sheet’s type', async () => {
  const card = await page(),
    style = (selector: string) => getComputedStyle(part(card, `dialog[open] ${selector}`)),
    of = (selector: string) => {
      const { fontSize, fontWeight, lineHeight } = style(selector);
      return [fontSize, fontWeight, lineHeight];
    };
  open(card, 'uv');
  expect(of('.sheet>header h2').slice(0, 2)).toEqual(['16.25px', '700']);
  expect(of('.detail-summary h3.detail-now')).toEqual(['13.75px', '600', '17.5px']);
  expect(of('.detail-summary p')).toEqual(['16.25px', '400', '20px']);
  expect(of('.detail-compare h3').slice(0, 2)).toEqual(['21.25px', '600']);
  expect(of('.detail-sub').slice(0, 2)).toEqual(['13.75px', '500']);
  expect(style('.detail-sub').color).toBe('rgba(255, 255, 255, 0.55)');
  closed(card);
  open(card, 'moon');
  expect(of('.moon-hero b').slice(0, 2)).toEqual(['21.25px', '600']);
  expect(of('.moon-hero span').slice(0, 2)).toEqual(['16.25px', '450']);
  card.remove();
});

test('the glass is a light grey at half strength over a narrow blur', async () => {
  const card = await page();
  open(card, 'uv');
  const glass = getComputedStyle(part(card, 'dialog[open] .sheet-glass'));
  expect(glass.backdropFilter).toBe('blur(10px) saturate(1.5)');
  expect(glass.backgroundColor).toBe('rgba(107, 110, 115, 0.5)');
  card.remove();
});

// The days and their strip.
const pressed = (card: IWeatherCard) => part(card, 'dialog[open] .detail-days [aria-pressed=true]');
const zoned = (time: number) => new Date(time).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
const glided = async (card: IWeatherCard, left: number) => {
  await vi.waitFor(() => {
    expect(part(card, 'dialog[open] .detail-days').scrollLeft).toBeCloseTo(left, 0);
  });
};

test('every day-based sheet offers yesterday, today and nine more, and opens on today', async () => {
  const card = await page();
  for (const tile of ['uv', 'wind', 'humidity', 'pressure', 'visibility', 'precipitation']) {
    open(card, tile);
    const cells = [...card.root.querySelectorAll<HTMLElement>('dialog[open] .detail-days button')];
    expect(cells.map(cell => cell.dataset['tense'])).toEqual([
      'past',
      'today',
      ...Array.from({ length: 9 }, () => 'later'),
    ]);
    expect(pressed(card).dataset['tense'], tile).toBe('today');
    expect(pressed(card).getAttribute('aria-current'), tile).toBe('date');
    closed(card);
    await settled();
  }
  card.remove();
});

test('a number’s colour follows its tense, chosen or not', async () => {
  const card = await page(),
    number = (tense: string) => getComputedStyle(part(card, `dialog[open] [data-tense=${tense}] b`));
  open(card, 'uv');
  const dark = 'rgb(30, 30, 30)',
    grey = 'rgb(152, 152, 157)',
    cyan = 'rgb(60, 211, 254)';
  expect([number('past').color, number('past').backgroundColor]).toEqual([grey, 'rgba(0, 0, 0, 0)']);
  expect([number('today').color, number('today').backgroundColor]).toEqual([dark, cyan]);
  expect(number('later').color).toBe('rgba(255, 255, 255, 0.85)');
  part(card, 'dialog[open] [data-step="1"]').click();
  expect([number('today').color, number('today').backgroundColor]).toEqual([cyan, 'rgba(0, 0, 0, 0)']);
  const later = getComputedStyle(part(card, 'dialog[open] [aria-pressed=true] b'));
  expect([later.color, later.backgroundColor]).toEqual([dark, 'rgb(255, 255, 255)']);
  part(card, 'dialog[open] [data-step="-1"]').click();
  part(card, 'dialog[open] [data-step="-1"]').click();
  expect([number('past').color, number('past').backgroundColor]).toEqual([dark, grey]);
  card.remove();
});

test('the strip’s cells stand 50 apart, its circles 37.5, with the weekday the same on every day', async () => {
  const card = await page();
  open(card, 'uv');
  const dialog = part(card, 'dialog[open]').getBoundingClientRect(),
    cells = [...card.root.querySelectorAll('dialog[open] .detail-days b')].map(cell => cell.getBoundingClientRect()),
    [first, second] = cells;
  if (!first || !second) throw new Error('No cells.');
  expect((second.left - first.left) / ZOOM).toBeCloseTo(50, 1);
  expect(first.width / ZOOM).toBeCloseTo(37.5, 1);
  expect((first.left - dialog.left) / ZOOM).toBeCloseTo(12.5, 1);
  const weekdays = [...card.root.querySelectorAll('dialog[open] .detail-days span')].map(cell => {
    const { fontSize, fontWeight, color } = getComputedStyle(cell);
    return [fontSize, fontWeight, color].join();
  });
  expect(new Set(weekdays)).toEqual(new Set(['13.75px,500,rgba(255, 255, 255, 0.85)']));
  const day = getComputedStyle(part(card, 'dialog[open] .detail-days b')),
    date = getComputedStyle(part(card, 'dialog[open] .detail-date'));
  expect([day.fontSize, day.fontWeight]).toEqual(['16.25px', '500']);
  expect([date.fontSize, date.fontWeight]).toEqual(['16.25px', '400']);
  card.remove();
});

test('the strip moves the least that shows the day, on its own, and starts over at the ends', async () => {
  const card = await page(hassWith(true, 240)),
    next = () => part(card, 'dialog[open] [data-step="1"]'),
    previous = () => part(card, 'dialog[open] [data-step="-1"]');
  open(card, 'uv');
  const sheet = part(card, 'dialog[open] .sheet');
  sheet.scrollTop = 40;
  const down = scrollY;
  // Eight show: no need to move until the eighth's own side would leave.
  for (let i = 0; i < 5; i += 1) next().click();
  await glided(card, 0);
  next().click();
  await glided(card, 6.25);
  next().click();
  await glided(card, 56.25);
  expect(part(card, 'dialog[open] [aria-pressed=true] b').getBoundingClientRect().right).toBeCloseTo(
    part(card, 'dialog[open]').getBoundingClientRect().right - 6.25 * ZOOM,
    1,
  );
  // Back within what shows, it stays put.
  previous().click();
  await settled();
  await glided(card, 56.25);
  expect(sheet.scrollTop).toBe(40);
  expect(scrollY).toBe(down);
  // The last has the end of the strip beyond it, and so has the first.
  for (let i = 0; i < 3; i += 1) next().click();
  await glided(card, 162.5);
  expect(next().matches(':disabled')).toBe(true);
  for (let i = 0; i < 10; i += 1) previous().click();
  await glided(card, 0);
  expect(pressed(card).dataset['tense']).toBe('past');
  expect(previous().matches(':disabled')).toBe(true);
  card.remove();
});

test('a day picked stands though its pages come to rest short of it, until a hand takes over', async () => {
  const card = await page(),
    day = () => pressed(card).dataset['day'];
  open(card, 'uv');
  await settled();
  const strip = part(card, 'dialog[open] .chart-pages'),
    next = () => part(card, 'dialog[open] [data-step="1"]');
  for (let i = 0; i < 3; i += 1) next().click();
  const picked = day(),
    width = strip.clientWidth,
    target = Math.round(strip.scrollLeft / width) + 3;
  // Held up on the way, as a slide can be on a busy page.
  strip.scrollTo({ left: width, behavior: 'instant' });
  await vi.waitFor(() => {
    expect(strip.scrollLeft).toBeCloseTo(target * width, 0);
  });
  expect(day()).toBe(picked);
  // A finger on the pages is another matter: the sheet follows where it takes them.
  next().click();
  strip.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, composed: true }));
  strip.scrollTo({ left: width, behavior: 'instant' });
  await vi.waitFor(() => {
    expect(pressed(card).dataset['tense']).toBe('today');
  });
  card.remove();
});

test('a sheet can open on any day it lists, and one the forecast has no hours for says so', async () => {
  const card = await page(),
    [last] = card.update?.ctx.daily.slice(-1) ?? [];
  if (!last) throw new Error('No days.');
  for (const id of ['wind', 'humidity', 'uv', 'visibility', 'conditions', 'precipitation'] as const) {
    card.sheets.open(id, part(card, '.tile[data-tile=uv]'), zoned(last.time));
    landed(card);
    expect(pressed(card).dataset['day'], id).toBe(zoned(last.time));
    expect(part(card, 'dialog[open] .detail-days').scrollLeft, id).toBeCloseTo(162.5, 0);
    expect(part(card, 'dialog[open] .detail-date span').textContent, id).toContain(
      new Date(last.time).toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'long' }),
    );
    expect(part(card, 'dialog[open] .sheet').textContent, id).toMatch(/The forecast has no hourly \w+ for this\sday\./);
    closed(card);
    await settled();
  }
  card.remove();
});

const WEEK_HOURS = 24;
// A day of what Home Assistant keeps, ending now.
const rowsOf = (attributes: object) =>
  Array.from({ length: WEEK_HOURS * 2 }, (_, i) => ({
    lu: (Date.now() - i * HOUR) / 1000,
    s: 'cloudy',
    a: { temperature_unit: '°F', wind_speed_unit: 'mph', ...attributes },
  }));

// Whether a chart has anything to read: a line, or readings to read at.
const readable = (chart: HTMLElement) => chart.dataset['line'] !== undefined || chart.dataset['points'] !== '[]';
test('yesterday looks up its readings, shows them when they come, and writes no forecast of them', async () => {
  let reply: (value: unknown) => void = () => undefined;
  const asked = new Promise(done => {
      reply = done;
    }),
    hass = { ...hassWith(), callWS: () => asked },
    card = await page(hass);
  open(card, 'wind');
  part(card, 'dialog[open] [data-step="-1"]').click();
  expect(pressed(card).dataset['tense']).toBe('past');
  expect(part(card, 'dialog[open] .detail-summary p').textContent).toBe('Looking up yesterday’s\u00A0readings.');
  // Its chart keeps its frame, with nothing in it yet.
  const yesterday = `dialog[open] .chart-page[data-day="${pressed(card).dataset['day'] ?? ''}"]`;
  expect(readable(part(card, `${yesterday} .chart`))).toBe(false);
  reply({ 'weather.home': rowsOf({ wind_speed: 12 }) });
  await vi.waitFor(() => {
    expect(readable(part(card, `${yesterday} .chart`))).toBe(true);
  });
  expect(part(card, 'dialog[open] .sheet').textContent).not.toMatch(/will be/);
  expect(pressed(card).dataset['tense']).toBe('past');
  card.remove();
});

test('yesterday with no history to ask, or none that came, says there is no record', async () => {
  for (const hass of [hassWith(), { ...hassWith(), callWS: () => Promise.reject(new Error('No recorder.')) }]) {
    const card = await page(hass);
    open(card, 'humidity');
    part(card, 'dialog[open] [data-step="-1"]').click();
    await vi.waitFor(() => {
      expect(part(card, 'dialog[open] .detail-summary p').textContent).toBe(
        'Home Assistant has no record of yesterday’s\u00A0values.',
      );
    });
    expect(
      readable(part(card, `dialog[open] .chart-page[data-day="${pressed(card).dataset['day'] ?? ''}"] .chart`)),
    ).toBe(false);
    closed(card);
    card.remove();
  }
});

test('yesterday’s conditions take their range and sky from what was recorded', async () => {
  const hass = {
      ...hassWith(),
      callWS: () => Promise.resolve({ 'weather.home': rowsOf({ temperature: 71 }) }),
    },
    card = await page(hass);
  card.sheets.open('conditions', part(card, '.tile[data-tile=uv]'));
  landed(card);
  await settled();
  part(card, 'dialog[open] [data-step="-1"]').click();
  await vi.waitFor(() => {
    expect(part(card, 'dialog[open] .detail-headline').textContent).toContain('71°');
  });
  // Its summary tells of a day that's over.
  expect(part(card, 'dialog[open] .detail-compare p').textContent).toMatch(/low was 71° .* high was 71°/);
  card.remove();
});

// The tabs.
test('tabs are a capsule, the thumb inset 2.5 all round, the chosen one’s text a little heavier', async () => {
  const card = await page();
  card.sheets.open('conditions', part(card, '.tile[data-tile=uv]'));
  landed(card);
  const dialog = part(card, 'dialog[open]').getBoundingClientRect(),
    track = part(card, 'dialog[open] .segmented'),
    box = track.getBoundingClientRect(),
    thumb = part(card, 'dialog[open] .segmented .thumb').getBoundingClientRect();
  expect((box.left - dialog.left) / ZOOM).toBeCloseTo(12.5, 1);
  expect(box.width / ZOOM).toBeCloseTo(375, 1);
  expect(box.height / ZOOM).toBeCloseTo(40, 1);
  expect(thumb.width / ZOOM).toBeCloseTo(182.5, 1);
  expect(thumb.height / ZOOM).toBeCloseTo(35, 1);
  expect((thumb.left - box.left) / ZOOM).toBeCloseTo(2.5, 1);
  expect((thumb.top - box.top) / ZOOM).toBeCloseTo(2.5, 1);
  expect(getComputedStyle(track).backgroundColor).toBe('rgba(255, 255, 255, 0.06)');
  expect(getComputedStyle(track).borderRadius).toBe('20px');
  expect(getComputedStyle(part(card, 'dialog[open] .thumb')).backgroundColor).toBe('rgba(255, 255, 255, 0.28)');
  const chosen = getComputedStyle(part(card, 'dialog[open] .segmented [aria-pressed=true]')),
    other = getComputedStyle(part(card, 'dialog[open] .segmented [aria-pressed=false]'));
  expect([chosen.fontSize, other.fontSize]).toEqual(['16.25px', '16.25px']);
  expect(Number(chosen.fontWeight)).toBeGreaterThanOrEqual(500);
  expect(Number(chosen.fontWeight)).toBeLessThanOrEqual(600);
  expect(other.fontWeight).toBe('400');
  card.remove();
});

test('the thumb slides from where it was on a tight spring, at its own size', async () => {
  const card = await page();
  card.sheets.open('conditions', part(card, '.tile[data-tile=uv]'));
  landed(card);
  const box = () => part(card, 'dialog[open] .segmented .thumb').getBoundingClientRect(),
    from = box();
  part(card, 'dialog[open] [data-variant=feels_like]').click();
  const thumb = part(card, 'dialog[open] .segmented .thumb'),
    [slide] = thumb.getAnimations();
  if (!slide) throw new Error('It didn’t slide.');
  slide.pause();
  const progress = (at: number) => {
    slide.currentTime = at;
    return (box().left - from.left) / travel;
  };
  slide.currentTime = 0;
  expect(box().left).toBeCloseTo(from.left, 1);
  slide.finish();
  const travel = box().left - from.left;
  expect(travel / ZOOM).toBeCloseTo(187.5, 1);
  expect(progress(100)).toBeGreaterThan(0.45);
  expect(progress(100)).toBeLessThan(0.55);
  expect(progress(240)).toBeGreaterThan(0.95);
  const further = [300, 340, 370, 400, 450, 500].map(at => progress(at));
  expect(Math.max(...further)).toBeGreaterThan(1.003);
  expect(Math.max(...further)).toBeLessThan(1.007);
  expect(progress(370)).toBeGreaterThan(0.995);
  expect(box().width / ZOOM).toBeCloseTo(182.5, 1);
  card.remove();
});

test('with reduced motion the thumb goes straight there, and sheets open and close at once', async () => {
  const card = await page();
  Object.defineProperty(card, 'motion', { value: { matches: true, removeEventListener: () => undefined } });
  card.sheets.open('conditions', part(card, '.tile[data-tile=uv]'));
  const dialog = part(card, 'dialog[open]');
  expect(part(card, 'dialog[open] .sheet').getAnimations()).toEqual([]);
  part(card, 'dialog[open] [data-variant=feels_like]').click();
  expect(part(card, 'dialog[open] .segmented .thumb').getAnimations()).toEqual([]);
  card.sheets.close();
  expect(dialog.hasAttribute('open')).toBe(false);
  card.remove();
});

// Opening and closing.
test('a sheet opens from the tip of its tail on a spring, its parts as one', async () => {
  const card = await page();
  part(card, '.tile[data-tile=uv]').click();
  const dialog = part(card, 'dialog[open]');
  const parts = ['.sheet-glass', '.sheet', '.sheet-edge'].map(selector => part(card, `dialog[open] ${selector}`)),
    motion = parts.flatMap(item => item.getAnimations());
  expect(motion).toHaveLength(6);
  for (const animation of motion) animation.pause();
  const hold = (at: number) => {
    for (const animation of motion) animation.currentTime = at;
    const [glass, sheet] = parts;
    if (!glass || !sheet) throw new Error('No sheet.');
    return {
      scale: new DOMMatrixReadOnly(getComputedStyle(sheet).transform).a,
      opacity: Number(getComputedStyle(sheet).opacity),
      glass: glass.getBoundingClientRect(),
      sheet: sheet.getBoundingClientRect(),
    };
  };
  const rest = hold(600);
  expect(rest.scale).toBe(1);
  // Nothing at first, then the tenth of a second's fade and a fifth of a second's growing, a little
  // past full size, and back.
  expect(hold(0).scale).toBeLessThan(0.02);
  expect(hold(0).opacity).toBe(0);
  expect(hold(45).scale).toBeGreaterThan(0.2);
  expect(hold(45).scale).toBeLessThan(0.3);
  expect(hold(68).scale).toBeGreaterThan(0.42);
  expect(hold(68).scale).toBeLessThan(0.52);
  expect(hold(120).opacity).toBe(1);
  expect(hold(170).scale).toBeGreaterThan(0.93);
  expect(hold(170).scale).toBeLessThan(0.97);
  expect(hold(210).scale).toBeGreaterThan(0.995);
  expect(hold(270).scale).toBeGreaterThan(1.01);
  expect(hold(270).scale).toBeLessThan(1.02);
  expect(hold(460).scale).toBeLessThan(1.003);
  // Whatever its size, the glass and the sheet stay one, their tip where it was.
  const side = dialog.dataset['side'],
    { depth } = SHEET_TAIL;
  // The glass's box reaches as far as the tip on that side.
  const tip = (box: DOMRect) =>
    side === 'above' ? box.bottom : side === 'below' ? box.top : side === 'left' ? box.right : box.left;
  for (const at of [40, 100, 170, 270]) {
    const held = hold(at);
    expect(tip(held.glass), `${at}`).toBeCloseTo(tip(rest.glass), 0);
    expect(held.sheet.width / held.glass.width).toBeCloseTo(rest.sheet.width / rest.glass.width, 2);
    expect(held.sheet.left - held.glass.left).toBeCloseTo(depth * ZOOM * held.scale, 1);
  }
  for (const animation of motion) animation.finish();
  card.remove();
});

test('a sheet goes in a tenth of a second, fading where it is', async () => {
  const card = await page();
  open(card, 'uv');
  const dialog = part(card, 'dialog[open]'),
    sheet = part(card, 'dialog[open] .sheet'),
    at = sheet.getBoundingClientRect();
  dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
  expect(dialog.hasAttribute('open')).toBe(true);
  const [fade] = sheet.getAnimations();
  if (!fade) throw new Error('It didn’t fade.');
  fade.pause();
  fade.currentTime = 50;
  const faded = Number(getComputedStyle(sheet).opacity);
  expect(faded).toBeGreaterThan(0);
  expect(faded).toBeLessThan(0.5);
  expect(sheet.getBoundingClientRect()).toEqual(at);
  expect(fade.effect?.getComputedTiming().duration).toBe(110);
  fade.play();
  await vi.waitFor(() => {
    expect(dialog.hasAttribute('open')).toBe(false);
  });
  expect(sheet.getAnimations()).toEqual([]);
  card.remove();
});

test('a sheet opened while it fades stays, and can fade again', async () => {
  const card = await page(),
    tile = part(card, '.tile[data-tile=uv]');
  open(card, 'uv');
  const dialog = part(card, 'dialog[open]');
  card.sheets.close();
  card.sheets.open('uv', tile);
  await new Promise(done => setTimeout(done, 200));
  expect(dialog.hasAttribute('open')).toBe(true);
  card.sheets.close();
  await vi.waitFor(() => {
    expect(dialog.hasAttribute('open')).toBe(false);
  });
  card.remove();
});

// Where it goes, and stays.
const placed = (card: IWeatherCard) => {
  const dialog = part(card, 'dialog[open]');
  return [dialog.style.left, dialog.style.top, dialog.dataset['side']];
};
const anotherDay = (card: IWeatherCard) => {
  part(card, 'dialog[open] [data-step="1"]').click();
};
// A sheet looks for its anchor again when something scrolls behind it.
const scrolled = () => {
  dispatchEvent(new Event('scroll'));
};

test('a sheet stays where it is when its tile is drawn again, and gives the tile back', async () => {
  const card = await page();
  open(card, 'wind');
  const at = placed(card),
    was = part(card, '.tile[data-tile=wind]');
  card.redrawTiles(true);
  expect(part(card, '.tile[data-tile=wind]')).not.toBe(was);
  anotherDay(card);
  scrolled();
  expect(placed(card)).toEqual(at);
  expect(card.sheets.anchorOf(card.sheets.detail ?? expect.fail('No sheet.'))).toBe(
    part(card, '.tile[data-tile=wind]'),
  );
  card.remove();
});

test('a sheet stays where it is when the alert it came from is drawn again', async () => {
  const alert = (headline: string) => ({
      entity_id: 'binary_sensor.alarm',
      state: 'on',
      attributes: { event: 'Wind Advisory', headline, severity: 'Moderate', friendly_name: 'Alarm' },
    }),
    hass = hassWith();
  hass.states['binary_sensor.alarm'] = alert('Gusts up to 45.');
  const card = await page(hass, { alert_entities: ['binary_sensor.alarm'] }),
    button = part(card, '.alert button[data-index]');
  button.click();
  landed(card);
  const at = placed(card);
  expect(at[2]).not.toBe('sheet');
  card.hass = { ...hass, states: { ...hass.states, 'binary_sensor.alarm': alert('Gusts up to 60.') } };
  await vi.waitFor(() => {
    expect(button.isConnected).toBe(false);
  });
  card.sheets.renderAll();
  scrolled();
  expect(placed(card)).toEqual(at);
  expect(card.sheets.detail?.anchor).toBe(part(card, '.alert button[data-index]'));
  card.remove();
});

test('a sheet stays where it is when its tile goes altogether', async () => {
  // With no hour to fill it in from, a reading the entity stops sending takes its tile with it.
  const hass: HomeAssistant = {
      ...hassWith(),
      connection: {
        subscribeMessage(callback: (message: unknown) => void, message: ForecastSubscription) {
          const hours = hourly().map(entry => {
            const { humidity: _, ...rest } = entry;
            return rest;
          });
          queueMicrotask(() => {
            callback({ forecast: message.forecast_type === 'hourly' ? hours : daily() });
          });
          return Promise.resolve(() => undefined);
        },
      },
    },
    card = await page(hass);
  open(card, 'humidity');
  const at = placed(card),
    was = part(card, '.tile[data-tile=humidity]'),
    state = hass.states['weather.home'];
  if (!state) throw new Error('No entity.');
  const { humidity: _, ...attributes } = state.attributes;
  card.hass = { ...hass, states: { ...hass.states, 'weather.home': { ...state, attributes } } };
  await vi.waitFor(() => {
    expect(was.isConnected).toBe(false);
  });
  expect(card.root.querySelector('.tile[data-tile=humidity]')).toBeNull();
  anotherDay(card);
  scrolled();
  expect(placed(card)).toEqual(at);
  card.remove();
});

test('a sheet stays where it is when the row it came from has gone', async () => {
  let send: (forecast: readonly ForecastEntry[]) => void = () => {};
  const hass = hassWith(),
    { connection } = hass;
  if (!connection) throw new Error('No connection.');
  const subscribed: typeof connection.subscribeMessage = (callback, message) => {
    if (message.forecast_type === 'daily') send = forecast => callback({ forecast });
    return connection.subscribeMessage(callback, message);
  };
  const card = await page({ ...hass, connection: { ...connection, subscribeMessage: subscribed } });
  await vi.waitFor(() => {
    expect(card.root.querySelectorAll('.day[data-key]').length).toBeGreaterThan(5);
  });
  const row = [...card.root.querySelectorAll<HTMLElement>('.day[data-key]')].at(-1);
  if (!row) throw new Error('No rows.');
  row.click();
  landed(card);
  const at = placed(card);
  send(daily().slice(0, 3));
  await vi.waitFor(() => {
    expect(row.isConnected).toBe(false);
  });
  expect(card.root.querySelector(`.day[data-key="${row.dataset['key'] ?? ''}"]`)).toBeNull();
  scrolled();
  expect(placed(card)).toEqual(at);
  card.remove();
});

test('a sheet stays where it is, as it was, when the next hour’s panel hides', async () => {
  const nowcast = (rain: number) => ({
      entity_id: 'sensor.nowcast',
      state: '0',
      attributes: {
        unit_of_measurement: 'mm/h',
        forecast: Array.from({ length: 13 }, (_, i) => ({
          datetime: new Date(Date.now() + i * 300_000).toISOString(),
          precipitation: i > 2 && i < 8 ? rain : 0,
        })),
      },
    }),
    hass = hassWith();
  hass.states['sensor.nowcast'] = nowcast(3);
  const card = await page(hass, { next_hour_entity: 'sensor.nowcast' }),
    panel = card.parts.nextHour;
  await vi.waitFor(() => {
    expect(panel.hidden).toBe(false);
  });
  panel.click();
  landed(card);
  const at = placed(card),
    title = part(card, 'dialog[open] h2').textContent;
  expect(at[2]).not.toBe('sheet');
  card.hass = { ...hass, states: { ...hass.states, 'sensor.nowcast': nowcast(0) } };
  await vi.waitFor(() => {
    expect(panel.hidden).toBe(true);
  });
  expect(panel.getBoundingClientRect().width).toBe(0);
  card.sheets.renderAll();
  scrolled();
  expect(placed(card)).toEqual(at);
  expect(part(card, 'dialog[open] h2').textContent).toBe(title);
  card.remove();
});

test('a press doesn’t place a sheet: it lies 13 from the tile at rest, and stays there when let go', async () => {
  const card = await page(),
    tile = part(card, '.tile[data-tile=uv]'),
    rest = tile.getBoundingClientRect();
  // Held at the shrunken size a press leaves it at.
  tile.style.transform = 'scale(.95)';
  tile.click();
  const dialog = landed(card),
    at = placed(card),
    box = dialog.getBoundingClientRect(),
    side = dialog.dataset['side'];
  expect(
    side === 'above'
      ? rest.top - box.bottom
      : side === 'below'
        ? box.top - rest.bottom
        : side === 'left'
          ? rest.left - box.right
          : box.left - rest.right,
  ).toBeCloseTo(13, 0);
  tile.style.transform = '';
  scrolled();
  expect(placed(card)).toEqual(at);
  card.remove();
});

test('a change of size closes a sheet, but not the map', async () => {
  const card = await page(hassWith(), { map: 'local' });
  open(card, 'uv');
  const dialog = part(card, 'dialog[open]');
  dispatchEvent(new Event('resize'));
  await vi.waitFor(() => {
    expect(dialog.hasAttribute('open')).toBe(false);
  });
  part(card, '.tile[data-tile=map]').click();
  await vi.waitFor(() => {
    expect(card.root.querySelector('dialog[open][data-id=map]')).not.toBeNull();
  });
  dispatchEvent(new Event('resize'));
  await new Promise(done => setTimeout(done, 200));
  expect(card.root.querySelector('dialog[open][data-id=map]')).not.toBeNull();
  card.remove();
});

// The tail and what's round it.
test('the tail is 13.75 deep, with straight 45° flanks, a round tip and a small curve at its base', () => {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'),
    { depth } = SHEET_TAIL,
    width = 400,
    height = 800;
  path.setAttribute('d', sheetOutline('below', width, height, 200));
  // The path starts on the top edge and comes to the tail first.
  const points = Array.from({ length: 3000 }, (_, i) => path.getPointAtLength(i / 10)),
    tail = points.filter(point => point.y < depth - 0.001);
  expect(Math.min(...points.map(point => point.y))).toBeCloseTo(0, 1);
  const base = Math.max(...tail.map(point => point.x)) - Math.min(...tail.map(point => point.x));
  expect(base).toBeGreaterThan(37.5);
  expect(base).toBeLessThan(40);
  const middle = 200 + depth,
    flank = tail.filter(point => point.x > middle && point.y > 4.5 && point.y < 11);
  flank.slice(1).forEach((point, i) => {
    const before = flank[i];
    if (before && point.x !== before.x) expect(Math.abs((point.y - before.y) / (point.x - before.x))).toBeCloseTo(1, 0);
  });
  // The tip is round: flat for a moment, and already a pixel down two pixels off the middle.
  const near = (x: number) =>
    tail.reduce((best, point) => (Math.abs(point.x - x) < Math.abs(best.x - x) ? point : best), { x: 0, y: 0 });
  expect(near(middle).y).toBeCloseTo(0, 1);
  expect(near(middle + 3.5).y).toBeGreaterThan(1);
  expect(near(middle + 3.5).y).toBeLessThan(2);
});

test('each side’s tail points its own way, kept clear of the corners, and a sheet with no tail has none', () => {
  const box = (d: string) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'),
      path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
    document.body.append(svg);
    const bounds = path.getBBox();
    svg.remove();
    return bounds;
  };
  const { depth } = SHEET_TAIL,
    far = depth * 2;
  const reaches = (side: Parameters<typeof sheetOutline>[0], expected: readonly number[]) => {
    const { x, y, width, height } = box(sheetOutline(side, 400, 800, 300));
    [x, y, x + width, y + height].forEach((value, i) => {
      expect(value, side).toBeCloseTo(expected[i] ?? Number.NaN, 1);
    });
  };
  reaches('below', [depth, 0, 400 + depth, 800 + depth]);
  reaches('above', [depth, depth, 400 + depth, 800 + far]);
  reaches('right', [0, depth, 400 + depth, 800 + depth]);
  reaches('left', [depth, depth, 400 + far, 800 + depth]);
  reaches('sheet', [depth, depth, 400 + depth, 800 + depth]);
  expect(sheetOutline('below', 400, 800, 0)).toBe(sheetOutline('below', 400, 800, 40));
});

test('the edge lies over the title’s band, and what scrolls under the band fades', async () => {
  const card = await page(),
    dialog = open(card, 'uv'),
    sheet = part(card, 'dialog[open] .sheet'),
    edge = part(card, 'dialog[open] .sheet-edge'),
    band = part(card, 'dialog[open] .sheet-band');
  expect(band.compareDocumentPosition(edge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(getComputedStyle(edge, '::before').backgroundImage).toContain('svg');
  expect(getComputedStyle(edge).pointerEvents).toBe('none');
  expect(getComputedStyle(sheet).maskImage).toBe('none');
  sheet.scrollTop = 120;
  await vi.waitFor(() => {
    expect(dialog.hasAttribute('data-scrolled')).toBe(true);
  });
  expect(getComputedStyle(sheet).maskImage).toContain('linear-gradient');
  expect(getComputedStyle(band, '::before').backdropFilter).toBe('blur(2.5px)');
  // The glass stays whole: only the sheet's contents go.
  expect(getComputedStyle(part(card, 'dialog[open] .sheet-glass')).maskImage).toBe('none');
  card.remove();
});

test('nothing in a sheet reaches its tail: it scrolls in the rectangle', async () => {
  const card = await page(),
    dialog = open(card, 'uv'),
    sheet = part(card, 'dialog[open] .sheet').getBoundingClientRect(),
    box = dialog.getBoundingClientRect();
  expect([sheet.left, sheet.top, sheet.right, sheet.bottom]).toEqual([box.left, box.top, box.right, box.bottom]);
  card.remove();
});

test('a sheet with a tail has no close button under a mouse, and one without keeps it', async () => {
  const card = await page(),
    dialog = open(card, 'uv'),
    button = part(card, 'dialog[open] .sheet>header [data-close]');
  expect(dialog.dataset['side']).not.toBe('sheet');
  expect(getComputedStyle(button).display).toBe('none');
  dialog.dataset['side'] = 'sheet';
  expect(getComputedStyle(button).display).toBe('grid');
  card.remove();
});

test('a sheet takes the focus with no ring round it', async () => {
  const card = await page();
  open(card, 'uv');
  const sheet = part(card, 'dialog[open] .sheet');
  sheet.tabIndex = -1;
  sheet.focus();
  expect(getComputedStyle(sheet).outlineStyle).toBe('none');
  card.remove();
});

// What the card asks of the record: three years of days, the normal range at each hour of the date,
// and the last thirty days. Nothing leaves the page.
const RECORD = Date.UTC(2018, 0, 1),
  RECORD_DAYS = 3 * 365,
  DAY = 24 * HOUR,
  BAND_READINGS = 24 * 21,
  RECENT_DAYS = 31;
const MONTHLY_RAIN = [5, 57.2, 99, 107.9, 118.1, 94, 80, 77.5, 71.1, 80, 87.6, 69.8];
const recordFor = (url: string) => {
  if (url.includes('hourly=temperature_2m')) {
    const time = Array.from({ length: BAND_READINGS }, (_, i) => (RECORD + i * HOUR) / 1000);
    return { hourly: { time, temperature_2m: time.map((_, i) => 50 + (i % 20)) } };
  }
  if (url.includes('past_days')) {
    const time = Array.from({ length: RECENT_DAYS }, (_, i) =>
      new Date(Date.now() + (i - RECENT_DAYS + 1) * DAY).toISOString().slice(0, 10),
    );
    return { daily: { time, precipitation_sum: time.map((_, i) => i % 3) } };
  }
  const dates = Array.from({ length: RECORD_DAYS }, (_, i) => new Date(RECORD + i * DAY));
  return {
    daily: {
      time: dates.map(date => date.toISOString().slice(0, 10)),
      temperature_2m_max: dates.map(date => 40 + 4 * date.getUTCMonth()),
      temperature_2m_min: dates.map(date => 25 + 3 * date.getUTCMonth()),
      precipitation_sum: dates.map(date => (MONTHLY_RAIN[date.getUTCMonth()] ?? 0) / 30),
    },
  };
};
async function averages(precipitationUnit = 'in'): Promise<IWeatherCard> {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-27T17:30:00Z') });
  vi.stubGlobal('fetch', (url: string) => Promise.resolve(new Response(JSON.stringify(recordFor(url)))));
  const hass = hassWith(),
    home = hass.states['weather.home'];
  if (!home) throw new Error('No weather entity.');
  home.attributes.precipitation_unit = precipitationUnit;
  const card = await page(hass, { averages: 'open-meteo' });
  await vi.waitFor(() => {
    expect(card.root.querySelector('.tile[data-tile=averages]')).toBeTruthy();
  });
  open(card, 'averages');
  return card;
}
const unstub = () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
};
const style = (card: IWeatherCard, selector: string, pseudo?: string) => getComputedStyle(part(card, selector), pseudo);
const tab = async (card: IWeatherCard, name: string) => {
  part(card, `dialog[open] [data-variant=${name}]`).click();
  await settled();
};

test('removing the averages source clears the tile and the band in an already open sheet', async () => {
  const card = await averages();
  try {
    await vi.waitFor(() => expect(card.sheets.history.dayBand?.band).toBeTruthy());
    card.setConfig({ ...card.config, averages: undefined });
    expect(card.root.querySelector('.tile[data-tile=averages]')).toBeNull();
    expect(card.root.querySelector('dialog[open] .chart[data-chart=average]')).toBeNull();
    expect(card.sheets.history.dayBand).toBeUndefined();
  } finally {
    card.remove();
    unstub();
  }
});

test('both tabs of Averages stand in one rounded frame, scale and hours inside it', async () => {
  const card = await averages();
  for (const [name, chart] of [
    ['temperature', '.chart[data-chart=average]'],
    ['precipitation', '.rain-chart'],
  ] as const) {
    await tab(card, name);
    await settled();
    const selector = `dialog[open] ${chart}`,
      whole = part(card, selector),
      plot = part(card, `${selector} .chart-plot`),
      scale = part(card, `${selector} .chart-y`),
      frame = style(card, selector, '::after');
    expect(whole.offsetHeight).toBe(300);
    expect(plot.offsetHeight).toBe(275);
    expect(frame.content).not.toBe('none');
    expect(frame.borderTopWidth).toBe('1.25px');
    expect(frame.borderTopLeftRadius).toBe('10.625px');
    // The chart runs the width of the text, and the scale's column is a fixed part of it.
    expect(whole.offsetWidth).toBe(375);
    expect(scale.offsetWidth).toBe(45);
    // None of the two rules of a day's chart.
    expect(style(card, `${selector} .chart-face`).backgroundImage).toBe('none');
    expect(style(card, `${selector} .chart-y`, '::before').content).toBe('none');
  }
  card.remove();
  unstub();
});

test('the Averages chart marks the day’s peak and nothing of now, and its line has a shadow', async () => {
  const card = await averages(),
    selector = 'dialog[open] .chart[data-chart=average]';
  await vi.waitFor(() => {
    expect(card.root.querySelector(`${selector} ~ .chart-legend .band`)).toBeTruthy();
  });
  expect(card.root.querySelector(`${selector} .chart-dot`)).toBeNull();
  expect(card.root.querySelector(`${selector} .chart-rule`)).toBeNull();
  expect(part(card, selector).style.getPropertyValue('--high-x')).not.toBe('');
  const line = card.root.querySelector(`${selector} .chart-lifted`);
  if (!line) throw new Error('No line.');
  expect(getComputedStyle(line).filter).toContain('drop-shadow');
  // The label's two lines, and the legend's dots.
  expect(style(card, `${selector} .chart-peak`).fontSize).toBe('12.5px');
  expect(style(card, `${selector} .chart-peak`).fontWeight).toBe('500');
  expect(style(card, `${selector} .chart-peak b`).fontSize).toBe('27.5px');
  expect(style(card, `${selector} .chart-peak b`).fontWeight).toBe('600');
  expect(style(card, 'dialog[open] .chart-legend i').width).toBe('12.5px');
  expect(style(card, 'dialog[open] .chart-legend i').backgroundImage).toContain('linear-gradient');
  expect(style(card, 'dialog[open] .chart-legend i.band').opacity).toBe('0.5');
  card.remove();
  unstub();
});

test('the rain’s totals stand over the chart, where a long one isn’t cut', async () => {
  const card = await averages('mm');
  await tab(card, 'precipitation');
  const totals = card.root.querySelectorAll('dialog[open] .rain-total'),
    last = [...totals].at(-1),
    face = part(card, 'dialog[open] .rain-chart .chart-face').getBoundingClientRect();
  if (!last) throw new Error('No totals.');
  expect(last.getBoundingClientRect().right).toBeGreaterThan(face.right);
  expect(last.closest('.chart-face')).toBeNull();
  expect(style(card, 'dialog[open] .rain-chart .chart-rule').backgroundColor).toBe('rgba(38, 146, 255, 0.25)');
  card.remove();
  unstub();
});

test('the rain’s chart reads the day under the mouse, over the chart, and goes back after', async () => {
  const card = await averages();
  await tab(card, 'precipitation');
  const chart = part(card, 'dialog[open] .rain-chart'),
    plot = part(card, 'dialog[open] .rain-chart .chart-plot'),
    { left, top, width } = plot.getBoundingClientRect(),
    resting = part(card, 'dialog[open] .detail-headline').textContent;
  const hover = (share: number) =>
    plot.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        pointerType: 'mouse',
        clientX: left + width * share,
        clientY: top + 20,
      }),
    );
  // Ten days before today: the last days' total so far, with the average's under it.
  hover(20 / 40);
  expect('scrubbing' in chart.dataset).toBe(true);
  expect(part(card, 'dialog[open] .detail-time').textContent).toMatch(/^[A-Z][a-z]{2} \d+$/);
  expect(part(card, 'dialog[open] .detail-headline').textContent).toMatch(/^\d+(\.\d+)?″$/);
  expect(part(card, 'dialog[open] .detail-sub').textContent).toMatch(/^Average: \d+(\.\d+)?″$/);
  const cursor = part(card, 'dialog[open] .rain-chart .chart-cursor').getBoundingClientRect();
  expect(cursor.left).toBeCloseTo(left + width / 2, 0);
  // Today's own marks give way to the reading's.
  expect(style(card, 'dialog[open] .rain-chart .chart-rule').opacity).toBe('0');
  expect(style(card, 'dialog[open] .rain-total').opacity).toBe('0');
  hover(30 / 40);
  expect(part(card, 'dialog[open] .detail-time').textContent).toBe('Today');
  // Past today, only the average.
  hover(35 / 40);
  expect(part(card, 'dialog[open] .detail-sub').textContent).toBe('Average');
  plot.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse' }));
  expect(part(card, 'dialog[open] .detail-headline').textContent).toBe(resting);
  expect(part(card, 'dialog[open] .detail-time').textContent).toBe('');
  expect(style(card, 'dialog[open] .rain-chart .chart-rule').opacity).toBe('1');
  card.remove();
  unstub();
});

test('this month’s row looks like every other, and only says so to a reader', async () => {
  const card = await averages(),
    current = part(card, 'dialog[open] .month-rows [aria-current]'),
    other = current.previousElementSibling;
  if (!(other instanceof HTMLElement)) throw new Error('No row before this month’s.');
  const look = (row: HTMLElement) =>
    [row, ...row.children].map(node => {
      const { color, backgroundColor, fontWeight, opacity, borderTopWidth } = getComputedStyle(node);
      return [color, backgroundColor, fontWeight, opacity, borderTopWidth];
    });
  expect(look(current)).toEqual(look(other));
  card.remove();
  unstub();
});

test('monthly rows keep one column for the value, whatever each row’s reads', async () => {
  const card = await averages('mm');
  await tab(card, 'precipitation');
  const tracks = [...card.root.querySelectorAll('dialog[open] .month-rows .range-track')],
    values = [...card.root.querySelectorAll('dialog[open] .month-rows b')];
  expect(new Set(values.map(value => value.textContent.length)).size).toBeGreaterThan(1);
  expect(new Set(tracks.map(track => track.getBoundingClientRect().width)).size).toBe(1);
  expect(new Set(tracks.map(track => track.getBoundingClientRect().left)).size).toBe(1);
  card.remove();
  unstub();
});

test('the Beaufort table’s rows and columns fall where the sheet’s other rows do not', async () => {
  const card = await page();
  open(card, 'wind');
  const inset = part(card, 'dialog[open] .beaufort').getBoundingClientRect().left,
    across = (selector: string) =>
      (part(card, `dialog[open] .beaufort ${selector}`).getBoundingClientRect().left - inset) / ZOOM,
    down = [...card.root.querySelectorAll('dialog[open] .beaufort tr')].map(row => row.getBoundingClientRect().top),
    pitches = down.slice(2).map((top, i) => (top - (down[i + 1] ?? 0)) / ZOOM);
  expect(across('th:nth-child(2)')).toBeCloseTo(72, 0);
  expect(across('th:nth-child(3)')).toBeCloseTo(317.5, 0);
  expect(across('i')).toBeCloseTo(1.25, 1);
  expect(style(card, 'dialog[open] .beaufort i').width).toBe('16.25px');
  expect(pitches).toHaveLength(12);
  for (const pitch of pitches) expect(pitch).toBeCloseTo(36.25, 1);
  card.remove();
});

test('a sheet’s digits take the room they need, and the clock’s hold to one width', async () => {
  const card = await page(),
    numeric = (selector: string) => getComputedStyle(part(card, `dialog[open] ${selector}`)).fontVariantNumeric;
  open(card, 'wind');
  expect(numeric('.detail-headline')).toBe('proportional-nums');
  expect(numeric('.chart-y span')).toBe('proportional-nums');
  closed(card);
  open(card, 'sun');
  expect(numeric('.detail-headline')).toBe('tabular-nums');
  card.remove();
});

test('a day’s bars stand in proportion to their values, the longest leaving room for its value', async () => {
  const card = await page();
  open(card, 'wind');
  const section = document.createElement('section');
  section.className = 'detail-compare';
  section.innerHTML = comparisonMarkup({ text: 'Windier.', today: 14, yesterday: 6, shown: ['14 mph', '6 mph'] });
  part(card, 'dialog[open] .sheet').append(section);
  const [today, yesterday] = [...section.querySelectorAll('span')].map(bar => bar.getBoundingClientRect().width),
    value = section.querySelector('b')?.getBoundingClientRect(),
    box = section.getBoundingClientRect();
  expect((yesterday ?? 0) / (today ?? 1)).toBeCloseTo(6 / 14, 2);
  expect(value?.right).toBeCloseTo(box.right, 0);
  card.remove();
});

// A finger moves a sheet from the foot by scrolling, which only the browser's own input does: the
// pulls themselves are in e2e/sheet.spec.ts. What the card does with that scroll is here.
const pause = (ms: number) =>
  new Promise(done => {
    setTimeout(done, ms);
  });
const footSheet = async (tile = 'uv') => {
  const card = await page(hassWith(), { sheet_style: 'sheet' });
  open(card, tile);
  await settled();
  const dialog = part(card, 'dialog[open]');
  // Risen into its place.
  await Promise.all(
    dialog
      .getAnimations()
      .filter(animation => animation instanceof CSSTransition)
      .map(animation => animation.finished),
  );
  // Where its scroll stands with the sheet in its place, a screen down it.
  return { card, dialog, sheet: part(card, 'dialog[open] .sheet'), place: dialog.clientHeight };
};
// Long enough for a wheel's or a key's smooth scroll to have shown.
const SCROLLS = 300;
// A finger put down on the sheet, as one that pulls it scrolls its dialog: only that moves it.
const fingerDown = (dialog: HTMLElement) => {
  const touch = new Touch({ identifier: 1, target: dialog, clientX: 100, clientY: 100 });
  dialog.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [touch], changedTouches: [touch] }));
  return () => {
    dialog.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [touch] }));
  };
};
// Held still by a finger `top` down its scroll, and let go there.
const heldAt = async (dialog: HTMLElement, top: number) => {
  const letGo = fingerDown(dialog);
  dialog.scrollTop = top;
  await settled();
  letGo();
};

// A finger on `on`, as the browser tells of one where nothing scrolls: down, moved `by` px down from
// there, and let go, each a pointer event. Held still long enough before it is let go, it is let go
// with no speed.
const pointerFinger = (on: HTMLElement) => {
  const box = on.getBoundingClientRect(),
    from = { x: box.left + box.width / 2, y: box.top + box.height / 2 },
    at = (by: number) => ({
      bubbles: true,
      pointerId: 9,
      pointerType: 'touch',
      isPrimary: true,
      buttons: 1,
      clientX: from.x,
      clientY: from.y + by,
    });
  return {
    down: () => on.dispatchEvent(new PointerEvent('pointerdown', at(0))),
    move: (by: number) => on.dispatchEvent(new PointerEvent('pointermove', at(by))),
    up: (by: number) => on.dispatchEvent(new PointerEvent('pointerup', { ...at(by), buttons: 0 })),
  };
};
// Longer than a drag's speed is read over.
const STILLED = 150;
// Whether a finger's move on `on` is kept from scrolling.
const moveKept = (on: HTMLElement) => {
  const touch = new Touch({ identifier: 9, target: on, clientX: 100, clientY: 100 }),
    move = new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: [touch], changedTouches: [touch] });
  on.dispatchEvent(move);
  return move.defaultPrevented;
};
// How far down a press has drawn the sheet, in px.
const drawnDown = (dialog: HTMLElement) => Number.parseFloat(dialog.style.translate.split(' ')[1] ?? '0');
test('a mouse let go off the window lets the sheet go where it last drew it, and draws it no further', async () => {
  const { card, dialog, sheet } = await footSheet('humidity'),
    summary = part(card, 'dialog[open] .detail-summary'),
    box = summary.getBoundingClientRect(),
    from = { x: box.left + box.width / 2, y: box.top + box.height / 2 },
    rest = sheet.getBoundingClientRect().top,
    // How far below its place the sheet is drawn on screen, however it is drawn there.
    down = () => sheet.getBoundingClientRect().top - rest,
    at = (by: number, buttons = 1) => ({
      bubbles: true,
      composed: true,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons,
      clientX: from.x,
      clientY: from.y + by,
    });
  dialog.setPointerCapture = () => undefined;
  summary.dispatchEvent(new PointerEvent('pointerdown', at(0)));
  for (const by of [30, 60, 90]) summary.dispatchEvent(new PointerEvent('pointermove', at(by)));
  expect(down()).toBeCloseTo(90, 0);
  // Held still, it has no speed when it is let go.
  await new Promise(done => setTimeout(done, STILLED));
  // The button came up past the window's edge: the move that tells of it has no button held, and
  // a place that isn't where the mouse was.
  dialog.dispatchEvent(new PointerEvent('pointermove', { ...at(0, 0), clientY: -85 }));
  expect(down(), 'it doesn’t leap to where that move says').toBeCloseTo(90, 0);
  // Let go, a move with the button held belongs to no press.
  dialog.dispatchEvent(new PointerEvent('pointermove', at(150)));
  expect(down()).toBeLessThan(120);
  // Near its place and slow, it goes back, open.
  await vi.waitFor(() => {
    expect(down()).toBeCloseTo(0, 0);
  });
  expect(dialog.hasAttribute('open')).toBe(true);
});
test('scrolled, a finger on the title bar draws the whole sheet, its content held, and catches it on its way back', async () => {
  const { card, dialog, sheet, place } = await footSheet('wind'),
    bar = part(card, 'dialog[open] .sheet>header'),
    title = part(card, 'dialog[open] .sheet>header h2'),
    scrolledBy = 200,
    near = 100;
  // A press can't be held by the dialog that the browser never heard of.
  dialog.setPointerCapture = () => undefined;
  // At its top, the bar scrolls as the rest does, and a finger there pulls by scrolling.
  expect(getComputedStyle(bar).touchAction).toBe('auto');
  dialog.scrollTop = place + scrolledBy;
  await vi.waitFor(() => {
    expect(dialog.hasAttribute('data-scrolled')).toBe(true);
  });
  expect(getComputedStyle(bar).touchAction).toBe('none');
  // On the content, a finger scrolls: it draws nothing.
  const content = pointerFinger(part(card, 'dialog[open] .detail-summary'));
  content.down();
  content.move(near);
  expect(drawnDown(dialog)).toBe(0);
  expect(moveKept(part(card, 'dialog[open] .detail-summary'))).toBe(false);
  content.up(near);
  // Pushed up, it stays in its place; then down, it follows, its content where it was.
  const finger = pointerFinger(title);
  finger.down();
  finger.move(-near);
  expect(drawnDown(dialog)).toBe(0);
  finger.move(near);
  expect(drawnDown(dialog)).toBe(near);
  // Nor does the browser scroll from the bar under it, whatever the styles say.
  expect(moveKept(title)).toBe(true);
  expect(dialog.scrollTop).toBeCloseTo(place + scrolledBy, 0);
  await pause(STILLED);
  finger.up(near);
  // Let go short of half way, it springs back, its content still where it was.
  expect(dialog.style.translate).toBe('');
  expect(dialog.getAnimations().length).toBeGreaterThan(0);
  // On its way back, however slowly a busy page draws it.
  const letGo = sheet.getBoundingClientRect().top;
  await vi.waitFor(() => {
    expect(sheet.getBoundingClientRect().top).toBeLessThan(letGo - 1);
  });
  // Caught on the way, it stands where it has got to, and goes on back once let go.
  finger.down();
  const caught = drawnDown(dialog);
  expect(caught).toBeGreaterThan(0);
  expect(caught).toBeLessThan(near);
  expect(dialog.getAnimations().length).toBe(0);
  finger.up(0);
  await vi.waitFor(() => {
    expect(dialog.getAnimations().length).toBe(0);
    expect(dialog.style.translate).toBe('');
  });
  expect(dialog.scrollTop).toBeCloseTo(place + scrolledBy, 0);
  expect(dialog.hasAttribute('open')).toBe(true);
  // Drawn past half way, it goes.
  finger.down();
  finger.move(place * 0.6);
  await pause(STILLED);
  finger.up(place * 0.6);
  await vi.waitFor(() => {
    expect(dialog.hasAttribute('open')).toBe(false);
  });
  card.remove();
});

test('a sheet from the foot stands a screen down the one scroll there is, its content running on below', async () => {
  const { card, dialog, sheet, place } = await footSheet('wind');
  expect(dialog.hasAttribute('data-bottom')).toBe(true);
  expect(dialog.dataset['side']).toBe('sheet');
  expect(dialog.scrollTop).toBeCloseTo(place, 0);
  expect(sheet.getBoundingClientRect().top).toBeCloseTo(dialog.getBoundingClientRect().top, 0);
  expect(getComputedStyle(sheet).overflowY).toBe('visible');
  expect(dialog.scrollHeight - dialog.clientHeight).toBeGreaterThan(place);
  card.remove();
});

test('let go short of half way it springs back, and from past it it goes', async () => {
  const { card, dialog, place } = await footSheet();
  await heldAt(dialog, place * 0.6);
  // Once it has stood still, its scroll is put back, and it is drawn going up from where it was.
  await vi.waitFor(() => {
    expect(dialog.scrollTop).toBeCloseTo(place, 0);
  });
  expect(dialog.getAnimations().length).toBeGreaterThan(0);
  await pause(SCROLLS);
  expect(dialog.hasAttribute('open')).toBe(true);
  await heldAt(dialog, place * 0.4);
  await vi.waitFor(() => {
    expect(dialog.hasAttribute('open')).toBe(false);
  });
  expect(dialog.hasAttribute('data-bottom')).toBe(false);
  card.remove();
});

test('the dimming behind it goes as it does', async () => {
  const { card, dialog, place } = await footSheet(),
    dim = () => Number(getComputedStyle(dialog, '::backdrop').opacity);
  expect(dim()).toBe(1);
  // Held part way, as a finger holds it.
  const letGo = fingerDown(dialog);
  dialog.scrollTop = place / 4;
  await settled();
  expect(dim()).toBeCloseTo(1 / 4, 2);
  // Scrolled into its content, it stays dimmed.
  dialog.scrollTop = place * 2;
  await settled();
  expect(dim()).toBe(1);
  dialog.scrollTop = place;
  letGo();
  card.remove();
});

test('only a finger that came down with its content at the top lowers it: any other scroll stops at its place', async () => {
  const { card, dialog, sheet, place } = await footSheet('wind');
  // No finger at all, as bringing something into view, or the content coasting up to its top.
  dialog.scrollTop = 0;
  await pause(SCROLLS);
  expect(dialog.scrollTop).toBeCloseTo(place, 0);
  expect(dialog.hasAttribute('open')).toBe(true);
  // A tap that moved nothing leaves nothing to move it after.
  fingerDown(dialog)();
  dialog.scrollTop = 0;
  await pause(SCROLLS);
  expect(dialog.scrollTop).toBeCloseTo(place, 0);
  // A finger that came down on its content scrolled scrolls only that, however far: the sheet is
  // kept at its place whatever the scroll does under it, and once let go, the scroll is too.
  dialog.scrollTop = place + 200;
  await settled();
  const letGo = fingerDown(dialog);
  dialog.scrollTop = place / 2;
  await settled();
  expect(sheet.getBoundingClientRect().top).toBeCloseTo(dialog.getBoundingClientRect().top, 0);
  letGo();
  await pause(SCROLLS);
  expect(dialog.scrollTop).toBeCloseTo(place, 0);
  expect(dialog.hasAttribute('open')).toBe(true);
  // Its content is its own to scroll, finger or none.
  dialog.scrollTop = place + 100;
  await pause(SCROLLS);
  expect(dialog.scrollTop).toBeCloseTo(place + 100, 0);
  card.remove();
});

test('let go with its content scrolled, it is kept at its place, so the content coasting on past its top takes it no lower', async () => {
  const { card, dialog, sheet, place } = await footSheet('wind'),
    drawnAt = () => sheet.getBoundingClientRect().top - dialog.getBoundingClientRect().top;
  dialog.scrollTop = place + 300;
  await settled();
  fingerDown(dialog)();
  // Its scroll runs on past the content's top before the page has heard of it: the sheet is drawn
  // at its place all the same, and once heard of, the scroll is stopped there too.
  dialog.scrollTop = place / 2;
  expect(drawnAt()).toBeCloseTo(0, 0);
  await pause(SCROLLS);
  expect(dialog.scrollTop).toBeCloseTo(place, 0);
  expect(dialog.hasAttribute('open')).toBe(true);
  // A finger that comes down with its content at the top is the sheet's to pull down.
  const letGo = fingerDown(dialog);
  dialog.scrollTop = place / 2;
  expect(drawnAt()).toBeCloseTo(place / 2, 0);
  dialog.scrollTop = place;
  letGo();
  card.remove();
});

test('no wheel or key going up moves a sheet from the foot from its place, though its content takes them', async () => {
  const { card, dialog, sheet, place } = await footSheet('wind');
  await userEvent.wheel(sheet, { delta: { y: -200 } });
  for (const key of ['{ArrowUp}', '{PageUp}', '{Home}', '{Shift>}{ }{/Shift}']) await userEvent.keyboard(key);
  await pause(SCROLLS);
  expect(dialog.scrollTop).toBeCloseTo(place, 0);
  expect(dialog.hasAttribute('open')).toBe(true);
  dialog.scrollTop = place + 200;
  await userEvent.wheel(sheet, { delta: { y: -100 } });
  await vi.waitFor(() => {
    expect(dialog.scrollTop).toBeLessThan(place + 200);
  });
  expect(dialog.scrollTop).toBeGreaterThanOrEqual(place - 1);
  card.remove();
});

// Long enough for a finger held still on a chart to read it.
const HOLDS = 150;
test('a finger that pulls the sheet from a chart puts away what it read there', async () => {
  const { card, dialog, place } = await footSheet('wind'),
    read = [...dialog.querySelectorAll<HTMLElement>('.chart')].find(readable),
    plot = read?.querySelector<HTMLElement>('.chart-plot');
  if (!plot) throw new Error('No chart with readings.');
  const box = plot.getBoundingClientRect(),
    at = {
      bubbles: true,
      pointerId: 7,
      pointerType: 'touch',
      isPrimary: true,
      clientX: box.left + box.width / 2,
      clientY: box.top + box.height / 2,
    };
  plot.setPointerCapture = () => undefined;
  plot.dispatchEvent(new PointerEvent('pointerdown', at));
  await pause(HOLDS);
  expect(dialog.querySelector('.chart[data-scrubbing]')).not.toBeNull();
  // The finger's pull scrolls the dialog back, part way.
  const letGo = fingerDown(dialog);
  dialog.scrollTop = place / 2;
  await vi.waitFor(() => {
    expect(dialog.querySelector('.chart[data-scrubbing]')).toBeNull();
  });
  plot.dispatchEvent(new PointerEvent('pointerup', at));
  expect(dialog.querySelector('.chart[data-scrubbing], .chart[data-kept]')).toBeNull();
  dialog.scrollTop = place;
  letGo();
  card.remove();
});

test('a sheet from the foot is an opaque dark grey over the page as it stands, its close button on the left', async () => {
  const { card, sheet } = await footSheet(),
    look = getComputedStyle(sheet),
    close = part(card, 'dialog[open] .sheet>header>button').getBoundingClientRect(),
    title = part(card, 'dialog[open] .sheet>header h2').getBoundingClientRect(),
    box = sheet.getBoundingClientRect();
  expect(look.backgroundColor).toBe('rgb(28, 28, 30)');
  expect(getComputedStyle(part(card, 'dialog[open] .sheet-glass')).display).toBe('none');
  expect(close.right).toBeLessThan(title.left);
  expect(close.left - box.left).toBeLessThan(box.width / 4);
  // The page behind stays where it is.
  expect(getComputedStyle(part(card, '.weather')).transform).toBe('none');
  card.remove();
});

// How far a sheet from the foot reads its content as scrolled, standing in for its dialog's scroll.
const scrolledBy = (dialog: HTMLElement) => {
  let by = 0;
  Object.defineProperty(dialog, 'scrollTop', { configurable: true, get: () => dialog.clientHeight + by });
  return (to: number) => {
    by = to;
  };
};

test('its title stays at the top as its content scrolls under, and the bar comes up behind it once something has', async () => {
  const { card, dialog, sheet, place } = await footSheet('wind'),
    head = part(card, 'dialog[open] .sheet>header'),
    bar = () => getComputedStyle(head, '::before'),
    at = head.getBoundingClientRect().top;
  expect(bar().opacity).toBe('0');
  dialog.scrollTop = place + 300;
  await vi.waitFor(() => {
    expect(dialog.hasAttribute('data-scrolled')).toBe(true);
  });
  await vi.waitFor(() => {
    expect(bar().opacity).toBe('1');
  });
  expect(head.getBoundingClientRect().top).toBeCloseTo(at, 0);
  expect(sheet.getBoundingClientRect().top).toBeLessThan(at);
  card.remove();
});

test('the title bar stays away at the top, though a zoomed page or a bounce leaves the content a little down', async () => {
  const { card, dialog } = await footSheet(),
    to = scrolledBy(dialog);
  to(3);
  dialog.dispatchEvent(new Event('scroll'));
  expect(dialog.hasAttribute('data-scrolled')).toBe(false);
  to(6);
  dialog.dispatchEvent(new Event('scroll'));
  expect(dialog.hasAttribute('data-scrolled')).toBe(true);
  card.remove();
});

test('once scrolling settles the title bar is read again, so a last move never reported leaves no bar at the top', async () => {
  const { card, dialog } = await footSheet(),
    to = scrolledBy(dialog);
  to(120);
  dialog.dispatchEvent(new Event('scroll'));
  expect(dialog.hasAttribute('data-scrolled')).toBe(true);
  // Back at the top, with no scroll event to say so.
  to(0);
  await vi.waitFor(() => {
    expect(dialog.hasAttribute('data-scrolled')).toBe(false);
  });
  card.remove();
});

test('a sheet from the foot rounds its title bar and its dialog as it rounds itself, so neither shows past its corners', async () => {
  const { card, dialog, sheet } = await footSheet(),
    corner = getComputedStyle(sheet).borderTopLeftRadius,
    bar = getComputedStyle(part(card, 'dialog[open] .sheet>header'), '::before');
  expect(corner).not.toBe('0px');
  expect(bar.borderTopLeftRadius).toBe(corner);
  expect(bar.borderTopRightRadius).toBe(corner);
  expect(getComputedStyle(dialog).borderTopLeftRadius).toBe(corner);
  card.remove();
});

test('a sheet from the foot has a 70 px title bar that fades in and out, its title level with the close button', async () => {
  const { card, sheet } = await footSheet('wind'),
    head = part(card, 'dialog[open] .sheet>header'),
    title = part(card, 'dialog[open] .sheet>header h2'),
    close = part(card, 'dialog[open] .sheet>header>button'),
    bar = getComputedStyle(head, '::before'),
    // The sheet's own px: it is drawn a shade larger or smaller to fit the screen's width.
    scale = sheet.getBoundingClientRect().width / sheet.offsetWidth,
    middle = (node: HTMLElement) => {
      const { top, height } = node.getBoundingClientRect();
      return top + height / 2;
    };
  expect(head.getBoundingClientRect().height / scale).toBeCloseTo(70, 0);
  // Both its layers fade in and out: the grey with its line, and the wide spread under it.
  const spread = getComputedStyle(head, '::after');
  for (const layer of [bar, spread]) {
    expect([layer.transitionProperty, layer.transitionDuration]).toEqual(['opacity', '0.3s']);
    expect(layer.opacity).toBe('0');
  }
  // Its line is painted a third of a px deep, as a border that thin is a whole px in some engines.
  expect(bar.borderBottomWidth).toBe('0px');
  expect(bar.backgroundImage).toContain('0.34px');
  expect(bar.backdropFilter).toBe('blur(1.5px) saturate(1.2)');
  expect(spread.backdropFilter).toBe('blur(25px)');
  expect(getComputedStyle(title).fontSize).toBe('17px');
  expect(Math.abs(middle(title) - middle(close)) / scale).toBeLessThan(1);
  // What follows the bar stands where it did under an 80 px one.
  const strip = part(card, 'dialog[open] .detail-days');
  expect((strip.getBoundingClientRect().top - sheet.getBoundingClientRect().top) / scale).toBeCloseTo(92.5, 0);
  // Its sections' headings are semibold.
  const heading = getComputedStyle(part(card, 'dialog[open] :is(.detail-summary,.detail-compare)>h3'));
  expect([heading.fontSize, heading.fontWeight]).toEqual(['19px', '600']);
  card.remove();
});

test('a sheet from the foot starts right where the status bar ends', async () => {
  const { card, dialog } = await footSheet();
  expect(dialog.getBoundingClientRect().top).toBeCloseTo(0, 0);
  card.style.setProperty('--safe-area-inset-top', '47px');
  expect(dialog.getBoundingClientRect().top).toBeCloseTo(47, 0);
  card.remove();
});

test('from the foot each section holds what it says in a rounded panel under its heading, and beside a tile in none', async () => {
  const { card } = await footSheet('pressure'),
    sections = [...card.root.querySelectorAll<HTMLElement>('dialog[open] :is(.detail-summary,.detail-compare)')];
  expect(sections.length).toBeGreaterThan(1);
  for (const section of sections) {
    const heading = section.querySelector<HTMLElement>(':scope>h3'),
      panel = section.querySelector<HTMLElement>(':scope>.detail-panel');
    if (!heading || !panel) throw new Error('A section without its heading or panel.');
    const look = getComputedStyle(panel);
    expect(look.display).toBe('block');
    expect(look.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(parseFloat(look.borderTopLeftRadius)).toBeGreaterThan(20);
    // The heading stands over the panel, indented as its words are.
    expect(heading.getBoundingClientRect().bottom).toBeLessThanOrEqual(panel.getBoundingClientRect().top);
    expect(heading.getBoundingClientRect().left).toBeGreaterThan(panel.getBoundingClientRect().left);
    // No rule over it.
    const rule = getComputedStyle(section, '::before');
    expect(rule.display === 'none' || rule.content === 'none').toBe(true);
  }
  closed(card);
  card.remove();
  const popover = await page(hassWith(), { sheet_style: 'popover' });
  open(popover, 'pressure');
  const panel = part(popover, 'dialog[open] .detail-summary>.detail-panel');
  expect(getComputedStyle(panel).display).toBe('contents');
  closed(popover);
  popover.remove();
});

test('from the foot the totals are smaller: quiet 11 px span names over 14 px rows named in semibold, their amounts quiet, a hairline between', async () => {
  const { card } = await footSheet('precipitation'),
    list = part(card, 'dialog[open] .detail-totals .sheet-rows');
  // With no hours gone by there is only the next 24 hours' span: it stands twice, as today's two do.
  list.append(...[...list.children].map(row => row.cloneNode(true)));
  const rows = [...list.querySelectorAll<HTMLElement>(':scope>div')],
    inRow = (row: HTMLElement, selector: string) => {
      const node = row.querySelector(selector);
      if (!(node instanceof HTMLElement)) throw new Error(`No ${selector}.`);
      return node;
    };
  expect(rows.length).toBe(2);
  for (const row of rows) {
    const span = getComputedStyle(inRow(row, 'dt')),
      name = getComputedStyle(inRow(row, 'dd>span')),
      amount = inRow(row, 'dd>b');
    expect([span.fontSize, span.fontWeight, span.color]).toEqual(['11px', '400', 'rgba(235, 235, 245, 0.6)']);
    expect([name.fontSize, name.fontWeight]).toEqual(['14px', '600']);
    // A kind's colour stands over the quiet grey.
    if (!amount.style.color) expect(getComputedStyle(amount).color).toBe('rgba(235, 235, 245, 0.6)');
  }
  const [first, second] = rows;
  if (!first || !second) throw new Error('Two rows.');
  const rule = getComputedStyle(second, '::before'),
    gap = parseFloat(getComputedStyle(second).marginTop);
  expect(gap).toBeCloseTo(26.3, 1);
  // In the sheet's own px, which a sheet's zoom leaves alone, in whole px as offsets are.
  expect(Math.abs(second.offsetTop - first.offsetTop - first.offsetHeight - gap)).toBeLessThan(1);
  expect(parseFloat(rule.borderTopWidth)).toBeLessThan(1);
  expect(rule.borderTopColor).toBe('rgba(84, 84, 88, 0.6)');
  // It runs through the middle of the gap.
  expect(Math.abs(parseFloat(rule.top) + gap / 2)).toBeLessThan(0.5);
  closed(card);
  card.remove();
  // Beside a tile they are as they were.
  const popover = await page(hassWith(), { sheet_style: 'popover' });
  open(popover, 'precipitation');
  expect(getComputedStyle(part(popover, 'dialog[open] .detail-totals dt')).fontSize).toBe('13.75px');
  closed(popover);
  popover.remove();
});

// The sheets its menu offers, and the one it shows.
const offered = (card: IWeatherCard) =>
  [...card.root.querySelectorAll<HTMLElement>('dialog[open] .sheet-menu:not([data-leaving]) [data-choice]')].map(
    item => `${item.dataset['choice'] ?? ''}${item.getAttribute('aria-checked') === 'true' ? '*' : ''}`,
  );
const menuOpen = (card: IWeatherCard) =>
  part(card, 'dialog[open] [data-switch]').getAttribute('aria-expanded') === 'true';

test('from the foot a sheet’s words are white and its menu’s a shade short, and a popover keeps its softer white', async () => {
  const { card } = await footSheet('precipitation'),
    colour = (selector: string) => getComputedStyle(part(card, selector)).color;
  expect(colour('dialog[open] h2')).toBe('rgb(255, 255, 255)');
  expect(colour('dialog[open] .detail-days span')).toBe('rgb(255, 255, 255)');
  expect(colour('dialog[open] .sheet-menu [data-choice]')).toMatch(/^rgba\(255, 255, 255, 0\.92/);
  expect(colour('dialog[open] .sheet-menu small')).toBe('rgba(255, 255, 255, 0.5)');
  closed(card);
  card.remove();
  const popover = await page(hassWith(), { sheet_style: 'popover' });
  open(popover, 'precipitation');
  expect(getComputedStyle(part(popover, 'dialog[open] h2')).color).toBe('rgba(255, 255, 255, 0.85)');
  closed(popover);
  popover.remove();
});

test('from the foot, a sheet of a day’s readings turns to another from its menu, on the same day, from its top', async () => {
  const { card, dialog, place } = await footSheet('uv'),
    later = part(card, 'dialog[open] .detail-days button:nth-child(4)'),
    day = later.dataset['day'];
  later.click();
  dialog.scrollTop = place + 100;
  // Opened from the keyboard, the sheet shown has the focus.
  part(card, 'dialog[open] [data-switch]').click();
  expect(menuOpen(card)).toBe(true);
  expect(part(card, 'dialog[open] .sheet-menu').hidden).toBe(false);
  expect(offered(card)).toEqual(['conditions', 'uv*', 'wind', 'precipitation', 'humidity', 'visibility', 'pressure']);
  expect(card.root.activeElement).toBe(part(card, 'dialog[open] [data-choice=uv]'));
  expect(part(card, 'dialog[open] [data-choice=conditions] small').textContent).toBe('Temperature · Feels Like');
  part(card, 'dialog[open] [data-choice=wind]').click();
  expect(dialog.dataset['id']).toBe('wind');
  expect(dialog.getAttribute('aria-label')).toBe('Wind');
  expect(part(card, 'dialog[open] .detail-days [aria-pressed=true]').dataset['day']).toBe(day);
  expect(dialog.scrollTop).toBeCloseTo(place, 0);
  expect(menuOpen(card)).toBe(false);
  expect(card.root.activeElement).toBe(part(card, 'dialog[open] [data-switch]'));
  // Its button shows the sheet it turned to.
  expect(part(card, 'dialog[open] [data-switch] .sheet-glyph').innerHTML).toBe(
    part(card, 'dialog[open] .sheet>header .detail-glyph').innerHTML,
  );
  expect(offered(card)).toContain('wind*');
  // The menu it was chosen from shrinks into the new button, taking nothing more, and goes.
  const leaving = part(card, 'dialog[open] .sheet-menu[data-leaving]');
  expect(leaving.inert).toBe(true);
  await vi.waitFor(() => {
    expect(leaving.isConnected).toBe(false);
  });
  closed(card);
  card.remove();
});

test('from the foot, its close button is pressed for as long as it is held down, and nowhere else', async () => {
  const { card } = await footSheet('uv'),
    close = part(card, 'dialog[open] .sheet>header>[data-close]');
  close.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
  expect(close.hasAttribute('data-pressed')).toBe(true);
  await vi.waitFor(() => {
    expect(new DOMMatrixReadOnly(getComputedStyle(close).transform).a).toBeGreaterThan(1.3);
  });
  dispatchEvent(new PointerEvent('pointercancel'));
  expect(close.hasAttribute('data-pressed')).toBe(false);
  closed(card);
  card.remove();
  const popover = await page(hassWith(), { sheet_style: 'popover' });
  open(popover, 'uv');
  const button = part(popover, 'dialog[open] [data-close]');
  button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
  expect(button.hasAttribute('data-pressed')).toBe(false);
  dispatchEvent(new PointerEvent('pointerup'));
  closed(popover);
  popover.remove();
});

test('from the foot, its close button lights where the finger is and follows it while held, its cross drawn over its whole box', async () => {
  const { card } = await footSheet('uv'),
    close = part(card, 'dialog[open] .sheet>header>[data-close]'),
    box = close.getBoundingClientRect(),
    at = (x: number, y: number) => ({ clientX: box.left + box.width * x, clientY: box.top + box.height * y }),
    light = () =>
      [close.style.getPropertyValue('--light-x'), close.style.getPropertyValue('--light-y')].map(parseFloat);
  // The cross is drawn the button's size, so the two land on the same pixels.
  const drawing = card.root.querySelector('dialog[open] .sheet>header>[data-close] svg')?.getBoundingClientRect();
  expect([drawing?.width, drawing?.height]).toEqual([box.width, box.height]);
  close.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true, ...at(0.1, 0.9) }));
  const [x = 0, y = 0] = light();
  expect(x).toBeCloseTo(10, 0);
  expect(y).toBeCloseTo(90, 0);
  await vi.waitFor(() => {
    expect(getComputedStyle(close, '::before').opacity).toBe('1');
  });
  dispatchEvent(new PointerEvent('pointermove', at(0.5, 0.25)));
  const [movedX = 0, movedY = 0] = light();
  // The button has grown under the finger by now, so the same point is nearer its middle.
  expect(movedX).toBeGreaterThan(x);
  expect(movedY).toBeLessThan(y);
  dispatchEvent(new PointerEvent('pointerup'));
  dispatchEvent(new PointerEvent('pointermove', at(0.9, 0.1)));
  expect(light()).toEqual([movedX, movedY]);
  await vi.waitFor(() => {
    expect(getComputedStyle(close, '::before').opacity).toBe('0');
  });
  closed(card);
  card.remove();
});

test('held on the menu’s button and drawn down it, a finger lights each sheet in turn, stretches the menu past its edge, and chooses where it lets go, the sheet never moving', async () => {
  const { card, dialog } = await footSheet('uv'),
    button = part(card, 'dialog[open] [data-switch]'),
    at = (element: Element) => {
      const box = element.getBoundingClientRect();
      return { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
    },
    press = (type: string, element: Element, point: { clientX: number; clientY: number }) =>
      element.dispatchEvent(
        new PointerEvent(type, { bubbles: true, composed: true, pointerId: 7, pointerType: 'touch', ...point }),
      );
  // Each sheet it passes ticks, as the moon's marks do, with haptics left as they come.
  let ticks = 0;
  card.addEventListener('haptic', () => ticks++);
  press('pointerdown', button, at(button));
  expect(menuOpen(card)).toBe(true);
  const menu = part(card, 'dialog[open] .sheet-menu');
  for (const animation of menu.getAnimations({ subtree: true })) animation.finish();
  const rest = menu.getBoundingClientRect();
  // The sheet's scroll is the menu's to keep still.
  const move = new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: [] });
  dialog.dispatchEvent(move);
  expect(move.defaultPrevented).toBe(true);
  const lit = () => card.root.querySelector<HTMLElement>('dialog[open] .sheet-menu [data-lit]')?.dataset['choice'];
  press('pointermove', menu, at(part(card, 'dialog[open] [data-choice=wind]')));
  expect(lit()).toBe('wind');
  press('pointermove', menu, at(part(card, 'dialog[open] [data-choice=precipitation]')));
  expect(lit()).toBe('precipitation');
  expect(ticks).toBe(2);
  // 200 px past the menu's foot it leans after the finger by 3.74% of its height: its top goes down
  // by that, its foot twice as far, and it grows as much thinner, keeping its area, its corner at
  // the button where it was, though a finger held on the button draws it in.
  button.style.transition = 'none';
  button.style.transform = 'scale(.9)';
  press('pointermove', menu, { clientX: rest.left + rest.width / 2, clientY: rest.bottom + 200 });
  const leant = menu.getBoundingClientRect();
  expect((leant.top - rest.top) / rest.height).toBeCloseTo(0.0374, 3);
  expect((leant.bottom - rest.bottom) / rest.height).toBeCloseTo(2 * 0.0374, 3);
  expect(leant.right).toBeCloseTo(rest.right, 1);
  expect((leant.width * leant.height) / (rest.width * rest.height)).toBeCloseTo(1, 3);
  // Out to its left as well, it leans that way too, its width going by the share the left gives it
  // over the share its foot does.
  press('pointermove', menu, { clientX: rest.left - 100, clientY: rest.bottom + 200 });
  const both = menu.getBoundingClientRect();
  expect((rest.right - both.right) / rest.width).toBeCloseTo(0.0204, 3);
  expect(both.width / rest.width).toBeCloseTo(1.0204 / 1.0374, 3);
  press('pointermove', menu, at(part(card, 'dialog[open] [data-choice=precipitation]')));
  press('pointerup', menu, at(part(card, 'dialog[open] [data-choice=precipitation]')));
  expect(dialog.dataset['id']).toBe('precipitation');
  // The click its letting go makes is its own.
  part(card, 'dialog[open] [data-switch]').click();
  expect(menuOpen(card)).toBe(false);
  closed(card);
  card.remove();
});

test('from the foot, the menu comes out of its button as a round drop, its top home last, and fades as it goes, its button growing back', async () => {
  const { card } = await footSheet('uv'),
    button = part(card, 'dialog[open] [data-switch]'),
    corner = button.getBoundingClientRect();
  button.click();
  const menu = part(card, 'dialog[open] .sheet-menu'),
    rows = part(card, 'dialog[open] .sheet-menu>.glass-menu-rows'),
    rounding = () => parseFloat(getComputedStyle(menu).borderTopLeftRadius),
    sample = (running: readonly Animation[], ms: number) => {
      for (const animation of running) {
        animation.pause();
        animation.currentTime = ms;
      }
      return menu.getBoundingClientRect();
    };
  const opening = menu.getAnimations({ subtree: true });
  // It moves only transforms and fades, which the browser runs on its own, with its blurs and its
  // corners each a motion apart.
  const moved = opening.map(animation =>
    animation.effect instanceof KeyframeEffect
      ? [...new Set(animation.effect.getKeyframes().flatMap(frame => Object.keys(frame)))]
          .filter(key => !['offset', 'easing', 'composite', 'computedOffset'].includes(key))
          .toSorted()
          .join()
      : '',
  );
  for (const kind of moved) expect(['transform', 'opacity,transform', 'filter', 'borderRadius']).toContain(kind);
  const early = sample(opening, 100),
    grown = new DOMMatrix(getComputedStyle(rows).transform).a,
    blurred = getComputedStyle(rows).filter,
    [round = ''] = getComputedStyle(menu).borderTopLeftRadius.split(' ');
  sample(opening, 50);
  const faint = Number(getComputedStyle(menu).opacity),
    swell = sample(opening, 260);
  // Its corners close in with it as it settles, and it is still within half a second.
  sample(opening, 360);
  const [squared = 0] = getComputedStyle(menu).borderTopLeftRadius.split(' ').map(parseFloat);
  expect(Math.max(...opening.map(animation => Number(animation.effect?.getTiming().duration)))).toBeLessThanOrEqual(
    500,
  );
  for (const animation of opening) animation.finish();
  expect(Math.abs((squared / 100) * parseFloat(getComputedStyle(menu).width) - rounding())).toBeLessThan(2);
  const rest = menu.getBoundingClientRect();
  // As much glass under its last row as over its first.
  const items = [...menu.querySelectorAll<HTMLElement>('[data-choice]')],
    above = (items[0]?.getBoundingClientRect().top ?? 0) - rest.top,
    below = rest.bottom - (items.at(-1)?.getBoundingClientRect().bottom ?? 0);
  expect(below).toBeCloseTo(above, 0);
  // A tenth of a second in, it has sunk below the button and is not yet as wide as the menu; as round
  // as it can be, what it holds larger and blurred.
  expect(early.top - corner.top).toBeGreaterThan(rest.height * 0.15);
  expect(early.width).toBeLessThan(rest.width * 0.85);
  expect(round).toBe('50%');
  expect(getComputedStyle(menu).borderTopLeftRadius).toBe(`${rounding()}px`);
  expect(grown).toBeGreaterThan(1.1);
  expect(blurred).toMatch(/blur/);
  // The button all but goes as it draws in, and the glass comes back as it swells.
  expect(faint).toBeLessThan(0.3);
  expect(Number(getComputedStyle(menu).opacity)).toBe(1);
  // A quarter of a second in, it swells a shade past its size, its bottom past the menu's, and eases
  // back.
  expect(swell.width).toBeGreaterThan(rest.width * 1.015);
  expect(swell.height).toBeGreaterThan(rest.height * 1.02);
  expect(swell.bottom).toBeGreaterThan(rest.bottom);
  // Whole, it stands at the button's corner.
  expect(rest.top).toBeCloseTo(corner.top, 0);
  expect(rest.right).toBeCloseTo(corner.right, 0);
  // Put away, its top drops first, and it draws in toward the button and fades, gone before it gets
  // there; the button stands again under it, and grows back into its place from under half its size.
  button.click();
  expect(getComputedStyle(button).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  const closing = menu.getAnimations({ subtree: true }),
    going = sample(closing, 50);
  expect(going.top - corner.top).toBeGreaterThan(rest.height * 0.1);
  const last = sample(closing, Math.max(...closing.map(animation => Number(animation.effect?.getTiming().duration))));
  expect(Number(getComputedStyle(menu).opacity)).toBe(0);
  expect(last.width).toBeLessThan(rest.width * 0.5);
  expect(last.width).toBeGreaterThan(corner.width);
  const growing = button.getAnimations().filter(animation => !(animation instanceof CSSTransition)),
    grownAt = (ms: number) => {
      for (const animation of growing) {
        animation.pause();
        animation.currentTime = ms;
      }
      return {
        shown: Number(getComputedStyle(button).opacity),
        size: button.getBoundingClientRect().width / corner.width,
      };
    };
  expect(grownAt(100).shown).toBe(0);
  const small = grownAt(160);
  expect(small.shown).toBe(1);
  expect(small.size).toBeLessThan(0.6);
  expect(grownAt(400).size).toBeCloseTo(1, 1);
  for (const animation of [...closing, ...growing]) animation.finish();
  await vi.waitFor(() => {
    expect(menu.hidden).toBe(true);
  });
  closed(card);
  card.remove();
});

test('a press beside the open menu only puts it away, and Escape puts away the menu rather than the sheet', async () => {
  const { card, dialog } = await footSheet('uv'),
    button = part(card, 'dialog[open] [data-switch]'),
    shown = part(card, 'dialog[open] .detail-days [aria-pressed=true]').dataset['day'],
    other = part(card, 'dialog[open] .detail-days button:nth-child(4)');
  // A tap opens it with the focus left where it was.
  button.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, detail: 1 }));
  expect(menuOpen(card)).toBe(true);
  expect(card.root.activeElement).not.toBe(part(card, 'dialog[open] [data-choice=uv]'));
  other.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
  other.click();
  expect(menuOpen(card)).toBe(false);
  expect(part(card, 'dialog[open] .detail-days [aria-pressed=true]').dataset['day']).toBe(shown);
  await vi.waitFor(() => {
    expect(part(card, 'dialog[open] .sheet-menu').hidden).toBe(true);
  });
  // The next press goes where it lands.
  other.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
  other.click();
  expect(part(card, 'dialog[open] .detail-days [aria-pressed=true]').dataset['day']).toBe(other.dataset['day']);
  part(card, 'dialog[open] [data-switch]').click();
  await userEvent.keyboard('{ArrowDown}');
  expect(card.root.activeElement).toBe(part(card, 'dialog[open] [data-choice=wind]'));
  await userEvent.keyboard('{Escape}');
  expect(menuOpen(card)).toBe(false);
  // Long past a sheet's going.
  await pause(600);
  expect(dialog.hasAttribute('open')).toBe(true);
  expect(dialog.hasAttribute('data-sinking')).toBe(false);
  expect(card.root.activeElement).toBe(part(card, 'dialog[open] [data-switch]'));
  closed(card);
  card.remove();
});

test('only a sheet of a day’s readings from the foot has the menu, which offers only the sheets with something to show', async () => {
  const popover = await page(hassWith(), { sheet_style: 'popover' });
  open(popover, 'uv');
  expect(popover.root.querySelector('dialog[open] .sheet-switch')).toBeNull();
  closed(popover);
  popover.remove();
  const moon = await page(hassWith(), { sheet_style: 'sheet' });
  open(moon, 'moon');
  expect(moon.root.querySelector('dialog[open] .sheet-switch')).toBeNull();
  closed(moon);
  moon.remove();
  // Neither visibility nor pressure, now or in the forecast.
  const unread = new Set(['visibility', 'pressure']),
    read = (entry: object) => Object.fromEntries(Object.entries(entry).filter(([key]) => !unread.has(key))),
    plain = hassWith(),
    entity = plain.states['weather.home'];
  if (!entity) throw new Error('No weather entity.');
  const hass: HomeAssistant = {
    ...plain,
    states: { ...plain.states, 'weather.home': { ...entity, attributes: read(entity.attributes) } },
    connection: {
      subscribeMessage(callback: (message: unknown) => void, message: ForecastSubscription) {
        queueMicrotask(() => {
          callback({ forecast: message.forecast_type === 'hourly' ? hourly().map(read) : daily() });
        });
        return Promise.resolve(() => undefined);
      },
    },
  };
  const card = await page(hass, { sheet_style: 'sheet' });
  open(card, 'wind');
  part(card, 'dialog[open] [data-switch]').click();
  expect(offered(card)).toEqual(['conditions', 'uv', 'wind*', 'precipitation', 'humidity']);
  closed(card);
  card.remove();
});

test('where sheets come from the foot the map takes the whole screen, and elsewhere it stands in the middle', async () => {
  for (const [sheet_style, full] of [
    ['sheet', true],
    ['popover', false],
  ] as const) {
    const card = await page(hassWith(), { sheet_style, map: 'local' });
    part(card, '.tile[data-tile=map]').click();
    await vi.waitFor(() => {
      expect(card.root.querySelector('dialog[open][data-id=map]')).not.toBeNull();
    });
    const dialog = part(card, 'dialog[open][data-id=map]'),
      box = dialog.getBoundingClientRect();
    expect(dialog.hasAttribute('data-full')).toBe(full);
    if (full) {
      expect(box.left).toBeCloseTo(0, 0);
      expect(box.top).toBeCloseTo(0, 0);
      expect(box.width).toBeCloseTo(innerWidth, 0);
      expect(box.height).toBeCloseTo(innerHeight, 0);
    } else expect(box.width).toBeLessThan(innerWidth);
    closed(card);
    card.remove();
  }
});

test('a finger lifted from the map over the whole screen leaves it open, as that map is no sheet to pull away', async () => {
  const card = await page(hassWith(), { sheet_style: 'sheet', map: 'local' });
  part(card, '.tile[data-tile=map]').click();
  await vi.waitFor(() => {
    expect(card.root.querySelector('dialog[open][data-full]')).not.toBeNull();
  });
  const dialog = part(card, 'dialog[open][data-full]'),
    button = part(card, 'dialog[open][data-full] button:not([data-close])'),
    touch = new Touch({ identifier: 1, target: button, clientX: 100, clientY: 100 });
  button.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [touch], changedTouches: [touch] }));
  button.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [touch] }));
  await settled();
  await settled();
  expect(dialog.hasAttribute('open')).toBe(true);
  expect(dialog.hasAttribute('data-thrown')).toBe(false);
  closed(card);
  card.remove();
});

test('from the foot a sheet’s charts and menu button stand 16 px in from its sides, its words 3 px further', async () => {
  const { card, sheet } = await footSheet('precipitation'),
    box = sheet.getBoundingClientRect(),
    // The sheet is 400 of its own px across, drawn to the width of the screen.
    scale = box.width / 400,
    inset = (selector: string) => {
      const found = part(card, `dialog[open] ${selector}`).getBoundingClientRect();
      return { left: (found.left - box.left) / scale, right: (box.right - found.right) / scale };
    };
  for (const chart of ['precipitation', 'chance']) {
    const { left, right } = inset(`.chart-page:nth-child(2) .chart[data-chart=${chart}]`);
    expect(left).toBeCloseTo(16, 0);
    expect(right).toBeCloseTo(16, 0);
  }
  expect(inset('.detail-chance').left).toBeCloseTo(16, 0);
  expect(inset('.sheet-switch>button').right).toBeCloseTo(16, 0);
  for (const words of ['.sheet>.detail-reading', '.detail-chance .detail-reading'])
    expect(getComputedStyle(part(card, `dialog[open] ${words}`)).paddingLeft).toBe('3px');
  expect(getComputedStyle(part(card, 'dialog[open] .detail-date'), '::after').left).toBe('0px');
  // The chance chart's heading is a section's size, the day's chance under it smaller.
  expect(getComputedStyle(part(card, 'dialog[open] .detail-chance h4')).fontSize).toBe('18.6px');
  expect(getComputedStyle(part(card, 'dialog[open] .detail-chance .detail-sub')).fontSize).toBe('12px');
  closed(card);
  card.remove();
});

test('from the foot the moon calendar draws each day’s phase as a symbol, its week across the panel’s whole width', async () => {
  const { card } = await footSheet('moon'),
    panel = part(card, 'dialog[open] .moon-calendar .detail-panel').getBoundingClientRect(),
    week = part(card, 'dialog[open] .moon-week').getBoundingClientRect();
  expect(getComputedStyle(part(card, 'dialog[open] .moon-grid .moon-disc')).display).toBe('none');
  expect(getComputedStyle(part(card, 'dialog[open] .moon-grid .moon-glyph')).display).toBe('block');
  expect(week.left).toBeCloseTo(panel.left, 0);
  expect(week.right).toBeCloseTo(panel.right, 0);
  closed(card);
  card.remove();
});

test('from the foot the date’s arrows wait for the sheet to be touched', async () => {
  const { card, sheet } = await footSheet('precipitation'),
    arrow = part(card, 'dialog[open] .detail-date button');
  expect(getComputedStyle(arrow).visibility).toBe('hidden');
  sheet.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  await vi.waitFor(() => {
    expect(getComputedStyle(arrow).visibility).toBe('visible');
  });
  closed(card);
  card.remove();
});

test('focus rings show for the keyboard only: a tap puts them away, a key brings them back', async () => {
  const card = await page(),
    tile = part(card, '.tile[data-tile=uv]');
  tile.focus();
  expect(tile.matches(':focus-visible')).toBe(true);
  card.root.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
  expect(getComputedStyle(tile).outlineStyle).toBe('none');
  tile.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, composed: true }));
  expect(getComputedStyle(tile).outlineStyle).toBe('solid');
  card.remove();
});

test('haptic feedback ticks for each mark the moon’s strip passes, taps for the rest only when asked, and can be off', async () => {
  const tick = MOON_TICK.hours * MOON_HOUR_PX;
  for (const [haptics, elsewhere, onMoon] of [
    [undefined, false, 3],
    ['all', true, 3],
    ['off', false, 0],
    // Saved before there was a choice: on was everything, and off none.
    [true, true, 3],
    [false, false, 0],
  ] as const) {
    const card = await page(hassWith(), haptics === undefined ? {} : { haptics });
    let taps = 0;
    card.addEventListener('haptic', () => taps++);
    // Pressing a tile, closing its sheet and switching the hourly view.
    open(card, 'uv');
    closed(card);
    part(card, '.modes [data-mode=rain]').click();
    expect(taps > 0, String(haptics)).toBe(elsewhere);
    open(card, 'moon');
    await settled();
    const before = taps;
    // The strip is found afresh each time, as a sheet drawn again holds a new one in the old one's place.
    for (let step = 0; step < 3; step++) {
      part(card, 'dialog[open] .moon-scroll').scrollLeft += tick;
      await settled();
    }
    expect(taps - before, String(haptics)).toBe(onMoon);
    card.remove();
  }
});

test('the moon’s strip ticks lightly past a mark and firmly past a midnight’s line', async () => {
  const card = await page(hassWith()),
    felt: unknown[] = [];
  card.addEventListener('haptic', event => felt.push(event instanceof CustomEvent ? event.detail : undefined));
  open(card, 'moon');
  await settled();
  const strip = () => part(card, 'dialog[open] .moon-scroll'),
    tick = MOON_TICK.hours * MOON_HOUR_PX,
    midnight = (strip().dataset['midnights'] ?? '')
      .split(',')
      .map(Number)
      .find(at => at > strip().scrollLeft + tick);
  expect(midnight).toBeDefined();
  strip().scrollLeft = (midnight ?? 0) - tick / 2;
  await settled();
  felt.length = 0;
  strip().scrollLeft = (midnight ?? 0) + 1;
  await settled();
  strip().scrollLeft += tick;
  await settled();
  strip().scrollLeft -= tick;
  await settled();
  expect(felt).toEqual(['medium', 'light', 'light']);
  card.remove();
});
