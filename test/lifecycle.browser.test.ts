import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import '../src/iweather-card.ts';
import type { ForecastSubscription, HomeAssistant } from '../src/card/home-assistant.ts';
import type { IWeatherCard } from '../src/iweather-card.ts';
import type * as MapGl from '../src/map/gl.ts';
import { type GroundStill, groundStill } from '../src/map/gl.ts';
import { showMotion } from '../src/map/moves.ts';
import { STILL } from '../src/map/wind.ts';
import { drawMoon } from '../src/sky/moon.ts';
import { sharedGlass } from '../src/sky/glass-gl.ts';
import { context2d } from '../src/lib/canvas.ts';
import { SYMBOLS } from '../src/weather/symbols.ts';

// What a card must let go of as it lives on one screen for weeks: drawn over, closed or gone.
vi.mock('../src/map/gl.ts', async original => ({
  ...(await original<typeof MapGl>()),
  groundStill: vi.fn(),
}));
const HOUR = 3_600_000;
const hourly = () =>
  Array.from({ length: 24 }, (_, i) => ({
    datetime: new Date(Date.now() + i * HOUR).toISOString(),
    temperature: 60,
    condition: 'cloudy',
    wind_speed: 8,
    wind_bearing: 200,
  }));
const hassWith = (): HomeAssistant => ({
  states: {
    'weather.home': {
      entity_id: 'weather.home',
      state: 'cloudy',
      attributes: {
        temperature: 68,
        temperature_unit: '°F',
        wind_speed: 8,
        wind_bearing: 200,
        wind_speed_unit: 'mph',
        precipitation_unit: 'in',
        friendly_name: 'Chicago',
        supported_features: 3,
      },
    },
    'sun.sun': { entity_id: 'sun.sun', state: 'above_horizon', attributes: { elevation: 40, rising: true } },
  },
  locale: { language: 'en', time_format: '12' },
  config: { location_name: 'Home', time_zone: 'America/Chicago', latitude: 41.9, longitude: -87.6 },
  connection: {
    subscribeMessage(callback: (message: unknown) => void, _message: ForecastSubscription) {
      queueMicrotask(() => {
        callback({ forecast: hourly() });
      });
      return Promise.resolve(() => undefined);
    },
  },
});
function page(extra: object): IWeatherCard {
  const card = document.createElement('iweather-card');
  card.style.cssText = 'display:block;width:1100px';
  card.setConfig({
    type: 'custom:iweather-card',
    entity: 'weather.home',
    weather_layout: 'page',
    weather_animation: false,
    ...extra,
  });
  card.hass = hassWith();
  document.body.replaceChildren(card);
  return card;
}
const tile = (card: IWeatherCard, id: string) => {
  const found = card.root.querySelector<HTMLElement>(`.tile[data-tile=${id}]`);
  if (!found) throw new Error(`No ${id} tile.`);
  return found;
};
const redrawn = async (card: IWeatherCard) => {
  card.redrawTiles();
  await new Promise(requestAnimationFrame);
};

// Observe the shared renderer through a real rainy card, keeping other cards' cleanup
// out of the counts. Still weather lets each test choose when the next repaint occurs.
async function rainyCard() {
  const renderer = sharedGlass();
  if (!renderer?.ready) throw new Error('The glass renderer requires WebGL.');
  const drawn = vi.spyOn(renderer, 'draw'),
    released = vi.spyOn(renderer, 'release'),
    card = page({ local_only: true }),
    hass = hassWith(),
    home = hass.states['weather.home'];
  if (!home) throw new Error('No weather entity.');
  home.state = 'rainy';
  card.hass = hass;
  const draws = () => drawn.mock.calls.filter(([, , , sky]) => sky === card.parts.sky).length,
    releases = () => released.mock.calls.filter(([sky]) => sky === card.parts.sky).length;
  await vi.waitFor(() => {
    expect(draws()).toBeGreaterThan(0);
    expect(card.root.querySelector('canvas.drops')).not.toBeNull();
  });
  await new Promise(requestAnimationFrame);
  return { card, draws, releases };
}

beforeEach(() => {
  vi.mocked(groundStill).mockReset().mockResolvedValue(null);
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('{}', { status: 404 }))),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

test("a small wind map's streaks don't pile up as the tiles are drawn again", async () => {
  const card = page({ map: 'local', weather_mode: 'wind' });
  await vi.waitFor(() => {
    expect(card.maps.windMaps).toHaveLength(1);
  });
  for (let i = 0; i < 5; i += 1) await redrawn(card);
  expect(card.maps.windMaps).toHaveLength(1);
  expect(card.maps.windMaps[0]?.canvas.isConnected).toBe(true);
});

test('a closed sheet keeps its map, which no longer counts as the one on show', async () => {
  const card = page({ map: 'local' });
  await vi.waitFor(() => {
    expect(tile(card, 'map')).toBeTruthy();
  });
  tile(card, 'map').click();
  await vi.waitFor(() => {
    expect(card.maps.largeView()).not.toBeNull();
  });
  const sheet = card.sheets.mapSheet();
  sheet?.dialog.close();
  await new Promise(done => sheet?.dialog.addEventListener('close', done, { once: true }));
  expect(card.root.querySelector('.radar.large')).not.toBeNull();
  expect(card.maps.largeView()).toBeNull();
});

