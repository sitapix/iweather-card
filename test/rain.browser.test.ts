import { expect, test, vi, onTestFinished } from 'vitest';
import { context2d } from '../src/lib/canvas.ts';
import { WeatherScene } from '../src/sky/scene.ts';
import type { SceneInputs } from '../src/sky/sky.ts';
import { sharedGlass } from '../src/sky/glass-gl.ts';

const CASES = [
  { condition: 'rainy' },
  { condition: 'pouring', windSpeed: 12 },
  { condition: 'rainy', temperature: -2 },
  { condition: 'exceptional', windSpeed: 35 },
  { condition: 'snowy-rainy' },
];
const TIMES = [1000, 1016, 12000, 800, 80000];
const SIZE = { width: 390, height: 400 };

function scene(inputs: SceneInputs) {
  const result = new WeatherScene(document.createElement('canvas'));
  result.prepare(inputs);
  result.advance(0);
  return result;
}
function draw(rain: WeatherScene, phase: number, { width, height } = SIZE) {
  const canvas = rain.canvas;
  if (!canvas) throw new Error('No rain canvas.');
  canvas.width = width;
  canvas.height = height;
  const ctx = context2d(canvas);
  rain.paintRain(ctx, width, height, phase, false);
  rain.paintRain(ctx, width, height, phase, true);
  return ctx.getImageData(0, 0, width, height).data;
}

test.each(CASES)('cached drops keep their appearance across respawns and rewinds: %o', inputs => {
  const cached = scene(inputs);
  for (const phase of TIMES) {
    const expected = draw(scene(inputs), phase),
      actual = draw(cached, phase);
    expect(actual.some(channel => channel > 0)).toBe(true);
    expect(actual).toEqual(expected);
  }
});

test('rain responds immediately to resized cards, changed winds and a new kind of rain', () => {
  const cached = scene(CASES[0] ?? {});
  draw(cached, TIMES[0] ?? 0);
  for (const inputs of CASES) {
    cached.prepare(inputs);
    cached.advance(0);
    for (const size of [SIZE, { width: 600, height: 300 }])
      expect(draw(cached, 8000, size)).toEqual(draw(scene(inputs), 8000, size));
  }
});

test('dry and hidden skies release the cached drops', () => {
  const cached = scene(CASES[0] ?? {});
  draw(cached, 8000);
  expect(Object.keys(cached.rainFields).length).toBe(2);
  cached.release();
  expect(cached.rainFields).toEqual({});
  draw(cached, 8000);
  cached.prepare({ condition: 'sunny' });
  expect(cached.rainFields).toEqual({});
});

test.each(CASES)('the separate far-rain layer preserves the direct strokes: %o', inputs => {
  const rain = scene(inputs);
  for (const ratio of [1, 1.5, 3]) {
    for (const phase of [1000, 1016, 8000, 12016]) {
      const width = phase === 8000 ? 360 : 240,
        height = 180,
        alpha = phase === 1000 ? 0.4 : 1;
      const target = () => {
        const image = document.createElement('canvas');
        image.width = width * ratio;
        image.height = height * ratio;
        const ctx = context2d(image);
        ctx.setTransform(ratio, 0, 0, ratio, 0.5, -1.25);
        ctx.globalAlpha = alpha;
        return ctx;
      };
      const actual = target(),
        expected = target();
      rain.paintFarRain(actual, width, height, phase);
      rain.paintRain(expected, width, height, phase, false);
      const pixels = actual.getImageData(0, 0, actual.canvas.width, actual.canvas.height).data,
        reference = expected.getImageData(0, 0, expected.canvas.width, expected.canvas.height).data;
      let largest = 0,
        total = 0;
      for (let i = 0; i < pixels.length; i++) {
        const difference = Math.abs((pixels[i] ?? 0) - (reference[i] ?? 0));
        largest = Math.max(largest, difference);
        total += difference;
      }
      // The transparent rain coverage stays identical. Full-scene images separately
      // check the rounding introduced by blending this layer over an opaque sky.
      expect(largest, `maximum difference at DPR ${ratio}, phase ${phase}`).toBe(0);
      expect(total).toBe(0);
      expect(actual.getTransform().a).toBe(ratio);
      expect(actual.getTransform().f).toBe(-1.25);
      expect(actual.globalAlpha).toBe(alpha);
      expect(actual.globalCompositeOperation).toBe('source-over');
      expect(rain.farRain?.width).toBe(actual.canvas.width);
      expect(rain.farRain?.height).toBe(actual.canvas.height);
    }
  }
});

