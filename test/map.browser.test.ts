import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import '../src/iweather-card.ts';
import type { ForecastSubscription, HomeAssistant } from '../src/card/home-assistant.ts';
import type { IWeatherCard } from '../src/iweather-card.ts';
import type * as MapGl from '../src/map/gl.ts';
import { type GroundStill, groundStill } from '../src/map/gl.ts';
import { openingZoom } from '../src/map/sources.ts';
import { bloscStored, bucketListing, hrrrSizes } from './forecast-files.ts';

// The small map on the full layout, over a RainViewer that answers from here and with MapLibre
// left out: radar observations play between pictures of its ground and names. With playback
// switched off, a later frame comes in over the latest once its tiles have.
vi.mock('../src/map/gl.ts', async original => ({
  ...(await original<typeof MapGl>()),
  groundStill: vi.fn(),
}));
const MINUTE = 60_000,
  STEP = 10 * MINUTE,
  PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==',
  STILL: GroundStill = { ground: `${PIXEL}#ground`, names: `${PIXEL}#names` };
const DARK = { themes: { darkMode: true } },
  LIGHT = { themes: { darkMode: false } };
const hassWith = (
  state: string,
  sun: string,
  theme: Partial<HomeAssistant> = {},
  more: Record<string, number> = {},
): HomeAssistant => ({
  ...theme,
  states: {
    'weather.home': {
      entity_id: 'weather.home',
      state,
      attributes: {
        temperature: 68,
        temperature_unit: '°F',
        wind_speed_unit: 'mph',
        precipitation_unit: 'in',
        friendly_name: 'Chicago',
        supported_features: 3,
        ...more,
      },
    },
    'sun.sun': { entity_id: 'sun.sun', state: sun, attributes: { elevation: 40, rising: true } },
  },
  locale: { language: 'en', time_format: '12' },
  config: { location_name: 'Home', time_zone: 'America/Chicago', latitude: 41.9, longitude: -87.6 },
  connection: {
    subscribeMessage(callback: (message: unknown) => void, _message: ForecastSubscription) {
      queueMicrotask(() => {
        callback({ forecast: [] });
      });
      return Promise.resolve(() => undefined);
    },
  },
});

// Frames ten minutes apart, the last of them `latest` steps on from the last whole ten minutes; a
// radar tile answers once `tiles` does, with none to draw.
let latest = 0,
  frameEpoch: number | undefined,
  tiles: Promise<unknown> = Promise.resolve(),
  // Open-Meteo answers with precipitation falling this quarter hour, so the outlook is now.
  raining = false;
const fallingNow = () => {
  const hour = Math.floor(Date.now() / 3_600_000) * 3600,
    quarter = Math.floor(Date.now() / 900_000) * 900;
  return {
    hourly: {
      time: Array.from({ length: 48 }, (_, i) => hour + i * 3600),
      precipitation: Array.from({ length: 48 }, () => 1),
    },
    daily: { time: [hour, hour + 86_400] },
    minutely_15: {
      time: Array.from({ length: 12 }, (_, i) => quarter + (i + 1) * 900),
      precipitation: Array.from({ length: 12 }, () => 0.5),
    },
  };
};
const asked = vi.fn();
const lastFrame = () => {
  frameEpoch ??= Math.floor(Date.now() / STEP) * STEP - STEP;
  return frameEpoch + latest * STEP;
};
async function answer(url: string) {
  if (raining && url.includes('api.open-meteo.com/v1/forecast')) return new Response(JSON.stringify(fallingNow()));
  if (url.includes('radar.invalid')) await tiles;
  // Where the radar reaches is asked apart from its frames (see covering).
  if (!url.includes('rainviewer') || url.includes('/v2/coverage/')) return new Response('{}', { status: 404 });
  asked();
  const last = lastFrame();
  return new Response(
    JSON.stringify({
      host: 'https://radar.invalid',
      radar: {
        past: [2, 1, 0].map(back => ({ time: (last - back * STEP) / 1000, path: `/frame/${last - back * STEP}` })),
      },
    }),
  );
}
const newest = () => `/frame/${lastFrame()}/`;
const layers = (card: IWeatherCard) => [...card.root.querySelectorAll<HTMLElement>('.radar-layer.frame')];
const stills = (card: IWeatherCard) => [...card.root.querySelectorAll<HTMLImageElement>('.map-still')];
const pause = (ms: number) => new Promise(done => setTimeout(done, ms));

function placed(hass: HomeAssistant, config: object) {
  const card = document.createElement('iweather-card');
  card.setConfig({
    type: 'custom:iweather-card',
    entity: 'weather.home',
    weather_layout: 'page',
    map: 'rainviewer',
    map_precipitation_animation: false,
    ...config,
  });
  card.hass = hass;
  document.body.replaceChildren(card);
  return card;
}
async function mapped(state = 'cloudy', hass = hassWith(state, 'above_horizon'), config: object = {}) {
  const card = placed(hass, config);
  await vi.waitFor(() => {
    expect(layers(card)).toHaveLength(1);
  });
  return card;
}