test('a picture of the ground that comes after the card has gone is let go', async () => {
  let finish: (still: GroundStill) => void = () => undefined;
  vi.mocked(groundStill).mockReturnValue(new Promise(done => (finish = done)));
  const revoked = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined),
    card = page({ map: 'rainviewer' });
  const view = { latitude: 1, longitude: 2, zoom: 3, width: 4, height: 5, pixelRatio: 1 },
    drawing = card.maps.drawStill('a look', view, 'pale');
  card.remove();
  finish({ ground: 'blob:ground', names: 'blob:names' });
  await drawing;
  expect(revoked.mock.calls.flat()).toEqual(['blob:ground', 'blob:names']);
  expect(card.maps.stills.size).toBe(0);
});

test('an open map is left as it is while nothing about it changes', async () => {
  const card = page({ map: 'local' });
  await vi.waitFor(() => {
    expect(tile(card, 'map')).toBeTruthy();
  });
  tile(card, 'map').click();
  await vi.waitFor(() => {
    expect(card.maps.largeView()?.querySelector('.map-pan')).toBeTruthy();
  });
  const view = card.maps.largeView(),
    drawn = view?.querySelector('.map-pan');
  // Mid-drag, say, or with its menu open.
  view?.toggleAttribute('data-dragging', true);
  card.sheets.renderAll();
  expect(card.maps.largeView()).toBe(view);
  expect(view?.hasAttribute('data-dragging')).toBe(true);
  view?.removeAttribute('data-dragging');
  card.sheets.renderAll();
  expect(view?.querySelector('.map-pan')).toBe(drawn);
});

test('a map moved back to where it is drawn lets go of the motion, leaving nothing on its layer', async () => {
  const card = page({ map: 'local' });
  await vi.waitFor(() => {
    expect(tile(card, 'map')).toBeTruthy();
  });
  tile(card, 'map').click();
  await vi.waitFor(() => {
    expect(card.maps.largeView()?.querySelector('.map-pan')).toBeTruthy();
  });
  const view = card.maps.largeView(),
    drawn = view?.querySelector<HTMLElement>('.map-pan'),
    pins = view?.querySelector<HTMLElement>('.map-pins');
  if (!view || !drawn || !pins) throw new Error('no large map');
  // As the live ground reports a move that ends where it began, a resize say.
  showMotion(view, STILL, false);
  expect(view.hasAttribute('data-dragging')).toBe(true);
  card.maps.move(card.maps.centre);
  // Its streaks show and move again, and the map takes what changes.
  expect(view.hasAttribute('data-dragging')).toBe(false);
  expect(view.querySelector('.map-pan')).toBe(drawn);
  // Even a transform that moves nothing would set the layer apart from the ground under it.
  expect([drawn.style.translate, drawn.style.scale, drawn.style.transformOrigin, pins.style.translate]).toEqual([
    '',
    '',
    '',
    '',
  ]);
});

test('a sheet stays by its tile when the tiles are drawn again', async () => {
  const card = page({});
  await vi.waitFor(() => {
    expect(card.root.querySelector('.tile[data-tile=wind][data-detail]')).toBeTruthy();
  });
  tile(card, 'wind').click();
  const detail = card.sheets.detail;
  await vi.waitFor(() => {
    expect(detail?.dialog.open).toBe(true);
  });
  const side = detail?.dialog.dataset['side'];
  expect(side).not.toBe('sheet');
  await redrawn(card);
  card.sheets.place();
  expect(detail?.anchor).toBe(tile(card, 'wind'));
  expect(detail?.dialog.dataset['side']).toBe(side);
  detail?.dialog.close();
  await new Promise(done => detail?.dialog.addEventListener('close', done, { once: true }));
  expect(card.root.activeElement).toBe(tile(card, 'wind'));
});

test('normals that never came are asked for again in a while, not at each update', async () => {
  const asked = vi.fn(() => Promise.reject(new Error('No network yet.')));
  vi.stubGlobal('fetch', asked);
  localStorage.clear();
  const card = page({ averages: 'open-meteo' }),
    archive = () => asked.mock.calls.flat().filter(url => String(url).includes('archive-api')).length;
  await vi.waitFor(() => {
    expect(archive()).toBe(1);
  });
  await vi.waitFor(() => {
    expect(card.records.climate).toBeNull();
  });
  await card.records.loadClimate();
  expect(archive()).toBe(1);
  card.records.climateAt -= 31 * 60_000;
  await card.records.loadClimate();
  expect(archive()).toBe(2);
});

test('a reply for what the card no longer shows is dropped', async () => {
  const answers: ((reply: unknown) => void)[] = [],
    hass = hassWith(),
    home = hass.states['weather.home'];
  if (!home) throw new Error('No weather entity.');
  home.attributes.pressure = 1012;
  home.attributes.pressure_unit = 'hPa';
  hass.states['weather.other'] = { ...home, entity_id: 'weather.other' };
  hass.callWS = () =>
    new Promise(done => {
      answers.push(done);
    });
  const card = page({});
  card.hass = hass;
  await vi.waitFor(() => {
    expect(card.records.earlierEntity).toBe('weather.home');
  });
  card.setConfig({ type: 'custom:iweather-card', entity: 'weather.other', weather_layout: 'page' });
  expect(card.records.earlierEntity).toBe('weather.other');
  // The first entity's reply comes in with the second's still on its way.
  answers[0]?.({ 'weather.home': [{ a: { pressure: 1000 } }] });
  await new Promise(done => setTimeout(done));
  expect(card.records.earlier).toBeUndefined();
});

