import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import '../src/iweather-card.ts';
import type { HomeAssistant } from '../src/card/home-assistant.ts';
import type * as MapGl from '../src/map/gl.ts';
import { showRainSlots } from '../src/map/gl.ts';
import { loadRain } from '../src/map/rain-grids.ts';
import { HOUR, MINUTE } from '../src/lib/time.ts';
import { forecastLevels, isForecastTile } from '../src/map/radar-forecast.ts';

vi.mock('../src/map/rain-grids.ts', { spy: true });

vi.mock('../src/map/gl.ts', async original => {
  const actual = await original<typeof MapGl>();
  return {
    ...actual,
    groundStill: vi.fn(() => Promise.resolve(null)),
    showRainSlots: vi.fn(actual.showRainSlots),
    newMap: vi.fn((...args: Parameters<typeof actual.newMap>) =>
      actual.newMap(args[0], {
        ...args[1],
        style: `data:application/json,${encodeURIComponent(JSON.stringify({ version: 8, sources: {}, layers: [] }))}`,
        canvasContextAttributes: { preserveDrawingBuffer: true },
      }),
    ),
  };
});

const now = Math.floor(Date.now() / HOUR) * HOUR + 20 * MINUTE,
  run = Math.floor(now / HOUR) * HOUR - 2 * HOUR,
  last = now - 10 * MINUTE;
let failTiles = false;
const requests: string[] = [];
const localFetch = globalThis.fetch;
function png(size: number, colour?: string) {
  const canvas = new OffscreenCanvas(size, size),
    context = canvas.getContext('2d');
  if (!context) throw new Error('No canvas');
  if (colour) {
    context.fillStyle = colour;
    context.fillRect(0, 0, size, size);
  }
  return canvas.convertToBlob({ type: 'image/png' });
}
beforeEach(async () => {
  vi.spyOn(Date, 'now').mockReturnValue(now);
  failTiles = false;
  requests.length = 0;
  const observed = await png(512, '#005588'),
    forecast = await png(256, '#f80000'),
    empty = await png(512);
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith(location.origin))
        return localFetch(input, init);
      requests.push(url);
      if (url.includes('weather-maps.json'))
        return Promise.resolve(
          new Response(
            JSON.stringify({
              host: 'https://radar.invalid',
              radar: {
                past: [2, 1, 0].map(back => ({ time: (last - back * 10 * MINUTE) / 1000, path: `/frame/${back}` })),
              },
            }),
          ),
        );
      if (url.includes('refd_1080.json'))
        return Promise.resolve(
          new Response(
            JSON.stringify({
              model_init_utc: new Date(run).toISOString(),
              forecast_minute: 1080,
              model_forecast_utc: new Date(run + 18 * HOUR).toISOString(),
            }),
          ),
        );
      if (isForecastTile(url))
        return Promise.resolve(failTiles ? new Response('', { status: 503 }) : new Response(forecast));
      if (url.includes('/v2/coverage/')) return Promise.resolve(new Response(empty));
      if (url.includes('radar.invalid')) return Promise.resolve(new Response(observed));
      return Promise.resolve(new Response('', { status: 404 }));
    }),
  );
});
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function openMap() {
  const card = document.createElement('iweather-card');
  card.setConfig({ entity: 'weather.home', weather_layout: 'page', map: 'rainviewer', weather_animation: false });
  card.hass = {
    states: {
      'weather.home': {
        entity_id: 'weather.home',
        state: 'rainy',
        attributes: {
          temperature: 63,
          temperature_unit: '°F',
          precipitation_unit: 'in',
          wind_speed_unit: 'mph',
        },
      },
    },
    config: { latitude: 38.63, longitude: -90.2, time_zone: 'America/Chicago' },
    locale: { language: 'en', time_format: '12' },
  } satisfies HomeAssistant;
  document.body.append(card);
  await vi.waitFor(() => expect(card.root.querySelector('.tile[data-tile=map]')).not.toBeNull());
  card.root.querySelector<HTMLElement>('.tile[data-tile=map]')?.click();
  await vi.waitFor(() => expect(card.maps.gl).toBeDefined());
  return card;
}

test('a real IEM forecast tile decodes without mistaking its palette for RainViewer colors', async () => {
  // Recorded from the documented IEM endpoint, 2026-11-04 02Z run, forecast minute 180.
  const response = await localFetch(new URL('./fixtures/hrrr-refd-f0180-202611040200-z6-x15-y24.png', import.meta.url)),
    bitmap = await createImageBitmap(await response.blob()),
    canvas = new OffscreenCanvas(bitmap.width, bitmap.height),
    context = canvas.getContext('2d');
  if (!context) throw new Error('No canvas');
  expect([bitmap.width, bitmap.height]).toEqual([256, 256]);
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const levels = forecastLevels(context.getImageData(0, 0, canvas.width, canvas.height).data);
  expect(levels.some(level => level > 0)).toBe(true);
  expect(levels.some(level => level === 0)).toBe(true);
  expect(new Set(levels).size).toBeGreaterThan(5);
});

