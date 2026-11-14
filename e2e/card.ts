import { artifact } from './artifacts.ts';
import { test as base, expect, type Locator, type Page, type Route } from '@playwright/test';
import type { ForecastSubscription, HomeAssistant } from '../src/card/home-assistant.ts';
import { bloscStored, bucketListing, hrrrSizes } from '../test/forecast-files.ts';

// The card as a dashboard has it: the built file, fetched by a page of its own and handed a Home
// Assistant stand-in, on a rainy noon in Chicago. Nothing reaches the network, as there are no
// servers here at all: the page, the file and the map's services are answered in place. A script
// error, a console error or a request nobody expected fails the test that caused it.
const DASHBOARD = 'https://home.test',
  FOLDER = `${DASHBOARD}/hacsfiles/`,
  FILE = `${FOLDER}iweather-card.js`,
  PAGE = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>:root{--ha-font-family-body:"Liberation Sans",Arial}</style><script type="module" src="${FILE}?hacstag=1234567"></script>`;
const NOW = Date.UTC(2026, 9, 27, 17, 30, 0),
  SECONDS = Math.floor(NOW / 1000);
// Today's charts, on a sheet's page for that day.
export const TODAY = '.chart-page[data-day="2026-10-27"]';
// A see-through pixel.
const CLEAR = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==',
  'base64',
);
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
// A config for the map, with tiles and radar from hosts answered here.
export const MAP = { map: 'rainviewer', map_tile_url: 'https://tiles.test/{z}/{x}/{y}.png' };

// Twelve radar frames ten minutes apart up to now.
const radar = {
  host: 'https://radar.test',
  radar: {
    past: Array.from({ length: 12 }, (_, i) => ({ time: SECONDS - (11 - i) * 600, path: `/radar/${i}` })),
  },
};
// The wind, for as many places as are asked.
function wind(url: URL) {
  const places = url.searchParams.get('latitude')?.split(',') ?? [],
    times = Array.from({ length: 16 }, (_, hour) => SECONDS + (hour - 3) * 3600);
  return places.map(() => ({
    hourly: {
      time: times,
      wind_speed_10m: times.map(() => 6),
      wind_direction_10m: times.map(() => 200),
      temperature_2m: times.map(() => 12),
    },
  }));
}
// HRRR's hours over Chicago, 0.8 mm an hour: a listing that finds the run, the run's array, and
// each tile of it.
const RAIN = Buffer.from(bloscStored(Array.from({ length: 18 * 150 * 150 }, () => 0.8)));
function hrrr(url: URL) {
  if (url.searchParams.has('list-type')) return bucketListing(url.searchParams.get('prefix') ?? '', hrrrSizes(1000));
  if (url.pathname.endsWith('.zarray')) return JSON.stringify({ shape: [18, 1059, 1799], chunks: [18, 150, 150] });
  return RAIN;
}
// The forecast that fills what an entity leaves out: hours from yesterday, and the days they span.
function supplement() {
  const start = SECONDS - (SECONDS % 86400) - 86400,
    hours = Array.from({ length: 288 }, (_, i) => start + i * 3600),
    days = Array.from({ length: 12 }, (_, i) => start + i * 86400);
  return {
    hourly: {
      time: hours,
      precipitation_probability: hours.map(() => 30),
      wind_gusts_10m: hours.map(() => 12),
      wind_speed_10m: hours.map(() => 6),
      wind_direction_10m: hours.map(() => 200),
      apparent_temperature: hours.map(() => 13),
      dew_point_2m: hours.map(() => 8),
      relative_humidity_2m: hours.map(() => 80),
      pressure_msl: hours.map(() => 1013),
      uv_index: hours.map(() => 3),
      visibility: hours.map(() => 16000),
      precipitation: hours.map(() => 0.5),
      snowfall: hours.map(() => 0),
      weather_code: hours.map(() => 61),
      temperature_2m: hours.map(() => 14),
      cloud_cover: hours.map(() => 90),
    },
    daily: {
      time: days,
      weather_code: days.map(() => 61),
      temperature_2m_max: days.map(() => 18),
      temperature_2m_min: days.map(() => 9),
      precipitation_sum: days.map(() => 3),
      precipitation_probability_max: days.map(() => 60),
      wind_speed_10m_max: days.map(() => 8),
      wind_gusts_10m_max: days.map(() => 14),
      sunrise: days.map(time => time + 12 * 3600),
      sunset: days.map(time => time + 23 * 3600),
    },
    // Raining as the hours say, a quarter hour at a time from the one under way.
    minutely_15: {
      time: Array.from({ length: 12 }, (_, i) => SECONDS - (SECONDS % 900) + (i + 1) * 900),
      precipitation: Array.from({ length: 12 }, () => 0.2),
    },
  };
}
// Air quality filled in where no sensor is set: a moderate index now, with yesterday's hours.
function air() {
  const hour = SECONDS - (SECONDS % 3600),
    hours = Array.from({ length: 48 }, (_, i) => hour - (24 - i) * 3600);
  return {
    current: { time: hour, us_aqi: 58, pm2_5: 14.2, pm10: 20.5, ozone: 61, nitrogen_dioxide: 9.4 },
    hourly: { time: hours, us_aqi: hours.map(() => 51) },
  };
}
// What the build put beside the card, as an installer would serve it.
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  js: 'text/javascript',
  css: 'text/css',
  json: 'application/json',
  avif: 'image/avif',
};
function answer(route: Route, faults: string[]) {
  const url = new URL(route.request().url());
  if (url.href === `${DASHBOARD}/`) return route.fulfill({ contentType: 'text/html', body: PAGE });
  if (url.href.startsWith(FOLDER)) {
    const name = url.pathname.split('/').at(-1) ?? '',
      contentType = CONTENT_TYPES[name.split('.').at(-1) ?? ''];
    return route.fulfill({
      path: artifact('dist', name),
      ...(contentType ? { contentType } : {}),
    });
  }
  if (url.hostname === 'tiles.test' || url.hostname === 'radar.test')
    return route.fulfill({ contentType: 'image/png', body: PIXEL });
  // The radar reaches Chicago: its coverage is see-through there.
  if (url.hostname === 'tilecache.rainviewer.com' && url.pathname.startsWith('/v2/coverage/'))
    return route.fulfill({ contentType: 'image/png', body: CLEAR });
  if (url.hostname === 'api.rainviewer.com') return route.fulfill({ json: radar });
  if (url.hostname === 'api.open-meteo.com')
    return route.fulfill({ json: url.searchParams.has('daily') ? supplement() : wind(url) });
  if (url.hostname === 'air-quality-api.open-meteo.com') return route.fulfill({ json: air() });
  if (url.hostname === 'api.weather.gov') return route.fulfill({ json: { type: 'FeatureCollection', features: [] } });
  if (url.hostname === 'hrrrzarr.s3.amazonaws.com') return route.fulfill({ body: hrrr(url) });
  // The short forecast's run, which a small map over the United States asks for: none published.
  if (url.hostname === 'mesonet.agron.iastate.edu') return route.fulfill({ json: {} });
  faults.push(`Asked for ${url.href}.`);
  return route.abort();
}

// The dashboard's page, its clock stopped at `now`, with all it asks for answered here. Returns what
// goes wrong on it from then on: script errors, console errors and requests nobody expected.
export async function openDashboard(page: Page, now = NOW): Promise<string[]> {
  const faults: string[] = [];
  page.on('pageerror', error => faults.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') faults.push(message.text());
  });
  await page.route('**/*', route => answer(route, faults));
  await page.clock.setFixedTime(now);
  await page.goto(`${DASHBOARD}/`);
  return faults;
}

// Runs in the page, so it can use nothing from this module: only what it is passed.
function mount({ config, now, language }: { config: object; now: number; language: string }) {
  const hour = 3_600_000,
    start = Math.floor(now / hour) * hour;
  const hourly = Array.from({ length: 24 }, (_, i) => ({
    datetime: new Date(start + i * hour).toISOString(),
    temperature: 58 + Math.round(Math.sin(i / 4) * 4),
    condition: 'rainy',
    precipitation: 0.1,
    precipitation_probability: 60,
    wind_speed: 8,
    wind_bearing: 200,
    uv_index: 3,
    humidity: 80,
    pressure: 29.91,
  }));
  const daily = Array.from({ length: 10 }, (_, i) => ({
    datetime: new Date(now + i * 24 * hour).toISOString(),
    condition: 'rainy',
    temperature: 64,
    templow: 48,
    precipitation: 0.1,
  }));
  const hass: HomeAssistant = {
    states: {
      'weather.home': {
        entity_id: 'weather.home',
        state: 'rainy',
        attributes: {
          temperature: 58,
          temperature_unit: '°F',
          humidity: 80,
          uv_index: 3,
          wind_speed: 12,
          wind_bearing: 220,
          wind_speed_unit: 'mph',
          precipitation_unit: 'in',
          visibility: 10,
          visibility_unit: 'mi',
          pressure: 29.91,
          pressure_unit: 'inHg',
          friendly_name: 'Chicago',
          supported_features: 3,
        },
      },
      'sun.sun': { entity_id: 'sun.sun', state: 'above_horizon', attributes: { elevation: 38, rising: false } },
    },
    language,
    locale: { language, time_format: '12' },
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
  const card = document.createElement('iweather-card');
  card.style.cssText = 'display:block;max-width:1100px';
  card.setConfig({
    type: 'custom:iweather-card',
    entity: 'weather.home',
    weather_layout: 'page',
    weather_animation: false,
    ...config,
  });
  card.hass = hass;
  document.body.replaceChildren(card);
}

export const test = base.extend<{
  config: object;
  language: string;
  asked: string[];
  spoken: string[];
  card: Locator;
}>({
  // What a test adds to the card's settings: `test.use({ config: MAP })`.
  config: [{}, { option: true }],
  // The language Home Assistant is set to: `test.use({ language: 'de' })`.
  language: ['en', { option: true }],
  // Every host the page asks beyond the dashboard, answered here or not.
  asked: [
    async ({ page }, use) => {
      const hosts: string[] = [];
      page.on('request', request => {
        const { protocol, hostname } = new URL(request.url());
        if (protocol === 'https:' && hostname !== new URL(DASHBOARD).hostname) hosts.push(hostname);
      });
      await use(hosts);
    },
    { auto: true },
  ],
  // What the card says for itself in the console.
  spoken: [
    async ({ page }, use) => {
      const lines: string[] = [];
      page.on('console', message => {
        if (message.type() === 'info') lines.push(message.text());
      });
      await use(lines);
    },
    { auto: true },
  ],
  card: async ({ page, config, language }, use) => {
    const faults = await openDashboard(page);
    await page.evaluate(mount, { config, now: NOW, language });
    const card = page.locator('iweather-card');
    await expect(card.locator('.tile').first()).toBeVisible();
    await use(card);
    expect(faults).toEqual([]);
  },
});
// A sheet past its opening scale, so that boxes read true and a pointer put over a part of it
// stays over it.
export const landed = (dialog: Locator) =>
  dialog.locator('.sheet').evaluate(async node => {
    const whole = [...node.getAnimations(), ...(node.closest('dialog')?.getAnimations() ?? [])];
    await Promise.all(whole.map(animation => animation.finished));
  });
export { expect };