beforeEach(() => {
  latest = 0;
  raining = false;
  // An answer kept from another test would decide this one's outlook.
  localStorage.removeItem('iweather-supplement-v1');
  // Capture on first use, after a test can set its clock. Then advance through
  // `latest`, not when the real clock crosses ten minutes while waiting for tiles.
  frameEpoch = undefined;
  tiles = Promise.resolve();
  asked.mockClear();
  vi.mocked(groundStill).mockReset().mockResolvedValue(null);
  vi.stubGlobal('fetch', vi.fn(answer));
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

test('with precipitation animation off the small map holds the latest radar frame still, with no time on it', async () => {
  const card = await mapped(),
    [layer] = layers(card);
  expect(layer?.dataset['tiles']).toContain(newest());
  expect(layer?.hasAttribute('data-on')).toBe(true);
  expect(card.root.querySelector('.radar-time')).toBeNull();
  // It takes up the map: the card's own .frame rule would give a canvas no box.
  expect(layer && getComputedStyle(layer).display).toBe('block');
  // Longer than a few steps of any loop.
  await pause(1500);
  expect(layers(card)).toEqual([layer]);
  expect(layer?.hasAttribute('data-on')).toBe(true);
});

test('precipitation plays on the card from now into the forecast, never before now, and rests on now', async () => {
  const pixel = new Blob([Uint8Array.from(atob(PIXEL.split(',')[1] ?? ''), char => char.charCodeAt(0))], {
    type: 'image/gif',
  });
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => (url.includes('radar.invalid') ? Promise.resolve(new Response(pixel)) : answer(url))),
  );
  const config = {
    type: 'custom:iweather-card',
    entity: 'weather.home',
    weather_layout: 'page',
    map: 'rainviewer',
  };
  const card = placed(hassWith('cloudy', 'above_horizon'), config);
  // Removing the fixture's override exercises the saved configuration's default.
  card.setConfig(config);
  const hours = () => card.root.querySelectorAll('.map-hour').length,
    when = () => card.root.querySelector('.map-when')?.textContent ?? '';
  // Three frames are observed, but only the one now is shown: the loop never goes back before it.
  await vi.waitFor(() => expect(layers(card)).toHaveLength(1));
  expect(when()).toBe('Now');
  expect(card.maps.largeView()).toBeNull();
  // The forecast's precipitation for the next 18 hours, over the whole map.
  const now = Date.now(),
    field = { north: 85, west: -180, step: 2, rows: 86, cols: 181, values: new Float32Array(86 * 181).fill(2) },
    slots = Array.from({ length: 18 }, (_, i) => now + (i + 1) * 3_600_000);
  card.maps.winds = [
    {
      source: 'rain',
      at: now,
      bounds: { north: 85, south: -85, west: -180, east: 180 },
      step: 2,
      hours: { times: slots, fields: [], precipitation: slots.map(() => field), slot: 3_600_000 },
    },
  ];
  card.maps.draw();
  await vi.waitFor(() => expect(hours()).toBe(12));
  expect(layers(card)).toHaveLength(1);
  await vi.waitFor(() => expect(when()).toBe('In 1 hour'), { timeout: 5000 });
  expect(card.maps.timelineTime).toBeUndefined();

  card.setConfig({ ...config, map_precipitation_animation: false });
  await vi.waitFor(() => expect(hours()).toBe(0));
  expect(layers(card)).toHaveLength(1);
  expect(when()).toBe('');

  card.setConfig(config);
  await vi.waitFor(() => expect(hours()).toBe(12));
  card.visible = false;
  card.maps.draw();
  expect(when()).toBe('Now');
  await pause(1500);
  expect(when()).toBe('Now');
  card.visible = true;
  card.maps.draw();
  await vi.waitFor(() => expect(when()).toBe('In 1 hour'), { timeout: 5000 });
});

test('while rain is falling the card plays its latest radar on fifty minutes at the rain’s drift, and no forecast hours', async () => {
  const pixel = new Blob([Uint8Array.from(atob(PIXEL.split(',')[1] ?? ''), char => char.charCodeAt(0))], {
    type: 'image/gif',
  });
  const fetched = vi.fn((url: string) =>
    url.includes('radar.invalid') ? Promise.resolve(new Response(pixel)) : answer(url),
  );
  vi.stubGlobal('fetch', fetched);
  const config = { type: 'custom:iweather-card', entity: 'weather.home', weather_layout: 'page', map: 'rainviewer' };
  raining = true;
  const card = placed(hassWith('rainy', 'above_horizon'), config);
  card.setConfig(config);
  await vi.waitFor(() => expect(card.update?.ctx.rainOutlook).toBe('now'));
  card.maps.draw();
  // The latest frame and those after it, ten minutes apart, to fifty minutes past now: the stand-in's
  // latest frame is up to twenty minutes old, so as many as eight.
  await vi.waitFor(() => expect(layers(card).length).toBeGreaterThanOrEqual(6));
  expect(layers(card).length).toBeLessThanOrEqual(8);
  expect(card.root.querySelectorAll('.map-hour')).toHaveLength(0);
  expect(card.root.querySelector('.map-when')?.textContent).toBe('Now');
  expect(card.maps.winds.some(grid => grid.source === 'rain')).toBe(false);
  expect(fetched.mock.calls.some(([url]) => url.includes('mesonet'))).toBe(false);
});

test('the small map looks as far out as the weather calls for', async () => {
  const dry = await mapped(),
    view = dry.root.querySelector<HTMLElement>('.radar');
  // The page is drawn at 125%, so a zoom takes in as much here as it would on screen at 100%.
  expect(view && dry.maps.centreOf(view).zoom).toBeCloseTo(4 + Math.log2(1.25));
  // Precipitation falling now, by the minute forecast, brings it close in.
  raining = true;
  const wet = await mapped('rainy'),
    close = wet.root.querySelector<HTMLElement>('.radar');
  await vi.waitFor(() => expect(wet.update?.ctx.rainOutlook).toBe('now'));
  expect(close && wet.maps.centreOf(close).zoom).toBeCloseTo(8.5 + Math.log2(1.25));
});

test('the map’s layers blend among themselves, which leaves its tile’s glass alone', async () => {
  const card = await mapped(),
    view = card.root.querySelector<HTMLElement>('.radar');
  expect(view && getComputedStyle(view).isolation).toBe('isolate');
});

test('a later frame comes in over the last only once its tiles have', async () => {
  const card = await mapped(),
    [last] = layers(card),
    ground = card.root.querySelector('.radar-layer.base img');
  let loaded = () => {};
  tiles = new Promise<void>(done => {
    loaded = done;
  });
  latest = 1;
  await card.maps.loadRadar(Date.now() + 6 * MINUTE);
  const coming = layers(card).at(-1);
  expect(layers(card)).toHaveLength(2);
  expect(coming?.dataset['tiles']).toContain(newest());
  expect(last?.hasAttribute('data-on')).toBe(true);
  expect(coming?.hasAttribute('data-on')).toBe(false);
  // The map under it stays as it is.
  expect(card.root.querySelector('.radar-layer.base img')).toBe(ground);
  loaded();
  await vi.waitFor(() => {
    expect(coming?.hasAttribute('data-on')).toBe(true);
  });
  expect(last?.hasAttribute('data-on')).toBe(false);
  await vi.waitFor(() => {
    expect(layers(card)).toEqual([coming]);
  });
});