test('weather that has stopped updating says when it last did', async () => {
  const hass = hassWith(),
    home = hass.states['weather.home'];
  if (!home) throw new Error('No weather entity.');
  // Home Assistant's frontend is told last_updated, not last_reported.
  home.last_updated = new Date(Date.now() - 5 * HOUR).toISOString();
  const card = page({});
  card.hass = hass;
  const stale = card.root.querySelector<HTMLElement>('.stale');
  await vi.waitFor(() => {
    expect(stale?.hidden).toBe(false);
  });
  expect(stale?.textContent).toMatch(/^Last updated .*[AP]M$/);
});

test('an open air quality sheet follows its pollutant sensors', async () => {
  const withOzone = (ozone: string): HomeAssistant => {
    const hass = hassWith();
    hass.states['sensor.aqi'] = { entity_id: 'sensor.aqi', state: '42', attributes: {} };
    hass.states['sensor.ozone'] = {
      entity_id: 'sensor.ozone',
      state: ozone,
      attributes: { device_class: 'ozone', unit_of_measurement: 'ppb' },
    };
    hass.entities = {
      'sensor.aqi': { device_id: 'air' },
      'sensor.ozone': { device_id: 'air' },
    };
    return hass;
  };
  const card = page({ air_quality_entity: 'sensor.aqi' }),
    first = withOzone('31');
  card.hass = first;
  await vi.waitFor(() => {
    expect(tile(card, 'air_quality')).toBeTruthy();
  });
  tile(card, 'air_quality').click();
  const pollutants = () => card.root.querySelector('dialog[open] .sun-rows')?.textContent;
  await vi.waitFor(() => {
    expect(pollutants()).toContain('31');
  });
  // Only the sensor changes: the weather, the index and everything else are as they were.
  const changed = withOzone('57').states['sensor.ozone'];
  if (!changed) throw new Error('No ozone sensor.');
  card.hass = { ...first, states: { ...first.states, 'sensor.ozone': changed } };
  await new Promise(requestAnimationFrame);
  expect(pollutants()).toContain('57');
});

test('today follows the cloud cover the entity reports', async () => {
  const hours = (cover: number): HomeAssistant => {
    const hass = hassWith(),
      home = hass.states['weather.home'];
    if (!home) throw new Error('No weather entity.');
    home.state = 'partlycloudy';
    home.attributes.cloud_coverage = cover;
    return hass;
  };
  const card = page({}),
    first = hours(15),
    today = () => card.root.querySelector('.day .day-icon')?.innerHTML;
  card.hass = first;
  await vi.waitFor(() => {
    expect(today()).toBeTruthy();
  });
  const clear = today(),
    changed = hours(85).states['weather.home'];
  if (!changed) throw new Error('No weather entity.');
  card.hass = { ...first, states: { ...first.states, 'weather.home': changed } };
  await new Promise(requestAnimationFrame);
  expect(today()).not.toBe(clear);
});

