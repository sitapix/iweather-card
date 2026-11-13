// Draws the README's pictures in docs/images from the preview pages: the full page at sunset, four
// skies from the gallery (the rain one moving), and the sizes a sections dashboard offers. Run it
// after a change to how the card looks: node scripts/readme-images.ts (about three minutes; needs
// Google Chrome, ffmpeg, cwebp and img2webp). It starts a dev server of its own, so `pnpm dev` can
// stay up. The map's base tiles and its radar come from their services, as a reader's would. The
// averages' history and the alerts are answered here, and Open-Meteo's forecast is refused, so each
// card shows the preview's forecast alone. Anything else asked for is refused and listed at the end.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page, type Route } from 'playwright';
import { createServer } from 'vite';
import type { IWeatherCard } from '../src/iweather-card.ts';

// The moments shown, both with the moon about 20° up over Chicago and St. Louis. The gallery and the
// full page set each scene's own clock by its sun, so they take a night with the moon climbing in
// the east. The sizes page reads day and night from the real sun, so it takes a late morning of the
// same day, the moon sinking in the west.
const AT = Date.parse('2026-10-31T04:30:00Z'),
  MORNING = Date.parse('2026-10-31T11:30:00-05:00'),
  ZONE = 'America/Chicago',
  SCALE = 2,
  // How long a page is left to draw its sky and finish its fades, and then how long it must go
  // without asking anything of the network (the map's tiles, say) before it is taken, in ms.
  SETTLE = 6000,
  QUIET = 3000,
  // The moving sky: frames 50 ms apart, and the last few faded into the first so it loops unseen.
  FRAME = 50,
  FRAMES = 52,
  FADE = 12,
  DAY = 86_400_000;
const OUT = fileURLToPath(new URL('../docs/images/', import.meta.url)),
  work = mkdtempSync(join(tmpdir(), 'readme-images-')),
  refused = new Set<string>(),
  faults: string[] = [];

// Thirty years of days for the averages tile: highs at their warmest in mid-July, lows 20° under them.
function normals(url: URL) {
  const fahrenheit = url.searchParams.get('temperature_unit') === 'fahrenheit',
    inches = url.searchParams.get('precipitation_unit') === 'inch',
    degrees = (f: number) => Math.round((fahrenheit ? f : ((f - 32) * 5) / 9) * 10) / 10,
    time: string[] = [],
    highs: number[] = [],
    lows: number[] = [];
  for (let t = Date.UTC(1991, 0, 1); t <= Date.UTC(2020, 11, 31); t += DAY) {
    const date = new Date(t),
      day = (t - Date.UTC(date.getUTCFullYear(), 0, 1)) / DAY,
      high = 66 - 24 * Math.cos((2 * Math.PI * (day - 15)) / 365);
    time.push(date.toISOString().slice(0, 10));
    highs.push(degrees(high));
    lows.push(degrees(high - 20));
  }
  return {
    daily: {
      time,
      temperature_2m_max: highs,
      temperature_2m_min: lows,
      precipitation_sum: time.map(() => (inches ? 0.1 : 2.5)),
    },
  };
}

// What a page asks of the world. `offset` moves the radar's frame times to the page's clock: the
// radar is today's, but the page lives on the day shown.
async function answer(route: Route, origin: string, offset: number) {
  const url = new URL(route.request().url());
  if (url.origin === origin) return route.continue();
  switch (url.hostname) {
    case 'archive-api.open-meteo.com':
      return url.searchParams.has('daily') ? route.fulfill({ json: normals(url) }) : route.abort();
    case 'api.open-meteo.com':
      return route.abort();
    case 'api.weather.gov':
      return route.fulfill({ json: { type: 'FeatureCollection', features: [] } });
    case 'api.rainviewer.com': {
      const response = await route.fetch(),
        body = (await response.text()).replaceAll(
          /"(time|generated)":(\d+)/g,
          (_, key: string, time: string) => `"${key}":${Number(time) + offset}`,
        );
      return route.fulfill({ response, body });
    }
    case 'tiles.openfreemap.org':
    case 'tilecache.rainviewer.com':
      return route.continue();
    default:
      refused.add(url.hostname);
      return route.abort();
  }
}

const server = await createServer({ server: { port: 4190, strictPort: false }, logLevel: 'error' });
await server.listen();
const origin = new URL(server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:4190/').origin,
  browser = await chromium.launch({ channel: 'chrome' });

// When each page last asked something of the network beyond the dev server.
const asked = new WeakMap<Page, number>();

// A preview page at `at`, its clock running, in dark mode, with nothing behind the card.
async function open(path: string, width: number, height: number, at = AT): Promise<Page> {
  const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: SCALE,
      timezoneId: ZONE,
      locale: 'en-US',
      colorScheme: 'dark',
      reducedMotion: 'no-preference',
    }),
    page = await context.newPage(),
    offset = Math.round((at - Date.now()) / 1000),
    note = (url: string) => {
      if (!url.startsWith(origin)) asked.set(page, Date.now());
    };
  page.on('pageerror', error => faults.push(`${path}: ${String(error)}`));
  page.on('request', request => note(request.url()));
  page.on('requestfinished', request => note(request.url()));
  page.on('requestfailed', request => note(request.url()));
  await page.route('**/*', route => answer(route, origin, offset));
  await page.clock.install({ time: at });
  await page.goto(`${origin}/preview/${path}`);
  await page.addStyleTag({
    content: 'html,body,.stage,.screen{background:transparent!important}iweather-card{box-shadow:none!important}',
  });
  await page.locator('iweather-card').first().waitFor();
  return page;
}
// Waits for a page's sky and fades, then until it has gone QUIET ms without the network.
async function settled(page: Page) {
  await page.waitForTimeout(SETTLE);
  while (Date.now() - (asked.get(page) ?? 0) < QUIET) await page.waitForTimeout(QUIET / 6);
}
const card = (page: Page) => page.locator('iweather-card');
const shot = async (page: Page, name: string) => {
  const path = join(work, `${name}.png`);
  await card(page).screenshot({ path, omitBackground: true });
  return path;
};
const run = (command: string, args: string[]) =>
  execFileSync(command, args, { stdio: ['ignore', 'ignore', 'inherit'] });