test('a later frame still comes in when its tiles never do', async () => {
  const card = await mapped();
  tiles = new Promise(() => {});
  latest = 1;
  await card.maps.loadRadar(Date.now() + 6 * MINUTE);
  await vi.waitFor(
    () => {
      expect(layers(card)).toHaveLength(1);
      expect(layers(card)[0]?.dataset['tiles']).toContain(newest());
    },
    { timeout: 3000 },
  );
});

test('the radar is asked for every five minutes, and not out of sight', async () => {
  const card = await mapped();
  asked.mockClear();
  await card.maps.loadRadar(Date.now() + 4 * MINUTE);
  expect(asked).not.toHaveBeenCalled();
  card.visible = false;
  await card.maps.loadRadar(Date.now() + 6 * MINUTE);
  expect(asked).not.toHaveBeenCalled();
  card.visible = true;
  await card.maps.loadRadar(Date.now() + 6 * MINUTE);
  expect(asked).toHaveBeenCalledOnce();
});

test('the radar timeline labels the selected frame generation time, not the current clock', async () => {
  const now = Date.UTC(2026, 9, 27, 17, 37),
    clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  try {
    const card = await mapped('cloudy', hassWith('cloudy', 'above_horizon'), {
      weather_animation: false,
      map_tile_url: 'https://tiles.invalid/{z}/{x}/{y}.png',
    });
    card.root.querySelector<HTMLElement>('.tile[data-tile=map]')?.click();
    const label = () => card.maps.largeView()?.querySelector('.wind-when span')?.textContent,
      format = new Intl.DateTimeFormat('en', {
        weekday: 'long',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/Chicago',
        hour12: true,
      });
    await vi.waitFor(() => {
      expect(label()).toBe(format.format(lastFrame()));
    });
    expect(label()).not.toBe(format.format(now));
    card.maps.timelineTime = lastFrame() - STEP + STEP / 4;
    card.maps.syncWindTime();
    expect(label()).toBe(format.format(lastFrame() - STEP));
  } finally {
    clock.mockRestore();
  }
});

