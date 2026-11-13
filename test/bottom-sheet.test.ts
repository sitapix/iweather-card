import assert from 'node:assert/strict';
import { test } from 'vitest';
import { backCurve, letsGo, thrownCurve } from '../src/sheets/bottom-sheet.ts';

const HEIGHT = 800;

test('a sheet let go goes once it is half way down, and comes back short of that', () => {
  assert.equal(letsGo(400, HEIGHT, 0), true);
  assert.equal(letsGo(399, HEIGHT, 0), false);
  assert.equal(letsGo(0, HEIGHT, 2), false, 'where it was, it stays');
});
test('its speed counts for the distance it would carry it, so a shorter pull needs a faster one', () => {
  assert.equal(letsGo(60, HEIGHT, 1.14), true);
  assert.equal(letsGo(60, HEIGHT, 1.13), false);
  assert.equal(letsGo(200, HEIGHT, 0.67), true);
  assert.equal(letsGo(200, HEIGHT, 0.66), false);
});
test('flicked back up, it stays, even from past half way', () => {
  assert.equal(letsGo(60, HEIGHT, -2), false);
  assert.equal(letsGo(500, HEIGHT, -1), false);
});

const LEFT = 700;
test('thrown out hard, it is out of sight in a quarter of a second, and let go slowly, in under half', () => {
  const hard = thrownCurve(LEFT, 2),
    slow = thrownCurve(LEFT, 0.3);
  assert.ok(hard.ms >= 220 && hard.ms <= 260, `${hard.ms} ms`);
  assert.ok(slow.ms >= 440 && slow.ms <= 500, `${slow.ms} ms`);
  assert.ok(thrownCurve(LEFT, 5).ms <= hard.ms, 'thrown harder, no slower');
  assert.equal(thrownCurve(LEFT, 0).ms, slow.ms, 'short of slow, no slower');
  const between = thrownCurve(LEFT, 1.25).ms;
  assert.ok(between > hard.ms && between < slow.ms, `${between} ms`);
});
test('it sets off as fast as it was let go, goes only on, and ends out of sight', () => {
  for (const speed of [0, 1.25, 2]) {
    const { points } = thrownCurve(LEFT, speed),
      first = ((points[1] ?? 1) * LEFT) / 8;
    assert.equal(points[0], 0);
    assert.ok(first >= speed && first < speed + 1, `let go at ${speed} px a ms, it sets off at ${first}`);
    assert.ok(points.every((point, index) => index === 0 || point >= (points[index - 1] ?? 0)));
    assert.equal(points.at(-1), 1);
  }
});
test('thrown by its scroll, which carries it on as it was going, it sets off from rest on top of that', () => {
  const hard = thrownCurve(LEFT, 2),
    carried = thrownCurve(LEFT, 2, 0);
  assert.ok((carried.points[1] ?? 1) * LEFT < 8, `${(carried.points[1] ?? 1) * LEFT} px in its first step`);
  assert.ok(Math.abs(carried.ms - hard.ms) <= 24, `${carried.ms} ms against ${hard.ms}`);
  assert.equal(carried.points.at(-1), 1);
});
test('it is half way out in about a tenth of a second', () => {
  const half = (speed: number) => thrownCurve(LEFT, speed).points.findIndex(point => point >= 0.5) * 8;
  assert.ok(half(2) >= 80 && half(2) <= 104, `thrown hard, ${half(2)} ms`);
  assert.ok(half(0.3) >= 88 && half(0.3) <= 112, `let go slowly, ${half(0.3)} ms`);
});
test('let go short of going, it springs back over half way in a tenth of a second, and never past its place', () => {
  const { points, ms } = backCurve(200),
    at = (time: number) => points[Math.round(time / 8)] ?? 1;
  assert.ok(at(100) > 0.5 && at(100) < 0.65, `${at(100)} at 100 ms`);
  assert.ok(at(200) > 0.85, `${at(200)} at 200 ms`);
  assert.ok(ms >= 300 && ms <= 450, `${ms} ms`);
  assert.ok(points.every(point => point <= 1));
});
test('let go still going down, it carries on a little before it turns, and never past its place', () => {
  const { points } = backCurve(100, 1.3),
    furthest = -Math.min(...points) * 100;
  assert.ok(furthest > 5 && furthest < 20, `${furthest} px further`);
  assert.ok(points.every(point => point <= 1));
  assert.equal(points.at(-1), 1);
});
