import { afterAll, beforeAll, expect, onTestFinished, test, vi } from 'vitest';
import { CloudAtlas, FALLBACK_SCALE, frameUnit } from '../src/sky/cloud-decks.ts';
import { CLOUD_MAPS } from './cloud-maps.ts';
import { BLANKET_WIDTH } from '../src/sky/clouds.ts';
import { WeatherScene, feathered } from '../src/sky/scene.ts';
import { context2d } from '../src/lib/canvas.ts';
import { sharedGlass } from '../src/sky/glass-gl.ts';

// The sky as the full page draws it: a page 1310 × 1355 at 1.6 device pixels to its own.
const WIDTH = 1310,
  HEIGHT = 1355,
  RATIO = 1.6;
const OVERCAST = { condition: 'cloudy', night: true, elevation: -60, cloudCover: 100 };
// One frame shows only the clouds passing then, so the sky's colour is read across half an hour.
const DRIFT = { frames: 16, step: 131000 };
// A lid is drawn six times a frame: three of it, three mirrored.
const COPIES = 6;
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

test('a night overcast is a blue-grey sky, about rgb(41, 48, 60), as the clouds drift across it', () => {
  const scene = sky(OVERCAST),
    totals = [0, 0, 0];
  let count = 0;
  for (let frame = 0; frame < DRIFT.frames; frame++) {
    scene.paint(WIDTH, HEIGHT, RATIO, frame * DRIFT.step);
    const { canvas } = scene;
    if (!canvas) throw new Error('The scene has no canvas.');
    // The open sky either side of the hero text.
    for (const left of [40, 1400]) {
      const { data } = context2d(canvas).getImageData(left, 170, 600, 330);
      for (let i = 0; i < data.length; i += 4)
        for (let c = 0; c < 3; c++) totals[c] = (totals[c] ?? 0) + (data[i + c] ?? 0);
      count += data.length / 4;
    }
  }
  const [red = 0, green = 0, blue = 0] = totals.map(total => total / count);
  expect(Math.abs(red - 41)).toBeLessThan(2);
  expect(Math.abs(green - 47.5)).toBeLessThan(2);
  expect(Math.abs(blue - 60)).toBeLessThan(2);
  expect(blue - red).toBeGreaterThanOrEqual(17);
});

test('a night overcast is mottled: cloud as bright as rgb(68, 74, 84) over a sky of rgb(30, 37, 50)', () => {
  const scene = sky(OVERCAST);
  scene.paint(WIDTH, HEIGHT, RATIO, 225000);
  const { canvas } = scene;
  if (!canvas) throw new Error('The scene has no canvas.');
  const { data } = context2d(canvas).getImageData(40, 170, 600, 330),
    tones = Array.from({ length: data.length / 4 }, (_, i) => data[i * 4 + 1] ?? 0).toSorted((a, b) => a - b),
    at = (share: number) => tones[Math.floor(tones.length * share)] ?? 0;
  expect(at(0.99) - at(0.05)).toBeGreaterThan(24);
});

test('with no light to follow, a cloud is drawn once a frame, solid as its sprite', () => {
  const scene = sky({ condition: 'cloudy', night: true, elevation: -60, cloudCover: 100 }),
    clouds = (scene.decks ?? []).flat().filter(Boolean).length;
  const draws = vi.spyOn(CanvasRenderingContext2D.prototype, 'drawImage');
  scene.paint(WIDTH, HEIGHT, RATIO, 1234);
  const sprites = draws.mock.calls.filter(([image]) => image instanceof HTMLCanvasElement && image.height === 168);
  expect(sprites.length).toBeLessThanOrEqual(clouds);
  draws.mockRestore();
});

