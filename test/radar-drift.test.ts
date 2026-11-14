import { test } from 'vitest';
import assert from 'node:assert/strict';
import { driftBetween } from '../src/map/radar-drift.ts';

const SIZE = 160;
// A frame with a blob of rain centred at (x, y), in RGBA.
const blob = (cx: number, cy: number) => {
  const pixels = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const near = Math.hypot(x - cx, y - cy) < 18 || Math.hypot(x - cx - 20, y - cy + 6) < 10;
      if (near) pixels[(y * SIZE + x) * 4 + 3] = 220;
    }
  return pixels;
};

test('the rain carried between two frames is found to the nearest two pixels, any way it went', () => {
  for (const [dx, dy] of [
    [12, -6],
    [-20, 8],
    [0, 14],
    [30, 22],
  ] as const) {
    const drift = driftBetween(blob(70, 80), blob(70 + dx, 80 + dy), SIZE, SIZE);
    assert.ok(Math.abs(drift.x - dx) <= 2 && Math.abs(drift.y - dy) <= 2, `${dx},${dy} found as ${drift.x},${drift.y}`);
  }
});

test('with no rain in either frame, nothing moves', () => {
  const clear = new Uint8ClampedArray(SIZE * SIZE * 4);
  assert.deepEqual(driftBetween(clear, clear, SIZE, SIZE), { x: 0, y: 0 });
});
