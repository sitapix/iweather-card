// Run against `pnpm dev`. Outputs go to ignored perf-results/, separate from tests
// because Playwright clears its output folder before each test run.
// Example: node scripts/weather-performance.ts before
// PERF_KINDS=rain,heavyRain PERF_PROFILES=desktop-day PERF_SAMPLE=5000 node scripts/weather-performance.ts repeat
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, firefox, webkit, type CDPSession, type Page } from 'playwright';
import type { IWeatherCard } from '../src/iweather-card.ts';
import type { SceneInputs } from '../src/sky/sky.ts';
import { PRESET_DATA, type SkyKind } from '../src/sky/presets-data.ts';

// A GPU drawn in software, as a browser falls back to without a graphics card it can use.
const SOFTWARE_GPU = /swiftshader|llvmpipe|software|basic render/iu;

interface Measurement {
  card: IWeatherCard;
  inputs: SceneInputs;
  enabled: boolean;
  backgrounded: boolean;
  start: number;
  phaseOrigin: number;
  times: Record<'card' | 'sky' | 'glass', number[]>;
  cardFrames: number[];
  raf: number[];
}
declare global {
  interface Window {
    __weatherPerf: Measurement;
    __weatherPerfKind: SkyKind | undefined;
  }
}

const label = process.argv[2] ?? 'run';
const origin = process.env['PERF_URL'] ?? 'http://127.0.0.1:4174';
const output = `perf-results/${label}`;
const warmup = Number(process.env['PERF_WARMUP'] ?? 1800);
const sample = Number(process.env['PERF_SAMPLE'] ?? 2200);
const phaseBase = Number(process.env['PERF_PHASE_BASE'] ?? 8000);
const engine = process.env['PERF_BROWSER'] ?? 'chrome';
const headed = process.env['PERF_HEADED'] === '1';
const refraction = process.env['PERF_GLASS_REFRACTION'] !== '0';
const throttle = Number(process.env['PERF_CPU_THROTTLE'] ?? 1);
const profiles = [
  { name: 'desktop-day', width: 1280, height: 900, dpr: 2, night: false },
  { name: 'desktop-night', width: 1280, height: 900, dpr: 2, night: true },
  { name: 'phone-day', width: 390, height: 844, dpr: 3, night: false },
  { name: 'phone-night', width: 390, height: 844, dpr: 3, night: true },
  { name: 'tablet-day', width: 820, height: 1180, dpr: 2, night: false },
  { name: 'tablet-night', width: 820, height: 1180, dpr: 2, night: true },
].filter(p => !process.env['PERF_PROFILES'] || process.env['PERF_PROFILES'].split(',').includes(p.name));
// Inputs in °C, m/s, km, mm. The three presets without a provider mapping are forced
// ONLY in the served benchmark module, without adding an override to the shipped card.
const allCases: [SkyKind, string, SceneInputs, boolean?][] = [
  ['clear', 'sunny', {}],
  ['mostlyClear', 'sunny', { cloudCover: 25 }],
  ['partlyCloudyMidAltitude', 'partlycloudy', {}],
  ['mostlyCloudyMidAltitude', 'cloudy', { cloudCover: 75 }],
  ['cloudyMidAltitude', 'exceptional', { windSpeed: 0 }],
  ['cloudyLowAltitude', 'cloudy', { temperature: 12, dewPoint: 10 }],
  ['cloudyHighAltitude', 'cloudy', {}],
  ['mostlyCloudyLowAltitude', 'cloudy', {}, true],
  ['partlyCloudyLowAltitude', 'partlycloudy', {}, true],
  ['foggy', 'fog', { visibility: 0.5, humidity: 95 }],
  ['haze', 'fog', { visibility: 3, humidity: 50 }],
  ['drizzle', 'rainy', { precipitation: 0.2 }],
  ['rain', 'rainy', {}],
  ['heavyRain', 'pouring', {}],
  ['thunderstorms', 'lightning-rainy', {}],
  ['isolatedThunderstorms', 'lightning', {}],
  ['scatteredThunderstorms', 'lightning-rainy', { cloudCover: 40 }],
  ['strongStorms', 'lightning-rainy', { precipitation: 9 }],
  ['sunShowers', 'rainy', { cloudCover: 40 }],
  ['freezingDrizzle', 'rainy', { temperature: -2, precipitation: 0.2 }],
  ['snow', 'snowy', { temperature: -2 }],
  ['flurries', 'snowy', { temperature: -2, precipitation: 0.2 }],
  ['heavySnow', 'snowy', { temperature: -2, precipitation: 4 }],
  ['sleet', 'snowy-rainy', { temperature: 1 }, true],
  ['wintryMix', 'snowy-rainy', { temperature: 1 }],
  ['hail', 'hail', { temperature: 8 }],
  ['blowingSnow', 'snowy', { temperature: -4, windSpeed: 12 }],
  ['smoky', 'exceptional', { visibility: 3, windSpeed: 1 }],
  ['hurricane', 'exceptional', { windSpeed: 35 }],
  ['freezingRain', 'rainy', { temperature: -2 }],
  ['blizzard', 'snowy', { temperature: -8, windSpeed: 18, visibility: 0.2 }],
  ['tropicalStorm', 'exceptional', { windSpeed: 20 }],
  ['blowingDust', 'exceptional', { temperature: 30, dewPoint: 5, windSpeed: 10, visibility: 3 }],
];
const missing = Object.keys(PRESET_DATA.kinds).filter(kind => !allCases.some(([covered]) => covered === kind));
if (missing.length) throw new Error(`Add benchmark inputs for these presets: ${missing.join(', ')}`);
const cases = allCases.filter(c => !process.env['PERF_KINDS'] || process.env['PERF_KINDS'].split(',').includes(c[0]));
if (!profiles.length || !cases.length) throw new Error('No matching profiles or weather presets.');

