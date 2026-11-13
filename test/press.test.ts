import { afterEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { pointEasing, springEasing } from '../src/lib/press.ts';

test('a tile springs back without going past full size, as measured', () => {
  const stops = /^linear\((.*)\)$/.exec(springEasing())?.[1]?.split(',').map(Number) ?? [];
  // Sampled every 20 ms over 0.6 s, from 0 to 1, never past it.
  assert.equal(stops.length, 31);
  assert.deepEqual([stops[0], stops.at(-1)], [0, 1]);
  assert.ok(stops.every((stop, i) => i === 0 || stop >= (stops[i - 1] ?? 0)));
  assert.ok(Math.max(...stops) <= 1);
  // About two thirds of the way back 140 ms after letting go, nearly all of it by 400 ms.
  assert.ok(Math.abs((stops[7] ?? 0) - 0.67) < 0.02);
  assert.ok((stops[20] ?? 0) > 0.985);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("a browser that cannot ease along points is given an easing it can, as one it can't would throw", () => {
  vi.stubGlobal('CSS', { supports: () => false });
  assert.equal(pointEasing('linear(0,.5,1)'), 'ease-out');
  assert.equal(springEasing(), 'ease-out');
  vi.stubGlobal('CSS', { supports: () => true });
  assert.equal(pointEasing('linear(0,.5,1)'), 'linear(0,.5,1)');
});
