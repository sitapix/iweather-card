import { afterAll, beforeAll, expect, onTestFinished, test, vi } from 'vitest';
import { page as frame } from 'vitest/browser';
import '../src/iweather-card.ts';
import type { IWeatherCard } from '../src/iweather-card.ts';
import type { ForecastSubscription, HomeAssistant } from '../src/card/home-assistant.ts';

// The card laid out at every size a sections dashboard offers (a section 12 columns
// wide, rows 56px tall with 8px between), on desktop and phone sections, by day, in rain
// and at night, as Home Assistant places it: in the grid, with its size in grid_options.
const COLUMNS = [3, 4, 6, 8, 12],
  ROWS = [1, 2, 3, 4, 5, 6, 7, 8],
  SECTIONS = [500, 400, 358];
const SCENES = [
  ['partlycloudy', 40, 68, 45],
  ['rainy', 30, 55, 95],
  ['clear-night', -35, 58, 0],
] as const;
// A night with the moon up over Chicago, so the moon is placed in every night card.
const NOW = Date.UTC(2026, 9, 27, 4, 0, 0);

const box = (section: number, columns: number, rows: number) => ({
  width: (columns * (section - 11 * 8)) / 12 + (columns - 1) * 8,
  height: rows * 64 - 8,
});
function hassFor([condition, elevation, temperature, cover]: (typeof SCENES)[number]): HomeAssistant {
  const hour = Math.floor(NOW / 3600000) * 3600000,
    wet = condition === 'rainy';
  const hourly = Array.from({ length: 24 }, (_, i) => ({
    datetime: new Date(hour + i * 3600000).toISOString(),
    temperature: temperature + Math.round(Math.sin(i / 5) * 4),
    condition,
    precipitation_probability: wet ? 60 + (i % 4) * 8 : 0,
    precipitation: wet ? 0.08 : 0,
    wind_speed: 5 + (i % 4),
  }));
  const daily = Array.from({ length: 10 }, (_, i) => ({
    datetime: new Date(NOW + i * 86400000).toISOString(),
    condition: i ? 'sunny' : condition,
    temperature: temperature + 6,
    templow: temperature - 8,
  }));
  return {
    states: {
      'weather.home': {
        entity_id: 'weather.home',
        state: condition,
        attributes: {
          temperature,
          temperature_unit: '°F',
          wind_speed_unit: 'mph',
          precipitation_unit: 'in',
          cloud_coverage: cover,
          friendly_name: 'Chicago',
          supported_features: 3,
        },
      },
      'sun.sun': { entity_id: 'sun.sun', state: 'above_horizon', attributes: { elevation, rising: true } },
    },
    locale: { language: 'en', time_format: '12' },
    config: { location_name: 'Home', time_zone: 'America/Chicago', latitude: 41.9, longitude: -87.6 },
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

const frames = (count: number) =>
  new Promise<void>(resolve => {
    const step = (left: number) => {
      if (left) requestAnimationFrame(() => step(left - 1));
      else resolve();
    };
    step(count);
  });
function part(card: IWeatherCard, selector: string): HTMLElement {
  const node = card.root.querySelector(selector);
  if (!(node instanceof HTMLElement)) throw new Error(`No ${selector}.`);
  return node;
}
const shown = (node: HTMLElement) =>
  getComputedStyle(node).display !== 'none' && node.hidden === false && node.offsetHeight > 0;
const inside = (a: DOMRect, b: DOMRect) =>
  a.left >= b.left - 1 && a.right <= b.right + 1 && a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
// Words that run past their box by any amount, even a fraction of a pixel the browser marks
// with an ellipsis, though the box's whole-pixel scroll width doesn't show it.
function cutShort(node: HTMLElement): boolean {
  const words = document.createRange();
  words.selectNodeContents(node);
  return words.getBoundingClientRect().right > node.getBoundingClientRect().right;
}

// A strip is one line: the place at the start, then the temperature and condition, then the
// high and low at the end. Narrowing, it lets go of the high and low below 400px, the
// condition below 200 and the place below 150, and what it shows is never cut short but the
// place.
const STRIP_WIDTHS = { range: 400, condition: 200, place: 150 } as const;
// A place too long to fit beside the reading, and the step of widths it is tried at: fine
// enough to find a width where the reading is shortened by a fraction of a pixel.
const LONG_PLACE = 'Saint-Jean-sur-Richelieu',
  STRIP_STEP = 7;
function stripProblems(card: IWeatherCard, name: string, width: number): string[] {
  const found: string[] = [],
    place = part(card, '.location'),
    temperature = part(card, '.temperature'),
    condition = part(card, '.condition'),
    range = part(card, '.range');
  if (shown(part(card, '.home'))) found.push(`${name}: a strip shows the home's name`);
  const want = [
    [place, width >= STRIP_WIDTHS.place, 'the place'],
    [condition, width >= STRIP_WIDTHS.condition, 'the condition'],
    [range, width >= STRIP_WIDTHS.range, "the day's range"],
  ] as const;
  for (const [node, wanted, what] of want)
    if (shown(node) !== wanted) found.push(`${name}: a strip ${wanted ? 'leaves out' : 'shows'} ${what}`);
  const parts = [place, temperature, condition, range].filter(shown),
    boxes = parts.map(node => node.getBoundingClientRect());
  for (const [index, at] of boxes.entries()) {
    const before = boxes[index - 1];
    if (before && (at.top >= before.bottom || at.bottom <= before.top)) found.push(`${name}: a strip isn't one line`);
    if (before && at.left < before.right - 1) found.push(`${name}: a strip's parts are out of order`);
  }
  for (const node of [temperature, condition, range])
    if (shown(node) && cutShort(node)) found.push(`${name}: a strip cuts short what it shows`);
  return found;
}

// Whether an hour's chance, under its symbol, runs into its value, below it or beside it.
const chanceOverlaps = (card: IWeatherCard) =>
  [...card.root.querySelectorAll('.hour')].some(hour => {
    const chance = hour.querySelector('.hour-chance')?.getBoundingClientRect(),
      value = hour.querySelector('.hour-value')?.getBoundingClientRect();
    return (
      chance !== undefined &&
      value !== undefined &&
      chance.height > 0 &&
      chance.left < value.right &&
      chance.right > value.left &&
      chance.top < value.bottom - 0.5 &&
      chance.bottom > value.top + 0.5
    );
  });

// Forty cards in each of three skies, or a sweep of widths, so it takes a while, and a busy
// machine several times as long.
const MANY_CARDS = 60_000;
// Every size of one section and layout, in each scene: what is wrong with each card.
async function problems(section: number, layout: 'auto' | 'expanded') {
  const found: string[] = [];
  let moons = 0;
  for (const scene of SCENES) {
    const stage = document.createElement('div');
    stage.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:flex-start';
    const cards = ROWS.flatMap(rows =>
      COLUMNS.map(columns => {
        const card = document.createElement('iweather-card'),
          { width, height } = box(section, columns, rows);
        card.style.cssText = `width:${width}px;height:${height}px`;
        card.layout = 'grid';
        card.setConfig({
          type: 'custom:iweather-card',
          entity: 'weather.home',
          weather_layout: layout,
          weather_animation: false,
          grid_options: { columns, rows },
        });
        card.hass = hassFor(scene);
        stage.append(card);
        return { card, columns, rows, width, height };
      }),
    );
    document.body.replaceChildren(stage);
    await frames(3);
    for (const { card, columns, rows, width, height } of cards) {
      card.paint();
      const name = `${columns}×${rows} on ${section}px, ${layout}, ${scene[0]}`,
        bounds = card.getBoundingClientRect(),
        current = part(card, '.current').getBoundingClientRect(),
        forecast = part(card, '.forecast'),
        daily = part(card, '.daily'),
        hours = part(card, '.hours');
      if (!inside(current, bounds)) found.push(`${name}: the conditions leave the card`);
      // A narrow card stacks the conditions: every line centred under the next. Where the
      // temperature and condition aren't a line of their own, each is. A strip is one line.
      const lines = [...card.root.querySelectorAll('.current > *')].flatMap(line =>
        getComputedStyle(line).display === 'contents' ? [...line.children] : [line],
      );
      if (width < 200 && rows > 1)
        for (const line of lines) {
          const at = line.getBoundingClientRect();
          if (at.width && Math.abs(at.left + at.width / 2 - (current.left + current.width / 2)) > 1.5) {
            found.push(`${name}: the conditions aren't centred`);
            break;
          }
        }
      if (rows === 1) found.push(...stripProblems(card, name, width));
      // A small card's conditions read as a header: the home's name over the place name, then
      // the temperature and condition on one line where there is room.
      if (rows === 2) {
        const home = part(card, '.home'),
          place = part(card, '.location').getBoundingClientRect(),
          temperature = part(card, '.temperature').getBoundingClientRect(),
          condition = part(card, '.condition');
        if (shown(part(card, '.range'))) found.push(`${name}: a small card shows the day's range`);
        if (!(shown(home) && home.getBoundingClientRect().bottom <= place.top + 1))
          found.push(`${name}: the home's name isn't over the place name`);
        if (temperature.top < place.bottom - 1) found.push(`${name}: the temperature isn't under the place name`);
        if (width >= 150 && Math.abs(condition.getBoundingClientRect().top - temperature.top) > 2)
          found.push(`${name}: the temperature and condition aren't on one line`);
        if (width >= 150 && condition.scrollWidth > condition.clientWidth)
          found.push(`${name}: the condition is cut short`);
      }
      // The forecast: shown where there is room for it, and whole.
      if (rows === 1 && shown(forecast)) found.push(`${name}: a strip shows the forecast`);
      if (width < 200 && height >= 170 && height < 300 && shown(forecast))
        found.push(`${name}: forecast in a short narrow card`);
      if (shown(forecast)) {
        const panel = forecast.getBoundingClientRect(),
          content = part(card, '.forecast-content'),
          list = getComputedStyle(hours).flexDirection === 'column';
        if (
          Math.min(current.right, panel.right) - Math.max(current.left, panel.left) > 2 &&
          Math.min(current.bottom, panel.bottom) - Math.max(current.top, panel.top) > 2
        )
          found.push(`${name}: the conditions overlap the forecast`);
        if (content.scrollHeight > content.clientHeight + 1) found.push(`${name}: the forecast is cut off`);
        if (width < 200 && !list) found.push(`${name}: a narrow card's hours aren't a list`);
        if (width < 200 && hours.dataset['mode'] !== 'conditions')
          found.push(`${name}: a narrow card isn't on conditions`);
        const strip = hours.getBoundingClientRect();
        for (const value of card.root.querySelectorAll('.hour-value')) {
          const at = value.getBoundingClientRect(),
            hour = value.closest('.hour')?.getBoundingClientRect();
          if (!at.height) continue;
          if ((!list && at.bottom > strip.bottom + 1) || (hour && at.right > hour.right + 1)) {
            found.push(`${name}: an hour's value is cut off`);
            break;
          }
        }
        if (chanceOverlaps(card)) found.push(`${name}: an hour's chance runs into its value`);
      }
      if (
        shown(daily) &&
        getComputedStyle(part(card, '.weather')).overflowY !== 'auto' &&
        !inside(daily.getBoundingClientRect(), bounds)
      )
        found.push(`${name}: the daily forecast leaves the card`);
      // The sun's core and the moon, wherever they are up, never behind the conditions.
      const moon = card.scene.moonPoint,
        text = card.geometry().text,
        core = card.scene.sunPoint;
      if (
        core &&
        (card.scene.levels?.sun ?? 0) > 0.005 &&
        core.x + core.r > text.x &&
        core.x - core.r < text.x + text.width &&
        core.y + core.r > text.y + 1 &&
        core.y - core.r < text.y + text.height
      )
        found.push(`${name}: the sun is behind the conditions`);
      if (moon && (card.scene.levels?.moon ?? 0) > 0.005) {
        moons++;
        if (
          moon.x + moon.r > text.x &&
          moon.x - moon.r < text.x + text.width &&
          moon.y + moon.r > text.y &&
          moon.y - moon.r < text.y + text.height
        )
          found.push(`${name}: the moon is behind the conditions`);
        // Nor in the sun's glow, wherever both are up: it rises out of the frame instead.
        const sun = card.scene.sunPoint;
        if (
          sun &&
          (card.scene.levels?.sun ?? 0) > 0.005 &&
          moon.y + moon.r > 0 &&
          Math.hypot(moon.x - sun.x, moon.y - sun.y) < sun.r * 4 + moon.r
        )
          found.push(`${name}: the moon is beside the sun`);
      }
    }
  }
  return { found, moons };
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  // Layout is all that's tested here: the forecast stays the one these pages are given.
  vi.stubGlobal('fetch', () => Promise.reject(new Error('Offline.')));
});
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

test('the grid offers every size from a one-row strip to the whole section', () => {
  const card = document.createElement('iweather-card');
  card.setConfig({ type: 'custom:iweather-card', entity: 'weather.home' });
  expect(card.getGridOptions()).toEqual({ columns: 12, rows: 6, min_columns: 3, min_rows: 1 });
  card.setConfig({ type: 'custom:iweather-card', entity: 'weather.home', weather_layout: 'page' });
  expect(card.getGridOptions()).toEqual({ columns: 12, min_columns: 6, rows: 'auto' });
  card.setConfig({ type: 'custom:iweather-card', entity: 'weather.home', weather_layout: 'strip' });
  expect(card.getGridOptions()).toEqual({ columns: 12, min_columns: 3, rows: 1, min_rows: 1 });
  expect(card.getCardSize()).toBe(1);
});

test('the sections grid before Home Assistant 2024.11 gets the same sizes in its own columns', () => {
  const card = document.createElement('iweather-card');
  card.setConfig({ type: 'custom:iweather-card', entity: 'weather.home' });
  expect(card.getLayoutOptions()).toEqual({ grid_columns: 4, grid_min_columns: 1, grid_rows: 6, grid_min_rows: 1 });
  card.setConfig({ type: 'custom:iweather-card', entity: 'weather.home', weather_layout: 'page' });
  expect(card.getLayoutOptions()).toEqual({ grid_columns: 4, grid_min_columns: 2 });
  card.setConfig({ type: 'custom:iweather-card', entity: 'weather.home', weather_layout: 'compact' });
  expect(card.getLayoutOptions()).toEqual({ grid_columns: 4, grid_min_columns: 2, grid_rows: 3, grid_min_rows: 2 });
});

test('a card the grid sizes fills its cell; elsewhere it keeps a height of its own', async () => {
  const card = document.createElement('iweather-card');
  card.setConfig({ type: 'custom:iweather-card', entity: 'weather.home', weather_animation: false });
  card.hass = hassFor(SCENES[0]);
  card.style.cssText = 'height:56px;width:300px';
  document.body.replaceChildren(card);
  // A masonry view: no layout, so the card keeps its own height whatever its box.
  await frames(2);
  expect(card.getBoundingClientRect().height).toBe(280);
  card.layout = 'grid';
  await frames(2);
  expect(card.getBoundingClientRect().height).toBe(56);
  // Rows set to 'auto' leave the height to the card again.
  card.setConfig({ type: 'custom:iweather-card', entity: 'weather.home', grid_options: { rows: 'auto' } });
  await frames(2);
  expect(card.getBoundingClientRect().height).toBe(280);
});

// A strip is one row's height wherever it sits, so it can go in a stack or a masonry view, and
// draws there as a sections grid's one-row card does.
// A dashboard that leaves the height to the card, as a masonry view and the editor's preview do:
// at its own height an automatic card fits its hours whole, the chance under each symbol included,
// and beside the conditions its hours' panel is as tall as what it holds, centred.
const OWN_HEIGHT_WIDTHS = [340, 420, 500, 640, 720] as const,
  SIDE_BY_SIDE = 640;
test('an automatic card at its own height keeps each hour’s chance clear of its value', async () => {
  const cards = OWN_HEIGHT_WIDTHS.map(width => {
    const card = document.createElement('iweather-card');
    card.style.cssText = `width:${width}px`;
    card.setConfig({ type: 'custom:iweather-card', entity: 'weather.home', weather_animation: false });
    card.hass = hassFor(SCENES[1]);
    return card;
  });
  document.body.replaceChildren(...cards);
  await vi.waitFor(() => {
    for (const card of cards) expect(card.root.querySelector('.hour .hour-chance')).toBeTruthy();
  });
  await frames(2);
  for (const card of cards) {
    const { width } = card.getBoundingClientRect();
    expect(chanceOverlaps(card), `${width}px`).toBe(false);
    const panel = part(card, '.forecast').getBoundingClientRect(),
      bounds = card.getBoundingClientRect(),
      hours = part(card, '.hours').getBoundingClientRect();
    expect(inside(panel, bounds), `${width}px`).toBe(true);
    if (width < SIDE_BY_SIDE) continue;
    expect(Math.abs(panel.top - bounds.top - (bounds.bottom - panel.bottom)), `${width}px`).toBeLessThan(1.5);
    expect(panel.bottom - hours.bottom, `${width}px`).toBeLessThan(panel.height / 4);
  }
  document.body.replaceChildren();
});

test('a strip keeps one row’s height outside the grid, on one line', { timeout: MANY_CARDS }, async () => {
  const card = document.createElement('iweather-card');
  card.setConfig({
    type: 'custom:iweather-card',
    entity: 'weather.home',
    weather_layout: 'strip',
    weather_animation: false,
  });
  card.hass = hassFor(SCENES[0]);
  card.style.cssText = `width:${STRIP_WIDTHS.range}px`;
  document.body.replaceChildren(card);
  await frames(3);
  expect(card.getBoundingClientRect().height).toBe(56);
  expect(stripProblems(card, 'a strip', STRIP_WIDTHS.range)).toEqual([]);
  expect(shown(part(card, '.forecast'))).toBe(false);
  // A place too long for the line is shortened, and the reading beside it kept whole.
  const hass = hassFor(SCENES[1]),
    home = hass.states['weather.home'];
  if (!home) throw new Error('No weather.');
  card.hass = {
    ...hass,
    states: {
      ...hass.states,
      'weather.home': { ...home, attributes: { ...home.attributes, friendly_name: LONG_PLACE } },
    },
  };
  for (let width: number = STRIP_WIDTHS.condition; width < STRIP_WIDTHS.range; width += STRIP_STEP) {
    card.style.width = `${width}px`;
    await frames(2);
    expect(stripProblems(card, `a strip ${width}px wide`, width)).toEqual([]);
    if (width === STRIP_WIDTHS.condition) expect(cutShort(part(card, '.location'))).toBe(true);
  }
  card.remove();
});

for (const section of SECTIONS)
  for (const layout of ['auto', 'expanded'] as const) {
    test(`every size fits a ${section}px section (${layout})`, { timeout: MANY_CARDS }, async () => {
      const { found, moons } = await problems(section, layout);
      expect(found).toEqual([]);
      expect(moons).toBeGreaterThan(0);
    });
    // As wide as a system's type gets: what fits above must fit here too.
    test(`every size fits a ${section}px section in wide type (${layout})`, { timeout: MANY_CARDS }, async () => {
      const { style } = document.documentElement,
        type = style.getPropertyValue('--ha-font-family-body');
      style.setProperty('--ha-font-family-body', 'Verdana,"DejaVu Sans"');
      const { found } = await problems(section, layout);
      style.setProperty('--ha-font-family-body', type);
      expect(found).toEqual([]);
    });
  }

// German's words for what the strip shows run longer than the room beside the switch.
for (const layout of ['auto', 'expanded'] as const)
  test(`a subtitle too long for the room beside the switch ends short of it (${layout})`, async () => {
    const card = document.createElement('iweather-card'),
      hass = hassFor(SCENES[1]);
    card.style.cssText = 'width:320px;height:400px';
    card.layout = 'grid';
    card.setConfig({
      type: 'custom:iweather-card',
      entity: 'weather.home',
      weather_layout: layout,
      weather_animation: false,
      weather_mode: 'rain',
    });
    card.hass = { ...hass, locale: { ...hass.locale, language: 'de' } };
    document.body.append(card);
    const words = await vi.waitFor(() => {
        const found = card.root.querySelector('.measure > span');
        expect(found?.textContent).toContain('Regenwahrscheinlichkeit');
        return found;
      }),
      measure = words?.parentElement,
      start = card.root.querySelector('.modes')?.getBoundingClientRect().left;
    if (!words || !measure || start === undefined) throw new Error('Nothing to measure.');
    const range = document.createRange();
    range.selectNodeContents(words);
    expect(range.getBoundingClientRect().right, 'too long to fit').toBeGreaterThan(start);
    expect(getComputedStyle(measure).overflowX).toBe('hidden');
    expect(measure.getBoundingClientRect().right).toBeLessThanOrEqual(start);
    card.remove();
  });

// The full layout from four columns: the hourly panel, the daily list and the map as one
// block, the tiles around it, and the hourly panel's row level with the tiles beside it.
test('the full layout places the hourly, daily and map block for its columns', async () => {
  const base = hassFor(SCENES[0]),
    weather = base.states['weather.home'];
  if (!weather) throw new Error('No weather entity.');
  const hass: HomeAssistant = {
    ...base,
    states: {
      ...base.states,
      'weather.home': {
        ...weather,
        attributes: { ...weather.attributes, humidity: 60, wind_speed: 6, wind_bearing: 200, pressure: 29.9 },
      },
    },
  };
  const layout = async (width: number) => {
    const card = document.createElement('iweather-card');
    card.setConfig({
      type: 'custom:iweather-card',
      entity: 'weather.home',
      weather_layout: 'page',
      weather_animation: false,
      map: 'local',
      forecast_days: 10,
    });
    card.hass = hass;
    card.style.width = `${width}px`;
    document.body.replaceChildren(card);
    await frames(3);
    const box = (selector: string) => part(card, selector).getBoundingClientRect();
    return {
      card: card.getBoundingClientRect(),
      hourly: box('.forecast'),
      daily: box('.daily'),
      map: box('.tile[data-tile=map]'),
      tile: box('.tile[data-tile=humidity]'),
      tiles: [...card.root.querySelectorAll('.tile')].map(tile => tile.getBoundingClientRect()),
    };
  };
  const near = (a: number, b: number) => Math.abs(a - b) < 1;
  // Four columns: the block takes the right half, the hourly over the daily list over the map.
  const four = await layout(1000);
  expect(four.hourly.left).toBeGreaterThan(four.card.left + four.card.width / 2 - 10);
  expect(near(four.daily.left, four.hourly.left) && near(four.map.left, four.hourly.left)).toBe(true);
  expect(four.map.top).toBeGreaterThan(four.daily.bottom);
  expect(four.tile.right).toBeLessThan(four.hourly.left);
  // Five: the hourly four wide over the daily list and the map side by side, a tile beside it.
  const five = await layout(1200);
  expect(near(five.daily.left, five.hourly.left) && near(five.map.top, five.daily.top)).toBe(true);
  expect(five.map.left).toBeGreaterThan(five.daily.right);
  expect(five.hourly.width).toBeGreaterThan(five.tile.width * 3.5);
  expect(five.tile.left).toBeGreaterThan(five.hourly.right);
  // Six: the block on the right four columns, tiles two abreast on its left.
  const six = await layout(1500);
  expect(near(six.daily.left, six.hourly.left) && near(six.map.top, six.daily.top)).toBe(true);
  expect(six.map.left).toBeGreaterThan(six.daily.right);
  expect(six.hourly.left - six.card.left).toBeGreaterThan(six.tile.width * 2);
  expect(six.tile.right).toBeLessThan(six.hourly.left);
  // Wherever a tile shares the hourly panel's row, the row is level.
  for (const { hourly, tiles } of [four, five, six])
    expect(tiles.some(tile => near(tile.top, hourly.top) && near(tile.bottom, hourly.bottom))).toBe(true);
});

// A page with every tile that needs no record of the past, and what was asked for of what changes
// how it packs.
function fullPage(
  width: number,
  { air, alert, nextHour }: { air?: string | undefined; alert?: string | undefined; nextHour?: boolean },
) {
  const now = NOW,
    base = hassFor(SCENES[0]),
    weather = base.states['weather.home'];
  if (!weather) throw new Error('No weather entity.');
  const card = document.createElement('iweather-card');
  card.setConfig({
    type: 'custom:iweather-card',
    entity: 'weather.home',
    weather_layout: 'page',
    weather_animation: false,
    map: 'local',
    forecast_days: 10,
    ...(air ? { air_quality_entity: 'sensor.aqi' } : {}),
    ...(alert ? { alert_entities: ['binary_sensor.alert'] } : {}),
    ...(nextHour ? { next_hour_entity: 'sensor.nowcast' } : {}),
  });
  card.hass = {
    ...base,
    states: {
      ...base.states,
      'weather.home': {
        ...weather,
        attributes: {
          ...weather.attributes,
          humidity: 60,
          wind_speed: 6,
          wind_bearing: 200,
          pressure: 29.9,
          uv_index: 3,
          visibility: 10,
          visibility_unit: 'mi',
          attribution: 'From the weather service.',
        },
      },
      'sun.sun': {
        entity_id: 'sun.sun',
        state: 'below_horizon',
        attributes: {
          next_noon: new Date(now + 3600000 * 14).toISOString(),
          next_rising: new Date(now + 3600000 * 8).toISOString(),
          next_setting: new Date(now + 3600000 * 19).toISOString(),
          elevation: -30,
        },
      },
      'sensor.aqi': { entity_id: 'sensor.aqi', state: air ?? '', attributes: {} },
      'binary_sensor.alert': {
        entity_id: 'binary_sensor.alert',
        state: 'on',
        attributes: { event: 'Heat Advisory', severity: alert ?? '', expires: new Date(now + 3600000).toISOString() },
      },
      'sensor.nowcast': {
        entity_id: 'sensor.nowcast',
        state: '0',
        attributes: {
          unit_of_measurement: 'mm/h',
          forecast: Array.from({ length: 13 }, (_, i) => ({
            datetime: new Date(now + i * 300000).toISOString(),
            precipitation: i > 3 && i < 9 ? 3 : 0,
          })),
        },
      },
    },
  };
  card.style.width = `${width}px`;
  document.body.replaceChildren(card);
  return card;
}
const GRID = { cell: 180, gap: 20 } as const,
  STACKED_COLUMNS = 4;
test('on a narrow phone the wind tile keeps its whole dial, smaller where the tile is shorter', async () => {
  try {
    // The card across the screen, and narrower than it, as in a column of a dashboard.
    for (const [screen, width] of [
      [345, 345],
      [360, 360],
      [400, 400],
      [430, 430],
      [500, 500],
      [430, 360],
      [430, 335],
    ] as const) {
      await frame.viewport(screen, 844);
      const card = fullPage(width, {});
      card.style.setProperty('--iweather-height', '800px');
      await vi.waitFor(() => {
        expect(card.root.querySelector('.weather')?.getAttribute('data-scroll')).toBe('true');
      });
      const tile = part(card, '.tile[data-tile=wind]'),
        shown = part(card, '.tile[data-tile=wind] .body-window').getBoundingClientRect(),
        svg = card.root.querySelector('.tile[data-tile=wind] .compass > svg'),
        scale = card.getBoundingClientRect().width / width;
      if (!svg) throw new Error('No dial.');
      const dial = svg.getBoundingClientRect();
      expect(tile.getBoundingClientRect().width / scale, `${width}`).toBeGreaterThan(0);
      expect(dial.top, `${width}`).toBeGreaterThanOrEqual(shown.top - 0.5);
      expect(dial.bottom, `${width}`).toBeLessThanOrEqual(shown.bottom + 0.5);
      // Never more than its own size.
      expect(dial.height / scale, `${width}`).toBeLessThanOrEqual(145.5);
    }
  } finally {
    await frame.viewport(1280, 900);
  }
});
test('the grid holds its cells and goes by the width: two columns, three from 620, four from 820, five from 1135, six from 1456', async () => {
  for (const [width, columns] of [
    [420, 2],
    [619, 2],
    [620, 3],
    [819, 3],
    [820, 4],
    [1134, 4],
    [1135, 5],
    [1455, 5],
    [1456, 6],
    [2400, 6],
  ] as const) {
    const card = fullPage(width, {});
    await frames(3);
    const root = part(card, '.scene-root'),
      style = getComputedStyle(root),
      scale = card.getBoundingClientRect().width / width,
      hourly = part(card, '.forecast').getBoundingClientRect();
    expect(style.gridTemplateColumns.split(' ')).toEqual(Array.from({ length: columns }, () => `${GRID.cell}px`));
    expect(style.columnGap).toBe(`${GRID.gap}px`);
    // The margins take the slack, alike on both sides.
    const tiles = [...card.root.querySelectorAll('.forecast,.tile')].map(tile => tile.getBoundingClientRect()),
      left = Math.min(...tiles.map(tile => tile.left)),
      right = Math.max(...tiles.map(tile => tile.right));
    expect((right - left) / scale).toBeCloseTo(columns * GRID.cell + (columns - 1) * GRID.gap, 0);
    expect(Math.abs(left - (card.getBoundingClientRect().right - right))).toBeLessThan(1);
    // Under four columns the hourly panel runs the whole width, and from four it is two or four wide.
    expect(hourly.width / scale).toBeCloseTo(
      columns < STACKED_COLUMNS
        ? columns * GRID.cell + (columns - 1) * GRID.gap
        : columns === STACKED_COLUMNS
          ? 380
          : 780,
      0,
    );
    // Each count of columns takes the width worked out for it; under four, wind is two wide.
    const wind = part(card, '.tile[data-tile=wind]');
    expect(wind.getBoundingClientRect().width / scale).toBeCloseTo(
      columns < STACKED_COLUMNS || wind.dataset['wideAt']?.split(' ').includes(String(columns)) ? 380 : 180,
      0,
    );
  }
});
test('under three columns the daily list keeps the rows ten days have from three on', async () => {
  for (const width of [340, 420, 619, 620]) {
    const card = fullPage(width, {});
    await vi.waitFor(() => {
      expect(card.root.querySelectorAll('.daily-content > .day')).toHaveLength(10);
    });
    await frames(3);
    const scale = card.getBoundingClientRect().width / width;
    for (const day of card.root.querySelectorAll('.daily-content > .day'))
      expect(day.getBoundingClientRect().height / scale, `${width}`).toBeCloseTo(58, 0);
  }
});
// How many cells of each row of the grid a page's panels take, the credit's row left out.
function rowsFilled(card: IWeatherCard, width: number): { columns: number; rows: number[] } {
  const style = getComputedStyle(part(card, '.scene-root')),
    scale = card.getBoundingClientRect().width / width,
    columns = style.gridTemplateColumns.split(' ').length,
    tracks = style.gridTemplateRows.split(' ').map(parseFloat).slice(0, -1),
    boxes = [...card.root.querySelectorAll('.alert,.next-hour,.forecast,.daily,.tile')].flatMap(panel =>
      panel instanceof HTMLElement && panel.offsetHeight ? [panel.getBoundingClientRect()] : [],
    ),
    first = Math.min(...boxes.map(box => box.top)),
    left = Math.min(...boxes.map(box => box.left));
  // Where each row starts on screen.
  const starts = tracks.map((_, row) =>
    tracks.slice(0, row).reduce((top, track) => top + (track + GRID.gap) * scale, first),
  );
  const used = new Set<string>(),
    rows = tracks.map(() => 0);
  for (const box of boxes) {
    const span = Math.round((box.width / scale + GRID.gap) / (GRID.cell + GRID.gap)),
      column = Math.round((box.left - left) / scale / (GRID.cell + GRID.gap));
    starts.forEach((top, row) => {
      if (top < box.top - 1 || top > box.bottom - 1) return;
      rows[row] = (rows[row] ?? 0) + span;
      for (let across = 0; across < span; across++) {
        const cell = `${column + across} ${row}`;
        if (used.has(cell)) throw new Error(`Two panels at ${cell}.`);
        used.add(cell);
      }
    });
  }
  return { columns, rows };
}
// Three widths of nine pages each, so it takes a while, and a slow machine several times as long.
const MANY_PAGES = 60_000;
test('the page fills its grid around what is on it, leaving a gap only in its last row', {
  timeout: MANY_PAGES,
}, async () => {
  for (const width of [1000, 1200, 1500])
    for (const air of [undefined, '60', '160'])
      for (const alert of [undefined, 'Minor', 'Severe'])
        for (const nextHour of [false, true]) {
          const card = fullPage(width, { air, alert, nextHour });
          await frames(2);
          const { columns, rows } = rowsFilled(card, width),
            last = rows.pop() ?? 0,
            name = JSON.stringify({ width, air, alert, nextHour, rows, last });
          expect(
            rows.every(cells => cells === columns),
            name,
          ).toBe(true);
          expect(columns - last, name).toBeLessThanOrEqual(2);
        }
});
test('the credit keeps its own height under the grid, and opens what the conditions do', async () => {
  const card = fullPage(1200, {});
  await frames(3);
  const credit = part(card, '.credit');
  expect(credit.textContent).toBe('Weather for HomeFrom the weather service.');
  expect(credit.localName).toBe('button');
  const scale = card.getBoundingClientRect().width / 1200;
  expect(credit.getBoundingClientRect().height / scale).toBeLessThan(40);
  const lastTile = Math.max(
    ...[...card.root.querySelectorAll('.tile')].map(tile => tile.getBoundingClientRect().bottom),
  );
  expect(credit.getBoundingClientRect().top - lastTile).toBeLessThan(80 * scale);
  // Painted over the sky, which would otherwise dim it.
  expect(getComputedStyle(credit).position).toBe('relative');
  const opened = vi.fn();
  card.addEventListener('hass-more-info', opened);
  credit.click();
  expect(opened).toHaveBeenCalledTimes(1);
  card.setConfig({
    type: 'custom:iweather-card',
    entity: 'weather.home',
    weather_layout: 'page',
    tap_behavior: 'none',
  });
  credit.click();
  expect(opened).toHaveBeenCalledTimes(1);
});
test('the full layout’s conditions are the one size at every width', async () => {
  for (const width of [390, 700, 1000, 1500]) {
    const card = fullPage(width, {});
    await frames(2);
    const temperature = getComputedStyle(part(card, '.temperature')),
      condition = getComputedStyle(part(card, '.condition')),
      range = getComputedStyle(part(card, '.range'));
    expect([temperature.fontSize, temperature.fontWeight, temperature.lineHeight]).toEqual(['75px', '100', '88.75px']);
    expect(temperature.color).toBe('rgba(255, 255, 255, 0.85)');
    expect(temperature.fontVariantNumeric).toBe('normal');
    for (const line of [condition, range])
      expect([line.fontSize, line.fontWeight, line.lineHeight]).toEqual(['18.75px', '500', '23.75px']);
  }
});
test('a tile’s title adds its light to the glass', async () => {
  const card = fullPage(1200, {});
  await frames(3);
  const tile = part(card, '.tile[data-tile=uv]'),
    lift = part(card, '.tile[data-tile=uv] .tile-content > .lift');
  // Lifted by a third, then a quarter white over it: what is behind plus a quarter of white.
  expect(lift.style.getPropertyValue('--lift')).toBe('1.333');
  expect(lift.style.clipPath).toContain('title-');
  expect(getComputedStyle(lift).backdropFilter).toContain('brightness');
  // Under a rounded clip a lift would fill its box, so the page rounds its corners by a mask.
  expect(getComputedStyle(card).overflow).toBe('visible');
  expect(getComputedStyle(part(card, '.weather')).borderRadius).toBe('0px');
  expect(tile.querySelector('header .title g text')?.textContent).toBe('UV index');
  expect(tile.getAttribute('aria-label')).toMatch(/^UV index 3/);
});

test('switching the hourly view moves nothing on the full layout', async () => {
  for (const width of [390, 1200]) {
    const card = document.createElement('iweather-card');
    card.setConfig({
      type: 'custom:iweather-card',
      entity: 'weather.home',
      weather_layout: 'page',
      weather_animation: false,
      map: 'local',
    });
    card.hass = hassFor(SCENES[1]);
    card.style.width = `${width}px`;
    document.body.replaceChildren(card);
    await frames(3);
    const boxes = async (mode: string) => {
      part(card, `.modes [data-mode=${mode}]`).click();
      await frames(2);
      return [card, ...card.root.querySelectorAll('.forecast, .daily, .tile')].map(node => {
        const { left, top, width: wide, height } = node.getBoundingClientRect();
        return [left, top, wide, height].map(Math.round).join(' ');
      });
    };
    const conditions = await boxes('conditions');
    expect(await boxes('rain')).toEqual(conditions);
    expect(await boxes('wind')).toEqual(conditions);
  }
});

// Given less height than it needs (a panel view gives it the screen), the full layout scrolls in
// place: the sky holds still, the hero collapses into a band at the top, and each panel passes
// under it, its glass sliding down to the band, its header held there and its content cut at the
// header.
// Given back its own height, it grows to fit again.
test('a full layout given a height scrolls in place under a collapsing hero', async () => {
  const card = document.createElement('iweather-card');
  card.setConfig({
    type: 'custom:iweather-card',
    entity: 'weather.home',
    weather_layout: 'page',
    weather_animation: false,
    map: 'local',
    forecast_days: 10,
  });
  card.hass = hassFor(SCENES[0]);
  card.style.cssText = 'width:900px;--iweather-height:600px';
  document.body.replaceChildren(card);
  await frames(4);
  const near = (a: number, b: number) => Math.abs(a - b) < 1,
    weather = part(card, '.weather'),
    scroller = part(card, '.weather-content'),
    hero = part(card, '.hero'),
    sky = part(card, '.sky');
  expect(near(card.getBoundingClientRect().height, 600)).toBe(true);
  expect(weather.dataset['scroll']).toBe('true');
  // Scrolled until a tile is a little way under the band, past where the hero has collapsed.
  const at = card.getBoundingClientRect().top,
    skyAt = sky.getBoundingClientRect().top,
    scale = card.getBoundingClientRect().width / parseFloat(getComputedStyle(card).width);
  scroller.scrollTop =
    (part(card, '.tile[data-tile=feels_like]').getBoundingClientRect().top - at) / scale -
    parseFloat(weather.style.getPropertyValue('--band')) +
    60;
  await frames(3);
  expect(near(sky.getBoundingClientRect().top, skyAt)).toBe(true);
  expect(Number(getComputedStyle(part(card, '.temperature')).opacity)).toBeCloseTo(0, 6);
  expect(Number(getComputedStyle(part(card, '.brief')).opacity)).toBe(1);
  expect(Number(getComputedStyle(part(card, '.brief-light .lift')).opacity)).toBe(1);
  // The page's own pixels (the band, the glass) show zoomed on screen by its size. The hero has
  // slid up into the band, where the page's box starts.
  const zoom = scale,
    pin = hero.getBoundingClientRect().bottom;
  expect(near(pin, at + parseFloat(weather.style.getPropertyValue('--band')) * zoom)).toBe(true);
  expect(near(scroller.getBoundingClientRect().top, pin)).toBe(true);
  // A tile under the band with room left below it.
  const tile = [...card.root.querySelectorAll<HTMLElement>('.tile[data-cut]')].find(node => {
    const box = node.getBoundingClientRect();
    return box.top < pin && box.bottom > pin + 40 * zoom;
  });
  if (!tile) throw new Error('No tile passing under the band.');
  // Its glass slides down in its window, which moves only once the tile's foot reaches the band.
  const header = tile.querySelector('header'),
    lift = tile.querySelector('.tile-content > .lift'),
    pane = tile.querySelector(':scope > .glass'),
    shift = (node: Element, pseudo?: string) => new DOMMatrixReadOnly(getComputedStyle(node, pseudo).transform).m42;
  if (!header || !lift || !pane) throw new Error('No tile header, lift or glass.');
  const glass = (shift(pane) + shift(pane, '::before')) * zoom;
  // To within a pixel and a half.
  expect(Math.abs(tile.getBoundingClientRect().top + glass - pin)).toBeLessThan(1.5);
  expect(header.getBoundingClientRect().top).toBeGreaterThan(pin);
  expect(header.getBoundingClientRect().top).toBeLessThan(pin + 30 * zoom);
  // The title's lift stays behind its words as the header holds.
  expect(near(lift.getBoundingClientRect().top, header.getBoundingClientRect().top)).toBe(true);
  // Both stand a hair toward the viewer, which keeps them drawn while off screen (see KEPT_DRAWN).
  for (const node of [header, lift]) expect(new DOMMatrixReadOnly(getComputedStyle(node).transform).is2D).toBe(false);
  // What nothing moves takes that step only in WebKit (see stillKept), not here in Chrome: the words
  // over each reading's light, the page's foot and each day's pieces run nothing along the scroll.
  const kept = [...card.root.querySelectorAll('.tile .added > .words'), part(card, '.credit')],
    still = [...kept, ...card.root.querySelectorAll('.day > *')];
  expect(kept.length).toBeGreaterThan(1);
  for (const node of still) expect(alongScroll(node)).toEqual([]);
  // The content's body is cut below the header by the window round it, and some of what it holds
  // has gone under. The body slides back up in the window whole: what it holds runs nothing of its own.
  const frame = tile.querySelector('.body-window'),
    body = frame?.querySelector(':scope > .panel-body'),
    first = body?.firstElementChild;
  if (!frame || !body || !first) throw new Error('No tile body.');
  expect(frame.getBoundingClientRect().top).toBeGreaterThanOrEqual(header.getBoundingClientRect().bottom);
  expect(first.getBoundingClientRect().top).toBeLessThan(frame.getBoundingClientRect().top);
  for (const node of [frame, body]) expect(alongScroll(node)).toHaveLength(1);
  for (const node of body.children) expect(alongScroll(node)).toEqual([]);
  // Drawn again with nothing moved, the page keeps the animations it runs, and where it measured
  // them from: started again, they went missing from a frame or more in WebKit.
  const running = [hero, header].map(node => node.getAnimations()[0]),
    headerTop = header.getBoundingClientRect().top;
  card.render();
  await frames(3);
  [hero, header].forEach((node, i) => {
    expect(node.getAnimations()[0]).toBe(running[i]);
  });
  for (const animation of running) expect(animation?.playState).toBe('running');
  expect(near(header.getBoundingClientRect().top, headerTop)).toBe(true);
  // WebKit lets go of the pictures of parts off screen, so there they take it, though nothing moves
  // them, and a Chrome built on WebKit is WebKit too. Firefox draws them without it, and one inside
  // another left the daily list's first and last rows and every day's high undrawn: there nothing
  // takes it. What the page moves moves in each.
  for (const [agent, steps] of [
    [WEBKIT, 1],
    [CHROME_ON_WEBKIT, 1],
    [FIREFOX, 0],
  ] as const) {
    const spy = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(agent);
    try {
      card.render();
      await frames(3);
      for (const node of kept) expect(alongScroll(node)).toHaveLength(steps);
      for (const node of [header, part(card, '.daily-content')]) expect(alongScroll(node)).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  }
  card.render();
  await frames(3);
  for (const node of still) expect(alongScroll(node)).toEqual([]);
  // The drops and frost on the glass are cut along the band's foot where the hero collapsed, and
  // scrolling on leaves that cut, the box the page scrolls in cutting them at the band.
  const drops = part(card, '.droplets'),
    cut = drops.style.clipPath;
  expect(cut).toMatch(/^inset\(/);
  scroller.scrollTop += 40;
  await frames(3);
  expect(drops.style.clipPath).toBe(cut);
  // Its own height again: the page grows to fit and nothing stays cut, the window laying out nothing.
  card.style.removeProperty('--iweather-height');
  await frames(4);
  expect(weather.dataset['scroll']).toBe('false');
  expect(getComputedStyle(frame).display).toBe('contents');
  expect(card.getBoundingClientRect().height).toBeGreaterThan(900 * zoom);
  expect(card.root.querySelector('[data-cut]')).toBeNull();
});

// What a part runs along the page's scroll.
const alongScroll = (node: Element) =>
  node.getAnimations().filter(animation => animation.timeline instanceof ScrollTimeline);
// How browsers on the engines that draw the page differently name themselves.
const WEBKIT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15',
  CHROME_ON_WEBKIT =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0.7444.46 Safari/604.1',
  FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:162.0) Gecko/20100101 Firefox/162.0';

// A page that scrolls a little leaves the daily list short of the band, where it is both what holds
// its panel and its body and so is asked for twice, in WebKit (see stillKept). However often the page
// is drawn, it and every other part run one animation each: one left behind would never be let go.
test('a part the page asks for twice runs one animation', async () => {
  const spy = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(WEBKIT);
  onTestFinished(() => spy.mockRestore());
  const card = document.createElement('iweather-card');
  card.setConfig({
    type: 'custom:iweather-card',
    entity: 'weather.home',
    weather_layout: 'page',
    weather_animation: false,
    map: 'local',
    forecast_days: 10,
  });
  card.hass = hassFor(SCENES[0]);
  card.style.width = '900px';
  document.body.replaceChildren(card);
  await frames(4);
  const full = card.getBoundingClientRect().height;
  card.style.setProperty('--iweather-height', `${full - 80}px`);
  await frames(4);
  expect(part(card, '.weather').dataset['scroll']).toBe('true');
  for (let draw = 0; draw < 3; draw++) {
    card.render();
    await frames(3);
  }
  const daily = part(card, '.daily-content');
  expect(alongScroll(daily)).toHaveLength(1);
  expect(new DOMMatrixReadOnly(getComputedStyle(daily).transform).m42).toBe(0);
  for (const node of card.root.querySelectorAll('*')) {
    const own = alongScroll(node).map(animation =>
      animation.effect instanceof KeyframeEffect ? animation.effect.pseudoElement : undefined,
    );
    expect(new Set(own).size).toBe(own.length);
  }
});

// A panel view gives its card the screen under the toolbar, which the full layout fills.
test('the full layout fills a panel view', async () => {
  const card = document.createElement('iweather-card');
  card.setConfig({ type: 'custom:iweather-card', entity: 'weather.home', weather_layout: 'page' });
  card.hass = hassFor(SCENES[0]);
  card.layout = 'panel';
  document.body.replaceChildren(card);
  await frames(3);
  expect(Math.abs(card.getBoundingClientRect().height - (innerHeight - 56))).toBeLessThan(1);
  card.layout = undefined;
  await frames(3);
  expect(card.hasAttribute('data-panel')).toBe(false);
});

// Its size zooms the whole page, text and tiles together, and it still fills the view.
test('the full layout draws at its size and still fills a panel view', async () => {
  const card = document.createElement('iweather-card'),
    config = { type: 'custom:iweather-card', entity: 'weather.home', weather_layout: 'page' };
  card.setConfig(config);
  card.hass = hassFor(SCENES[0]);
  card.layout = 'panel';
  document.body.replaceChildren(card);
  const header: Record<string, number> = {};
  for (const size of ['standard', 'large', 'extra_large']) {
    card.setConfig({ ...config, size });
    await frames(3);
    expect(Math.abs(card.getBoundingClientRect().height - (innerHeight - 56))).toBeLessThan(1);
    header[size] = part(card, '.heading strong').getBoundingClientRect().height;
  }
  const { standard = 0, large = 1, extra_large: extra = 0 } = header;
  expect(Math.abs(standard / large - 0.8)).toBeLessThan(0.02);
  expect(Math.abs(extra / large - 1.2)).toBeLessThan(0.02);
});

// Air quality that matters leads the page: at five columns it opens a row above the hourly
// panel, and the map turns to it. Otherwise it keeps its place: beside the hourly panel at
// six columns, below the hourly, daily and map block at five.
test('air quality that matters moves to the top and onto the map', async () => {
  const place = async (width: number, aqi: string) => {
    const base = hassFor(SCENES[0]),
      card = document.createElement('iweather-card');
    card.setConfig({
      type: 'custom:iweather-card',
      entity: 'weather.home',
      weather_layout: 'page',
      weather_animation: false,
      map: 'local',
      forecast_days: 10,
      air_quality_entity: 'sensor.aqi',
    });
    card.hass = {
      ...base,
      states: { ...base.states, 'sensor.aqi': { entity_id: 'sensor.aqi', state: aqi, attributes: {} } },
    };
    card.style.width = `${width}px`;
    document.body.replaceChildren(card);
    await frames(3);
    const box = (selector: string) => part(card, selector).getBoundingClientRect();
    return {
      air: box('.tile[data-tile=air_quality]'),
      hourly: box('.forecast'),
      daily: box('.daily'),
      map: part(card, '.tile[data-tile=map] header').textContent,
    };
  };
  const near = (a: number, b: number) => Math.abs(a - b) < 1;
  const fiveBad = await place(1200, '160'),
    fiveFair = await place(1200, '60'),
    sixBad = await place(1500, '160'),
    sixFair = await place(1500, '60');
  expect(fiveBad.air.bottom).toBeLessThan(fiveBad.hourly.top);
  expect(fiveFair.air.top).toBeGreaterThan(fiveFair.daily.top);
  expect(near(sixBad.air.top, sixBad.hourly.top) && near(sixFair.air.top, sixFair.hourly.top)).toBe(true);
  expect(fiveBad.map).toMatch(/Air quality/);
  expect(fiveFair.map).not.toMatch(/Air quality/);
  // Grid order is painting order too: every panel and tile comes after the sky, or the sky
  // would cover it.
  const card = document.querySelector('iweather-card');
  if (!card) throw new Error('No card.');
  const sky = Number(getComputedStyle(part(card, '.sky')).order);
  for (const panel of card.root.querySelectorAll<HTMLElement>('.alert,.next-hour,.forecast,.daily,.tile,.credit'))
    expect(Number(getComputedStyle(panel).order)).toBeGreaterThan(sky);
});

test('the hourly strip offers an arrow on each side with more to scroll to', async () => {
  const card = document.createElement('iweather-card');
  card.style.width = '900px';
  card.setConfig({
    type: 'custom:iweather-card',
    entity: 'weather.home',
    weather_layout: 'page',
    weather_animation: false,
  });
  card.hass = hassFor(SCENES[0]);
  document.body.replaceChildren(card);
  await frames(3);
  const hours = part(card, '.hours'),
    back = part(card, '.hours-arrow[data-edge=start]'),
    next = part(card, '.hours-arrow[data-edge=end]');
  expect([back.hasAttribute('data-more'), next.hasAttribute('data-more')]).toEqual([false, true]);
  // It pages as soon as it is pressed, and the click that follows doesn't open the sheet.
  next.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
  next.click();
  await vi.waitFor(() => {
    expect(hours.scrollLeft).toBeGreaterThan(0);
  });
  expect(card.root.querySelector('dialog')?.open ?? false).toBe(false);
  await frames(2);
  expect(back.hasAttribute('data-more')).toBe(true);
  hours.scrollLeft = hours.scrollWidth;
  await vi.waitFor(() => {
    expect([back.hasAttribute('data-more'), next.hasAttribute('data-more')]).toEqual([true, false]);
  });
  card.remove();
});

test('a screen as narrow as a phone draws no arrows beside the hourly strip', async () => {
  const card = document.createElement('iweather-card');
  card.setConfig({
    type: 'custom:iweather-card',
    entity: 'weather.home',
    weather_layout: 'page',
    weather_animation: false,
  });
  card.hass = hassFor(SCENES[0]);
  try {
    for (const [screen, shown] of [
      [500, false],
      [900, true],
    ] as const) {
      await frame.viewport(screen, 844);
      card.style.width = `${screen}px`;
      document.body.replaceChildren(card);
      await frames(3);
      for (const arrow of card.root.querySelectorAll('.hours-arrow'))
        expect(getComputedStyle(arrow).display !== 'none', `${screen}`).toBe(shown);
    }
  } finally {
    await frame.viewport(1280, 900);
    card.remove();
  }
});

test('rain on the glass limits sky uploads, and skips panels out of sight', async () => {
  const card = document.createElement('iweather-card');
  card.style.width = '900px';
  card.setConfig({
    type: 'custom:iweather-card',
    entity: 'weather.home',
    weather_layout: 'page',
    weather_animation: false,
  });
  card.hass = hassFor(SCENES[1]);
  document.body.replaceChildren(card);
  await frames(3);
  // Down the page, so that only the first row of panels is on screen.
  const panels = [...card.root.querySelectorAll<HTMLElement>('.forecast,.daily,.tile,.alert,.next-hour')].filter(
      panel => panel.offsetWidth && panel.offsetHeight,
    ),
    tops = panels.map(panel => panel.getBoundingClientRect().top);
  card.style.marginTop = `${innerHeight - 40 - Math.min(...tops)}px`;
  await frames(2);
  const below = panels.filter(panel => panel.getBoundingClientRect().top >= innerHeight);
  // A still frame reaches every panel, on screen or not.
  card.glass.paint(0);
  expect(card.root.querySelectorAll('canvas.drops').length).toBe(panels.length);
  // Running, the panels out of sight keep what they have.
  expect(below.length).toBeGreaterThan(0);
  const reached = new Set<unknown>(),
    measured = vi.spyOn(Element.prototype, 'getBoundingClientRect'),
    copies = vi.spyOn(CanvasRenderingContext2D.prototype, 'drawImage').mockImplementation(function (
      this: CanvasRenderingContext2D,
    ) {
      reached.add(this.canvas);
    }),
    uploads = vi.spyOn(WebGLRenderingContext.prototype, 'texImage2D');
  for (let frame = 1; frame <= 6; frame++) card.glass.paint(frame * 1000);
  const glass = new Set<unknown>(panels);
  expect(measured.mock.contexts.filter(element => glass.has(element)).length).toBe(0);
  measured.mockRestore();
  for (const panel of panels)
    expect(reached.has(panel.querySelector(':scope > canvas.drops'))).toBe(!below.includes(panel));
  // Two skies go up each time, the sharp and the soft.
  expect(uploads.mock.calls.length).toBe(4);
  uploads.mockRestore();
  // In a fixed-height card the scene root scrolls while the card stays put.
  card.style.marginTop = '';
  card.style.setProperty('--iweather-height', '600px');
  await frames(3);
  card.parts.content.scrollTop = card.parts.content.scrollHeight;
  await frames(2);
  expect(card.parts.content.scrollTop).toBeGreaterThan(0);
  const frameBox = card.getBoundingClientRect();
  reached.clear();
  card.glass.paint(7000);
  for (const panel of panels) {
    const box = panel.getBoundingClientRect();
    expect(reached.has(panel.querySelector(':scope > canvas.drops'))).toBe(
      box.bottom > Math.max(frameBox.top, 0) && box.top < Math.min(frameBox.bottom, innerHeight),
    );
  }
  copies.mockRestore();
  card.remove();
});

// Home Assistant takes cards off the page as views change and while it edits a dashboard. An
// open sheet goes with its card, and stops following the window's scrolling and resizing.
test('a card taken off the page closes its open sheet', async () => {
  const card = document.createElement('iweather-card');
  card.setConfig({
    type: 'custom:iweather-card',
    entity: 'weather.home',
    weather_layout: 'page',
    weather_animation: false,
  });
  card.hass = hassFor(SCENES[0]);
  document.body.replaceChildren(card);
  await frames(3);
  const removed = vi.spyOn(window, 'removeEventListener');
  part(card, '.daily .day').click();
  const dialog = card.root.querySelector('dialog');
  expect(dialog?.open).toBe(true);
  card.remove();
  expect(dialog?.open).toBe(false);
  await vi.waitFor(() => {
    expect(removed.mock.calls.map(([type]) => type)).toEqual(expect.arrayContaining(['resize', 'scroll']));
  });
  removed.mockRestore();
});

// The title holds over a scrolled sheet in a bar of its own, gone at the top, and never in the way.
test('a scrolled sheet holds its title in a bar over it', async () => {
  const card = document.createElement('iweather-card');
  card.setConfig({
    type: 'custom:iweather-card',
    entity: 'weather.home',
    weather_layout: 'page',
    weather_animation: false,
  });
  card.hass = hassFor(SCENES[0]);
  document.body.replaceChildren(card);
  await frames(3);
  const day = part(card, '.daily .day');
  day.click();
  const dialog = part(card, 'dialog'),
    sheet = part(card, 'dialog .sheet'),
    band = part(card, 'dialog .sheet-band');
  expect(band.textContent).toBe(part(card, 'dialog .sheet header h2').textContent);
  expect(band.getAttribute('aria-hidden')).toBe('true');
  expect(band.querySelector('button')?.tabIndex).toBe(-1);
  expect(dialog.hasAttribute('data-scrolled')).toBe(false);
  sheet.style.maxHeight = '200px';
  sheet.scrollTop = 60;
  await vi.waitFor(() => {
    expect(dialog.hasAttribute('data-scrolled')).toBe(true);
  });
  // It lets the wheel and presses through to the sheet; only its button takes them.
  expect(getComputedStyle(band).pointerEvents).toBe('none');
  sheet.scrollTop = 0;
  await vi.waitFor(() => {
    expect(dialog.hasAttribute('data-scrolled')).toBe(false);
  });
  sheet.scrollTop = 60;
  await vi.waitFor(() => {
    expect(dialog.hasAttribute('data-scrolled')).toBe(true);
  });
  // Closing from the bar, then opening again, starts at the top with no bar.
  band.querySelector('button')?.click();
  await vi.waitFor(() => {
    expect(card.root.querySelector('dialog')?.open).toBe(false);
  });
  day.click();
  expect(dialog.hasAttribute('data-scrolled')).toBe(false);
  expect(sheet.scrollTop).toBe(0);
  card.remove();
});

// A sheet stays put under the pointer: reading a chart moves nothing, an update with nothing new
// leaves it alone, and one that draws it again keeps it scrolled where it was.
test('reading a chart moves nothing in its sheet, through updates too', async () => {
  const card = document.createElement('iweather-card');
  card.setConfig({
    type: 'custom:iweather-card',
    entity: 'weather.home',
    weather_layout: 'page',
    weather_animation: false,
  });
  card.hass = hassFor(SCENES[0]);
  document.body.replaceChildren(card);
  await frames(3);
  part(card, '.daily .day').click();
  const sheet = part(card, 'dialog .sheet'),
    shown = `dialog .chart-page[data-day="${part(card, 'dialog .detail-days [aria-pressed=true]').dataset['day'] ?? ''}"]`,
    plot = part(card, `${shown} .chart-plot`),
    chart = part(card, `${shown} .chart`),
    readout = part(card, `dialog .${chart.dataset['readout'] ?? ''}`);
  sheet.style.maxHeight = '200px';
  sheet.scrollTop = sheet.scrollHeight;
  const top = sheet.scrollTop,
    before = plot.getBoundingClientRect(),
    tall = readout.getBoundingClientRect().height;
  expect(top).toBeGreaterThan(0);
  const hover = (share: number) =>
    plot.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        composed: true,
        pointerType: 'mouse',
        clientX: before.left + before.width * share,
        clientY: before.top + before.height / 2,
      }),
    );
  for (const share of [0.1, 0.5, 0.9]) {
    hover(share);
    expect('scrubbing' in chart.dataset).toBe(true);
    expect(plot.getBoundingClientRect().top).toBeCloseTo(before.top, 0);
    expect(readout.getBoundingClientRect().height).toBeCloseTo(tall, 0);
    expect(sheet.scrollTop).toBe(top);
  }
  // Nothing new: the same chart, still being read.
  card.sheets.renderAll();
  expect(plot.isConnected).toBe(true);
  expect('scrubbing' in chart.dataset).toBe(true);
  expect(sheet.scrollTop).toBe(top);
  // Put away, the readout goes back to sizing itself.
  plot.dispatchEvent(
    new PointerEvent('pointerout', { bubbles: true, composed: true, pointerType: 'mouse', relatedTarget: sheet }),
  );
  expect(readout.style.height).toBe('');
  // The next day leaves the charts' pages as they are, and the sheet where it was.
  sheet.scrollTop = 40;
  part(card, 'dialog [data-step="1"]').click();
  expect(plot.isConnected).toBe(true);
  expect(sheet.scrollTop).toBe(40);
  card.remove();
});