// A symbol as the page holds it.
const parsed = (svg: string) => {
  const holder = document.createElement('template');
  holder.innerHTML = svg;
  return holder.innerHTML;
};
const clearNight = (): HomeAssistant => {
  const hass = hassWith(),
    home = hass.states['weather.home'],
    sun = hass.states['sun.sun'];
  if (!home || !sun) throw new Error('No weather entity.');
  home.state = 'clear-night';
  sun.state = 'below_horizon';
  return hass;
};
test("by night only today's row shows the night, and every row still names its weather", async () => {
  const noon = (days: number) => new Date(Date.now() + days * 24 * HOUR).toISOString();
  const hass = clearNight();
  hass.connection = {
    subscribeMessage(callback: (message: unknown) => void, message: ForecastSubscription) {
      queueMicrotask(() => {
        callback({
          forecast:
            message.forecast_type === 'daily'
              ? [
                  { datetime: noon(0), condition: 'clear-night', temperature: 60, templow: 50 },
                  { datetime: noon(1), condition: 'clear-night', temperature: 60, templow: 50 },
                ]
              : hourly(),
        });
      });
      return Promise.resolve(() => undefined);
    },
  };
  const card = page({});
  card.hass = hass;
  const rows = () => [...card.root.querySelectorAll('.day')];
  await vi.waitFor(() => {
    expect(rows().length).toBe(2);
  });
  const [today, tomorrow] = rows();
  expect(today?.querySelector('.day-icon')?.innerHTML).toBe(parsed(SYMBOLS.moon));
  expect(tomorrow?.querySelector('.day-icon')?.innerHTML).toBe(parsed(SYMBOLS.sun));
  // The symbols say nothing to a screen reader, so the rows carry the words.
  expect(today?.getAttribute('aria-label')).toMatch(/^Today, Clear,/);
  expect(tomorrow?.getAttribute('aria-label')).toMatch(/, Clear,/);
  const hour = card.root.querySelector('.hours .hour');
  expect(hour?.getAttribute('aria-label')).toMatch(/Clear/);
  expect(hour?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
});
test('with the animation on, nothing moves in the list or strip', async () => {
  const sun = {
    next_rising: new Date(Date.now() + 30 * 60_000).toISOString(),
    next_setting: new Date(Date.now() + 10 * HOUR).toISOString(),
  };
  const hass = hassWith(),
    star = hass.states['sun.sun'];
  if (!star) throw new Error('No sun.');
  Object.assign(star.attributes, sun);
  const card = page({ weather_animation: true });
  card.hass = hass;
  await vi.waitFor(() => {
    expect(card.root.querySelector('.hour[data-sun=sunrise] svg')).toBeTruthy();
  });
  const strip = card.root.querySelector('.hours'),
    list = card.root.querySelector('.daily');
  for (const part of [strip, list]) {
    expect(part?.querySelector('animate,animateTransform,animateMotion,set')).toBeNull();
    expect([...(part?.querySelectorAll('*') ?? [])].flatMap(node => node.getAnimations())).toEqual([]);
  }
});
test('a symbol keeps its proportions from the list to the strip, and a wide glyph its height in a sheet', async () => {
  const hass = hassWith(),
    star = hass.states['sun.sun'];
  if (!star) throw new Error('No sun.');
  Object.assign(star.attributes, {
    next_rising: new Date(Date.now() + 14 * HOUR).toISOString(),
    next_setting: new Date(Date.now() + 2 * HOUR).toISOString(),
    next_noon: new Date(Date.now() + 19 * HOUR).toISOString(),
  });
  const card = page({}),
    box = (selector: string) => {
      const found = card.root.querySelector(selector);
      if (!found) throw new Error(`No ${selector}.`);
      return found.getBoundingClientRect();
    };
  card.hass = hass;
  await vi.waitFor(() => {
    expect(card.root.querySelector('.tile[data-tile=sun][data-detail]')).toBeTruthy();
    expect(card.root.querySelector('.hour-symbol svg')).toBeTruthy();
    expect(card.root.querySelector('.day-icon svg')).toBeTruthy();
  });
  expect(box('.hour-symbol svg').width / box('.day-icon svg').width).toBeCloseTo(24.5 / 19.5);
  tile(card, 'sun').click();
  await vi.waitFor(() => {
    expect(card.root.querySelector('.detail[open] .detail-glyph svg')).toBeTruthy();
  });
  const glyph = box('.detail[open] .detail-glyph svg');
  expect(glyph.width / glyph.height).toBeCloseTo(20 / 16);
});

test('a sky takes the landscape decks by its own shape, not by the title above it', async () => {
  const card = page({ weather_layout: 'expanded' });
  card.style.width = '800px';
  card.style.setProperty('--iweather-height', '1080px');
  for (let frame = 0; frame < 2; frame++) await new Promise(requestAnimationFrame);
  expect(card.scene.wide).toBe(false);
  card.style.width = '1600px';
  card.style.setProperty('--iweather-height', '500px');
  await vi.waitFor(() => expect(card.scene.wide).toBe(true));
});

test("a page's sky is a window's, and keeps the regular decks however wide the window", async () => {
  const card = page({});
  card.style.width = '1600px';
  card.style.setProperty('--iweather-height', '500px');
  for (let frame = 0; frame < 3; frame++) await new Promise(requestAnimationFrame);
  expect(card.scene.wide).toBe(false);
});

test('a right-to-left dashboard leaves the card reading left to right, as all its words do', () => {
  const holder = document.createElement('div');
  holder.dir = 'rtl';
  const card = page({});
  document.body.replaceChildren(holder);
  holder.append(card);
  expect(getComputedStyle(card.parts.weather).direction).toBe('ltr');
});

test('a browser that cannot say its zoom still draws the moon', async () => {
  const zoom = Object.getOwnPropertyDescriptor(Element.prototype, 'currentCSSZoom');
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:40px;height:40px';
  document.body.replaceChildren(canvas);
  Reflect.deleteProperty(Element.prototype, 'currentCSSZoom');
  try {
    expect('currentCSSZoom' in canvas).toBe(false);
    await drawMoon(canvas, 0.5);
    expect(canvas.dataset['drawn']).toMatch(/^\d+:/u);
  } finally {
    if (zoom) Object.defineProperty(Element.prototype, 'currentCSSZoom', zoom);
  }
});

test('a card moved on the page keeps its forecast, and one taken away lets it go', async () => {
  const stop = vi.fn(),
    hass = hassWith(),
    subscribe = vi.fn((callback: (message: unknown) => void, _message: ForecastSubscription) => {
      callback({ forecast: hourly() });
      return Promise.resolve(stop);
    });
  hass.connection = { subscribeMessage: subscribe };
  const card = page({});
  card.hass = hass;
  await vi.waitFor(() => {
    expect(subscribe).toHaveBeenCalled();
  });
  const asked = subscribe.mock.calls.length,
    holder = document.createElement('div');
  document.body.append(holder);
  holder.append(card);
  await new Promise(done => setTimeout(done));
  expect(subscribe).toHaveBeenCalledTimes(asked);
  expect(stop).not.toHaveBeenCalled();
  card.remove();
  await vi.waitFor(() => {
    expect(stop).toHaveBeenCalledTimes(asked);
  });
});

test('a weather entity made anew is asked for its forecast again, and one only rewritten is not', async () => {
  const stop = vi.fn(),
    hass = hassWith(),
    subscribe = vi.fn((callback: (message: unknown) => void, _message: ForecastSubscription) => {
      callback({ forecast: hourly() });
      return Promise.resolve(stop);
    });
  hass.connection = { subscribeMessage: subscribe };
  const home = hass.states['weather.home'];
  if (!home) throw new Error('No weather entity.');
  const card = page({}),
    at = (changed: string, updated: string): HomeAssistant => ({
      ...hass,
      states: { ...hass.states, 'weather.home': { ...home, last_changed: changed, last_updated: updated } },
    });
  card.hass = at('2026-11-11T08:00:00Z', '2026-11-11T08:00:00Z');
  await vi.waitFor(() => {
    expect(subscribe).toHaveBeenCalled();
  });
  const asked = subscribe.mock.calls.length;
  // Written again as it was: the subscription stands.
  card.hass = at('2026-11-11T08:00:00Z', '2026-11-11T08:10:00Z');
  await new Promise(done => setTimeout(done));
  expect(subscribe).toHaveBeenCalledTimes(asked);
  // The same condition since a later time: it has been something else, and each type is asked anew.
  card.hass = at('2026-11-11T08:20:00Z', '2026-11-11T08:20:00Z');
  await vi.waitFor(() => {
    expect(subscribe).toHaveBeenCalledTimes(asked * 2);
  });
  expect(stop).toHaveBeenCalledTimes(asked);
});

test('a weather entity back from unavailable is asked for its forecast again', async () => {
  const stop = vi.fn(),
    hass = hassWith(),
    subscribe = vi.fn((callback: (message: unknown) => void, _message: ForecastSubscription) => {
      callback({ forecast: hourly() });
      return Promise.resolve(stop);
    });
  hass.connection = { subscribeMessage: subscribe };
  const home = hass.states['weather.home'];
  if (!home) throw new Error('No weather entity.');
  const card = page({});
  card.hass = hass;
  await vi.waitFor(() => {
    expect(subscribe).toHaveBeenCalled();
  });
  const asked = subscribe.mock.calls.length;
  card.hass = { ...hass, states: { ...hass.states, 'weather.home': { ...home, state: 'unavailable' } } };
  await vi.waitFor(() => {
    expect(stop).toHaveBeenCalledTimes(asked);
  });
  card.hass = { ...hass, states: { ...hass.states, 'weather.home': { ...home } } };
  await vi.waitFor(() => {
    expect(subscribe).toHaveBeenCalledTimes(asked * 2);
  });
});

test.each(['dry weather', 'low power', 'scene off'] as const)(
  '%s releases the rainy card’s sky textures',
  async reason => {
    const { card, draws, releases } = await rainyCard(),
      before = releases();
    if (reason === 'low power') card.setConfig({ ...card.config, low_power: true });
    else if (reason === 'scene off') card.setConfig({ ...card.config, weather_scene: false });
    else card.hass = hassWith();
    await vi.waitFor(() => {
      expect(releases()).toBe(before + 1);
      expect(card.root.querySelector('canvas.drops')).toBeNull();
    });
    const painted = draws();
    card.paint();
    expect(draws()).toBe(painted);
    expect(releases()).toBe(before + 1);
    if (reason !== 'dry weather') {
      card.setConfig({ ...card.config, low_power: false, weather_scene: true });
      await vi.waitFor(() => {
        expect(draws()).toBeGreaterThan(painted);
        expect(card.root.querySelector('canvas.drops')).not.toBeNull();
      });
    }
  },
);

test('the refraction setting changes the glass look without removing its moving droplets', async () => {
  const { card } = await rainyCard(),
    renderer = sharedGlass();
  if (!renderer) throw new Error('The glass renderer requires WebGL.');
  const drawn = vi.spyOn(renderer, 'draw'),
    pixels = () => {
      const canvas = card.glass.drops;
      if (!canvas) throw new Error('No droplets.');
      return context2d(canvas).getImageData(0, 0, canvas.width, canvas.height).data;
    };
  card.paint(8000);
  const refracted = pixels();
  card.setConfig({ ...card.config, glass_refraction: false });
  card.paint(8000);
  expect(drawn.mock.lastCall?.[9]).toBe(false);
  const plain = pixels();
  expect(plain.some((channel, i) => i % 4 === 3 && channel > 0)).toBe(true);
  expect(plain).not.toEqual(refracted);
  expect(card.root.querySelector('canvas.drops')).not.toBeNull();
  card.paint(9000);
  expect(pixels()).not.toEqual(plain);
  card.setConfig({ ...card.config, glass_refraction: true });
  card.paint(9000);
  expect(drawn.mock.lastCall?.[9]).toBe(true);
  expect(card.root.querySelector('canvas.drops')).not.toBeNull();
});

test('rain textures survive a synchronous move and are released when the card stays disconnected', async () => {
  const { card, draws, releases } = await rainyCard(),
    before = releases(),
    holder = document.createElement('div');
  document.body.append(holder);
  holder.append(card);
  await new Promise(done => setTimeout(done));
  await new Promise(requestAnimationFrame);
  expect(releases()).toBe(before);
  const moved = draws();
  card.paint();
  expect(draws()).toBeGreaterThan(moved);
  expect(releases()).toBe(before);
  card.remove();
  expect(releases()).toBe(before);
  await vi.waitFor(() => expect(releases()).toBe(before + 1));
  const removed = draws();
  card.paint();
  expect(draws()).toBe(removed);
  holder.append(card);
  card.paint();
  expect(draws()).toBeGreaterThan(removed);
});

test('an open sheet goes with a card that moves, as a modal one cannot move with it', async () => {
  const card = page({ sheet_style: 'sheet' });
  await vi.waitFor(() => {
    expect(card.root.querySelector('.tile[data-tile=wind][data-detail]')).toBeTruthy();
  });
  tile(card, 'wind').click();
  await vi.waitFor(() => {
    expect(card.sheets.detail?.dialog.open).toBe(true);
  });
  document.body.append(document.createElement('div'));
  document.body.lastElementChild?.append(card);
  expect(card.sheets.detail?.dialog.open).toBe(false);
});

test('a hidden page lets go of its forecast subscriptions, and takes them up again', async () => {
  const stop = vi.fn(),
    hass = hassWith(),
    subscribe = vi.fn((callback: (message: unknown) => void, _message: ForecastSubscription) => {
      callback({ forecast: hourly() });
      return Promise.resolve(stop);
    }),
    hidden = vi.spyOn(document, 'hidden', 'get');
  hass.connection = { subscribeMessage: subscribe };
  hidden.mockReturnValue(false);
  const card = page({});
  card.hass = hass;
  await vi.waitFor(() => {
    expect(subscribe).toHaveBeenCalled();
  });
  const asked = subscribe.mock.calls.length;
  hidden.mockReturnValue(true);
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.waitFor(() => {
    expect(stop).toHaveBeenCalledTimes(asked);
  });
  hidden.mockReturnValue(false);
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.waitFor(() => {
    expect(subscribe).toHaveBeenCalledTimes(asked * 2);
  });
});

test('a hidden page releases rain textures and a still card acquires them on its next paint', async () => {
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false),
    { card, draws, releases } = await rainyCard(),
    before = releases(),
    drops = card.root.querySelector('canvas.drops');
  hidden.mockReturnValue(true);
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.waitFor(() => expect(releases()).toBe(before + 1));
  expect(card.root.querySelector('canvas.drops')).toBe(drops);
  const hiddenDraws = draws();
  card.paint();
  expect(draws()).toBe(hiddenDraws);
  hidden.mockReturnValue(false);
  document.dispatchEvent(new Event('visibilitychange'));
  expect(draws()).toBeGreaterThan(hiddenDraws);
  const returned = draws();
  card.paint();
  expect(draws()).toBeGreaterThan(returned);
  expect(card.animating).toBe(false);
  expect(card.root.querySelector('canvas.drops')).toBe(drops);
});

