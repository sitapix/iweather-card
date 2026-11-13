import { afterEach, expect, test, vi } from 'vitest';
import '../src/iweather-card.ts';
import type { ForecastSubscription, HomeAssistant } from '../src/card/home-assistant.ts';
import type { IWeatherCard } from '../src/iweather-card.ts';
import { ACTUAL, temperatureScale } from '../src/cards/forecast/conditions.ts';
import { weatherNumber } from '../src/lib/formats.ts';
import { chartMarkup } from '../src/sheets/chart.ts';
import { scrubCharts } from '../src/sheets/chart-scrub.ts';
import { dayAxis } from '../src/sheets/days.ts';

// A day's charts as a sheet draws them: their frame, and a scale that stays put.
const HOUR = 3_600_000,
  DAY = 24 * HOUR;
// One morning, so that the hours a test reads are the same at any time of day.
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(Date.UTC(2026, 9, 27, 14, 30));
const start = Math.floor(Date.now() / HOUR) * HOUR;
const hourly = Array.from({ length: 48 }, (_, i) => ({
  datetime: new Date(start + i * HOUR).toISOString(),
  // The second day is far milder than the first, and neither reaches yesterday's high.
  temperature: i < 24 ? 50 + i / 2 : 58 + (i % 3),
  apparent_temperature: i < 24 ? 48 + i / 2 : 57,
  condition: 'cloudy',
  wind_speed: i < 24 ? 8 : 4,
  wind_gust_speed: i < 24 ? 26 : 9,
  wind_bearing: 200,
  humidity: 60,
  pressure: 30,
  uv_index: 3,
  visibility: 40,
  precipitation: 0.1,
  precipitation_probability: 40,
}));
const daily = Array.from({ length: 8 }, (_, i) => ({
  datetime: new Date(start + (i + 0.5) * DAY).toISOString(),
  condition: 'cloudy',
  temperature: 60,
  templow: 48,
  precipitation: 0.1,
}));
const attributes = {
  temperature: 58,
  temperature_unit: '°F',
  humidity: 60,
  uv_index: 3,
  pressure: 30,
  pressure_unit: 'inHg',
  wind_speed: 8,
  wind_gust_speed: 20,
  wind_bearing: 220,
  wind_speed_unit: 'mph',
  visibility: 10,
  visibility_unit: 'mi',
  precipitation_unit: 'in',
  friendly_name: 'Chicago',
  supported_features: 3,
};
// Home Assistant, answering for history only when told to.
function homeAssistant(history: Promise<unknown>): HomeAssistant {
  return {
    states: {
      'weather.home': { entity_id: 'weather.home', state: 'cloudy', attributes },
      'sun.sun': { entity_id: 'sun.sun', state: 'above_horizon', attributes: { elevation: 40, rising: true } },
    },
    locale: { language: 'en', time_format: '12' },
    config: { location_name: 'Home', time_zone: 'America/Chicago', latitude: 41.9, longitude: -87.6 },
    callWS: () => history,
    connection: {
      subscribeMessage(callback: (message: unknown) => void, message: ForecastSubscription) {
        queueMicrotask(() => {
          callback({ forecast: message.forecast_type === 'hourly' ? hourly : daily });
        });
        return Promise.resolve(() => undefined);
      },
    },
  };
}
let shown: IWeatherCard | undefined;
afterEach(() => {
  shown?.remove();
});
const frames = async (count: number) => {
  for (let i = 0; i < count; i++) await new Promise(requestAnimationFrame);
};
async function page(history: Promise<unknown> = Promise.resolve({})): Promise<IWeatherCard> {
  const card = document.createElement('iweather-card');
  card.style.cssText = 'display:block;width:1100px';
  card.setConfig({
    type: 'custom:iweather-card',
    entity: 'weather.home',
    weather_layout: 'page',
    open_meteo_forecast: false,
    weather_animation: false,
    tiles: ['wind', 'uv', 'feels_like', 'precipitation', 'humidity', 'pressure', 'visibility'],
  });
  card.hass = homeAssistant(history);
  document.body.replaceChildren(card);
  shown = card;
  await frames(3);
  return card;
}
const within = (holder: IWeatherCard | HTMLElement, selector: string): HTMLElement => {
  const found = ('root' in holder ? holder.root : holder).querySelector(selector);
  if (!(found instanceof HTMLElement)) throw new Error(`No ${selector}`);
  return found;
};
// The charts of the day chosen, which is the page in view.
const shownPage = (card: IWeatherCard) =>
  `dialog[open] .chart-page[data-day="${within(card, 'dialog[open] .detail-days [aria-pressed=true]').dataset['day'] ?? ''}"]`;