test('the ground is a picture, with the radar between it and the names', async () => {
  vi.mocked(groundStill).mockResolvedValue(STILL);
  const card = await mapped();
  await vi.waitFor(() => {
    expect(stills(card)).toHaveLength(2);
  });
  const [ground, names] = stills(card),
    [frame] = layers(card);
  expect(ground?.getAttribute('src')).toBe(STILL.ground);
  expect(names?.getAttribute('src')).toBe(STILL.names);
  expect(card.root.querySelector('.radar-layer.osm')).toBeNull();
  expect(card.root.querySelector('.radar-credit')?.textContent).toContain('OpenFreeMap');
  const order = (a: Node | undefined, b: Node | undefined) => (a && b ? a.compareDocumentPosition(b) : 0);
  expect(order(ground, frame) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(order(frame, names) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // A frame fades in over it, leaving the pictures be, and asks nothing of the map renderer.
  vi.mocked(groundStill).mockClear();
  latest = 1;
  await card.maps.loadRadar(Date.now() + 6 * MINUTE);
  await vi.waitFor(() => {
    expect(layers(card)[0]?.dataset['tiles']).toContain(newest());
    expect(layers(card)).toHaveLength(1);
  });
  expect(stills(card)[0]).toBe(ground);
  expect(groundStill).not.toHaveBeenCalled();
});

test('a new ground leaves the last in place until it comes', async () => {
  vi.mocked(groundStill).mockResolvedValue(STILL);
  const card = await mapped();
  await vi.waitFor(() => {
    expect(stills(card)).toHaveLength(2);
  });
  const looks = vi.mocked(groundStill).mock.calls.map(call => call[2]);
  expect(looks.at(-1)).toBe('pale');
  let drawn = (_still: GroundStill) => {};
  vi.mocked(groundStill).mockReturnValue(
    new Promise(done => {
      drawn = done;
    }),
  );
  // On a dark theme, the dark picture.
  card.hass = hassWith('cloudy', 'above_horizon', DARK);
  await vi.waitFor(() => {
    expect(vi.mocked(groundStill).mock.calls.at(-1)?.[2]).toBe('night');
  });
  expect(stills(card)[0]?.getAttribute('src')).toBe(STILL.ground);
  // It stays through the tiles being replaced, as they are when one of them changes.
  card.render();
  expect(stills(card)[0]?.getAttribute('src')).toBe(STILL.ground);
  drawn({ ground: `${PIXEL}#night-ground`, names: `${PIXEL}#night-names` });
  await vi.waitFor(() => {
    expect(stills(card)[0]?.getAttribute('src')).toBe(`${PIXEL}#night-ground`);
  });
  expect(card.root.querySelector('.radar')?.hasAttribute('data-night')).toBe(true);
});

const lastLook = () => vi.mocked(groundStill).mock.calls.at(-1)?.[2];
const view = (card: IWeatherCard) => card.root.querySelector<HTMLElement>('.radar');

test('the ground follows the theme and not the sky', async () => {
  vi.mocked(groundStill).mockResolvedValue(STILL);
  // A dark theme on a bright afternoon.
  const noon = await mapped('sunny', hassWith('sunny', 'above_horizon', DARK));
  await vi.waitFor(() => {
    expect(lastLook()).toBe('night');
  });
  expect(view(noon)?.hasAttribute('data-night')).toBe(true);
  expect(layers(noon)[0]?.dataset['tiles']).toMatch(/^night\|/);
  vi.mocked(groundStill).mockClear();
  // A light theme after dark.
  const midnight = await mapped('cloudy', hassWith('cloudy', 'below_horizon', LIGHT));
  await vi.waitFor(() => {
    expect(lastLook()).toBe('pale');
  });
  expect(view(midnight)?.hasAttribute('data-night')).toBe(false);
  expect(layers(midnight)[0]?.dataset['tiles']).toMatch(/^pale\|/);
});

test('a remote map pin follows its own sun, including when it rises while the map stays open', async () => {
  const night = Date.UTC(2026, 9, 27, 17, 30),
    clock = vi.spyOn(Date, 'now').mockReturnValue(night);
  try {
    const card = await mapped(
      'sunny',
      hassWith('sunny', 'above_horizon', LIGHT, { latitude: 35.68, longitude: 139.69 }),
      { weather_animation: false, map_tile_url: 'https://tiles.invalid/{z}/{x}/{y}.png' },
    );
    card.root.querySelector<HTMLElement>('.tile[data-tile=map]')?.click();
    const pin = () => card.maps.largeView()?.querySelector('.map-badge[data-kind=precipitation]');
    await vi.waitFor(() => {
      expect(pin()?.hasAttribute('data-night')).toBe(true);
    });
    const moon = pin()?.querySelector('.map-sky')?.innerHTML;
    expect(card.update?.night).toBe(true);
    clock.mockReturnValue(night + 12 * 60 * MINUTE);
    card.render();
    await vi.waitFor(() => {
      expect(pin()?.hasAttribute('data-night')).toBe(false);
    });
    expect(card.update?.night).toBe(false);
    expect(pin()?.querySelector('.map-sky')?.innerHTML).not.toBe(moon);
  } finally {
    clock.mockRestore();
  }
});

test('a theme changing alone draws the map again, with no other state changing', async () => {
  vi.mocked(groundStill).mockResolvedValue(STILL);
  const light = hassWith('cloudy', 'above_horizon', LIGHT),
    card = await mapped('cloudy', light);
  await vi.waitFor(() => {
    expect(stills(card)).toHaveLength(2);
  });
  vi.mocked(groundStill).mockClear();
  card.hass = { ...light, themes: { darkMode: true } };
  await vi.waitFor(() => {
    expect(view(card)?.hasAttribute('data-night')).toBe(true);
  });
  await vi.waitFor(() => {
    expect(lastLook()).toBe('night');
  });
});

test('with no word from Home Assistant, the map follows the screen, and stops listening once gone', async () => {
  const real = window.matchMedia.bind(window),
    listeners = new Set<EventListenerOrEventListenerObject>(),
    scheme = Object.assign(new EventTarget(), { media: '(prefers-color-scheme: dark)', matches: false });
  vi.spyOn(scheme, 'addEventListener').mockImplementation((_, listener) => {
    if (listener) listeners.add(listener);
  });
  vi.spyOn(scheme, 'removeEventListener').mockImplementation((_, listener) => {
    if (listener) listeners.delete(listener);
  });
  vi.stubGlobal('matchMedia', (query: string) => (query === scheme.media ? scheme : real(query)));
  vi.mocked(groundStill).mockResolvedValue(STILL);
  const card = await mapped();
  await vi.waitFor(() => {
    expect(lastLook()).toBe('pale');
  });
  expect(listeners.size).toBe(1);
  scheme.matches = true;
  for (const listener of listeners) if (typeof listener === 'function') listener(new Event('change'));
  await vi.waitFor(() => {
    expect(view(card)?.hasAttribute('data-night')).toBe(true);
    expect(lastLook()).toBe('night');
  });
  card.remove();
  expect(listeners.size).toBe(0);
});

test('the wind keeps its own ground on either theme, its pin following the theme', async () => {
  vi.mocked(groundStill).mockResolvedValue(STILL);
  const dark = hassWith('cloudy', 'above_horizon', DARK, { wind_speed: 10 }),
    card = placed(dark, { weather_mode: 'wind' });
  // The small map's pin: its fill and its reading's colour.
  const pin = () => {
    const each = card.root.querySelector('.radar:not(.large) .map-badge[data-kind=wind]');
    if (!(each instanceof HTMLElement)) throw new Error('No wind pin');
    const { backgroundColor, color } = getComputedStyle(each);
    return { backgroundColor, color };
  };
  await vi.waitFor(() => {
    expect(lastLook()).toBe('wind');
  });
  expect(view(card)?.hasAttribute('data-night')).toBe(false);
  // Blue in white on a dark theme, black on white on a light one.
  expect(pin()).toEqual({ backgroundColor: 'rgb(0, 120, 189)', color: 'rgb(255, 255, 255)' });
  card.hass = { ...dark, ...LIGHT };
  await vi.waitFor(() => {
    expect(pin()).toEqual({ backgroundColor: 'rgb(255, 255, 255)', color: 'rgb(0, 0, 0)' });
  });
  expect(lastLook()).toBe('wind');
});

test('the pin is a disc in the sky’s colour, named my location at home', async () => {
  const card = await mapped(),
    pin = card.root.querySelector<HTMLElement>('.radar .map-badge'),
    name = card.root.querySelector<HTMLElement>('.radar .map-home');
  card.parts.weather.style.setProperty('--sky-1', 'rgb(1, 2, 3)');
  expect(name?.textContent).toBe('My Location');
  expect(pin && getComputedStyle(pin).backgroundColor).toBe('rgb(1, 2, 3)');
  expect(pin && getComputedStyle(pin).borderRadius).toBe('50%');
  expect(pin && [getComputedStyle(pin).width, getComputedStyle(pin).height]).toEqual(['32.5px', '32.5px']);
  expect(pin && getComputedStyle(pin).boxShadow).toContain('1.25px');
  expect(pin && getComputedStyle(pin).fontSize).toBe('21.25px');
  expect(pin && getComputedStyle(pin).fontWeight).toBe('700');
  expect(name && [getComputedStyle(name).fontSize, getComputedStyle(name).fontWeight]).toEqual(['12.5px', '400']);
});

test('away from home the pin takes the place set, and with none set it goes unnamed', async () => {
  const hass = hassWith('cloudy', 'above_horizon'),
    entity = hass.states['weather.home'];
  if (!entity) throw new Error('No entity.');
  entity.attributes = { ...entity.attributes, latitude: 35.68, longitude: 139.69 };
  const card = await mapped('cloudy', hass, { place_name: 'Tokyo' });
  expect(card.root.querySelector('.radar .map-home')?.textContent).toBe('Tokyo');
  expect(card.root.querySelector('.home')?.hasAttribute('hidden')).toBe(true);
  const unset = await mapped('cloudy', hass);
  expect(unset.root.querySelector('.radar .map-badge')).not.toBeNull();
  expect(unset.root.querySelector('.radar .map-home')).toBeNull();
});

test('a zone set moves the map there and names its pin, and the map follows the zone when it moves', async () => {
  vi.mocked(groundStill).mockResolvedValue(STILL);
  const hass = hassWith('cloudy', 'above_horizon'),
    zone = (friendly_name: string, latitude: number, longitude: number) => ({
      entity_id: 'zone.away',
      state: '0',
      attributes: { friendly_name, latitude, longitude },
    }),
    paris: HomeAssistant = { ...hass, states: { ...hass.states, 'zone.away': zone('Paris', 48.857, 2.352) } },
    card = await mapped('cloudy', paris, { zone: 'zone.away' }),
    pin = () => card.root.querySelector('.radar .map-home')?.textContent,
    centre = () => vi.mocked(groundStill).mock.calls.at(-1)?.[1];
  await vi.waitFor(() => {
    expect([pin(), centre()?.latitude, centre()?.longitude]).toEqual(['Paris', 48.857, 2.352]);
  });
  card.hass = { ...paris, states: { ...paris.states, 'zone.away': zone('Tokyo', 35.68, 139.69) } };
  await vi.waitFor(() => {
    expect([pin(), centre()?.latitude, centre()?.longitude]).toEqual(['Tokyo', 35.68, 139.69]);
  });
});

test('without a picture, the map falls back on tiles of the ground', async () => {
  const card = await mapped();
  await vi.waitFor(() => {
    expect(card.root.querySelector('.radar-layer.osm img')).not.toBeNull();
  });
  expect(stills(card)).toHaveLength(0);
  expect(card.root.querySelector('.radar-credit')?.textContent).toContain('OpenStreetMap');
});
test('those tiles take the theme’s look, and tiles of the user’s own are left as they come', async () => {
  const ground = (card: IWeatherCard) => card.root.querySelector<HTMLElement>('.radar-layer.base img'),
    look = async (card: IWeatherCard) => {
      await vi.waitFor(() => {
        expect(ground(card)).not.toBeNull();
      });
      const tile = ground(card);
      return tile && getComputedStyle(tile).filter;
    };
  const noon = await mapped('sunny', hassWith('sunny', 'above_horizon', DARK));
  expect(await look(noon)).toMatch(/^grayscale\(1\) invert\(1\)/);
  const midnight = await mapped('cloudy', hassWith('cloudy', 'below_horizon', LIGHT));
  expect(await look(midnight)).not.toContain('invert');
  const own = await mapped('sunny', hassWith('sunny', 'above_horizon', DARK), {
    map_tile_url: 'https://tiles.invalid/{z}/{x}/{y}.png',
  });
  expect(await look(own)).toBe('none');
  expect(ground(own)?.getAttribute('src')).toContain('https://tiles.invalid/');
  expect(own.root.querySelector('.radar-credit')?.textContent).not.toContain('OpenStreetMap');
});

test('the map stays as it is while another tile changes and the forecast switches to the same map', async () => {
  // Dry and gusting past 15 mph: conditions turn the map to the wind, as the wind's own view does.
  const gusty = hassWith('partlycloudy', 'above_horizon', LIGHT, {
      wind_speed: 12,
      wind_gust_speed: 25,
      wind_bearing: 200,
    }),
    card = placed(gusty, {});
  const streaks = () => card.root.querySelector('.radar:not(.large) canvas.wind-streaks');
  await vi.waitFor(() => {
    expect(streaks()).not.toBeNull();
  });
  const map = card.root.querySelector('.tile[data-tile=map]'),
    drawn = streaks(),
    others = new Set(card.root.querySelectorAll('.tile:not([data-tile=map])'));
  // Warmer, so some other tile has something new to show.
  card.hass = {
    ...gusty,
    states: {
      ...gusty.states,
      'weather.home': {
        ...gusty.states['weather.home'],
        entity_id: 'weather.home',
        state: 'partlycloudy',
        attributes: { ...gusty.states['weather.home']?.attributes, temperature: 91 },
      },
    },
  };
  card.mode = 'wind';
  card.render();
  expect(card.root.querySelector<HTMLElement>('.radar:not(.large)')?.dataset['kind']).toBe('wind');
  expect([...card.root.querySelectorAll('.tile:not([data-tile=map])')].some(tile => !others.has(tile))).toBe(true);
  expect(card.root.querySelector('.tile[data-tile=map]')).toBe(map);
  expect(streaks()).toBe(drawn);
});

test('without the live map, the 12-hour forecast blends between hours before it takes its colours', async () => {
  // Chicago's hours from HRRR's tiles: an hour dry, the next at 2 mm, round and round, by the hour
  // each ends, every hour of the run in each tile.
  const HOUR = 60 * MINUTE,
    rain = vi.fn(),
    wet = (end: number) => (end / HOUR) % 2 === 1;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (!url.includes('hrrrzarr')) return answer(url);
      rain(url);
      if (url.includes('list-type=2'))
        return Promise.resolve(
          new Response(bucketListing(new URL(url).searchParams.get('prefix') ?? '', hrrrSizes(1000))),
        );
      if (url.endsWith('.zarray'))
        return Promise.resolve(new Response(JSON.stringify({ shape: [18, 1059, 1799], chunks: [18, 150, 150] })));
      const [, day = '', cycle = ''] = /sfc\/(\d{8})\/\d{8}_(\d{2})z_fcst/.exec(url) ?? [],
        run = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6)), Number(cycle));
      return Promise.resolve(
        new Response(
          bloscStored(
            Array.from({ length: 18 * 22_500 }, (_, i) => (wet(run + (Math.floor(i / 22_500) + 1) * HOUR) ? 2 : 0)),
          ),
        ),
      );
    }),
  );
  raining = true;
  const card = await mapped('rainy', hassWith('rainy', 'above_horizon'), {
    map_tile_url: 'https://tiles.invalid/{z}/{x}/{y}.png',
  });
  await vi.waitFor(() => expect(card.update?.ctx.rainOutlook).toBe('now'));
  card.root.querySelector<HTMLElement>('.tile[data-tile=map]')?.click();
  await vi.waitFor(() => {
    expect(card.maps.largeView()).not.toBeNull();
  });
  card.maps.chooseSpan('12h');
  await vi.waitFor(() => {
    expect(card.maps.largeView()?.querySelector('.map-field')).not.toBeNull();
  });
  // The tiles under the view, each once, every hour in each.
  await vi.waitFor(() => {
    expect(card.maps.winds.findLast(grid => grid.source === 'rain')?.hours?.times.length).toBe(18);
  });
  const tiles = rain.mock.calls.map(([url]) => String(url)).filter(url => /\/0\.\d+\.\d+$/.test(url));
  expect(new Set(tiles).size).toBe(tiles.length);
  const shown = (time: number) => {
    card.maps.timelineTime = time;
    card.maps.syncWindTime();
    const canvas = card.maps.largeView()?.querySelector<HTMLCanvasElement>('.map-pan:not(.map-old) .map-field'),
      context = canvas?.getContext('2d');
    if (!canvas || !context) throw new Error('No field.');
    return [...context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data];
  };
  // An hour ending dry: its middle, then its end, halfway to the wet hour's middle.
  const dryEnd = Math.floor(Date.now() / HOUR) * HOUR + (wet(Math.floor(Date.now() / HOUR) * HOUR) ? HOUR : 0),
    dry = shown(dryEnd - HOUR / 2),
    halfway = shown(dryEnd),
    wetMiddle = shown(dryEnd + HOUR / 2);
  expect(dry[3]).toBe(0);
  expect(wetMiddle[3]).toBe(255);
  // Light rain (1 mm an hour) is full blue-violet; half of 2 mm's colour would be half seen.
  expect(halfway[3]).toBe(255);
  expect(halfway).not.toEqual(wetMiddle);
});