test('an offscreen rainy card releases its textures and acquires them on its next visible paint', async () => {
  // Deliver the real on-screen and offscreen entries together, as a quick move can.
  // The newest entry must win even when an earlier one says the card is still visible.
  const Observer = IntersectionObserver;
  let entered: IntersectionObserverEntry | undefined,
    batched = false;
  vi.stubGlobal(
    'IntersectionObserver',
    class extends Observer {
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        super((entries, observer) => {
          entered ??= entries.find(entry => entry.isIntersecting);
          const latest = entries.at(-1);
          if (entered && latest && !latest.isIntersecting) {
            batched = true;
            callback([entered, latest], observer);
          } else callback(entries, observer);
        }, options);
      }
    },
  );
  const { card, draws, releases } = await rainyCard(),
    before = releases(),
    drops = card.root.querySelector('canvas.drops');
  await vi.waitFor(() => expect(entered?.target).toBe(card));
  card.style.transform = 'translateY(10000px)';
  await vi.waitFor(() => {
    expect(batched).toBe(true);
    expect(card.visible).toBe(false);
    expect(releases()).toBe(before + 1);
  });
  expect(card.root.querySelector('canvas.drops')).toBe(drops);
  const offscreenDraws = draws();
  card.paint();
  expect(draws()).toBe(offscreenDraws);
  card.style.transform = '';
  await vi.waitFor(() => expect(card.visible).toBe(true));
  expect(draws()).toBeGreaterThan(offscreenDraws);
  const returned = draws();
  card.paint();
  expect(draws()).toBeGreaterThan(returned);
  expect(card.animating).toBe(false);
  expect(card.root.querySelector('canvas.drops')).toBe(drops);
});

