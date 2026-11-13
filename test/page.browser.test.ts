import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import '../src/iweather-card.ts';
import type { IWeatherCard } from '../src/iweather-card.ts';
import type { ForecastSubscription, HomeAssistant } from '../src/card/home-assistant.ts';
import { isRecord } from '../src/lib/values.ts';

// The full page's map and what the card asks for beyond its forecast, on a rainy noon, with the
// radar's frames and the wind from stand-ins for the services they come from. The map keeps to
// tiles of its own, as the live ground needs WebGL and the network.
const NOW = Date.UTC(2026, 9, 27, 17, 30, 0),
  HOUR = 3600000;

const hourly = Array.from({ length: 24 }, (_, i) => ({
  datetime: new Date(Math.floor(NOW / HOUR) * HOUR + i * HOUR).toISOString(),
  temperature: 58,
  condition: 'rainy',
  precipitation: 0.1,
  wind_speed: 8,
  wind_bearing: 200,
}));
const daily = Array.from({ length: 10 }, (_, i) => ({
  datetime: new Date(NOW + i * 24 * HOUR).toISOString(),
  condition: 'rainy',
  temperature: 64,
  templow: 48,
  precipitation: 0.1,
}));
function hassWith(callWS?: HomeAssistant['callWS']): HomeAssistant {
  return {
    states: {
      'weather.home': {
        entity_id: 'weather.home',
        state: 'rainy',
        attributes: {
          temperature: 58,
          temperature_unit: '°F',
          wind_speed: 12,
          wind_bearing: 220,
          wind_speed_unit: 'mph',
          precipitation_unit: 'in',
          friendly_name: 'Chicago',
          supported_features: 3,
        },
      },
      'sun.sun': { entity_id: 'sun.sun', state: 'above_horizon', attributes: { elevation: 38, rising: false } },
      'sensor.rain': { entity_id: 'sensor.rain', state: '0.4', attributes: { unit_of_measurement: 'mm' } },
    },
    locale: { language: 'en', time_format: '12' },
    config: { location_name: 'Home', time_zone: 'America/Chicago', latitude: 41.9, longitude: -87.6 },
    ...(callWS ? { callWS } : {}),
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
// Twelve radar frames ten minutes apart up to now; the wind, for as many places as are asked.
const SECONDS = Math.floor(NOW / 1000);
const radar = {
  host: 'https://radar.test',
  radar: {
    past: Array.from({ length: 12 }, (_, i) => ({ time: SECONDS - (11 - i) * 600, path: `/radar/${i}` })),
  },
};
function wind(url: string) {
  const places = new URL(url).searchParams.get('latitude')?.split(',') ?? [],
    times = Array.from({ length: 16 }, (_, hour) => SECONDS + (hour - 3) * 3600);
  return places.map(() => ({
    hourly: {
      time: times,
      wind_speed_10m: times.map(() => 6),
      wind_direction_10m: times.map(() => 200),
      temperature_2m: times.map(() => 12),
      precipitation: times.map(() => 0.5),
    },
  }));
}
function answer(url: string) {
  const body = url.includes('rainviewer') ? radar : url.includes('wind_speed_10m') ? wind(url) : null;
  return Promise.resolve({ ok: body !== null, status: body ? 200 : 503, json: () => Promise.resolve(body) });
}

function part(card: IWeatherCard, selector: string): HTMLElement {
  const node = card.root.querySelector(selector);
  if (!(node instanceof HTMLElement)) throw new Error(`No ${selector}.`);
  return node;
}
const press = (node: Element, key: string) =>
  node.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true }));
