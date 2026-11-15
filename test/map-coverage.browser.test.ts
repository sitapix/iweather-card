import { afterEach, expect, test, vi } from 'vitest';
import { drawRadarCoverage, fieldGaps, rainRows } from '../src/map/coverage.ts';
import { drawField, PRECIPITATION } from '../src/map/field.ts';
import type { ScalarField } from '../src/map/sources.ts';

// Keep provider pacing independent of the suite's other radar traffic.
vi.mock('../src/map/pace.ts', () => ({
  pacedFetch: (url: string, signal?: AbortSignal | null) => fetch(url, { signal: signal ?? null }),
}));
afterEach(() => vi.unstubAllGlobals());
const pixels = (canvas: HTMLCanvasElement) => {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No canvas.');
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
};
const alpha = (canvas: HTMLCanvasElement, x: number, y: number) => pixels(canvas)[(y * canvas.width + x) * 4 + 3] ?? 0;
const field: ScalarField = {
  north: 10,
  west: -10,
  rows: 3,
  cols: 3,
  step: 10,
  values: Float32Array.of(0, 0, Number.NaN, 0, 0, Number.NaN, 0, 0, Number.NaN),
};

test('fallback forecast hatches missing samples and outside the grid while valid dry samples stay clear', () => {
  const rain = document.createElement('canvas'),
    coverage = document.createElement('canvas');
  drawField(rain, field, { latitude: 0, longitude: 0, zoom: 4, width: 256, height: 256 }, PRECIPITATION, coverage);
  expect(coverage.dataset['gaps']).toBe('true');
  const readings = rainRows(field, Float64Array.of(0, 10))(0);
  expect(readings[0]).toBe(0);
  expect(readings[1]).toBeNaN();
  expect(Array.from({ length: 8 }, (_, x) => alpha(coverage, 48 + x, 128)).every(value => value === 0)).toBe(true);
  expect(Array.from({ length: 8 }, (_, x) => alpha(coverage, 192 + x, 128)).some(value => value > 30)).toBe(true);
  expect(Array.from({ length: 8 }, (_, x) => alpha(coverage, x, 0)).some(value => value > 30)).toBe(true);
  expect(pixels(rain).every(value => value === 0)).toBe(true);
  expect(fieldGaps(field, { north: 5, south: -5, west: -8, east: -2 })).toBe(false);
  expect(fieldGaps(field, { north: 5, south: -5, west: 2, east: 8 })).toBe(true);
});

test('a fine forecast core keeps its position and colour between the old eight-pixel samples', () => {
  const canvas = document.createElement('canvas'),
    width = 65,
    height = 97,
    zoom = 5,
    // One model interval spans two CSS pixels. The middle point lies between coarse samples.
    step = (2 * 360) / (256 * 2 ** zoom),
    storm = { north: 4 * step, west: -4 * step, rows: 9, cols: 9, step, values: new Float32Array(81) };
  storm.values[40] = 8;
  drawField(canvas, storm, { latitude: 0, longitude: 0, zoom, width, height, pixelRatio: 2 }, PRECIPITATION);
  expect([canvas.width, canvas.height]).toEqual([2 * width, 2 * height]);
  const bytes = pixels(canvas),
    at = (x: number, y: number) => Array.from(bytes.slice((y * canvas.width + x) * 4, (y * canvas.width + x + 1) * 4)),
    [r, g, b, a] = at(width, height);
  expect(Math.min(r ?? 0, g ?? 0)).toBeGreaterThan(200);
  expect(b).toBeLessThan(75);
  expect(a).toBe(255);
  expect(at(width + 1, height)).toEqual(at(width - 2, height));
  expect(at(width + 3, height)).not.toEqual(at(width + 1, height));
  expect(at(width + 5, height)[3]).toBe(0);
});

test('interpolation preserves measured peaks, dry intervals, and the boundary of missing data', () => {
  const storm = { north: 0, west: 0, rows: 1, cols: 6, step: 1, values: Float32Array.of(0, 0, 8, 0, 0, Number.NaN) },
    at = rainRows(storm, Float64Array.of(-1, 0.5, 1.25, 1.5, 2, 2.5, 2.75, 3.5, 4, 4.5, 5));
  expect(Array.from(at(0))).toEqual([Number.NaN, 0, 1.25, 4, 8, 4, 1.25, 0, 0, Number.NaN, Number.NaN]);
  expect(at(1).every(Number.isNaN)).toBe(true);
});

test('fallback radar uses the provider coverage mask, with transparent dry coverage and crisp diagonal gaps', async () => {
  const mask = new OffscreenCanvas(512, 512),
    context = mask.getContext('2d');
  if (!context) throw new Error('No canvas.');
  context.fillRect(256, 0, 256, 512);
  const blob = await mask.convertToBlob();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(blob))),
  );
  const canvas = document.createElement('canvas');
  await drawRadarCoverage(canvas, [{ x: 0, y: 0, z: 0, left: 0, top: 0 }], 1, 256, 256, new AbortController().signal);
  expect(canvas.dataset['gaps']).toBe('true');
  expect(Array.from({ length: 8 }, (_, x) => alpha(canvas, 32 + x, 128)).every(value => value === 0)).toBe(true);
  const line = Array.from({ length: 8 }, (_, x) => alpha(canvas, 192 + x, 128));
  expect(Math.min(...line)).toBe(0);
  expect(Math.max(...line)).toBeGreaterThan(30);
});

test('an unavailable radar mask does not manufacture coverage from a failed request', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('', { status: 404 }))),
  );
  const canvas = document.createElement('canvas');
  await drawRadarCoverage(canvas, [{ x: 0, y: 0, z: 0, left: 0, top: 0 }], 1, 256, 256, new AbortController().signal);
  expect(canvas.dataset['gaps']).toBe('false');
  expect(pixels(canvas).every(value => value === 0)).toBe(true);
});