test('a tile held as the page is suspended lets go, and opens nothing', async () => {
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false),
    card = page({});
  await vi.waitFor(() => {
    expect(card.root.querySelector('.tile[data-tile=wind][data-detail]')).toBeTruthy();
  });
  const held = tile(card, 'wind'),
    box = held.getBoundingClientRect();
  held.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      composed: true,
      isPrimary: true,
      pointerId: 7,
      clientX: box.x + 4,
      clientY: box.y + 4,
    }),
  );
  hidden.mockReturnValue(true);
  document.dispatchEvent(new Event('visibilitychange'));
  await new Promise(done => setTimeout(done, 1200));
  expect(card.sheets.detail?.dialog.open ?? false).toBe(false);
});

// Long enough for a tile let go to have sprung back, and short of the time a held one opens in.
const SPRUNG_BACK = 800;
// As long as a busy page may take to show a press.
const PRESS_SHOWN = { timeout: 5000 };
test('a finger that strays from a tile lets it go, where a mouse keeps holding it', async () => {
  const card = page({});
  await vi.waitFor(() => {
    expect(card.root.querySelector('.tile[data-tile=wind][data-detail]')).toBeTruthy();
  });
  const held = tile(card, 'wind'),
    box = held.getBoundingClientRect(),
    // Strayed off the tile altogether: held there, a mouse's press can't open it.
    off = box.width,
    scale = () => new DOMMatrix(getComputedStyle(held).transform).a,
    // The press's own animations on the tile: the script's, apart from any of the styles'.
    pressing = () =>
      held.getAnimations().filter(each => !(each instanceof CSSAnimation) && !(each instanceof CSSTransition)),
    send = (type: string, pointerType: string, across: number) =>
      (type === 'pointerdown' ? held : window).dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          composed: true,
          isPrimary: true,
          pointerId: 3,
          pointerType,
          clientX: box.x + 20 + across,
          clientY: box.y + 20,
        }),
      );
  for (const [pointerType, holds] of [
    ['mouse', true],
    ['touch', false],
  ] as const) {
    send('pointerdown', pointerType, 0);
    send('pointermove', pointerType, off);
    // A mouse's press shows however long a busy page takes to draw it, and is still held after.
    // Off the tile, a held mouse opens nothing however long it is held.
    if (holds)
      await vi.waitFor(() => {
        expect(scale()).toBeLessThan(1);
      }, PRESS_SHOWN);
    await new Promise(done => setTimeout(done, SPRUNG_BACK));
    expect(scale() < 1, pointerType).toBe(holds);
    send('pointerup', pointerType, off);
    // Sprung back and done with, so the next press starts from rest: not just at full size for a
    // moment on its way, as a busy page may hear of the spring's end later.
    await vi.waitFor(() => {
      expect(scale()).toBe(1);
      expect(pressing()).toEqual([]);
    }, PRESS_SHOWN);
  }
  expect(card.sheets.detail?.dialog.open ?? false).toBe(false);
});