// A coverage tile all one way: black where the radar has nothing, see-through where it reaches.
const coverageTile = (reaches: boolean) => {
  const canvas = new OffscreenCanvas(512, 512),
    context = canvas.getContext('2d');
  if (!context) throw new Error('No canvas.');
  if (!reaches) context.fillRect(0, 0, 512, 512);
  return canvas.convertToBlob({ type: 'image/png' });
};
const covering = (reaches: boolean) =>
  vi.fn(async (url: string) =>
    url.includes('tilecache.rainviewer.com/v2/coverage/') ? new Response(await coverageTile(reaches)) : answer(url),
  );
const openedAt = async (latitude: number, longitude: number, reaches: boolean) => {
  vi.stubGlobal('fetch', covering(reaches));
  const hass = hassWith('rainy', 'above_horizon');
  hass.config = { ...hass.config, latitude, longitude };
  const card = await mapped('rainy', hass, { map_tile_url: 'https://tiles.invalid/{z}/{x}/{y}.png' });
  await card.maps.loadRadar(Date.now());
  await vi.waitFor(() => {
    expect(card.maps.homeReach.reaches).toBe(reaches);
  });
  card.root.querySelector<HTMLElement>('.tile[data-tile=map]')?.click();
  await vi.waitFor(() => {
    expect(card.maps.largeView()).not.toBeNull();
  });
  return card;
};