async function page(extra: object, hass = hassWith()) {
  const card = document.createElement('iweather-card');
  card.style.cssText = 'display:block;width:1100px';
  card.setConfig({
    type: 'custom:iweather-card',
    entity: 'weather.home',
    weather_layout: 'page',
    weather_animation: false,
    map: 'rainviewer',
    map_tile_url: 'https://tiles.test/{z}/{x}/{y}.png',
    ...extra,
  });
  card.hass = hass;
  document.body.replaceChildren(card);
  await vi.waitFor(() => {
    expect(part(card, '.tile[data-tile=map] .radar [data-frame]')).toBeTruthy();
  });
  return card;
}
async function openMap(card: IWeatherCard) {
  part(card, '.tile[data-tile=map]').click();
  await vi.waitFor(() => {
    expect(part(card, '.radar.large .wind-time')).toBeTruthy();
  });
  return part(card, '.radar.large');
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  vi.stubGlobal('fetch', answer);
});
afterAll(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("the large map tells the radar's time on its timeline", async () => {
  const large = await openMap(await page({}));
  expect(large.querySelector('.wind-when b')?.textContent).toBe('Forecast');
});

test('the arrow keys slide the large map an eighth of its size, and it is drawn there at rest', async () => {
  const card = await page({}),
    view = await openMap(card),
    pan = part(card, '.radar.large > .map-pan');
  press(view, 'ArrowRight');
  expect(parseFloat(pan.style.translate)).toBeCloseTo(-view.clientWidth / 8);
  expect(view.hasAttribute('data-dragging')).toBe(true);
  await vi.waitFor(() => {
    expect(view.hasAttribute('data-dragging')).toBe(false);
  });
  expect(part(card, '.radar.large [data-home]').hasAttribute('data-here')).toBe(false);
});

test('a layer chosen from the menu is drawn, and the menu’s button keeps the focus', async () => {
  const card = await page({});
  await openMap(card);
  part(card, '.radar.large [data-layers]').click();
  expect(part(card, '.radar.large .map-layers').hidden).toBe(false);
  part(card, '.radar.large [data-choice=wind]').click();
  expect(part(card, '.radar.large').dataset['kind']).toBe('wind');
  expect(card.root.activeElement).toBe(part(card, '.radar.large [data-layers]'));
});

test('closing the map forgets where it was moved and what it showed', async () => {
  const card = await page({}),
    view = await openMap(card);
  part(card, '.radar.large [data-zoom="1"]').click();
  await vi.waitFor(() => {
    expect(view.hasAttribute('data-dragging')).toBe(false);
    expect(part(card, '.radar.large [data-home]').hasAttribute('data-here')).toBe(false);
  });
  part(card, '.radar.large [data-layers]').click();
  part(card, '.radar.large [data-choice=temperature]').click();
  const dialog = part(card, 'dialog[open]'),
    closed = new Promise(done => {
      dialog.addEventListener('close', done, { once: true });
    });
  part(card, 'dialog[open] [data-close]').click();
  await closed;
  const reopened = await openMap(card);
  expect(reopened.dataset['kind']).toBe('precipitation');
  expect(part(card, '.radar.large [data-home]').hasAttribute('data-here')).toBe(true);
});

test('the arrow keys step the timeline a frame at a time, and stop at its ends', async () => {
  const card = await page({});
  await openMap(card);
  const track = part(card, '.radar.large .wind-track'),
    last = Number(track.getAttribute('aria-valuemax'));
  expect(track.getAttribute('aria-valuenow')).toBe(String(last));
  press(track, 'ArrowLeft');
  expect(track.getAttribute('aria-valuenow')).toBe(String(last - 1));
  press(track, 'ArrowRight');
  press(track, 'ArrowRight');
  expect(track.getAttribute('aria-valuenow')).toBe(String(last));
});

test('what a sensor recorded lately reaches its tile, however late it comes', async () => {
  let reply: (rows: unknown) => void = () => undefined;
  const replied = new Promise<unknown>(done => {
    reply = done;
  });
  const card = await page(
    { precipitation_entity: 'sensor.rain' },
    hassWith(message =>
      message.type === 'history/history_during_period' && message.entity_ids.includes('sensor.rain')
        ? replied
        : Promise.resolve({}),
    ),
  );
  const told = () => card.root.querySelector('.tile[data-tile=precipitation]')?.textContent ?? '';
  expect(told()).not.toContain('in last');
  const rows = Array.from({ length: 12 }, (_, i) => ({ s: String(i), lu: SECONDS - (12 - i) * 1800 }));
  reply({ 'sensor.rain': rows });
  await vi.waitFor(() => {
    expect(told()).toContain('in last');
  });
});

const nextHourRain = (attributes: Record<string, unknown>): HomeAssistant => {
  const hass = hassWith();
  hass.states['sensor.nowcast'] = { entity_id: 'sensor.nowcast', state: '0', attributes };
  return hass;
};
const scrolled = async (extra: object) => {
  const card = await page(extra);
  card.style.height = '800px';
  await vi.waitFor(() => {
    expect(getComputedStyle(part(card, '.weather')).getPropertyValue('--band')).not.toBe('');
  });
  return card;
};
const bandOf = (card: IWeatherCard) =>
  Number.parseFloat(getComputedStyle(part(card, '.weather')).getPropertyValue('--band'));

test('a town or city set for home stands under Home Assistant’s name for it, and the panels hold still', async () => {
  const plain = await page({}),
    panelTop = part(plain, '.forecast').getBoundingClientRect().top,
    temperature = part(plain, '.temperature').getBoundingClientRect().top;
  expect(part(plain, '.home').hidden).toBe(true);
  expect(part(plain, '.location').textContent).toBe('Chicago');
  const named = await page({ place_name: 'St. Louis' }),
    home = part(named, '.home');
  expect(getComputedStyle(home).display).toBe('block');
  expect(home.textContent).toBe('Home');
  expect(getComputedStyle(home).textTransform).toBe('uppercase');
  expect([getComputedStyle(home).fontSize, getComputedStyle(home).fontWeight]).toEqual(['12.5px', '600']);
  expect(getComputedStyle(home, '::before').content).not.toBe('none');
  expect(part(named, '.location').textContent).toBe('St. Louis');
  expect(home.getBoundingClientRect().bottom).toBeLessThanOrEqual(part(named, '.location').getBoundingClientRect().top);
  expect(part(named, '.forecast').getBoundingClientRect().top).toBeCloseTo(panelTop, 1);
  expect(part(named, '.temperature').getBoundingClientRect().top).toBeCloseTo(temperature, 1);
});

test('the pinned band follows the top spacing and leaves room for a line over the place name', async () => {
  expect(bandOf(await scrolled({ top_padding: 100 }))).toBeCloseTo(186, 2);
  expect(bandOf(await scrolled({ top_padding: 100, place_name: 'St. Louis' }))).toBeCloseTo(199.75, 2);
  const reduced = bandOf(await scrolled({}));
  expect(reduced).toBeGreaterThan(0);
  expect(reduced).toBeLessThan(186);
});

test('top padding halves the upper gap by default and can be changed without resizing the weather text', async () => {
  const card = await page({ top_padding: 100 }),
    hero = part(card, '.hero'),
    current = part(card, '.current'),
    gap = () => current.getBoundingClientRect().top - hero.getBoundingClientRect().top,
    original = gap(),
    textHeight = current.getBoundingClientRect().height,
    below = hero.getBoundingClientRect().bottom - current.getBoundingClientRect().bottom;
  expect(original).toBeGreaterThan(0);
  for (const [padding, factor] of [
    [undefined, 0.5],
    [0, 0],
    [200, 2],
    [100, 1],
  ] as const) {
    card.setConfig({
      entity: 'weather.home',
      weather_layout: 'page',
      weather_animation: false,
      map: 'none',
      ...(padding === undefined ? {} : { top_padding: padding }),
    });
    await vi.waitFor(() => {
      expect(Math.abs(gap() - original * factor)).toBeLessThan(1);
      expect(current.getBoundingClientRect().height).toBeCloseTo(textHeight, 1);
      expect(hero.getBoundingClientRect().bottom - current.getBoundingClientRect().bottom).toBeCloseTo(below, 1);
    });
  }
});

test('the large map’s weather keeps its colours after dark', async () => {
  const hass = hassWith();
  hass.states['sun.sun'] = { entity_id: 'sun.sun', state: 'below_horizon', attributes: { elevation: -20 } };
  const view = await openMap(await page({}, hass)),
    symbol = view.querySelector('.map-sky svg');
  expect(symbol && getComputedStyle(symbol).filter).toBe('none');
  // Rain's cyan, which a flat white would lose.
  expect(symbol?.innerHTML).toContain('#39d1fd');
});

test('a title’s symbol and words share one lift, its shapes clipped to both', async () => {
  const card = await page({}),
    tile = part(card, '.tile[data-tile=wind]'),
    lifts = tile.querySelectorAll('.tile-content > .lift'),
    clip = tile.querySelector('header .title clipPath'),
    symbol = tile.querySelector('header > svg:not(.title)');
  expect(lifts).toHaveLength(1);
  expect(clip?.querySelectorAll('text')).toHaveLength(1);
  expect(clip?.querySelectorAll('path').length).toBeGreaterThan(0);
  expect(clip?.querySelectorAll('g')).toHaveLength(0);
  expect(symbol && getComputedStyle(symbol).visibility).toBe('hidden');
  // The marks over the lift draw the same shapes in the title's light.
  const marks = tile.querySelector('header .title > g');
  expect(marks?.querySelectorAll('path').length).toBe(clip?.querySelectorAll('path').length);
  expect(marks?.getAttribute('fill-opacity')).toBe('0.250');
  for (const shape of marks?.querySelectorAll('path') ?? []) expect(shape.hasAttribute('fill')).toBe(false);
});

test('next hour is a tile: the strip’s title, a sentence of two lines at most, and a chart in the room left', async () => {
  const forecast = Array.from({ length: 13 }, (_, i) => ({
      datetime: new Date(NOW + i * 300000).toISOString(),
      precipitation: 4,
    })),
    card = await page({ next_hour_entity: 'sensor.nowcast' }, nextHourRain({ unit_of_measurement: 'mm/h', forecast })),
    panel = part(card, '.next-hour'),
    title = part(card, '.next-title'),
    text = part(card, '.next-text'),
    chart = part(card, '.next-chart'),
    strip = part(card, '.heading strong');
  expect(title.textContent).toBe('Rain Forecasted');
  expect(panel.querySelector('header')).toBeNull();
  expect(panel.getAttribute('aria-label')).toBe('Rain Forecasted. Rain for the next hour');
  expect(getComputedStyle(text).fontSize).toBe('13.75px');
  expect(getComputedStyle(text).webkitLineClamp).toBe('2');
  for (const style of ['fontSize', 'fontWeight', 'color'] as const)
    expect(getComputedStyle(title)[style]).toBe(getComputedStyle(strip)[style]);
  // Sixty bars, whatever the tile's width, each 3.75 px across in the card's own px.
  const bars = chart.querySelectorAll('g g rect');
  expect(bars).toHaveLength(60);
  const zoom = card.getBoundingClientRect().width / card.offsetWidth,
    [first] = bars,
    words = text.getBoundingClientRect(),
    plot = chart.getBoundingClientRect();
  expect(first && first.getBoundingClientRect().width / zoom).toBeCloseTo(3.75, 1);
  expect(chart.clientHeight).toBeGreaterThan(25);
  // The chart's top line stands clear of the sentence, and the title out past both.
  expect((plot.top - words.bottom) / zoom).toBeCloseTo(12.5, 1);
  expect((words.left - title.getBoundingClientRect().left) / zoom).toBeCloseTo(7.5, 1);
});

test('a tile’s title keeps to one line, so the title drawn over it stands level with every other', async () => {
  const card = await page({}),
    tile = part(card, '.tile[data-tile=feels_like]'),
    words = part(card, '.tile[data-tile=feels_like] .tile-content > header > span'),
    line = part(card, '.tile[data-tile=wind] .tile-content > header').getBoundingClientRect().height;
  // So narrow that its two words could not share a line.
  tile.style.width = '40px';
  expect(words.getBoundingClientRect().height).toBeCloseTo(line, 1);
  expect(part(card, '.tile[data-tile=feels_like] .tile-content > header').getBoundingClientRect().height).toBeCloseTo(
    line,
    1,
  );
  card.remove();
});

test('an integration that gives minute precipitation when asked fills the next hour, and is asked again only now and then', async () => {
  const asked: unknown[] = [];
  const minutes = Array.from({ length: 61 }, (_, i) => ({
    datetime: new Date(NOW + i * 60000).toISOString(),
    precipitation: 2,
  }));
  const callWS: HomeAssistant['callWS'] = message => {
    asked.push(message);
    return message.type === 'call_service'
      ? Promise.resolve({ response: { 'weather.home': { forecast: minutes } } })
      : Promise.resolve({});
  };
  const card = await page({}, { ...hassWith(callWS), entities: { 'weather.home': { platform: 'openweathermap' } } });
  await vi.waitFor(() => {
    expect(part(card, '.next-title').textContent).toBe('Rain Forecasted');
  });
  const services = () => asked.filter(message => isRecord(message) && message['type'] === 'call_service');
  expect(services()[0]).toEqual({
    type: 'call_service',
    domain: 'openweathermap',
    service: 'get_minute_forecast',
    target: { entity_id: 'weather.home' },
    return_response: true,
  });
  card.render();
  card.render();
  expect(services()).toHaveLength(1);
  card.remove();
});