test('a canvas handed back blank is drawn again', async () => {
  const card = page({}),
    paint = vi.spyOn(card, 'paint'),
    release = vi.spyOn(card.scene, 'release');
  card.parts.sky.dispatchEvent(new Event('contextrestored'));
  expect(release).toHaveBeenCalled();
  expect(paint).toHaveBeenCalled();
  await vi.waitFor(() => {
    expect(tile(card, 'moon').querySelector<HTMLCanvasElement>('.moon-disc')?.dataset['drawn']).toBeTruthy();
  });
  const moon = tile(card, 'moon').querySelector<HTMLCanvasElement>('.moon-disc');
  if (!moon) throw new Error('No moon.');
  const redraw = vi.spyOn(card, 'drawMoons');
  moon.dispatchEvent(new Event('contextrestored'));
  expect(redraw).toHaveBeenCalled();
});

test('a restored sky discards its old rain textures before repainting the same canvas', async () => {
  const { card, draws, releases } = await rainyCard(),
    before = releases(),
    painted = draws();
  card.parts.sky.dispatchEvent(new Event('contextrestored'));
  expect(releases()).toBe(before + 1);
  expect(draws()).toBeGreaterThan(painted);
  expect(card.root.querySelector('canvas.drops')).not.toBeNull();
});

test('rain reflects a completed sky while animating, and a fresh sky on first, resumed, resized and still frames', async () => {
  const { card } = await rainyCard(),
    sky = card.parts.sky,
    reflected: number[][] = [],
    paintGlass = card.glass.paint.bind(card.glass);
  let color = '#ff0000';
  vi.spyOn(card.scene, 'paint').mockImplementation((width, height, dpr = 1) => {
    sky.width = Math.round(width * Math.min(dpr, 2));
    sky.height = Math.round(height * Math.min(dpr, 2));
    const ctx = context2d(sky);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, sky.width, sky.height);
  });
  vi.spyOn(card.glass, 'paint').mockImplementation(phase => {
    reflected.push([...context2d(sky).getImageData(0, 0, 1, 1).data].slice(0, 3));
    paintGlass(phase);
  });
  card.animating = true;
  card.glass.clearDrops();
  sky.width = 0;
  card.paint(1000);
  color = '#0000ff';
  card.paint(1016);
  card.paint(1032);
  color = '#00ff00';
  card.paint(0);
  color = '#ff0000';
  sky.width = 1;
  card.paint(1050);
  color = '#0000ff';
  card.glass.release();
  card.paint(1066);
  expect(reflected).toEqual([
    [255, 0, 0],
    [255, 0, 0],
    [0, 0, 255],
    [0, 255, 0],
    [255, 0, 0],
    [0, 0, 255],
  ]);
});