test('where the radar doesn’t reach home, the large map opens on the 12-hour forecast', async () => {
  // Lagos, beyond the radar.
  const card = await openedAt(6.5, 3.4, false);
  expect(card.maps.rainSpan).toBe('12h');
  // Closed and opened again, it opens there again.
  card.maps.reset();
  card.maps.opening();
  expect(card.maps.rainSpan).toBe('12h');
});

test('where the radar reaches home, the large map opens on the radar', async () => {
  const card = await openedAt(51.5, -0.1, true);
  expect(card.maps.rainSpan).toBe('1h');
});

test('where the radar’s reach can’t be told, it is asked again no more often than the radar', async () => {
  const coverage = vi.fn(() => Promise.resolve(new Response('', { status: 429 })));
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => (url.includes('/v2/coverage/') ? coverage() : answer(url))),
  );
  const card = await mapped();
  await vi.waitFor(() => {
    expect(coverage).toHaveBeenCalled();
  });
  const calls = coverage.mock.calls.length;
  for (let k = 0; k < 5; k++) await card.maps.loadRadar(Date.now());
  expect(coverage.mock.calls.length).toBe(calls);
  expect(card.maps.homeReach.reaches).toBeUndefined();
  expect(card.maps.rainSpan).toBe('1h');
});

test('the small map’s radar reaches past its edges, so its blur fades out where the map cuts it off', async () => {
  const card = await mapped('rainy'),
    view = card.root.querySelector<HTMLElement>('.radar:not(.large)'),
    [frame] = layers(card);
  if (!view || !(frame instanceof HTMLCanvasElement)) throw new Error('No radar.');
  const grow = Number(frame.parentElement?.style.scale || 1),
    shown = view.getBoundingClientRect(),
    painted = frame.getBoundingClientRect();
  // Four of its own pixels further each way, drawn at twice their size.
  expect(frame.width).toBe(Math.round((view.clientWidth / grow + 8) * 2));
  expect(painted.left).toBeLessThan(shown.left);
  expect(painted.top).toBeLessThan(shown.top);
  expect(painted.right).toBeGreaterThan(shown.right);
  expect(painted.bottom).toBeGreaterThan(shown.bottom);
});

// The large map on the card's own tiles, its timeline left to start by itself as it opens.
async function opened(config: object = {}) {
  const card = await mapped('rainy', hassWith('rainy', 'above_horizon'), {
    map_tile_url: 'https://tiles.invalid/{z}/{x}/{y}.png',
    ...config,
  });
  card.root.querySelector<HTMLElement>('.tile[data-tile=map]')?.click();
  await vi.waitFor(() => {
    expect(card.maps.largeView()?.querySelector('.wind-time')).not.toBeNull();
  });
  return card;
}