const scale = (card: IWeatherCard) =>
  [...card.root.querySelectorAll(`${shownPage(card)} .chart-y`)].map(y =>
    [...y.children].map(label => label.textContent),
  );
const hours = (card: IWeatherCard) =>
  [...card.root.querySelectorAll(`${shownPage(card)} .chart-x`)].map(x =>
    [...x.children].map(label => label.textContent),
  );
const open = async (card: IWeatherCard, tile: string) => {
  within(card, `.tile[data-tile="${tile}"]`).click();
  await frames(1);
};
const press = async (card: IWeatherCard, selector: string) => {
  within(card, `dialog[open] ${selector}`).click();
  await frames(1);
};

test('Conditions reads the same scale on today and tomorrow, on both tabs', async () => {
  const card = await page();
  await open(card, 'feels_like');
  const [temperatures, chance] = scale(card);
  expect(temperatures?.[0]).toMatch(/°$/);
  await press(card, '[data-variant=temperature]');
  expect(scale(card)).toEqual([temperatures, chance]);
  await press(card, '.detail-days button:nth-child(2)');
  expect(scale(card)).toEqual([temperatures, chance]);
  await press(card, '[data-variant=feels_like]');
  expect(scale(card)).toEqual([temperatures, chance]);
});
test('wind reads the same scale on its calm day and its gusty one', async () => {
  const card = await page();
  await open(card, 'wind');
  const [windy] = scale(card);
  await press(card, '.detail-days button:nth-child(2)');
  expect(scale(card)).toEqual([windy]);
  // Up to the gusts of 26, a step past them, from a calm 0.
  expect(windy).toEqual(['0', '5', '10', '15', '20', '25', '30', '35']);
});
test('history answering late fills the chart in without moving its scale', async () => {
  let answer: (reply: unknown) => void = () => undefined;
  const late = new Promise<unknown>(resolve => {
      answer = resolve;
    }),
    card = await page(late);
  await open(card, 'feels_like');
  const before = scale(card),
    sheet = within(card, 'dialog[open] .sheet').innerHTML;
  const lastHour = Date.now() - 3 * HOUR;
  answer({
    'weather.home': [
      { lu: (lastHour - DAY) / 1000, s: 'sunny', a: { temperature: 95, temperature_unit: '°F' } },
      { lu: lastHour / 1000, s: 'sunny', a: { temperature: 20, temperature_unit: '°F' } },
    ],
  });
  await frames(3);
  // It was drawn again, with the same scale.
  expect(within(card, 'dialog[open] .sheet').innerHTML).not.toBe(sheet);
  expect(scale(card)).toEqual(before);
  // Opened again, history is in from the start, so the scale takes it in.
  within(card, 'dialog[open] [data-close]').click();
  await open(card, 'feels_like');
  expect(scale(card)).not.toEqual(before);
});
test('a chart is one of two sizes, framed top and bottom, whatever it shows', async () => {
  const card = await page();
  for (const [tile, chart, whole, plot] of [
    ['wind', 'wind', 301.25, 273.75],
    ['humidity', 'humidity', 301.25, 273.75],
    ['pressure', 'pressure', 301.25, 273.75],
    ['uv', 'uv', 301.25, 273.75],
    ['visibility', 'visibility', 301.25, 273.75],
    ['precipitation', 'precipitation', 201.25, 175],
    ['precipitation', 'chance', 201.25, 175],
  ] as const) {
    await open(card, tile);
    // Measured in the sheet's own px, before its zoom and as it opens.
    const selector = `${shownPage(card)} .chart[data-chart=${chart}]`,
      frame = within(card, selector),
      area = within(card, `${selector} .chart-plot`),
      numbers = within(card, `${selector} .chart-y`);
    expect(frame.offsetHeight).toBe(Math.round(whole));
    expect(area.offsetHeight).toBe(Math.round(plot));
    expect(area.getBoundingClientRect().height / frame.getBoundingClientRect().height).toBeCloseTo(plot / whole, 2);
    // The scale's column runs up against the plot, and its numbers stand 7.5 px on from there.
    expect(numbers.getBoundingClientRect().left).toBeCloseTo(area.getBoundingClientRect().right, 0);
    expect(getComputedStyle(numbers).paddingLeft).toBe('7.5px');
    within(card, 'dialog[open] [data-close]').click();
    await frames(1);
  }
  // Both of the rain's charts have the same plot, though only one has numbers.
  await open(card, 'precipitation');
  const widths = ['precipitation', 'chance'].map(
    chart => within(card, `${shownPage(card)} .chart[data-chart=${chart}] .chart-plot`).offsetWidth,
  );
  expect(widths[0]).toBe(widths[1]);
});
test('a chart being read keeps its cursor over the plot, clear of what fades the past', async () => {
  const card = await page();
  await open(card, 'wind');
  const chart = within(card, `${shownPage(card)} .chart`),
    plot = within(chart, '.chart-plot'),
    face = within(chart, '.chart-face');
  expect(hours(card)[0]?.length).toBe(4);
  expect(getComputedStyle(face).maskImage).toContain('linear-gradient');
  const box = plot.getBoundingClientRect();
  plot.dispatchEvent(
    new PointerEvent('pointermove', {
      bubbles: true,
      composed: true,
      pointerType: 'mouse',
      clientX: box.left + box.width * 0.9,
      clientY: box.top + box.height / 2,
    }),
  );
  expect('scrubbing' in chart.dataset).toBe(true);
  // Outside the part of the chart that fades, and over the plot still.
  const cursor = within(chart, '.chart-cursor');
  expect(face.contains(cursor)).toBe(false);
  expect(cursor.getBoundingClientRect().height).toBeCloseTo(box.height, 0);
  expect(cursor.getBoundingClientRect().left).toBeCloseTo(box.left + box.width * 0.9, -1);
});