test('a part that fails to draw leaves the rest, and reaches the page as an uncaught error', async () => {
  const card = page({});
  await vi.waitFor(() => {
    expect(tile(card, 'wind')).toBeTruthy();
  });
  const caught: unknown[] = [];
  const listen = (event: ErrorEvent) => {
    caught.push(event.error);
    event.preventDefault();
  };
  window.addEventListener('error', listen);
  vi.spyOn(card.forecastPanel, 'drawHours').mockImplementation(() => {
    throw new Error('planted');
  });
  const hass = hassWith(),
    state = hass.states['weather.home'];
  if (!state) throw new Error('No entity.');
  const warmer = { ...state, attributes: { ...state.attributes, temperature: 71 } };
  expect(() => {
    card.hass = { ...hass, states: { ...hass.states, 'weather.home': warmer } };
  }).not.toThrow();
  await vi.waitFor(() => {
    expect(caught).toHaveLength(1);
  });
  expect(String(caught[0])).toMatch(/planted/u);
  // Once, however often the card draws again.
  card.render();
  card.render();
  await new Promise(done => setTimeout(done));
  expect(caught).toHaveLength(1);
  expect(card.parts.weather.textContent).toMatch(/71°/u);
  window.removeEventListener('error', listen);
  card.remove();
});

test('a card off the page draws nothing until it is back', async () => {
  const card = page({});
  await vi.waitFor(() => {
    expect(tile(card, 'wind')).toBeTruthy();
  });
  card.remove();
  const render = vi.spyOn(card, 'render');
  const hass = hassWith(),
    state = hass.states['weather.home'];
  if (!state) throw new Error('No entity.');
  card.hass = {
    ...hass,
    states: { ...hass.states, 'weather.home': { ...state, attributes: { ...state.attributes, temperature: 72 } } },
  };
  expect(render).not.toHaveBeenCalled();
  document.body.append(card);
  expect(render).toHaveBeenCalled();
  expect(card.parts.weather.textContent).toMatch(/72°/u);
  card.remove();
});

test('times follow the zone the user’s profile picks, unless the card sets its own', () => {
  const card = page({}),
    hass = hassWith(),
    device = Intl.DateTimeFormat().resolvedOptions().timeZone;
  card.hass = { ...hass, locale: { ...hass.locale, time_zone: 'server' } };
  expect(card.timeZone).toBe('America/Chicago');
  card.hass = { ...hass, locale: { ...hass.locale, time_zone: 'local' } };
  expect(card.timeZone).toBe(device);
  card.setConfig({ type: 'custom:iweather-card', entity: 'weather.home', time_zone: 'Asia/Tokyo' });
  expect(card.timeZone).toBe('Asia/Tokyo');
  card.remove();
});

test('a new dashboard can start as the weather alone, on the first weather entity or the one named', async () => {
  const entry = window.customStrategies?.find(strategy => strategy.type === 'iweather');
  expect(entry?.strategyType).toBe('dashboard');
  expect(entry?.description).toMatch(/Forecast/u);
  const element = customElements.get('ll-strategy-dashboard-iweather');
  if (!element) throw new Error('No strategy.');
  const { WeatherDashboardStrategy } = await import('../src/card/strategy.ts');
  expect(element).toBe(WeatherDashboardStrategy);
  const hass = hassWith();
  expect(WeatherDashboardStrategy.getCreateSuggestions(hass)).toEqual({
    title: 'Weather',
    icon: 'mdi:weather-partly-cloudy',
  });
  const card = (config: object) => WeatherDashboardStrategy.generate(config, hass).views[0]?.cards[0];
  expect(card({})).toEqual({ type: 'custom:iweather-card', entity: 'weather.home', weather_layout: 'page' });
  expect(card({ entity: 'weather.elsewhere' })?.entity).toBe('weather.elsewhere');
  expect(WeatherDashboardStrategy.generate({}, hass).views[0]?.type).toBe('panel');
});

test('a card taken off the page layout keeps none of its tiles, whatever redrew it on the way', async () => {
  // With no air quality sensor, the page asks Open-Meteo for the air; leaving the page drops that
  // and redraws before the new layout is drawn.
  const card = page({});
  await vi.waitFor(() => {
    expect(card.records.airSupply).toBeDefined();
    expect(card.root.querySelectorAll('.tiles > .tile').length).toBeGreaterThan(0);
  });
  for (const layout of ['expanded', 'auto', 'compact', 'strip']) {
    card.setConfig({ type: 'custom:iweather-card', entity: 'weather.home', weather_layout: 'page' });
    await vi.waitFor(() => {
      expect(card.records.airSupply).toBeDefined();
      expect(card.root.querySelectorAll('.tiles > .tile').length).toBeGreaterThan(0);
    });
    card.setConfig({ type: 'custom:iweather-card', entity: 'weather.home', weather_layout: layout });
    expect(card.root.querySelectorAll('.tiles > *').length, layout).toBe(0);
  }
});
