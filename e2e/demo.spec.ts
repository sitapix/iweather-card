import { artifact } from './artifacts.ts';
import { test as base, expect, type Locator, type Page, type Route } from '@playwright/test';

// The demo site as it is published, _site/ (built at the start of the run): its controls drive the
// card it loads from beside its pages, and a place looked up by name shows its real weather. The
// expanded layout asks nothing of the internet, so the only services here are the two the demo
// asks itself, answered in place. A script error, a console error or a request nobody expected
// fails the test.

const SITE = 'https://demo.test',
  NOW = Date.UTC(2026, 9, 27, 17, 30),
  HOUR = 3_600_000,
  DAY = 24 * HOUR;
const TYPES: Readonly<Record<string, string>> = {
  html: 'text/html',
  js: 'text/javascript',
  css: 'text/css',
  json: 'application/json',
  avif: 'image/avif',
  txt: 'text/plain',
};
const PLACES = {
  results: [
    { name: 'Paris', admin1: 'Île-de-France', country: 'France', latitude: 48.85, longitude: 2.35 },
    { name: 'Paris', admin1: 'Texas', country: 'United States', latitude: 33.66, longitude: -95.56 },
  ],
};
// Rain in Paris, now and for two days of hours and ten days.
function forecast() {
  const start = Math.floor(NOW / HOUR) * HOUR,
    hours = Array.from({ length: 48 }, (_, i) => (start + i * HOUR) / 1000),
    days = Array.from({ length: 10 }, (_, i) => (start - (start % DAY) + i * DAY) / 1000);
  return {
    timezone: 'Europe/Paris',
    hourly_units: { visibility: 'ft' },
    current_units: { visibility: 'ft' },
    current: { temperature_2m: 52, relative_humidity_2m: 90, weather_code: 63, is_day: 1, wind_speed_10m: 9 },
    hourly: {
      time: hours,
      weather_code: hours.map(() => 63),
      is_day: hours.map(() => 1),
      temperature_2m: hours.map(() => 52),
      precipitation_probability: hours.map(() => 80),
      precipitation: hours.map(() => 0.05),
      wind_speed_10m: hours.map(() => 9),
      wind_gusts_10m: hours.map(() => 16),
      visibility: hours.map(() => 26_400),
    },
    daily: {
      time: days,
      weather_code: days.map(() => 63),
      temperature_2m_max: days.map(() => 55),
      temperature_2m_min: days.map(() => 46),
    },
  };
}

function answer(route: Route, faults: string[]) {
  const url = new URL(route.request().url());
  if (url.origin === SITE) {
    const path = url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname,
      type = TYPES[path.split('.').at(-1) ?? ''];
    return route.fulfill({
      path: artifact('site', path),
      ...(type ? { contentType: type } : {}),
    });
  }
  if (url.hostname === 'geocoding-api.open-meteo.com') return route.fulfill({ json: PLACES });
  if (url.hostname === 'api.open-meteo.com' && url.searchParams.has('current'))
    return route.fulfill({ json: forecast() });
  faults.push(`Asked for ${url.href}.`);
  return route.abort();
}

const test = base.extend<{ asked: string[]; demo: Page }>({
  // Every address the page asks for beyond the site, answered here or not.
  asked: async ({ page }, use) => {
    const urls: string[] = [];
    page.on('request', request => {
      if (!request.url().startsWith(SITE)) urls.push(request.url());
    });
    await use(urls);
  },
  demo: async ({ page }, use) => {
    const faults: string[] = [];
    page.on('pageerror', error => faults.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') faults.push(message.text());
    });
    await page.route('**/*', route => answer(route, faults));
    await page.clock.setFixedTime(NOW);
    await use(page);
    expect(faults).toEqual([]);
  },
});

const card = (page: Page): Locator => page.locator('iweather-card');
const choose = (page: Page, group: string, label: string) =>
  page.locator(`[data-name=${group}] label`, { hasText: new RegExp(`^${label}$`) }).click();

test('the demo controls work while the card file is still downloading', async ({ demo }) => {
  let resume: (() => void) | undefined;
  const download = new Promise<void>(resolve => {
    resume = resolve;
  });
  await demo.route('**/iweather-card.js', async route => {
    await download;
    await route.fallback();
  });
  await demo.goto(`${SITE}/#layout=expanded&language=en`, { waitUntil: 'commit' });
  try {
    await expect(demo.locator('code.yaml')).toContainText('weather_layout: expanded');
    await choose(demo, 'layout', 'Compact');
    await expect(demo.locator('code.yaml')).toContainText('weather_layout: compact');
    await choose(demo, 'weather', 'Snow');
    expect(new URLSearchParams(new URL(demo.url()).hash.slice(1)).get('weather')).toBe('snow');
  } finally {
    resume?.();
  }
  await expect(card(demo)).toHaveAttribute('data-layout', 'compact');
  await expect(card(demo).locator('.hero .condition')).toHaveText('Snow');
});