// Moves a mouse over a share of a plot, or does something else there as a pointer.
const point = (plot: HTMLElement, type: string, across: number, more: PointerEventInit = {}) => {
  const box = plot.getBoundingClientRect();
  plot.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      composed: true,
      pointerType: 'mouse',
      clientX: box.left + box.width * across,
      clientY: box.top + box.height / 2,
      ...more,
    }),
  );
};
const hover = (plot: HTMLElement, across: number) => {
  point(plot, 'pointermove', across);
};
const readings = (card: IWeatherCard) =>
  [...card.root.querySelectorAll('dialog[open] .detail-reading')].map(reading =>
    [...reading.children].map(part => part.textContent),
  );
const chartIn = (card: IWeatherCard, name: string) => within(card, `${shownPage(card)} .chart[data-chart=${name}]`);

test('every chart in a sheet reads the same hour, a bar at its middle, with no dot on bars', async () => {
  const card = await page();
  await open(card, 'precipitation');
  const rain = chartIn(card, 'precipitation'),
    chance = chartIn(card, 'chance');
  hover(within(rain, '.chart-plot'), 0.8);
  expect('scrubbing' in chance.dataset).toBe(true);
  const [time = '', value, kind] = readings(card)[0] ?? [];
  expect(time).toMatch(/^\d+[AP]M - \d+[AP]M$/);
  expect([value, kind]).toEqual(['Moderate', 'Rain']);
  // The same hour on both, half an hour apart.
  const place = (chart: HTMLElement) => Number(chart.dataset['at']),
    slot = 100 / Number(rain.dataset['hours']);
  expect(place(rain) - place(chance)).toBeCloseTo(slot / 2, 1);
  expect(readings(card)[1]?.[0]).toBe(time);
  expect(getComputedStyle(within(rain, '.chart-cursor i')).display).toBe('none');
  expect(getComputedStyle(within(chance, '.chart-cursor i')).width).toBe('20px');
  // And it's as much the other chart's reading: reading there moves this one too.
  hover(within(chance, '.chart-plot'), 0.9);
  expect(place(rain) - place(chance)).toBeCloseTo(slot / 2, 1);
  expect(readings(card)[0]?.[0]).toBe(readings(card)[1]?.[0]);
  // Going off a chart puts both away, and what they showed comes back.
  point(within(chance, '.chart-plot'), 'pointerout', 0.9);
  expect(chance.dataset['at']).toBeUndefined();
  expect(rain.dataset['at']).toBeUndefined();
  expect(readings(card)[1]?.[1]).toBe('Chance of Precipitation');
});
test('the conditions sheet reads its chance alone, at the time its hour starts, and its temperature alone too', async () => {
  const card = await page();
  await open(card, 'feels_like');
  const chance = chartIn(card, 'chance'),
    [temperature] = chance.closest('.chart-page')?.querySelectorAll<HTMLElement>('.chart') ?? [],
    reading = within(card, 'dialog[open] .chance-reading'),
    shown = reading.innerHTML;
  if (!temperature || temperature === chance) throw new Error('No temperature chart.');
  expect(chance.hasAttribute('data-alone')).toBe(true);
  hover(within(temperature, '.chart-plot'), 0.5);
  expect('scrubbing' in temperature.dataset).toBe(true);
  expect('scrubbing' in chance.dataset).toBe(false);
  expect(chance.querySelector('.chart-cursor')).toBeNull();
  expect(reading.innerHTML).toBe(shown);
  point(within(temperature, '.chart-plot'), 'pointerout', 0.5);
  // Its own reading: a time on the hour, not the hour's span, and the chance then.
  hover(within(chance, '.chart-plot'), 0.9);
  expect('scrubbing' in chance.dataset).toBe(true);
  expect('scrubbing' in temperature.dataset).toBe(false);
  expect(temperature.querySelector('.chart-cursor')).toBeNull();
  expect(chance.querySelector('.chart-cursor')).not.toBeNull();
  const [time = '', value] = [...reading.children].map(part => part.textContent);
  expect(time).toMatch(/^\d{1,2}:00[AP]M$/);
  expect(value).toBe('40%');
  // At the hour's start, where the line's hour is drawn.
  const slot = 100 / Number(chance.dataset['hours']);
  expect(Number(chance.dataset['at']) / slot).toBeCloseTo(Math.round(Number(chance.dataset['at']) / slot), 2);
  point(within(chance, '.chart-plot'), 'pointerout', 0.9);
  expect('scrubbing' in chance.dataset).toBe(false);
  expect(reading.innerHTML).toBe(shown);
});
test('a line is read by the minute, its time that minute, and a move of under a minute is none', async () => {
  const card = await page();
  await open(card, 'wind');
  const chart = chartIn(card, 'wind'),
    plot = within(chart, '.chart-plot'),
    day = Number(chart.dataset['hours']) * 60,
    at = (minute: number) => minute / day,
    place = () => Number(chart.dataset['at']),
    time = () => readings(card)[0]?.[0];
  expect(chart.dataset['points']).toBe('[]');
  // Half way between two hours: its own place, and its own time.
  const half = 20 * 60 + 30;
  hover(plot, at(half));
  expect(place()).toBeCloseTo((half / day) * 100, 1);
  expect(time()).toMatch(/^\d{1,2}:30PM$/);
  // Under a minute on is no move; a minute on is.
  hover(plot, at(half + 0.4));
  expect(place()).toBeCloseTo((half / day) * 100, 1);
  hover(plot, at(half + 1.1));
  expect(place()).toBeCloseTo(((half + 1) / day) * 100, 1);
  expect(time()).toMatch(/^\d{1,2}:31PM$/);
});
test('a line read past its scale keeps its dot on the plot, and a finger ticks once an hour', () => {
  const root = document.createElement('div'),
    axis = dayAxis(Date.now(), 'America/Chicago');
  root.style.width = '480px';
  root.innerHTML = chartMarkup(
    ACTUAL.chart,
    [
      { hour: 3, value: 300 },
      { hour: 4, value: -300 },
      { hour: 6, value: 60 },
    ],
    temperatureScale({ min: 46, max: 79 }),
    {
      id: 'scrub',
      attrs: { temperature_unit: '°F' },
      now: axis.start - HOUR,
      timeZone: 'America/Chicago',
      locale: 'en-US',
      numbers: 'en-US',
      hour12: true,
      fmt: (value: number | null | undefined, digits = 0) => weatherNumber(value, 'en-US', digits),
    },
    axis,
  );
  document.body.append(root);
  let ticks = 0;
  scrubCharts(root, {
    clock: time => String((time - axis.start) / 60_000),
    step: () => {
      ticks += 1;
    },
    turned: () => undefined,
    keeps: () => true,
  });
  const chart = within(root, '.chart'),
    plot = within(chart, '.chart-plot'),
    day = axis.hours * 60,
    cursor = () => within(chart, '.chart-cursor').style,
    label = () => within(chart, '.chart-cursor b').textContent;
  plot.setPointerCapture = () => undefined;
  hover(plot, (3 * 60) / day);
  expect(cursor().getPropertyValue('--y')).toBe('0%');
  expect(label()).toBe('180 · 300°');
  hover(plot, (4 * 60) / day);
  expect(cursor().getPropertyValue('--y')).toBe('100%');
  point(plot, 'pointerout', (4 * 60) / day);
  // A press ticks as it lands, and again only as it passes into another hour.
  const finger = { pointerType: 'touch', pointerId: 3, isPrimary: true };
  point(plot, 'pointerdown', (4 * 60 + 10) / day, finger);
  for (const minute of [4 * 60 + 20, 4 * 60 + 50, 5 * 60 + 2, 5 * 60 + 30, 5 * 60 + 59])
    point(plot, 'pointermove', minute / day, finger);
  expect(ticks).toBe(2);
  point(plot, 'pointerup', (5 * 60 + 59) / day, finger);
  root.remove();
});
test('the reading goes over the header, its type by what it has to say, inside the sheet', async () => {
  const card = await page();
  await open(card, 'precipitation');
  hover(within(chartIn(card, 'precipitation'), '.chart-plot'), 0.97);
  const [main, chance] = ['.detail-reading', '.chance-reading'].map(name => within(card, `dialog[open] ${name}`)),
    font = (part: Element | null | undefined) => {
      if (!part) throw new Error('No part');
      const { fontSize, fontWeight } = getComputedStyle(part);
      return `${fontSize}/${fontWeight}`;
    };
  if (!main || !chance) throw new Error('No reading');
  expect(font(main.querySelector('.detail-time'))).toBe('12.5px/500');
  expect(font(main.querySelector('.detail-headline'))).toBe('32.5px/700');
  expect(font(main.querySelector('.detail-sub'))).toBe('12.5px/500');
  expect(font(chance.querySelector('.detail-time'))).toBe('16.25px/500');
  expect(font(chance.querySelector('h4'))).toBe('32.5px/700');
  // Kept to the sheet at the chart's far end, where there's no room to centre it.
  const edge = main.getBoundingClientRect().right;
  for (const part of main.children) expect(part.getBoundingClientRect().right).toBeLessThanOrEqual(edge + 1);
});
test('a reading reaches back over what has faded', async () => {
  const earlier = Date.now() - 2 * HOUR;
  // Only as far back as today goes.
  if (new Date(earlier).getDate() !== new Date().getDate()) return;
  const row = (time: number) => ({ lu: time / 1000, s: 'cloudy', a: { wind_speed: 11, wind_bearing: 90 } });
  const card = await page(Promise.resolve({ 'weather.home': [row(earlier), row(earlier + HOUR / 2)] }));
  await open(card, 'wind');
  await frames(3);
  const chart = chartIn(card, 'wind');
  hover(within(chart, '.chart-plot'), 0.01);
  expect(readings(card)[0]?.[1]).toContain('11');
  expect(Number(chart.dataset['at'])).toBeLessThan(parseFloat(chart.style.getPropertyValue('--now-x')));
});
// The strip of pages and which of them is in view.
const strip = (card: IWeatherCard) => within(card, 'dialog[open] .chart-pages');
const pageInView = (card: IWeatherCard) => {
  const pages = strip(card);
  return Math.round(pages.scrollLeft / pages.clientWidth);
};
const chosen = (card: IWeatherCard) =>
  [...card.root.querySelectorAll('dialog[open] .detail-days button')].findIndex(
    day => day.getAttribute('aria-pressed') === 'true',
  );