await mkdir(output, { recursive: true });
const browser = await (engine === 'firefox' ? firefox : engine === 'webkit' ? webkit : chromium).launch({
  headless: !headed,
  ...(engine === 'chrome' ? { channel: 'chrome' } : {}),
});
const results = [];
const faults: string[] = [];
const metrics = async (cdp: CDPSession | null) =>
  cdp ? Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value])) : {};
const nativeFrame = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Native animation callbacks did not resume.')), 15000);
        requestAnimationFrame(() => {
          clearTimeout(timeout);
          resolve();
        });
      }),
  );
try {
  for (const profile of profiles) {
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: profile.dpr,
      reducedMotion: 'no-preference',
    });
    const page = await context.newPage();
    page.on('pageerror', e => faults.push(String(e)));
    // Freeze only calendar time. Playwright's clock also wraps requestAnimationFrame,
    // which would measure a simulated scheduler instead of the browser's native one.
    await page.addInitScript(
      now => {
        const NativeDate = Date;
        globalThis.Date = new Proxy(NativeDate, {
          construct(target, args: unknown[]) {
            const date: unknown = Reflect.construct(target, args.length ? args : [now]);
            if (date instanceof NativeDate) return date;
            throw new Error('Could not construct a benchmark date.');
          },
        });
        Date.now = () => now;
      },
      Date.UTC(2026, 10, 3, profile.night ? 5 : 18),
    );
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) {
        faults.push(`Unexpected network request: ${url.href}`);
        return route.abort();
      }
      if (url.pathname === '/weather-performance')
        return route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>body{margin:0;background:#f2f2f4;font:14px Arial}iweather-card{display:block;width:min(1100px,100vw)}:root{--ha-font-family-body:Arial}</style><script type="module" src="/src/iweather-card.ts"></script></html>`,
        });
      if (url.pathname === '/src/sky/presets.ts') {
        const response = await route.fetch();
        const body = await response.text();
        if (!body.includes('switch (isCondition')) throw new Error('Preset instrumentation no longer matches.');
        return route.fulfill({
          response,
          body: body.replace(
            'switch (isCondition',
            'if (window.__weatherPerfKind) return window.__weatherPerfKind;\n switch (isCondition',
          ),
        });
      }
      return route.continue();
    });
    await page.goto(`${origin}/weather-performance`);
    await page.waitForFunction(() => customElements.get('iweather-card'));
    const cdp = ['chrome', 'chromium'].includes(engine) ? await context.newCDPSession(page) : null;
    if (cdp) await cdp.send('Performance.enable');
    if (cdp && throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    const seen = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      const gpu: unknown = gl && ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
      return { ua: navigator.userAgent, gpu: typeof gpu === 'string' ? gpu : null };
    });
    // The renderer's kind rather than its name, which names the machine's maker.
    const environment = {
      ...seen,
      gpu: seen.gpu === null ? null : SOFTWARE_GPU.test(seen.gpu) ? 'software renderer' : 'hardware GPU',
    };
    console.log(JSON.stringify({ profile: profile.name, ...environment }));
    for (const [kind, condition, readings, forced] of cases) {
      await page.evaluate(
        ({ kind, condition, readings, forced, night, phaseBase, refraction }) => {
          document.body.replaceChildren();
          window.__weatherPerfKind = forced ? kind : undefined;
          const hour = 3600000,
            now = Date.now(),
            start = Math.floor(now / hour) * hour;
          const hourly = Array.from({ length: 48 }, (_, i) => ({
            datetime: new Date(start + i * hour).toISOString(),
            condition,
            temperature: 15 + Math.round(Math.sin(i / 4) * 4),
            precipitation: 1,
            precipitation_probability: 60,
            wind_speed: 8,
            wind_bearing: 200,
            uv_index: 3,
          }));
          const daily = Array.from({ length: 10 }, (_, i) => ({
            datetime: new Date(start + i * 24 * hour).toISOString(),
            condition,
            temperature: 17,
            templow: 8,
            precipitation: 1,
          }));
          const inputs = {
            temperature: 15,
            windSpeed: 3,
            precipitationUnit: 'mm',
            condition,
            night,
            elevation: night ? -30 : 38,
            rising: false,
            moonAltitude: night ? 45 : -20,
            moonHour: 23,
            solarHour: night ? 0 : 14,
            ...readings,
          };
          const card = document.createElement('iweather-card');
          card.setConfig({
            type: 'custom:iweather-card',
            entity: 'weather.home',
            weather_layout: 'page',
            weather_animation: true,
            glass_refraction: refraction,
            local_only: true,
          });
          card.hass = {
            states: {
              'weather.home': {
                entity_id: 'weather.home',
                state: condition,
                attributes: {
                  temperature: inputs.temperature ?? 15,
                  temperature_unit: '°C',
                  wind_speed: inputs.windSpeed,
                  wind_speed_unit: 'm/s',
                  wind_bearing: 200,
                  humidity: inputs.humidity ?? 80,
                  ...(inputs.dewPoint === undefined ? {} : { dew_point: inputs.dewPoint }),
                  ...(inputs.cloudCover === undefined ? {} : { cloud_coverage: inputs.cloudCover }),
                  ...(inputs.visibility === undefined ? {} : { visibility: inputs.visibility }),
                  visibility_unit: 'km',
                  ...(inputs.precipitation === undefined ? {} : { precipitation: inputs.precipitation }),
                  precipitation_unit: 'mm',
                  uv_index: 3,
                  pressure: 1013,
                  pressure_unit: 'hPa',
                  friendly_name: kind,
                  supported_features: 3,
                },
              },
              'sun.sun': {
                entity_id: 'sun.sun',
                state: night ? 'below_horizon' : 'above_horizon',
                attributes: { elevation: inputs.elevation ?? 38, rising: false },
              },
            },
            language: 'en',
            locale: { language: 'en', time_format: '12' },
            config: { location_name: 'Home', time_zone: 'America/Chicago', latitude: 41.9, longitude: -87.6 },
            connection: {
              subscribeMessage(callback, message) {
                queueMicrotask(() => callback({ forecast: message.forecast_type === 'hourly' ? hourly : daily }));
                return Promise.resolve(() => {});
              },
            },
          };
          document.body.append(card);
          window.__weatherPerf = {
            card,
            inputs,
            enabled: false,
            backgrounded: false,
            start: 0,
            phaseOrigin: performance.now(),
            times: { card: [], sky: [], glass: [] },
            cardFrames: [],
            raf: [],
          };
          // Compare the same part of the moving sky in each case, while keeping
          // the browser's real animation scheduler and performance clock.
          const state = window.__weatherPerf,
            paint = card.paint.bind(card);
          window.onblur = () => {
            if (state.enabled) state.backgrounded = true;
          };
          card.paint = function (phase) {
            paint(this.animating && phase !== 0 ? phaseBase + performance.now() - state.phaseOrigin : phase);
          };
          function instrument<Args extends unknown[]>(
            object: { paint: (...args: Args) => void },
            name: keyof Measurement['times'],
          ): (...args: Args) => void {
            const original = object.paint;
            object.paint = function (...args: Args) {
              const state = window.__weatherPerf;
              if (!state.enabled) {
                original.apply(this, args);
                return;
              }
              const start = performance.now();
              if (name === 'card') state.cardFrames.push(start);
              original.apply(this, args);
              state.times[name].push(performance.now() - start);
            };
            return original;
          }
          instrument(card, 'card');
          instrument(card.scene, 'sky');
          instrument(card.glass, 'glass');
        },
        { kind, condition, readings, forced: Boolean(forced), night: profile.night, phaseBase, refraction },
      );
      await page.waitForFunction(() => {
        const { card } = window.__weatherPerf;
        return Boolean(card.scene.key && card.shadowRoot?.querySelector('.tile') && card.parts.sky.width);
      });
      if (engine === 'firefox' && headed) {
        // Recompute native window visibility before timing; a visible page can still
        // have its compositor marked occluded. Keep the requested viewport unchanged.
        await page.setViewportSize({ width: profile.width + 1, height: profile.height });
        await page.setViewportSize({ width: profile.width, height: profile.height });
      }
      await page.bringToFront();
      await page.evaluate(() => {
        const { card, inputs } = window.__weatherPerf;
        window.__weatherPerf.phaseOrigin = performance.now();
        card.scene.prepare(inputs, { wide: card.scene.wide });
        card.paint(0);
      });
      if (process.env['PERF_SCROLL'])
        await page.evaluate(top => window.scrollTo(0, top), Number(process.env['PERF_SCROLL']));
      await page.waitForTimeout(warmup);
      await nativeFrame(page);
      const prepared = await page.evaluate(
        phaseBase => ({
          kind: window.__weatherPerf.card.scene.preset?.kind,
          interval: window.__weatherPerf.card.scene.frameInterval,
          phaseAtSample: phaseBase + performance.now() - window.__weatherPerf.phaseOrigin,
          visibility: document.visibilityState,
          focused: document.hasFocus(),
        }),
        phaseBase,
      );
      if (prepared.kind !== kind) throw new Error(`Expected ${kind}, got ${String(prepared.kind)}`);
      const trace = Boolean(process.env['PERF_TRACE']);
      if (trace && cdp) {
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.start');
      }
      const before = await metrics(cdp);
      await page.evaluate(() => {
        const state = window.__weatherPerf;
        state.times = { card: [], sky: [], glass: [] };
        state.cardFrames = [];
        state.raf = [];
        state.enabled = true;
        state.backgrounded = false;
        state.start = performance.now();
        let last: number | undefined;
        const frame = (now: number) => {
          if (!state.enabled) return;
          if (last !== undefined) state.raf.push(now - last);
          last = now;
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      await page.waitForTimeout(sample);
      // Include a complete final interval, including a stall that crosses the end
      // of the requested sample, instead of silently dropping its unfinished tail.
      await nativeFrame(page);
      const measured = await page.evaluate(() => {
        const state = window.__weatherPerf;
        state.enabled = false;
        const duration = performance.now() - state.start;
        const stats = (a: number[]) => {
          const sorted = a.toSorted((a, b) => a - b);
          return {
            count: a.length,
            mean: a.length ? a.reduce((a, b) => a + b, 0) / a.length : 0,
            p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
            max: sorted.at(-1) ?? 0,
          };
        };
        return {
          duration,
          visibility: document.visibilityState,
          focused: document.hasFocus(),
          backgrounded: state.backgrounded,
          drawsPerSecond: (state.times.card.length * 1000) / duration,
          times: { card: stats(state.times.card), sky: stats(state.times.sky), glass: stats(state.times.glass) },
          drawIntervals: stats(state.cardFrames.slice(1).map((at, i) => at - (state.cardFrames[i] ?? at))),
          raf: stats(state.raf),
          skyPixels: [state.card.parts.sky.width, state.card.parts.sky.height],
          gpuRain: state.card.scene.hasGPUSky,
          glassPixels: state.card.glass.drops ? [state.card.glass.drops.width, state.card.glass.drops.height] : null,
        };
      });
      const after = await metrics(cdp);
      if (prepared.visibility !== 'visible' || measured.visibility !== 'visible')
        throw new Error(`The benchmark tab became hidden during ${kind}; keep it visible and repeat this run.`);
      if (headed && (!prepared.focused || !measured.focused || measured.backgrounded))
        throw new Error(`The benchmark window lost focus during ${kind}; repeat this run with it in front.`);
      if (!measured.times.card.count || !measured.raf.count) {
        const state = await page.evaluate(() => {
          const card = window.__weatherPerf.card,
            { x, y, width, height } = card.getBoundingClientRect();
          return {
            visibility: document.visibilityState,
            animating: card.animating,
            connected: card.isConnected,
            bounds: { x, y, width, height },
          };
        });
        throw new Error(`No animated frames measured for ${kind}: ${JSON.stringify(state)}`);
      }
      // Some window managers pause native animation callbacks without changing the DOM's
      // visibility/focus flags. Reject samples that only covered part of the window.
      const rafCoverage = (measured.raf.count * measured.raf.mean) / measured.duration;
      if (rafCoverage < 0.8)
        throw new Error(`Animation callbacks covered only ${(rafCoverage * 100).toFixed(1)}% of ${kind}; repeat.`);
      const result = {
        profile: profile.name,
        viewport: { width: profile.width, height: profile.height, dpr: profile.dpr },
        throttle,
        glassRefraction: refraction,
        forced: Boolean(forced),
        ...environment,
        ...prepared,
        ...measured,
        rafCoverage,
        taskMsPerSecond: cdp
          ? (((after['TaskDuration'] ?? 0) - (before['TaskDuration'] ?? 0)) * 1e6) /
            (((after['Timestamp'] ?? 0) - (before['Timestamp'] ?? 0)) * 1000)
          : null,
      };
      if (trace && cdp) {
        const { profile: cpu } = await cdp.send('Profiler.stop');
        await writeFile(`${output}/${profile.name}-${kind}.cpuprofile`, JSON.stringify(cpu));
      }
      results.push(result);
      console.log(
        `${profile.name} ${kind}: ${result.taskMsPerSecond?.toFixed(1) ?? '-'} task ms/s; ${measured.drawsPerSecond.toFixed(1)} draws/s; paint p95 ${measured.times.card.p95.toFixed(1)} ms`,
      );
      await writeFile(
        `${output}/results.json`,
        JSON.stringify(
          {
            label,
            warmup,
            sample,
            phaseBase,
            engine,
            headed,
            windowOcclusion: process.env['MOZ_WINDOW_OCCLUSION'] ?? null,
            results,
            faults,
          },
          null,
          2,
        ),
      );
      if (process.env['PERF_SCREENSHOTS'] !== '0') {
        await page.evaluate(() => {
          const { card, inputs } = window.__weatherPerf;
          card.setConfig({ ...card.config, weather_animation: false });
          card.scene.prepare(inputs, { wide: card.scene.wide });
          card.scene.advance(0);
          card.paint(8000);
        });
        await page.screenshot({ path: `${output}/${profile.name}-${kind}.png` });
      }
    }
    await writeFile(`${output}/${profile.name}-accessibility.txt`, await page.locator('body').ariaSnapshot());
    await context.close();
  }
} finally {
  await browser.close();
}
if (faults.length) throw new Error(JSON.stringify(faults));