// A frame made `width` wide, or two frames mixed: `share` of `over` laid on `under`.
function scaled(under: string, width: number, to: string, over?: string, share = 0) {
  const resize = `scale=${width}:-2:flags=lanczos`;
  run('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-i',
    under,
    ...(over ? ['-i', over, '-filter_complex', `[1][0]blend=all_opacity=${share},${resize}`] : ['-vf', resize]),
    to,
  ]);
  return to;
}
const still = (png: string, name: string) =>
  run('cwebp', ['-quiet', '-q', '82', '-alpha_q', '100', '-m', '6', '-sharp_yuv', png, '-o', `${OUT}${name}.webp`]);

try {
  // The full page at sunset, as the panel preview shows it in a 1280 × 876 window.
  {
    const page = await open(
      'index-panel.html#scene=19&place=St.%20Louis&alert=0&nowcast=0&averages=1&aqi=1&aqi_value=35&map=rainviewer',
      1280,
      876,
    );
    if ((await page.evaluate(() => document.body.dataset['drawer'])) === 'open') await page.click('.drawer-tab');
    await settled(page);
    still(scaled(await shot(page, 'hero'), 1920, join(work, 'hero-1920.png')), 'hero');
    await page.context().close();
  }

  // Four skies from the gallery, each card 390 × 720, named for a place.
  {
    const page = await open('index-gallery.html', 800, 1000),
      sky = async (title: string) => {
        await page.locator('nav button', { hasText: new RegExp(`^${title}$`) }).click();
        const entity = `weather.scene_${Number(new URL(page.url()).hash.slice(1)) - 1}`;
        await card(page).evaluate(
          (element: IWeatherCard, id: string) =>
            element.setConfig({
              type: 'custom:iweather-card',
              entity: id,
              name: 'St. Louis',
              forecast_days: 3,
            }),
          entity,
        );
        await settled(page);
      };
    for (const [title, name] of [
      ['Sunny', 'sky-sunny'],
      ['Snow', 'sky-snow'],
      ['Clear night', 'sky-night'],
    ] as const) {
      await sky(title);
      still(scaled(await shot(page, name), 420, join(work, `${name}-420.png`)), name);
    }

    // Rain, moving: the clock stops, then steps a frame at a time, so frames are evenly spaced
    // however long each takes to draw.
    await sky('Rain');
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + FRAME);
    const frames: string[] = [];
    for (let i = 0; i < FRAMES + FADE; i++) {
      await page.clock.runFor(FRAME);
      frames.push(await shot(page, `rain-${String(i).padStart(3, '0')}`));
    }
    // Frames FADE onwards, the last FADE of them turning gradually into the first FADE, so the loop's
    // last frame leads into its first.
    const loop = Array.from({ length: FRAMES }, (_, i) => {
      const to = join(work, `loop-${String(i).padStart(3, '0')}.png`),
        frame = frames[i + FADE] ?? '',
        into = i - (FRAMES - FADE);
      return into < 0 ? scaled(frame, 420, to) : scaled(frame, 420, to, frames[into], into / FADE);
    });
    run('img2webp', [
      '-loop',
      '0',
      '-lossy',
      '-q',
      '58',
      '-m',
      '6',
      '-d',
      String(FRAME),
      ...loop,
      '-o',
      `${OUT}sky-rain.webp`,
    ]);
    await page.context().close();
  }

  // Sunny at the sizes a 500 px section offers: 4, 6 and 12 columns by 1, 2 and 3 rows.
  {
    const page = await open('index-sizes.html', 1600, 1200, MORNING);
    await page.selectOption('select[name=scene]', { label: 'Sunny' });
    await page.evaluate(() => {
      const keep = new Set([4, 6, 12]);
      for (const [row, line] of [...document.querySelectorAll('.line')].entries()) {
        if (row > 2) line.remove();
        for (const figure of line.querySelectorAll('figure'))
          if (!keep.has(Number(/^(\d+) ×/.exec(figure.textContent)?.[1]))) figure.remove();
      }
      for (const part of document.querySelectorAll('header, form, .line > b, figcaption')) part.remove();
      document.body.style.padding = '0';
      const main = document.querySelector('main');
      if (main) main.style.cssText = 'display:inline-flex;flex-direction:column;gap:12px';
      for (const line of document.querySelectorAll<HTMLElement>('.line')) line.style.cssText = 'margin:0;gap:12px';
    });
    await settled(page);
    const path = join(work, 'sizes.png');
    await page.locator('main').screenshot({ path, omitBackground: true });
    still(path, 'sizes');
    await page.context().close();
  }
} finally {
  await browser.close();
  await server.close();
  rmSync(work, { recursive: true, force: true });
}

for (const name of ['hero', 'sky-sunny', 'sky-rain', 'sky-snow', 'sky-night', 'sizes'])
  console.log(`docs/images/${name}.webp  ${Math.round(statSync(`${OUT}${name}.webp`).size / 1024)} KB`);
if (refused.size) console.log(`Refused: ${[...refused].join(', ')}`);
if (faults.length) console.log(faults.join('\n'));