test('a lid runs off the top of the card, so no dark line shows along its edge', () => {
  const scene = sky({ condition: 'rainy', elevation: 40, cloudCover: 100 });
  scene.paint(WIDTH, HEIGHT, RATIO, 0);
  const { canvas } = scene;
  if (!canvas) throw new Error('The scene has no canvas.');
  const row = (y: number) => {
    const { data } = context2d(canvas).getImageData(0, y, canvas.width, 1);
    return data.reduce((sum, value, i) => (i % 4 === 1 ? sum + value : sum), 0) / canvas.width;
  };
  expect(Math.abs(row(0) - row(12))).toBeLessThan(4);
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

test.each([false, true])('the copies of a lid meet on whole pixels with GPU rain %s', gpu => {
  const renderer = sharedGlass();
  if (!renderer) throw new Error('No shared renderer.');
  if (!gpu) {
    const fallback = vi.spyOn(renderer, 'beginSky').mockReturnValue(null);
    onTestFinished(() => fallback.mockRestore());
  }
  const scene = sky({ condition: 'rainy', night: true, elevation: -40, cloudCover: 100 }),
    draws = vi.spyOn(CanvasRenderingContext2D.prototype, 'drawImage');
  for (const phase of [1234, 3456, 8888]) scene.paint(WIDTH, HEIGHT, RATIO, phase);
  expect(scene.hasGPUSky).toBe(gpu);
  onTestFinished(() => scene.release());
  // A lid's copies: lit blankets on the native sky or the GPU's background surface.
  const edges = draws.mock.calls.flatMap(([image, x, , width], index) => {
    const on = draws.mock.contexts[index];
    return on instanceof CanvasRenderingContext2D &&
      (gpu || on.canvas === scene.canvas) &&
      image instanceof HTMLCanvasElement &&
      image.width === BLANKET_WIDTH * FALLBACK_SCALE &&
      typeof width === 'number'
      ? [[x, x + width] as const]
      : [];
  });
  draws.mockRestore();
  expect(edges.length).toBeGreaterThanOrEqual(COPIES);
  const density = gpu ? 1 : RATIO;
  for (const [index, [start, end]] of edges.entries()) {
    for (const edge of [start, end]) expect(Math.abs(edge * density - Math.round(edge * density))).toBeLessThan(1e-6);
    // Each copy starts where the one before it ended.
    const next = edges[index + 1];
    if (next && (index + 1) % COPIES) expect(next[0]).toBeCloseTo(end, 6);
  }
});

test('each cloud drifts left at its own speed in scene units a second, under a lid that hangs all but still', () => {
  // Where each cloud sprite, or each copy of a lid, was drawn on one frame, in draw order.
  const lefts = (scene: WeatherScene, phase: number, lid: boolean) => {
    const draws = vi.spyOn(CanvasRenderingContext2D.prototype, 'drawImage');
    scene.paint(WIDTH, HEIGHT, RATIO, phase);
    const xs = draws.mock.calls.flatMap(([image, x]) =>
      image instanceof HTMLCanvasElement &&
      (lid ? image.width === BLANKET_WIDTH * FALLBACK_SCALE : image.height === 168) &&
      typeof x === 'number'
        ? [x]
        : [],
    );
    draws.mockRestore();
    return xs;
  };
  const unit = frameUnit(WIDTH, HEIGHT),
    overcast = sky(OVERCAST),
    clouds = (overcast.decks ?? []).flatMap(deck => deck ?? []),
    wind = overcast.preset?.cloudSpeed ?? 0,
    before = lefts(overcast, 225000, false),
    after = lefts(overcast, 226000, false);
  expect(before).toHaveLength(clouds.length);
  for (const [index, cloud] of clouds.entries()) {
    const moved = (after[index] ?? 0) - (before[index] ?? 0);
    // One that wrapped round in that second has started again at the far side.
    if (moved < 0) expect(moved).toBeCloseTo(-cloud.speed * unit * wind, 4);
  }
  const rain = sky({ condition: 'rainy', night: true, elevation: -40, cloudCover: 100 }),
    slowest = Math.min(...(rain.decks ?? []).flatMap(deck => deck ?? []).map(cloud => cloud.speed)),
    minute = slowest * unit * (rain.preset?.cloudSpeed ?? 0) * 60,
    lid = (phase: number) => Math.min(...lefts(rain, phase, true));
  expect(Math.abs(lid(61000) - lid(1000))).toBeLessThan(minute / 20);
});

test("a lid's sides keep their cover as its outline eases, so the sky can't show down a join", () => {
  const size = 96,
    image = document.createElement('canvas');
  image.width = image.height = size;
  context2d(image).fillRect(0, 0, size, size);
  const eased = context2d(feathered(image));
  const cover = (x: number) => eased.getImageData(x, size / 2, 1, 1).data[3] ?? 0;
  expect(cover(0)).toBeGreaterThan(250);
  expect(cover(size - 1)).toBeGreaterThan(250);
  expect(eased.getImageData(size / 2, 0, 1, 1).data[3] ?? 0).toBeLessThan(200);
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
