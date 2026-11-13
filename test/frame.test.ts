import assert from 'node:assert/strict';
import { test } from 'vitest';
import { FRAME, frameUnit, frameY } from '../src/sky/cloud-decks.ts';
import { SUN_CLEAR, WeatherScene } from '../src/sky/scene.ts';
import { scenePreset } from '../src/sky/sky.ts';

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

test('the frame is square and spans the card’s longer side, centred', () => {
  // A tall card shows the frame's full height and crops its sides.
  assert.ok(near(frameUnit(260, 1000), 1000 / FRAME));
  assert.ok(near(frameY(0, 1000, frameUnit(260, 1000)), 0));
  // A wide card shows its full width and crops the top and bottom equally.
  const unit = frameUnit(1048, 700);
  assert.ok(near(unit, 1048 / FRAME));
  assert.ok(near(frameY(0.5, 700, unit), 350));
  assert.ok(near(frameY(0, 700, unit), 350 - 524), 'the frame’s top is cut off above');
  // A strip stops zooming at two and a half times its height, so it still shows the decks.
  assert.ok(near(frameUnit(500, 100), 250 / FRAME));
  assert.ok(near(frameUnit(500, 200), 500 / FRAME));
});

// A sunny scene at a solar hour (6 sunrise, 12 noon, 18 sunset).
const sunAt = (hour: number, width: number, height: number, wide = width > height * 1.3) => {
  const scene = new WeatherScene(null);
  scene.wide = wide;
  scene.preset = { ...scenePreset({ condition: 'sunny' }), solarHour: hour };
  const sun = scene.sunSpot(width, height);
  assert.ok(sun);
  return sun;
};

test('the sun crosses the middle of the card, cut off above on a wide card but never out of reach', () => {
  for (const [width, height] of [
    [1048, 1000],
    [1048, 700],
    [1700, 700],
    [500, 248],
    [500, 120],
    [300, 600],
  ] as const) {
    const noon = sunAt(12, width, height),
      morning = sunAt(9, width, height),
      afternoon = sunAt(15, width, height);
    assert.ok(near(noon.x, width / 2), 'noon in the middle');
    assert.ok(morning.x > width * 0.2 && morning.x < width / 2, 'morning left of the middle');
    assert.ok(afternoon.x > width / 2 && afternoon.x < width * 0.8, 'afternoon right of it');
    for (const sun of [noon, morning, afternoon]) {
      assert.ok(sun.y >= -width * 0.05 - 1e-9, `${width}×${height}: too far above the card`);
      assert.ok(sun.y < height * 0.25, `${width}×${height}: low in the sky`);
    }
  }
  // A card about as tall as wide shows the sun whole near the top; a wide, short one has
  // its centre above the top edge.
  assert.ok(sunAt(12, 1048, 1000).y > 0);
  assert.ok(sunAt(12, 300, 600).y > 0);
  assert.ok(sunAt(12, 1048, 640).y < 0);
  assert.ok(sunAt(12, 500, 248).y < 0);
});

test('the sun never sits on the conditions: it rises clear of them, with open sky between', () => {
  const scene = new WeatherScene(null);
  scene.preset = { ...scenePreset({ condition: 'sunny' }), solarHour: 12 };
  // A narrow card with its place name near the top, right where the noon sun would be.
  const text = { x: 15, y: 20, width: 90, height: 110 },
    sun = scene.sunSpot(119, 440, text);
  assert.ok(sun);
  assert.ok(sun.y + sun.r * SUN_CLEAR <= text.y + 1e-9, 'crowding the text');
  // Just below the noon sun's place, the text still pushes it up: the core alone would clear it.
  const below = { x: 15, y: 50, width: 90, height: 110 },
    free = scene.sunSpot(119, 440),
    lifted = scene.sunSpot(119, 440, below);
  assert.ok(free && lifted);
  assert.ok(free.y + free.r <= below.y && free.y + free.r * SUN_CLEAR > below.y, 'the case is between the two');
  assert.ok(near(lifted.y, below.y - lifted.r * SUN_CLEAR));
  // Clear of the text, it keeps its place.
  const aside = { x: 0, y: 300, width: 119, height: 60 };
  assert.deepEqual(scene.sunSpot(119, 440, aside), scene.sunSpot(119, 440));
});

test('the sun grows with the card’s longer side', () => {
  assert.ok(near(sunAt(12, 1700, 700).r, 1700 * 0.045));
  assert.ok(near(sunAt(12, 1048, 1000).r, 1048 * 0.045));
  assert.ok(near(sunAt(12, 300, 600).r, 600 * 0.045));
  assert.equal(sunAt(12, 120, 60).r, 9);
});
