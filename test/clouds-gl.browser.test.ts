import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { CloudAtlas } from '../src/sky/cloud-decks.ts';
import { CLOUD_SPRITES } from '../src/sky/clouds.ts';
import { CloudPainter, cloudPainter, resetCloudPainter } from '../src/sky/clouds-gl.ts';
import { WeatherScene } from '../src/sky/scene.ts';
import { context2d } from '../src/lib/canvas.ts';
import { CLOUD_MAPS } from './cloud-maps.ts';

// The sky as the full page draws it, as in sky.browser.test.ts.
const WIDTH = 1310,
  HEIGHT = 1355,
  RATIO = 1.6;
const OVERCAST = { condition: 'cloudy', night: true, elevation: -60, cloudCover: 100 };
const PHASE = 225000;

const sky = (inputs: Parameters<WeatherScene['prepare']>[0]) => {
  const scene = new WeatherScene(document.createElement('canvas'));
  scene.prepare(inputs);
  return scene;
};
// Paints until the GPU painter can draw, or the clouds have gone to the 2D drawing.
async function drawn(scene: WeatherScene, atlas: CloudAtlas) {
  scene.paint(WIDTH, HEIGHT, RATIO, PHASE);
  await atlas.ready;
  scene.paint(WIDTH, HEIGHT, RATIO, PHASE);
}
// The open sky either side of the hero text: its mean and spread of green.
function tone(scene: WeatherScene) {
  const { canvas } = scene;
  if (!canvas) throw new Error('The scene has no canvas.');
  const values: number[] = [];
  for (const left of [40, 1400]) {
    const { data } = context2d(canvas).getImageData(left, 170, 600, 330);
    for (let i = 1; i < data.length; i += 4) values.push(data[i] ?? 0);
  }
  const mean = values.reduce((a, b) => a + b, 0) / values.length,
    spread = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  return { mean, spread };
}

// The test browser's GPU is emulated in software, which the card leaves to the 2D drawing.
beforeEach(() => {
  CloudPainter.software = true;
});
afterEach(() => {
  CloudPainter.software = false;
  resetCloudPainter();
  vi.restoreAllMocks();
  WeatherScene.atlas = undefined;
  WeatherScene.gpuClouds = true;
});

test('the GPU draws an overcast in the tone the 2D drawing gives it', async () => {
  WeatherScene.gpuClouds = false;
  const atlas = new CloudAtlas(CLOUD_MAPS);
  WeatherScene.atlas = atlas;
  const flat = sky(OVERCAST);
  await drawn(flat, atlas);
  const before = tone(flat);
  WeatherScene.gpuClouds = true;
  const scene = sky(OVERCAST);
  scene.paint(WIDTH, HEIGHT, RATIO, PHASE);
  for (let tries = 0; tries < 200 && !scene.painter(); tries++) await new Promise(resolve => setTimeout(resolve, 25));
  expect(scene.painter()).not.toBeNull();
  scene.paint(WIDTH, HEIGHT, RATIO, PHASE);
  const after = tone(scene);
  expect(Math.abs(after.mean - before.mean)).toBeLessThan(3);
  expect(Math.abs(after.spread - before.spread)).toBeLessThan(3);
  // Once the GPU has its own copy, the 2D maps are let go.
  expect(atlas.loaded).toBe(false);
});

test('on the GPU, the copies of a lid meet on whole device pixels, each where the last ends', async () => {
  const atlas = new CloudAtlas(CLOUD_MAPS, { now: false });
  WeatherScene.atlas = atlas;
  // Fog lifted into a low overcast, by day: a lid that shows plainly.
  const scene = sky({ condition: 'fog', night: false, elevation: 30, visibility: 8 });
  await drawn(scene, atlas);
  expect(scene.painter()).not.toBeNull();
  const paint = vi.spyOn(CloudPainter.prototype, 'paint');
  for (const phase of [1234, 3456, 8888]) scene.paint(WIDTH, HEIGHT, RATIO, phase);
  const lids = paint.mock.calls
    .filter(([target]) => target.canvas === scene.canvas)
    .map(([, draws]) => draws.filter(draw => draw.sprite >= CLOUD_SPRITES.length));
  expect(lids.length).toBeGreaterThanOrEqual(3);
  for (const copies of lids) {
    expect(copies.length).toBe(6);
    for (const [index, { x, width }] of copies.entries()) {
      for (const edge of [x, x + width]) expect(Math.abs(edge * RATIO - Math.round(edge * RATIO))).toBeLessThan(1e-6);
      const next = copies[index + 1];
      if (next) expect(next.x).toBeCloseTo(x + width, 6);
    }
  }
});

test('without WebGL2 the clouds go to the 2D drawing', async () => {
  const atlas = new CloudAtlas(CLOUD_MAPS, { now: false });
  WeatherScene.atlas = atlas;
  // The painter asks for its context first of all.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValueOnce(null);
  expect(cloudPainter(atlas, image => image)).toBeNull();
  await expect(atlas.ready).resolves.toBe(true);
  expect(atlas.loaded).toBe(true);
  expect(cloudPainter(atlas, image => image)).toBeNull();
});

test('a GPU that loses its context hands the clouds back to the 2D drawing', async () => {
  const atlas = new CloudAtlas(CLOUD_MAPS, { now: false });
  WeatherScene.atlas = atlas;
  const scene = sky(OVERCAST);
  await drawn(scene, atlas);
  const painter = scene.painter();
  expect(painter).not.toBeNull();
  painter?.canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
  for (let tries = 0; tries < 200 && !atlas.loaded; tries++) {
    scene.paint(WIDTH, HEIGHT, RATIO, PHASE);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  expect(atlas.loaded).toBe(true);
});

test('as the page scrolls over the sky, each cloud layer rises by its own share of it, the front most', async () => {
  const atlas = new CloudAtlas(CLOUD_MAPS, { now: false });
  WeatherScene.atlas = atlas;
  // A sky with clouds on every deck.
  const scene = sky({ condition: 'partlycloudy', night: false, elevation: 40, cloudCover: 50 }),
    scroll = 300;
  await drawn(scene, atlas);
  expect(scene.painter()).not.toBeNull();
  const paint = vi.spyOn(CloudPainter.prototype, 'paint'),
    heights = (offset: number) => {
      paint.mockClear();
      scene.paint(WIDTH, HEIGHT, RATIO, PHASE, { scroll: offset });
      return paint.mock.calls.flatMap(([, draws]) => draws.map(draw => draw.y));
    };
  const still = heights(0),
    scrolled = heights(scroll),
    lifts = still.map((y, i) => Math.round((y - (scrolled[i] ?? y)) * 100) / 100);
  expect(scrolled.length).toBe(still.length);
  for (const lift of lifts) {
    expect(lift).toBeGreaterThanOrEqual(scroll * 0.03 - 0.01);
    expect(lift).toBeLessThanOrEqual(scroll * 0.12 + 0.01);
  }
  // Layers at different depths move by different amounts.
  expect(new Set(lifts).size).toBeGreaterThan(1);
});