test('the live map uses real future tiles, keeps its Forecast heading, and seeks by valid time', async () => {
  const card = await openMap();
  await vi.waitFor(() => expect(card.maps.shortForecast?.data?.run).toBe(run));
  const view = card.maps.largeView();
  if (!view) throw new Error('No map');
  const timeline = card.maps.timelineOf(view);
  expect(timeline?.times).toEqual([
    last - 20 * MINUTE,
    last - 10 * MINUTE,
    last,
    run + 135 * MINUTE,
    run + 150 * MINUTE,
    run + 165 * MINUTE,
    run + 180 * MINUTE,
    run + 195 * MINUTE,
  ]);
  card.maps.timelineTime = last;
  card.maps.syncWindTime();
  expect(view.querySelector('.wind-when b')?.textContent).toBe('Forecast');
  const track = view.querySelector('.wind-track');
  track?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  expect(card.maps.timelineTime).toBe(run + 135 * MINUTE);
  expect(view.querySelector('.wind-when b')?.textContent).toBe('Forecast');
  expect(view.hasAttribute('data-forecast')).toBe(true);
  expect(view.querySelector('.map-data')?.textContent).toContain('Iowa Environmental Mesonet');
  await vi.waitFor(() => expect(requests.some(isForecastTile)).toBe(true));
  await vi.waitFor(() => expect(view.getAttribute('aria-busy')).toBe('false'));
  expect(card.maps.gl?.map.getLayoutProperty('radar-gaps', 'visibility')).toBe('none');
  track?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
  expect(card.maps.timelineTime).toBe(last);
  expect(view.querySelector('.wind-when b')?.textContent).toBe('Forecast');
});

test('a failed model tile removes future times instead of substituting the last observation', async () => {
  failTiles = true;
  const card = await openMap();
  await vi.waitFor(() => expect(requests.some(isForecastTile)).toBe(true));
  await vi.waitFor(() => expect(card.maps.shortForecast?.data).toBeNull());
  const view = card.maps.largeView();
  if (!view) throw new Error('No map');
  expect(card.maps.timelineOf(view)?.times.at(-1)).toBe(last);
  expect(view.querySelector('.wind-when b')?.textContent).toBe('Forecast');
});

test('panning beyond the model domain removes future frames and restores the observed timeline', async () => {
  const card = await openMap();
  await vi.waitFor(() => expect(card.maps.shortForecast?.data?.run).toBe(run));
  card.maps.centre = { latitude: 52, longitude: 5, zoom: 8 };
  card.maps.draw();
  const view = card.maps.largeView();
  if (!view) throw new Error('No map');
  expect(card.maps.shortFrames(view)).toEqual([]);
  expect(card.maps.timelineOf(view)?.times.at(-1)).toBe(last);
  expect(view.hasAttribute('data-forecast')).toBe(false);
});

test('the live 12-hour map replaces its first frame as forecast hours arrive and renders different hours', async () => {
  const first = Math.floor(now / HOUR) * HOUR + HOUR;
  let finish = () => {};
  vi.mocked(loadRain).mockImplementationOnce((plans, _now, update) => {
    const plan = plans[0];
    if (!plan) throw new Error('No rain plan');
    const frames = [0, 2, 0].map(value => ({
      ...plan.points,
      values: new Float32Array(plan.points.rows * plan.points.cols).fill(value),
    }));
    update({ times: [first], fields: [], precipitation: frames.slice(0, 1), slot: HOUR }, plan);
    return new Promise(resolve => {
      finish = () => {
        const hours = { times: [first, first + HOUR, first + 2 * HOUR], fields: [], precipitation: frames, slot: HOUR };
        update(hours, plan);
        resolve({ hours, plan });
      };
    });
  });
  const card = await openMap();
  card.maps.chooseSpan('12h');
  await vi.waitFor(() => expect(vi.mocked(showRainSlots).mock.lastCall?.[1]).toHaveLength(1));
  finish();
  await vi.waitFor(() => expect(vi.mocked(showRainSlots).mock.lastCall?.[1]).toHaveLength(3));
  const map = card.maps.gl?.map;
  if (!map) throw new Error('No live map');
  const alpha = async (time: number) => {
    const idle = new Promise(resolve => map.once('idle', () => resolve(undefined)));
    card.maps.timelineTime = time;
    card.maps.syncWindTime();
    map.triggerRepaint();
    await idle;
    const canvas = map.getCanvas(),
      copy = new OffscreenCanvas(canvas.width, canvas.height),
      context = copy.getContext('2d');
    if (!context) throw new Error('No pixel reader');
    context.drawImage(canvas, 0, 0);
    return context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data[3] ?? 0;
  };
  expect(await alpha(first - HOUR / 2)).toBe(0);
  expect(await alpha(first + HOUR / 2)).toBeGreaterThan(200);
  expect(await alpha(first + (3 * HOUR) / 2)).toBe(0);
});