test('the controls drive the card, and the settings and the address follow', async ({ demo }) => {
  await demo.goto(`${SITE}/#layout=expanded&units=us&language=en`);
  const hero = card(demo).locator('.hero');
  await expect(hero.locator('.location')).toHaveText('Chicago');

  await choose(demo, 'weather', 'Snow');
  await expect(hero.locator('.condition')).toHaveText('Snow');
  // Clear by day is sunny, and clear after dark a clear night.
  await choose(demo, 'weather', 'Clear');
  await demo.locator('input[name=hour]').fill('13');
  await expect(hero.locator('.condition')).toHaveText('Sunny');
  await demo.locator('input[name=hour]').fill('22');
  await expect(hero.locator('.condition')).toHaveText('Clear');
  await expect(demo.locator('output[name=clock]')).toHaveText('10 PM');
  await expect(demo.getByRole('slider', { name: 'Hour' })).toHaveAttribute('aria-valuetext', '10 PM');

  await choose(demo, 'units', '°C');
  await expect(card(demo).getByText('Temperature (°C)').first()).toBeVisible();
  await demo.locator('select[name=language]').selectOption('de');
  await expect(card(demo).getByText('Bedingungen').first()).toBeVisible();
  await expect(card(demo)).toHaveAttribute('lang', 'de');

  await choose(demo, 'layout', 'Compact');
  await expect(card(demo)).toHaveAttribute('data-layout', 'compact');
  await expect(demo.locator('code.yaml')).toHaveText(
    'type: custom:iweather-card\nentity: weather.home\nweather_layout: compact',
  );
  expect(new URLSearchParams(new URL(demo.url()).hash.slice(1)).get('weather')).toBe('clear');
});

test('a scene in the address opens as it was left', async ({ demo }) => {
  await demo.goto(`${SITE}/#weather=fog&hour=9&layout=expanded&units=metric&language=en`);
  await expect(card(demo).locator('.hero .condition')).toHaveText('Fog');
  await expect(card(demo).getByText('Temperature (°C)').first()).toBeVisible();
  await expect(demo.locator('[data-name=weather] input[value=fog]')).toBeChecked();
  await expect(demo.locator('output[name=clock]')).toHaveText('9 AM');
});

test('a place found by name shows its own weather, until the sample is asked back', async ({ demo, asked }) => {
  await demo.goto(`${SITE}/#weather=snow&hour=22&layout=expanded&units=us&language=en`);
  const hero = card(demo).locator('.hero');
  await expect(hero.locator('.location')).toHaveText('Chicago');
  expect(asked, 'nothing asked before the visitor asks').toEqual([]);

  await demo.locator('input[name=place]').fill('Paris');
  await demo.getByRole('button', { name: 'Look up' }).click();
  await demo.getByRole('button', { name: 'Paris, Île-de-France, France' }).click();
  await expect(hero.locator('.location')).toHaveText('Paris');
  await expect(hero.locator('.condition')).toHaveText('Rain');
  // A disabled fieldset disables the choices in it.
  await expect(demo.locator('[data-name=weather] input').first()).toBeDisabled();
  await expect(demo.locator('output[name=clock]')).toHaveText('Now');
  expect(asked.some(url => url.includes('latitude=48.850') && url.includes('temperature_unit=fahrenheit'))).toBe(true);

  await demo.getByRole('button', { name: 'Back to sample weather' }).click();
  await expect(hero.locator('.location')).toHaveText('Chicago');
  await expect(demo.locator('[data-name=weather] input').first()).toBeEnabled();
  await expect(hero.locator('.condition')).toHaveText('Snow');
  await expect(demo.locator('output[name=clock]')).toHaveText('10 PM');
});

test('copying YAML reports success and still offers manual copying without a clipboard', async ({ demo }) => {
  await demo.goto(`${SITE}/#layout=expanded&language=en`);
  const copy = demo.getByRole('button', { name: 'Copy YAML' }),
    feedback = demo.locator('.copy-feedback'),
    yaml = demo.locator('code.yaml');
  await expect(yaml).toContainText('entity: weather.home');
  await demo.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          document.body.dataset['copied'] = text;
          return Promise.resolve();
        },
      },
    });
  });
  await copy.click();
  await expect(feedback).toHaveText('Copied');
  await expect(demo.locator('body')).toHaveAttribute('data-copied', (await yaml.textContent()) ?? '');
  await demo.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  });
  await copy.click();
  await expect(feedback).toHaveText(/manually/);
});

test('a late location reply leaves a newer town search in place', async ({ demo, asked }) => {
  await demo.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', {
      value: {
        getCurrentPosition: (found: (position: { coords: { latitude: number; longitude: number } }) => void) => {
          addEventListener('test-location', () => found({ coords: { latitude: 0, longitude: 0 } }), { once: true });
        },
      },
    });
  });
  await demo.goto(`${SITE}/#layout=expanded&units=us&language=en`);
  await demo.getByRole('button', { name: 'Use my location' }).click();
  await demo.getByRole('searchbox').fill('Paris');
  await demo.getByRole('button', { name: 'Look up' }).click();
  const paris = demo.getByRole('button', { name: 'Paris, Île-de-France, France' });
  await expect(paris).toBeVisible();
  await demo.evaluate(() => dispatchEvent(new Event('test-location')));
  await expect(paris).toBeVisible();
  expect(asked.some(url => url.includes('latitude='))).toBe(false);
});

for (const [tag, code] of [
  ['zh-TW', 'zh-Hant'],
  ['zh-Hans-TW', 'zh-Hans'],
  ['zh-Hant-CN', 'zh-Hant'],
  ['zh-CN', 'zh-Hans'],
] as const) {
  test(`a visitor speaking ${tag} starts the demo in ${code}`, async ({ demo }) => {
    await demo.addInitScript(
      language => Object.defineProperty(navigator, 'languages', { value: ['xx', language] }),
      tag,
    );
    await demo.goto(`${SITE}/#layout=expanded`);
    await expect(demo.locator('select[name=language]')).toHaveValue(code);
  });
}