test('the radar’s timeline plays only once its frames have come, and on through frames that come as it plays', async () => {
  const card = await opened({ weather_animation: true }),
    ready = vi.spyOn(card.maps, 'framesReady').mockReturnValue(false),
    timeline = () => card.maps.largeView()?.querySelector('.wind-time');
  await vi.waitFor(() => {
    expect(timeline()?.hasAttribute('data-playing')).toBe(true);
  });
  // Playing, but held at now while its frames come.
  await pause(300);
  expect(card.maps.timelineTime).toBeUndefined();
  ready.mockReturnValue(true);
  await vi.waitFor(() => {
    expect(card.maps.timelineTime).toBeDefined();
  });
  // A frame later than any it had: it plays on into that frame's part of the bar, past where it
  // ended before, rather than round to its start.
  const view = card.maps.largeView(),
    before = view ? card.maps.timelineOf(view) : null,
    first = before?.times[0];
  if (!before || first === undefined) throw new Error('No timeline.');
  const end = first + before.times.length * STEP;
  latest = 1;
  await card.maps.loadRadar(Date.now() + STEP);
  await vi.waitFor(() => {
    const shown = card.maps.largeView(),
      after = shown ? card.maps.timelineOf(shown) : null;
    expect(after?.times.at(-1)).toBe(end);
  });
  card.maps.timelineTime = end + STEP / 10;
  // However slowly the frames come, as long as they take.
  await vi.waitFor(() => {
    expect(card.maps.timelineTime).toBeGreaterThan(end + STEP / 10);
  });
  expect(timeline()?.hasAttribute('data-playing')).toBe(true);
});

test('without the live map, playing asks for every frame’s pictures at once', async () => {
  const card = await opened(),
    pictures = () => [...(card.maps.largeView()?.querySelectorAll<HTMLImageElement>('[data-frame] img') ?? [])];
  // Held still, only the frame shown has its pictures. Playing, every frame's are asked for from
  // its first step, well before it reaches the frame after the one it starts on, half a second on.
  expect(pictures().some(image => image.hasAttribute('data-src'))).toBe(true);
  card.maps.playTimeline(true);
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  expect(pictures().some(image => image.hasAttribute('data-src'))).toBe(false);
  card.maps.playTimeline(false);
});

// A sensor reading the air at 36, beside the weather.
const withAir = (hass: HomeAssistant): HomeAssistant => ({
  ...hass,
  states: {
    ...hass.states,
    'sensor.aqi': { entity_id: 'sensor.aqi', state: '36', attributes: { device_class: 'aqi' } },
  },
});
test('from the foot, the air quality sheet opens on a map of the air, whatever the tile shows', async () => {
  const hass = withAir(hassWith('rainy', 'above_horizon')),
    card = await mapped('rainy', hass, { sheet_style: 'sheet', air_quality_entity: 'sensor.aqi' });
  expect(card.root.querySelector('.tile .radar')?.getAttribute('data-kind')).toBe('precipitation');
  card.root.querySelector<HTMLElement>('.tile[data-tile=air_quality]')?.click();
  const map = () => card.root.querySelector<HTMLElement>('dialog[open] .radar.sheet-map');
  await vi.waitFor(() => {
    expect(map()?.querySelector('.map-badge')?.textContent).toBe('36');
  });
  expect(map()?.querySelector('.map-badge')?.getAttribute('data-kind')).toBe('air_quality');
  expect(map()?.querySelector('.map-home')?.textContent).toBe('My Location');
  // The tile still shows what matters on the page.
  expect(card.root.querySelector('.tile .radar')?.getAttribute('data-kind')).toBe('precipitation');
  // Both are masked to their rounded boxes, which hold while a picture fades in.
  for (const view of card.root.querySelectorAll('.tile .radar, dialog[open] .radar.sheet-map'))
    expect(getComputedStyle(view).maskImage).not.toBe('none');
});

test('a sheet beside its tile has no map of its own to draw', async () => {
  const hass = withAir(hassWith('rainy', 'above_horizon')),
    card = await mapped('rainy', hass, { sheet_style: 'popover', air_quality_entity: 'sensor.aqi' });
  card.root.querySelector<HTMLElement>('.tile[data-tile=air_quality]')?.click();
  await vi.waitFor(() => {
    expect(card.root.querySelector('dialog[open][data-id=air_quality]')).not.toBeNull();
  });
  await pause(100);
  const map = card.root.querySelector<HTMLElement>('dialog[open] .sheet-map');
  expect(map && getComputedStyle(map).display).toBe('none');
  expect(map?.childElementCount).toBe(0);
});

// A wind of 12 mph from the west-northwest, with today's hours and a few days to come.
const HOUR_MS = 3_600_000,
  DAY_MS = 24 * HOUR_MS;
const withWindHours = (hass: HomeAssistant): HomeAssistant => {
  const start = Math.floor(Date.now() / HOUR_MS) * HOUR_MS,
    hourly = Array.from({ length: 24 }, (_, i) => ({
      datetime: new Date(start + i * HOUR_MS).toISOString(),
      condition: 'rainy',
      temperature: 60,
      wind_speed: 10 + (i % 3),
      wind_bearing: 290,
    })),
    daily = Array.from({ length: 3 }, (_, i) => ({
      datetime: new Date(start + i * DAY_MS).toISOString(),
      condition: 'rainy',
      temperature: 64,
      templow: 52,
      wind_speed: 12,
    }));
  return {
    ...hass,
    connection: {
      subscribeMessage(callback: (message: unknown) => void, message: ForecastSubscription) {
        queueMicrotask(() => {
          callback({ forecast: message.forecast_type === 'hourly' ? hourly : daily });
        });
        return Promise.resolve(() => undefined);
      },
    },
  };
};
test('from the foot, today’s wind sheet has a map of the wind after its summary, as far out as the wind map opens', async () => {
  const hass = withWindHours(hassWith('rainy', 'above_horizon', {}, { wind_speed: 12, wind_bearing: 290 })),
    card = await mapped('rainy', hass, { sheet_style: 'sheet' });
  card.root.querySelector<HTMLElement>('.tile[data-tile=wind]')?.click();
  const section = () => card.root.querySelector<HTMLElement>('dialog[open] .sheet-map-section');
  await vi.waitFor(() => {
    expect(section()?.querySelector('.map-badge')?.textContent).toContain('12');
  });
  expect(section()?.querySelector('h3')?.textContent).toBe('Map');
  expect(section()?.previousElementSibling?.classList.contains('detail-summary')).toBe(true);
  expect(section()?.querySelector('.radar.sheet-map')?.getAttribute('data-kind')).toBe('wind');
  expect(section()?.querySelector('.map-home')?.textContent).toBe('My Location');
  // Its ground is the wind's, drawn closer, at the zoom the wind's large map opens at.
  expect(
    vi
      .mocked(groundStill)
      .mock.calls.some(([, view, look]) => look === 'windSheet' && view.zoom === openingZoom('wind')),
  ).toBe(true);
  // Masked to its rounded box, so its streaks, on a layer of their own, stop at its corners.
  const map = section()?.querySelector<HTMLElement>('.radar.sheet-map');
  expect(map && getComputedStyle(map).maskImage).not.toBe('none');
  // Another day has no map.
  card.root.querySelector<HTMLElement>('dialog[open] .detail-days [data-tense=later]')?.click();
  await vi.waitFor(() => {
    expect(card.root.querySelector('dialog[open] .detail-days [data-tense=later][aria-pressed=true]')).not.toBeNull();
  });
  expect(section()).toBeNull();
});