// A slide runs on the browser's own clock, and with every test file at once that can take a while.
const SLIDE_WAIT = { timeout: 5000 };
// Longer than a frame the page can spare, and than any gap a slide's moves leave.
const BUSY = 200;
const settled = async (card: IWeatherCard) => {
  await vi.waitFor(() => {
    const pages = strip(card);
    expect(pages.scrollLeft % pages.clientWidth).toBe(0);
    expect(pageInView(card)).toBe(chosen(card));
  }, SLIDE_WAIT);
  await new Promise(done => setTimeout(done, 200));
};
test('a sheet has a page of charts to each day from yesterday, today in view, a sheet wide', async () => {
  const card = await page();
  await open(card, 'wind');
  const pages = strip(card),
    days = card.root.querySelectorAll('dialog[open] .detail-days button');
  expect(pages.querySelectorAll('.chart-page')).toHaveLength(days.length);
  expect(pageInView(card)).toBe(1);
  expect(pageInView(card)).toBe(chosen(card));
  expect(pages.clientWidth).toBe(within(card, 'dialog[open] .sheet').clientWidth);
  expect(getComputedStyle(pages).scrollSnapType).toBe('x mandatory');
  // Each page has gradients and cuts of its own.
  const named = [...pages.querySelectorAll('[id]')].map(found => found.id);
  expect(new Set(named).size).toBe(named.length);
});
// A finger on a chart: pressed on the plot, a share of the way across it, and lower by `down` px.
const FINGER = { pointerType: 'touch', pointerId: 7, isPrimary: true };
const touch = (plot: HTMLElement, type: string, across: number, down = 0) => {
  // Capturing a pointer that was never really pressed isn't allowed, and doesn't matter here.
  plot.setPointerCapture = () => undefined;
  const box = plot.getBoundingClientRect();
  point(plot, type, across, { ...FINGER, clientY: box.top + box.height / 2 + down });
};
const wait = (ms: number) => new Promise(done => setTimeout(done, ms));
// Longer than a finger has to be held still to read a chart.
const HELD = 150;
test('a finger reads a chart once held still, gives way to a scroll, and lifted puts its reading away', async () => {
  const card = await page();
  await open(card, 'wind');
  const chart = chartIn(card, 'wind'),
    plot = within(chart, '.chart-plot');
  touch(plot, 'pointerdown', 0.3);
  expect('scrubbing' in chart.dataset).toBe(false);
  await wait(HELD);
  expect('scrubbing' in chart.dataset).toBe(true);
  // Held, a drag across reads along the chart and leaves the pages where they are.
  const at = chart.dataset['at'];
  touch(plot, 'pointermove', 0.6);
  expect(chart.dataset['at']).not.toBe(at);
  expect(strip(card).hasAttribute('data-sliding')).toBe(false);
  expect(pageInView(card)).toBe(1);
  // The browser took it for a scroll of the sheet.
  touch(plot, 'pointercancel', 0.6);
  expect('scrubbing' in chart.dataset).toBe(false);
  // Going down before it is held still, it is the sheet's, and nothing is read.
  touch(plot, 'pointerdown', 0.3);
  touch(plot, 'pointermove', 0.3, 20);
  await wait(HELD);
  expect('scrubbing' in chart.dataset).toBe(false);
  touch(plot, 'pointercancel', 0.3, 20);
  // A tap leaves the chart as drawn, and so does lifting a finger held still, or one that read along.
  touch(plot, 'pointerdown', 0.3);
  touch(plot, 'pointerup', 0.3);
  expect('scrubbing' in chart.dataset).toBe(false);
  for (const along of [0.3, 0.6]) {
    touch(plot, 'pointerdown', 0.3);
    await wait(HELD);
    expect('scrubbing' in chart.dataset).toBe(true);
    touch(plot, 'pointermove', along);
    touch(plot, 'pointerup', along);
    expect('scrubbing' in chart.dataset).toBe(false);
    expect('kept' in chart.dataset).toBe(false);
    expect(chart.querySelector('.chart-cursor')).toBeNull();
  }
});
test('a finger held on a chart with nothing to read leaves the sheet to scroll, and still turns the pages', async () => {
  const root = document.createElement('div'),
    chart = (points: string) =>
      `<div class="chart" data-hours="24" data-points="${points}"><div class="chart-plot" style="height:100px"></div></div>`;
  root.style.width = '400px';
  root.innerHTML = `<div class="chart-pages" style="display:flex;overflow-x:auto"><div class="chart-page" style="flex:none;width:400px">${chart('[]')}${chart('[[50,50,&quot;Noon\\n40%&quot;,12]]')}</div><div class="chart-page" style="flex:none;width:400px"></div></div>`;
  document.body.replaceChildren(root);
  scrubCharts(root, { clock: () => '', step: () => undefined, turned: () => undefined, keeps: () => true });
  const [empty, read] = [...root.querySelectorAll<HTMLElement>('.chart')],
    strip = within(root, '.chart-pages');
  if (!empty || !read) throw new Error('No charts.');
  const held = async (on: HTMLElement) => {
    const plot = within(on, '.chart-plot');
    touch(plot, 'pointerdown', 0.3);
    await wait(HELD);
    const touched = new Touch({ identifier: 7, target: plot, clientX: 120, clientY: 50 }),
      move = new TouchEvent('touchmove', {
        bubbles: true,
        cancelable: true,
        touches: [touched],
        changedTouches: [touched],
      });
    plot.dispatchEvent(move);
    return { plot, kept: move.defaultPrevented };
  };
  // Held on what reads, it reads and nothing scrolls; held on what doesn't, nothing reads, and the sheet scrolls.
  const reading = await held(read);
  expect(reading.kept).toBe(true);
  expect('scrubbing' in read.dataset).toBe(true);
  touch(reading.plot, 'pointerup', 0.3);
  const nothing = await held(empty);
  expect(nothing.kept).toBe(false);
  expect('scrubbing' in empty.dataset).toBe(false);
  // And a move across after the hold turns the pages, as it would have before.
  touch(nothing.plot, 'pointermove', 0.1);
  expect(strip.hasAttribute('data-sliding')).toBe(true);
  touch(nothing.plot, 'pointercancel', 0.1);
});
// Risen into its place: the sheet's opening animations have run their course, however long a busy
// page takes over them, so a box on screen has only the zoom in it. Those that never end (the
// styles' scroll-driven ones) are left out.
const risen = async (card: IWeatherCard) => {
  const dialog = within(card, 'dialog[open]'),
    ending = dialog
      .getAnimations({ subtree: true })
      .filter(animation => Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)));
  await Promise.all(ending.map(animation => animation.finished));
};
test('a finger across a chart turns the pages with it, and let go they settle on a day', async () => {
  const card = await page();
  await open(card, 'wind');
  // Grown to its full size, so a box on screen has only the zoom in it.
  await risen(card);
  const pages = strip(card),
    plot = within(chartIn(card, 'wind'), '.chart-plot'),
    from = pages.scrollLeft,
    // The strip's own px to a px on screen.
    scale = pages.clientWidth / pages.getBoundingClientRect().width,
    width = plot.getBoundingClientRect().width;
  touch(plot, 'pointerdown', 0.6);
  touch(plot, 'pointermove', 0.5);
  await wait(20);
  touch(plot, 'pointermove', 0.4);
  // The pages go with the finger once it has set off, and nothing is read.
  expect(Math.abs(pages.scrollLeft - from - 0.1 * width * scale)).toBeLessThan(2);
  expect(card.root.querySelector('dialog[open] .chart[data-scrubbing]')).toBeNull();
  await wait(HELD);
  expect(card.root.querySelector('dialog[open] .chart[data-scrubbing]')).toBeNull();
  // A quick stroke goes on to the next day.
  touch(plot, 'pointermove', 0.3);
  await wait(20);
  touch(plot, 'pointerup', 0.2);
  await settled(card);
  expect(chosen(card)).toBe(2);
  // Pulled a little way and let go still, they go back, and the day stands.
  const next = within(chartIn(card, 'wind'), '.chart-plot');
  touch(next, 'pointerdown', 0.6);
  touch(next, 'pointermove', 0.5);
  touch(next, 'pointermove', 0.45);
  await wait(HELD);
  touch(next, 'pointerup', 0.45);
  await settled(card);
  expect(chosen(card)).toBe(2);
  // However fast, a stroke turns one page, and the first day's has none before it.
  for (const page of [1, 0, 0]) {
    const shown = within(chartIn(card, 'wind'), '.chart-plot');
    touch(shown, 'pointerdown', 0.1);
    touch(shown, 'pointermove', 0.3);
    await wait(10);
    touch(shown, 'pointermove', 0.9);
    await wait(10);
    touch(shown, 'pointerup', 0.95);
    await settled(card);
    expect(chosen(card)).toBe(page);
  }
});
test('let go, turned pages carry on at the finger’s speed, and the day is drawn once they’re there', async () => {
  const card = await page();
  await open(card, 'wind');
  await risen(card);
  const pages = strip(card),
    plot = within(chartIn(card, 'wind'), '.chart-plot'),
    box = plot.getBoundingClientRect(),
    day = chosen(card),
    from = pages.scrollLeft,
    // A page on screen, the finger's stroke over it in frames, and a frame's share of it.
    across = pages.getBoundingClientRect().width,
    strokes = 8,
    step = (0.6 * across) / strokes,
    finger = (type: string, x: number) => {
      plot.setPointerCapture = () => undefined;
      point(plot, type, 0, { ...FINGER, clientX: x, clientY: box.top + box.height / 2 });
    };
  let x = box.left + box.width * 0.9;
  finger('pointerdown', x);
  x -= 12;
  finger('pointermove', x);
  const begun = { left: pages.scrollLeft, time: performance.now() };
  for (let i = 0; i < strokes; i++) {
    await frames(1);
    x -= step;
    finger('pointermove', x);
  }
  const before = { left: pages.scrollLeft, time: performance.now() },
    speed = (before.left - begun.left) / (before.time - begun.time);
  // Past half way under the finger, the day waits for it to let go.
  expect(before.left - from).toBeGreaterThan(pages.clientWidth / 2);
  expect(chosen(card)).toBe(day);
  finger('pointerup', x);
  const up = { left: pages.scrollLeft, time: performance.now() };
  await frames(1);
  // The frame after it lifts, they're still going at about its speed, not starting again from rest.
  const after = (pages.scrollLeft - up.left) / (performance.now() - up.time);
  expect(after).toBeGreaterThan(speed / 2);
  expect(chosen(card)).toBe(day);
  await settled(card);
  expect(chosen(card)).toBe(day + 1);
});
test('the arrows and the strip of days slide the pages, and sliding them picks the day', async () => {
  const card = await page();
  await open(card, 'humidity');
  const pages = strip(card),
    chart = within(pages, '.chart-page:nth-child(3) .chart');
  await press(card, '[data-step="1"]');
  expect(chosen(card)).toBe(2);
  await settled(card);
  await press(card, '.detail-days button:nth-child(5)');
  await settled(card);
  expect(chosen(card)).toBe(4);
  // Past half way, the day goes with the pages, and the rest follows.
  const date = () => within(card, 'dialog[open] .detail-date span').textContent;
  const before = date();
  pages.scrollTo({ left: 2.6 * pages.clientWidth, behavior: 'instant' });
  await vi.waitFor(() => {
    expect(chosen(card)).toBe(3);
  });
  expect(date()).not.toBe(before);
  await settled(card);
  expect(strip(card)).toBe(pages);
  // Nothing of the charts was drawn again for any of that.
  expect(chart.isConnected).toBe(true);
});
test('a slide held up by a busy page still lands on the day pressed', async () => {
  const card = await page();
  await open(card, 'humidity');
  await press(card, '[data-step="1"]');
  await frames(2);
  // Nothing on the page runs for a while, and the slide's own frames wait with it.
  const until = performance.now() + BUSY;
  while (performance.now() < until);
  await settled(card);
  expect(chosen(card)).toBe(2);
  expect(pageInView(card)).toBe(2);
});
test('a wheel going down the sheet leaves a slide to its day, and one going across takes over', async () => {
  const card = await page();
  await open(card, 'humidity');
  const pages = strip(card),
    wheel = (deltaX: number, deltaY: number) =>
      within(pages, '.chart').dispatchEvent(new WheelEvent('wheel', { bubbles: true, composed: true, deltaX, deltaY }));
  await press(card, '.detail-days button:nth-child(4)');
  wheel(0, 40);
  await settled(card);
  expect(chosen(card)).toBe(3);
  // Before the pages have moved, the day they show stands.
  await press(card, '.detail-days button:nth-child(8)');
  wheel(40, 0);
  expect(chosen(card)).toBe(3);
  await settled(card);
  // Part of the way, they settle on a page, and the day goes with them.
  await press(card, '.detail-days button:nth-child(8)');
  await vi.waitFor(() => {
    expect(pages.scrollLeft % pages.clientWidth).toBeGreaterThan(0);
  });
  expect(pages.hasAttribute('data-sliding')).toBe(true);
  wheel(40, 0);
  expect(pages.hasAttribute('data-sliding')).toBe(false);
  await settled(card);
  expect(chosen(card)).toBe(pageInView(card));
  expect(chosen(card)).not.toBe(7);
});
test('a press on the way to a day isn’t taken over by the pages it goes past', async () => {
  const card = await page();
  await open(card, 'humidity');
  await press(card, '.detail-days button:nth-child(8)');
  // Each page on the way goes by, and the day stays.
  await vi.waitFor(() => {
    expect(strip(card).scrollLeft).toBeGreaterThan(strip(card).clientWidth);
  });
  expect(chosen(card)).toBe(7);
  await settled(card);
  expect(pageInView(card)).toBe(7);
  // Turned back at once, it ends at the later press.
  await press(card, '.detail-days button:nth-child(4)');
  await frames(2);
  await press(card, '[data-step="1"]');
  await settled(card);
  expect(chosen(card)).toBe(4);
});
test('a slide puts away what was being read, and a sheet drawn again stays on its page', async () => {
  let answer: (reply: unknown) => void = () => undefined;
  const late = new Promise<unknown>(resolve => {
      answer = resolve;
    }),
    card = await page(late);
  await open(card, 'wind');
  await press(card, '[data-step="1"]');
  await settled(card);
  const pages = strip(card),
    sheet = within(card, 'dialog[open] .sheet');
  // Yesterday's page, today's, then this one.
  await vi.waitFor(() => {
    expect(pages.scrollLeft).toBeCloseTo(2 * pages.clientWidth, 0);
  }, SLIDE_WAIT);
  const tomorrow = chartIn(card, 'wind'),
    left = pages.scrollLeft;
  sheet.scrollTop = 30;
  hover(within(tomorrow, '.chart-plot'), 0.5);
  expect('scrubbing' in tomorrow.dataset).toBe(true);
  answer({ 'weather.home': [{ lu: (Date.now() - DAY) / 1000, s: 'sunny', a: { wind_speed: 3 } }] });
  await frames(3);
  // Yesterday's page took it in. The day's page was left as it was, and so was where the sheet stood.
  expect(strip(card)).toBe(pages);
  expect(pages.scrollLeft).toBe(left);
  expect(sheet.scrollTop).toBe(30);
  expect(tomorrow.isConnected).toBe(true);
  expect('scrubbing' in tomorrow.dataset).toBe(false);
  hover(within(tomorrow, '.chart-plot'), 0.5);
  expect('scrubbing' in tomorrow.dataset).toBe(true);
  // From the moment they move, well before the day changes.
  pages.dispatchEvent(new Event('scroll'));
  expect('scrubbing' in tomorrow.dataset).toBe(false);
});
test('with reduced motion a day picked is simply there', async () => {
  const card = await page();
  Object.defineProperty(card, 'motion', { value: { matches: true, removeEventListener: () => undefined } });
  await open(card, 'wind');
  await press(card, '.detail-days button:nth-child(7)');
  expect(strip(card).scrollLeft).toBe(6 * strip(card).clientWidth);
  expect(strip(card).getAnimations()).toEqual([]);
});
