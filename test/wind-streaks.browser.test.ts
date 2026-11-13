import { afterEach, expect, test } from 'vitest';
import { steadyWind } from '../src/map/sources.ts';
import { drawWindMap, streakPace } from '../src/map/wind.ts';

afterEach(() => {
  document.body.replaceChildren();
});

const centre = { latitude: 0, longitude: 0, zoom: 4 },
  SIDE = 340,
  SCALE = 2,
  // A pixel counts as a streak's where it is at least this opaque.
  LIT = 0.25;

// The streaks of a map held still in a steady wind from the west, read off its canvas: each streak a
// patch of touching pixels at least LIT opaque, as long as it is across and as thick as it is down,
// in the screen's pixels.
function streaks(speed: number) {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  drawWindMap(
    canvas,
    { times: [0], fields: [steadyWind(speed, 270)] },
    { ...centre, width: SIDE, height: SIDE, scale: SCALE },
    { moving: () => false, active: () => true, hour: () => 0 },
  );
  const { width, height } = canvas,
    pixels = canvas.getContext('2d')?.getImageData(0, 0, width, height).data;
  if (!pixels) throw new Error('No canvas.');
  const lit = (i: number) => (pixels[i * 4 + 3] ?? 0) >= LIT * 255,
    seen = new Uint8Array(width * height),
    lengths: number[] = [],
    thicknesses: number[] = [];
  for (let i = 0; i < width * height; i++) {
    if (!lit(i) || seen[i] === 1) continue;
    seen[i] = 1;
    const stack = [i],
      box = { left: width, right: 0, top: height, bottom: 0 };
    while (stack.length) {
      const at = stack.pop() ?? 0,
        x = at % width,
        y = Math.floor(at / width);
      box.left = Math.min(box.left, x);
      box.right = Math.max(box.right, x);
      box.top = Math.min(box.top, y);
      box.bottom = Math.max(box.bottom, y);
      for (const next of [at - 1, at + 1, at - width, at + width])
        if (next >= 0 && next < width * height && Math.abs((next % width) - x) <= 1 && lit(next) && seen[next] !== 1) {
          seen[next] = 1;
          stack.push(next);
        }
    }
    lengths.push(box.right - box.left + 1);
    thicknesses.push(box.bottom - box.top + 1);
  }
  const middle = (list: number[]) => list.toSorted((a, b) => a - b)[Math.floor(list.length / 2)] ?? 0;
  return { length: middle(lengths), thickness: middle(thicknesses) };
}

test('a streak grows with the wind in proportion, its trail gone in a moment, and as fine as a screen pixel or two', () => {
  const calm = streaks(2),
    light = streaks(4),
    strong = streaks(12);
  // Three times the wind, near three times the streak past its round ends.
  const grown = (strong.length - strong.thickness) / (light.length - light.thickness);
  expect(grown).toBeGreaterThan(2.2);
  expect(grown).toBeLessThan(3.6);
  // At 2 m/s a streak's trail is gone before it has gone far: a fleck.
  expect(calm.length).toBeLessThanOrEqual(10);
  expect(strong.length).toBeGreaterThan(12);
  // About 1.7 of the screen's pixels thick, whatever the map's scale.
  expect(light.thickness).toBeLessThanOrEqual(3);
});

test('a streak drifts at a calm pace in light wind, in proportion to the wind and the map', () => {
  // A 340 px map carries a streak 8.5 px a second in 2 m/s from the west, so it takes 40 s to cross.
  const [across, down] = streakPace(SIDE, SIDE, 2, 0);
  expect(across).toBeCloseTo(8.5, 5);
  expect(down).toBeCloseTo(0, 5);
  // Four times the wind, four times as fast; north is up the screen.
  expect(streakPace(SIDE, SIDE, 8, 0)[0]).toBeCloseTo(4 * across, 5);
  expect(streakPace(SIDE, SIDE, 0, 2)[1]).toBeCloseTo(-8.5, 5);
});