test('beside its tile, the wind sheet has no map of its own to draw', async () => {
  const hass = withWindHours(hassWith('rainy', 'above_horizon', {}, { wind_speed: 12, wind_bearing: 290 })),
    card = await mapped('rainy', hass, { sheet_style: 'popover' });
  card.root.querySelector<HTMLElement>('.tile[data-tile=wind]')?.click();
  await vi.waitFor(() => {
    expect(card.root.querySelector('dialog[open][data-id=wind]')).not.toBeNull();
  });
  await pause(100);
  const section = card.root.querySelector<HTMLElement>('dialog[open] .sheet-map-section');
  expect(section && getComputedStyle(section).display).toBe('none');
  expect(section?.querySelector('.sheet-map')?.childElementCount).toBe(0);
});

// The large map open, from the foot or beside its tile, and its layers button and menu.
const layerMenu = async (sheet_style: string) => {
  const card = await mapped('rainy', hassWith('rainy', 'above_horizon'), { sheet_style });
  card.root.querySelector<HTMLElement>('.tile[data-tile=map]')?.click();
  await vi.waitFor(() => {
    expect(card.maps.largeView()).not.toBeNull();
  });
  const parts = () => {
    const view = card.maps.largeView(),
      button = view?.querySelector<HTMLElement>('[data-layers]'),
      menu = view?.querySelector<HTMLElement>('.map-layers:not([data-leaving])');
    if (!view || !button || !menu) throw new Error('No layers.');
    return { view, button, menu };
  };
  return { card, parts };
};
test('from the foot the layers come out of their button as the glass menu, each with its glyph, and a layer chosen is drawn', async () => {
  const { card, parts } = await layerMenu('sheet'),
    { button, menu } = parts();
  button.click();
  expect([menu.hidden, button.getAttribute('aria-expanded')]).toEqual([false, 'true']);
  expect(menu.classList.contains('glass-menu')).toBe(true);
  const rows = [...menu.querySelectorAll<HTMLElement>('[data-choice]')];
  expect(
    rows.map(row => `${row.dataset['choice'] ?? ''}${row.getAttribute('aria-checked') === 'true' ? '*' : ''}`),
  ).toEqual(['precipitation*', 'temperature', 'air_quality', 'wind']);
  for (const row of rows) {
    const glyph = row.querySelector('.glass-menu-glyph svg');
    expect(glyph && getComputedStyle(glyph).display).toBe('block');
  }
  // It comes out as a drop, and at rest its top right corner is the button's.
  const drop = menu.getAnimations();
  expect(drop.length).toBeGreaterThan(0);
  for (const running of drop) running.finish();
  const box = menu.getBoundingClientRect(),
    from = button.getBoundingClientRect();
  expect(box.right).toBeCloseTo(from.right, 0);
  expect(box.top).toBeCloseTo(from.top, 0);
  expect(box.width).toBeGreaterThan(from.width * 4);
  // Chosen, the layer is drawn, and its menu goes back into the button.
  const wind = rows.at(-1);
  if (!wind) throw new Error('No wind.');
  wind.click();
  expect(card.maps.layer).toBe('wind');
  await vi.waitFor(() => {
    expect(parts().view.dataset['kind']).toBe('wind');
  });
  expect(parts().menu.hidden).toBe(true);
  expect(parts().button.getAttribute('aria-expanded')).toBe('false');
});
test('beside its tile the layers menu is small and plain, under its button, with no glyphs, and a press elsewhere puts it away', async () => {
  const { parts } = await layerMenu('popover'),
    { view, button, menu } = parts();
  button.click();
  expect(menu.hidden).toBe(false);
  expect(menu.getAnimations()).toEqual([]);
  const glyph = menu.querySelector('.glass-menu-glyph');
  expect(glyph && getComputedStyle(glyph).display).toBe('none');
  expect(menu.getBoundingClientRect().top).toBeGreaterThan(button.getBoundingClientRect().bottom);
  // On the legend, which the map's own drag leaves alone.
  view.querySelector('.map-key')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
  expect(menu.hidden).toBe(true);
});

test('a mounted map picks up base and overlay URL changes independently', async () => {
  const settings = (base: string, overlay: string) => ({
    map_tile_url: `https://${base}.invalid/{z}/{x}/{y}.png`,
    map_layers: { precipitation: `https://${overlay}.invalid/{z}/{x}/{y}.png` },
  });
  const card = await mapped('rainy', hassWith('rainy', 'above_horizon'), settings('first', 'old'));
  const layer = (kind: string) => card.root.querySelector<HTMLImageElement>(`.radar-layer.${kind} img`)?.src;
  expect(layer('base')).toContain('first.invalid');
  expect(layer('overlay')).toContain('old.invalid');
  card.setConfig({ ...card.config, ...settings('next', 'old') });
  expect(layer('base')).toContain('next.invalid');
  card.setConfig({ ...card.config, ...settings('next', 'new') });
  expect(layer('overlay')).toContain('new.invalid');
});
