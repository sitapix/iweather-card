import { expect, test } from 'vitest';
import { FLICK, flickEasing, flickOf } from '../src/map/pinch.ts';

// A pinch zooming at `speed` steps a second, sampled every 16 ms for `ms`, from zoom 6 at time 1000.
const pinching = (speed: number, ms: number) =>
  Array.from({ length: Math.floor(ms / 16) + 1 }, (_, i) => [1000 + i * 16, 6 + (speed * i * 16) / 1000] as const);

test('a pinch let go while spreading carries on as far as 0.15 s more at its speed would take it', () => {
  const samples = pinching(4, 320),
    flick = flickOf(samples, samples.at(-1)?.[0] ?? 0);
  expect(flick?.by).toBeCloseTo(4 * FLICK.carry, 5);
  expect(flick?.duration).toBeCloseTo(FLICK.carry * -Math.log(FLICK.left) * 1000, 5);
});

test('closing fingers flick the zoom out, and the fastest flick is held to two steps', () => {
  const closing = pinching(-5, 320),
    fast = pinching(40, 160);
  expect(flickOf(closing, closing.at(-1)?.[0] ?? 0)?.by).toBeCloseTo(-5 * FLICK.carry, 5);
  expect(flickOf(fast, fast.at(-1)?.[0] ?? 0)?.by).toBe(FLICK.most);
});

test('a slow pinch, or one held still before letting go, stops where the fingers left it', () => {
  const slow = pinching(0.5, 320),
    held = pinching(4, 320);
  expect(flickOf(slow, slow.at(-1)?.[0] ?? 0)).toBeUndefined();
  expect(flickOf(held, (held.at(-1)?.[0] ?? 0) + FLICK.window + 1)).toBeUndefined();
  expect(flickOf(held.slice(0, 1), held[0]?.[0] ?? 0)).toBeUndefined();
});

test('two wheels a moment apart are a frame of speed, not a burst', () => {
  expect(
    flickOf(
      [
        [1000, 6],
        [1001, 6.2],
      ],
      1001,
    )?.by,
  ).toBeCloseTo((0.2 / FLICK.frame) * 1000 * FLICK.carry, 5);
});

test('a flick starts at the speed the fingers left it with and slows all the way to its end', () => {
  const duration = FLICK.carry * -Math.log(FLICK.left),
    step = 1e-4,
    // The carried distance is speed × carry, so the opening speed of the ease, in steps a
    // second for one step carried, is 1 / carry: a hundredth more, for the 1% left unrun.
    opening = flickEasing(step) / step / duration;
  expect(flickEasing(0)).toBe(0);
  expect(flickEasing(1)).toBeCloseTo(1, 10);
  expect(opening).toBeCloseTo(1 / (FLICK.carry * (1 - FLICK.left)), 2);
  const steps = Array.from({ length: 11 }, (_, i) => flickEasing(i / 10)),
    gains = steps.slice(1).map((value, i) => value - (steps[i] ?? 0));
  expect(gains.every((gain, i) => i === 0 || gain < (gains[i - 1] ?? 0))).toBe(true);
});
