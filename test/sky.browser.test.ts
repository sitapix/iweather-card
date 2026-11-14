import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { CloudAtlas, type Tint } from '../src/sky/cloud-decks.ts';
import { CLOUD_MAPS } from './cloud-maps.ts';
import { cloudSlots } from '../src/sky/clouds.ts';
import { WeatherScene } from '../src/sky/scene.ts';
import { context2d } from '../src/lib/canvas.ts';

// The sky as the full page draws it: a page 1310 × 1355 at 1.6 device pixels to its own.
const WIDTH = 1310,
  HEIGHT = 1355,
  RATIO = 1.6;
const OVERCAST = { condition: 'cloudy', night: true, elevation: -60, cloudCover: 100 };
const sky = (inputs: Parameters<WeatherScene['prepare']>[0]) => {
  const scene = new WeatherScene(document.createElement('canvas'));
  scene.prepare(inputs);
  return scene;
};

// These are the 2D drawing's skies; the GPU's are in clouds-gl.browser.test.ts.
beforeAll(async () => {
  WeatherScene.gpuClouds = false;
  WeatherScene.atlas = new CloudAtlas(CLOUD_MAPS);
  await WeatherScene.atlas.ready;
});
afterAll(() => {
  WeatherScene.atlas = undefined;
  WeatherScene.gpuClouds = true;
});

test('uniform ambient light follows the authored silhouette, including partial opacity', () => {
  const atlas = WeatherScene.atlas;
  if (!atlas) throw new Error('Missing cloud atlas');
  const sprite = cloudSlots('Cumulus_SingleM')[0] ?? 0,
    off: Tint = [0, 0, 0, 0],
    whole = atlas.lit(sprite, false, [1, 0, 0], off, [60, 90, 120, 1]),
    thin = atlas.lit(sprite, false, [1, 0, 0], off, [15, 22.5, 30, 1], off, 0.25);
  if (!whole || !thin) throw new Error('Missing lit cloud');
  const sample = (image: HTMLCanvasElement) => context2d(image).getImageData(0, 0, image.width, image.height).data;
  const full = sample(whole),
    partial = sample(thin);
  let opaque = 0,
    clear = 0,
    edge = 0,
    colorError = 0,
    alphaError = 0;
  for (let i = 3; i < full.length; i += 4) {
    const alpha = full[i] ?? 0;
    if (alpha === 0) clear++;
    if (alpha > 200) {
      opaque++;
      colorError = Math.max(colorError, Math.abs((full[i - 2] ?? 0) - 90));
    }
    if (alpha > 0 && alpha < 200) edge++;
    alphaError = Math.max(alphaError, Math.abs((partial[i] ?? 0) - alpha * 0.25));
  }
  expect(Math.min(opaque, clear, edge)).toBeGreaterThan(0);
  expect(Math.max(colorError, alphaError)).toBeLessThanOrEqual(1);
});

test('a sky keeps cloud artwork and positions when only lighting or measured wind changes', () => {
  const scene = sky(OVERCAST),
    before = scene.decks,
    art = scene.blanket?.sprite;
  scene.prepare({ ...OVERCAST, elevation: -25, windSpeed: 18 });
  expect(scene.decks).toEqual(before);
  expect(scene.blanket?.sprite).toBe(art);
});

test('a sun over a blue sky pales to white through no ring of pure cyan and no hard edge', () => {
  const scene = sky({ condition: 'sunny', elevation: 40, cloudCover: 0, solarHour: 12 });
  scene.paint(WIDTH, HEIGHT, RATIO, 0);
  const { canvas } = scene;
  if (!canvas) throw new Error('The scene has no canvas.');
  const { data } = context2d(canvas).getImageData(0, 0, canvas.width, Math.round(HEIGHT / 2));
  let clipped = 0,
    steepest = 0;
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i + 1] ?? 0) >= 254 && (data[i + 2] ?? 0) >= 254 && (data[i] ?? 0) < 245) clipped++;
    if (i > 12) steepest = Math.max(steepest, Math.abs((data[i] ?? 0) - (data[i - 12] ?? 0)));
  }
  expect(clipped).toBe(0);
  expect(steepest).toBeLessThan(40);
});

test('the signed light maps send the key and fill to opposite sides of the same silhouette', () => {
  const atlas = WeatherScene.atlas;
  if (!atlas) throw new Error('Missing cloud atlas');
  const sprite = cloudSlots('Cumulus_SingleM')[0] ?? 0,
    off: Tint = [0, 0, 0, 0],
    white: Tint = [255, 255, 255, 1],
    lit = atlas.lit(sprite, false, [1, 0, 0], white, off),
    reversed = atlas.lit(sprite, false, [-1, 0, 0], off, off, white);
  if (!lit || !reversed) throw new Error('Missing lit cloud');
  const center = (image: HTMLCanvasElement) =>
    Array.from(context2d(image).getImageData(Math.floor(image.width / 2), Math.floor(image.height / 2), 1, 1).data);
  expect(center(lit)).toEqual(center(reversed));
});

test('low power gives up frames and sharpness, and a third of the fall stays', () => {
  const canvas = document.createElement('canvas'),
    scene = new WeatherScene(canvas),
    storm = { condition: 'pouring', night: false, elevation: 30, cloudCover: 100 };
  scene.prepare(storm);
  scene.paint(WIDTH, HEIGHT, RATIO, 0);
  expect(canvas.width).toBe(Math.round(WIDTH * RATIO));
  expect(scene.frameInterval).toBeLessThan(50);
  scene.lowPower = true;
  scene.paint(WIDTH, HEIGHT, RATIO, 0);
  expect(canvas.width * canvas.height).toBeLessThanOrEqual(1_001_000);
  expect(canvas.width * canvas.height).toBeGreaterThan(990_000);
  expect(scene.frameInterval).toBe(50);
  scene.paint(320, 400, 3, 0);
  expect(canvas.width).toBe(320);
});

test('clouds that do not come leave the sky without them, and no fault', async () => {
  const atlas = new CloudAtlas(CLOUD_MAPS.map(() => '/assets/there-is-no-such-picture.avif'));
  await expect(atlas.ready).resolves.toBe(false);
});

test('a flat-lit sky of vast faint clouds takes a fine grain, and other skies none', () => {
  const grained = (condition: string, visibility?: number) => {
    const scene = new WeatherScene(document.createElement('canvas')),
      grain = vi.spyOn(scene, 'paintGrain');
    scene.prepare({ condition, night: true, elevation: -40, ...(visibility === undefined ? {} : { visibility }) });
    scene.paint(320, 240, 1, 0);
    return grain.mock.calls.length > 0;
  };
  expect(grained('fog', 0.3)).toBe(true);
  expect(grained('cloudy')).toBe(false);
  expect(grained('clear-night')).toBe(false);
});