test('the full-resolution rain layer and bounded tile are reused and released for dry, hidden and still skies', ({
  onTestFinished,
}) => {
  const agent = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Firefox/157.0');
  onTestFinished(() => agent.mockRestore());
  const renderer = sharedGlass();
  if (!renderer) throw new Error('No glass renderer.');
  const fallback = vi.spyOn(renderer, 'beginSky').mockReturnValue(null);
  onTestFinished(() => fallback.mockRestore());
  const rain = scene({ condition: 'rainy' }),
    canvas = document.createElement('canvas'),
    ctx = context2d(canvas);
  canvas.width = 780;
  canvas.height = 800;
  ctx.scale(2, 2);
  rain.paintFarRain(ctx, 390, 400, 8000);
  const first = rain.farRain,
    tile = rain.rainTile;
  expect(tile?.width).toBe(258);
  expect(tile?.height).toBe(258);
  expect(first?.width).toBe(780);
  rain.paintFarRain(ctx, 390, 400, 9000);
  expect(rain.farRain).toBe(first);
  expect(rain.rainTile).toBe(tile);
  canvas.width = 900;
  rain.paintFarRain(ctx, 450, 400, 10000);
  expect(rain.farRain?.width).toBe(900);
  expect(rain.rainTile).toBe(tile);
  expect(tile?.width).toBe(258);
  rain.prepare({ condition: 'exceptional', windSpeed: 35 });
  expect(rain.rainTile).toBeUndefined();
  rain.paintFarRain(ctx, 450, 400, 11000);
  expect(rain.rainTile).toBeUndefined();
  rain.prepare({ condition: 'rainy' });
  rain.release();
  expect(rain.farRain).toBeUndefined();
  expect(rain.rainTile).toBeUndefined();
  rain.paintFarRain(ctx, 450, 400, 11000);
  rain.prepare({ condition: 'sunny' });
  expect(rain.farRain).toBeUndefined();
  expect(rain.rainTile).toBeUndefined();
  rain.prepare({ condition: 'rainy' });
  rain.paint(390, 400, 2, 12000);
  expect(rain.farRain).toBeDefined();
  rain.paint(390, 400, 2, 0);
  expect(rain.farRain).toBeUndefined();
  expect(rain.rainTile).toBeUndefined();
});

test.each(CASES)('tiled rain retains the original streak coverage: %o', inputs => {
  const agent = vi.spyOn(navigator, 'userAgent', 'get');
  onTestFinished(() => agent.mockRestore());
  const rain = scene(inputs);
  for (const ratio of [1, 1.5, 3]) {
    for (const phase of [1000, 1016, 8000, 12016]) {
      const target = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 240 * ratio;
        canvas.height = 180 * ratio;
        const ctx = context2d(canvas);
        ctx.setTransform(ratio, 0, 0, ratio, 0.5, -1.25);
        ctx.globalAlpha = phase === 1000 ? 0.4 : 1;
        return ctx;
      };
      const original = target(),
        tiled = target();
      agent.mockReturnValue('Chrome/156.0');
      rain.paintRain(original, 240, 180, phase, false);
      agent.mockReturnValue('Firefox/157.0');
      rain.paintRain(tiled, 240, 180, phase, false);
      const a = original.getImageData(0, 0, original.canvas.width, original.canvas.height).data,
        b = tiled.getImageData(0, 0, tiled.canvas.width, tiled.canvas.height).data;
      let worst = 0,
        total = 0;
      for (let i = 3; i < a.length; i += 4) {
        const difference = Math.abs((a[i] ?? 0) - (b[i] ?? 0));
        worst = Math.max(worst, difference);
        total += difference;
      }
      // Both render the same geometry and overlapping paths. Shorter path bounds
      // can change native antialiasing at a few intersections, and along the
      // narrow tails, thinner than a pixel at DPR 1, not the streak detail.
      expect(worst, `DPR ${ratio}, phase ${phase}`).toBeLessThanOrEqual(16);
      expect(total / (a.length / 4)).toBeLessThan(0.3);
    }
  }
});
