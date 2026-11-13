import { expect, test } from 'vitest';
import { animationDeadline } from '../src/lib/animation.ts';

test.each([60, 120, 144])('falling weather draws at 60 Hz on a %i Hz display', hz => {
  let due = 0;
  const draws: number[] = [];
  for (let frame = 0; frame < hz * 10; frame++) {
    const now = (frame * 1000) / hz;
    const next = animationDeadline(now, due, 1000 / 60);
    if (next !== undefined) {
      due = next;
      draws.push(now);
    }
  }
  expect(draws.length).toBe(600);
  expect(Math.max(...draws.slice(1).map((at, i) => at - (draws[i] ?? 0)))).toBeLessThanOrEqual(1000 / 60 + 1000 / hz);
});

test.each([25, 30, 10])('calm and low-power skies retain their %i Hz cadence', fps => {
  let due = 0;
  let count = 0;
  for (let frame = 0; frame < 600; frame++) {
    const next = animationDeadline((frame * 1000) / 60, due, 1000 / fps);
    if (next !== undefined) {
      due = next;
      count++;
    }
  }
  expect(count).toBe(fps * 10);
});

test('late frames resume without catch-up bursts or an accumulated delay', () => {
  const next = animationDeadline(5000, 100, 1000 / 60);
  expect(next).toBe(5000 + 1000 / 60);
  expect(animationDeadline(5001, next ?? 0, 1000 / 60)).toBeUndefined();
  expect(animationDeadline(5000 + 1000 / 60, next ?? 0, 1000 / 60)).toBeCloseTo(5000 + 2000 / 60);
});
