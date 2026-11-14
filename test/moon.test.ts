import assert from 'node:assert/strict';
import { test } from 'vitest';
import { arcX, moonAcross, moonHeight, moonPlace, type Rect } from '../src/sky/scene.ts';
import { solarHour, sunPathAt } from '../src/sky/presets.ts';
import { scenePreset, skyMoonPhase, moonAltitude, moonHourAt } from '../src/sky/sky.ts';
import { sceneInputs } from '../src/weather/conditions.ts';
import { sheetDim } from '../src/sky/moon-gpu.ts';
import { tickAt, tickFeel } from '../src/cards/moon/timeline.ts';

test('the sun path uses the chosen window, its daylight interval and whole iris particles', () => {
  for (const layout of ['compact', 'compactLandscape', 'portraitRegular', 'landscapeRegular', 'ultrawide'] as const) {
    const noon = sunPathAt(12, layout);
    assert.equal(noon.x, 0.5);
    assert.ok(noon.alpha > 0);
    assert.equal(sunPathAt(0, layout).alpha, 0);
  }
  assert.equal(sunPathAt(12).y, 0);
  assert.ok(Math.abs(sunPathAt(12, 'ultrawide').y - 0.28) < 1e-6);
  assert.equal(sunPathAt(7.25).ghosts, 7);
  assert.equal(sunPathAt(12.001).ghosts, 6);
  const hour = 3600000,
    start = Date.UTC(2026, 2, 8, 13);
  assert.equal(solarHour(start + 2 * hour, { sunrise: start, sunset: start + 8 * hour }), 9);
  const missing = { elevation: 22, rising: false };
  assert.equal(
    solarHour(start, { ...missing, nextSetting: start + 40 * 24 * hour, nextRising: start + 60 * 24 * hour }),
    solarHour(start, missing),
  );
});

test('lunar lighting, disc, and direct sun have separate gates', () => {
  const inputs = { condition: 'sunny', elevation: 9, moonAltitude: 9.01, moonPhase: 0.25 };
  const up = scenePreset(inputs),
    list = scenePreset({ ...inputs, tile: true });
  assert.ok(up.moon && !list.moon && !up.sun);
  assert.deepEqual(up.light, list.light);
  assert.ok(!up.rays && !up.ghosts && !up.rainbow);
  assert.equal(scenePreset({ ...inputs, moonAltitude: 9 }).moon, false);
  assert.equal(scenePreset({ ...inputs, moonPhase: 0 }).moon, false);
  const day = scenePreset({ ...inputs, elevation: 9.01 });
  assert.ok(day.sun && day.rays && !day.moon);
  assert.equal(skyMoonPhase(0.25, 179.99), 21 / 28);
  assert.equal(skyMoonPhase(0.25, 180), 7 / 28);
});

test('the lunar path uses an independent rise-to-set interval and crosses the middle once', () => {
  assert.equal(moonAcross(0), 0.1);
  assert.equal(moonAcross(0.5), 0.35);
  assert.ok(moonAcross(0.50001) > 0.65);
  assert.ok(Math.abs(moonAcross(1) - 0.9) < 1e-9);
  const start = Date.UTC(2026, 9, 26),
    latitude = 41.88,
    longitude = -87.63;
  let count = 0,
    previous = 0;
  for (let i = 0; i < 12; i++) {
    const time = start + i * 3600000,
      elevation = moonAltitude(time, latitude, longitude);
    if (elevation === undefined || elevation <= 9) continue;
    const hour = moonHourAt(time, latitude, longitude);
    assert.ok(hour !== undefined && hour > 6 && hour < 18 && hour > previous);
    previous = hour;
    count++;
  }
  assert.ok(count >= 3);
  const withoutSun = sceneInputs(undefined, undefined, { latitude, longitude }, start);
  assert.ok(Number.isFinite(withoutSun.elevation) && Number.isFinite(withoutSun.solarHour));
  const polar = sceneInputs(
    { state: 'sunny', attributes: {} },
    undefined,
    { latitude: 69.65, longitude: 18.96 },
    Date.UTC(2026, 5, 21, 11),
  );
  assert.ok((polar.elevation ?? 0) > 9);
  assert.equal(polar.sunPathAvailable, false);
  assert.equal(scenePreset(polar).sun, false);
  assert.equal(scenePreset({ condition: 'sunny', elevation: 30 }).sun, true);
});

test('the phase texture follows the illuminated limb while the face turns with the observer', () => {
  const place = { latitude: 41.8781, longitude: -87.6298 };
  for (const [day, hour, expected] of [
    [3, 8, 21],
    [10, 8, 0],
    [17, 12, 6],
    [26, 4, 14],
    [28, 12, 15],
  ] as const) {
    const at = Date.UTC(2026, 9, day, hour),
      inputs = sceneInputs(undefined, undefined, place, at);
    assert.equal(scenePreset(inputs).moonPicture, expected / 28);
    const other = sceneInputs(undefined, undefined, { latitude: -33.87, longitude: 151.21 }, at);
    assert.equal(scenePreset(other).moonPicture, expected / 28);
    assert.notEqual(inputs.moonTilt, other.moonTilt);
  }
});

// Cards from a one-row strip to a tall panel, a block of text across the middle of each,
// the sun nowhere or at a few places in the sky, at every altitude and every point of the
// moon's arc.
const FRAMES = [
  [84, 56],
  [119, 120],
  [119, 504],
  [161, 312],
  [246, 184],
  [331, 376],
  [500, 504],
  [820, 1100],
  [1700, 700],
] as const;
const TEXTS = [
  [0.1, 0.05, 0.8, 0.3],
  [0.25, 0.1, 0.5, 0.2],
  [0.05, 0.3, 0.9, 0.4],
  [0.4, 0.02, 0.2, 0.9],
] as const;
const SUNS = [null, [0.5, 0.05], [0.2, 0.2], [0.8, 0.3]] as const;
const ALTITUDES = Array.from({ length: 19 }, (_, i) => i * 5);
const ACROSS = [null, ...Array.from({ length: 21 }, (_, i) => arcX(i / 20))];
const overlaps = (x: number, y: number, r: number, text: Rect) =>
  x + r > text.x && x - r < text.x + text.width && y + r > text.y && y - r < text.y + text.height;

function* cases() {
  for (const [width, height] of FRAMES)
    for (const [tx, ty, tw, th] of TEXTS)
      for (const at of SUNS) {
        const sky: Rect = { x: 0, y: 0, width, height: height * 0.7 },
          text: Rect = { x: width * tx, y: height * ty, width: width * tw, height: height * th },
          sun = at
            ? { x: width * at[0], y: height * at[1], r: Math.max(9, Math.max(width, height) * 0.045) }
            : undefined;
        for (const degrees of ALTITUDES)
          for (const across of ACROSS)
            for (const r of [12, 40]) yield { width, height, sky, text, sun, degrees, across, r };
      }
}

test('the moon never sits behind the conditions', () => {
  for (const { width, height, sky, text, sun, degrees, across, r } of cases()) {
    const { x, y } = moonPlace(width, height, sky, text, degrees, across, r, sun);
    assert.ok(
      !overlaps(x, y, r, text),
      `behind the text at ${degrees}° across ${across ?? 'none'} in ${width}×${height}`,
    );
  }
});

test('the moon never sits in the sun’s glow: it rises off the card instead', () => {
  for (const { width, height, sky, text, sun, degrees, across, r } of cases()) {
    if (!sun) continue;
    const { x, y } = moonPlace(width, height, sky, text, degrees, across, r, sun);
    assert.ok(Math.hypot(x - sun.x, y - sun.y) >= sun.r * 4 + r || y + r <= 0, `beside the sun in ${width}×${height}`);
  }
});

test('the moon sits at a share of the card’s width, moving aside only to clear the text', () => {
  for (const { width, height, sky, text, sun, degrees, across, r } of cases()) {
    const free = moonPlace(width, height, sky, undefined, degrees, across, r),
      placed = moonPlace(width, height, sky, text, degrees, across, r, sun);
    assert.equal(free.x, width * (across ?? 0.75));
    if (placed.x !== free.x) {
      assert.ok(overlaps(free.x, free.y, r, text), 'moved aside with nothing in the way');
      assert.ok(placed.x - r >= sky.x && placed.x + r <= sky.x + sky.width, 'moved out of the open sky');
    }
  }
  // The sun's arc spans the middle half of the card, rising a quarter of the way in and
  // setting a quarter from the far edge.
  assert.equal(arcX(0), 0.25);
  assert.equal(arcX(0.5), 0.5);
  assert.equal(arcX(1), 0.75);
  // High in the middle of a wide card, the moon sits beside the centred conditions on its own
  // side, at its own height, rather than behind them.
  const text: Rect = { x: 434, y: 65, width: 180, height: 200 },
    moon = moonPlace(1048, 700, { x: 0, y: 0, width: 1048, height: 265 }, text, 60, 0.47, 28);
  assert.ok(Math.abs(moon.x - (434 - 28 * 1.4)) < 1e-9);
  assert.ok(Math.abs(moon.y - 700 * 0.075) < 1e-9);
});

test('the moon’s height is a share of the card’s height by its altitude, and only ever moves up from it', () => {
  for (const { width, height, sky, text, sun, degrees, across, r } of cases()) {
    const free = moonPlace(width, height, sky, undefined, degrees, across, r),
      placed = moonPlace(width, height, sky, text, degrees, across, r, sun);
    assert.ok(placed.y <= free.y, 'moved down');
    assert.ok(free.y + r <= Math.max(sky.y + sky.height, height * 0.5) + 1e-9, 'below the middle and the open sky');
    // Where neither the text nor the sun is in the way, the altitude alone sets the height.
    if (!overlaps(free.x, free.y, r, text) && !sun) assert.equal(placed.y, free.y);
  }
  // High (40° and up) it sits 7.5% from the top; lower, 0.7% of the height lower per degree,
  // about a third of the way down at the horizon.
  assert.ok(Math.abs(moonHeight(90) - 0.075) < 1e-9);
  assert.ok(Math.abs(moonHeight(45) - 0.075) < 1e-9);
  assert.ok(Math.abs(moonHeight(26, 0.1) - 0.17) < 1e-9);
  assert.ok(Math.abs(moonHeight(0, 0.5) - 0.15) < 1e-9);
  for (let degrees = 1; degrees <= 90; degrees++) assert.ok(moonHeight(degrees) <= moonHeight(degrees - 1));
  // The same share on a card of any shape: a wide, short card shows the moon as a tall one does.
  const open = (width: number, height: number): Rect => ({ x: 0, y: 0, width, height });
  for (const [width, height] of [
    [260, 1000],
    [1048, 1000],
    [1700, 700],
    [500, 184],
  ] as const)
    assert.ok(
      Math.abs(moonPlace(width, height, open(width, height), undefined, 60, 0.3, 12).y - height * 0.075) < 1e-9,
    );
  // A narrow card with its text where the moon would be and no room beside it: the moon
  // rises clear, cut off by the top.
  const text: Rect = { x: 17, y: 18, width: 84, height: 103 },
    moon = moonPlace(119, 312, { x: 0, y: 0, width: 119, height: 160 }, text, 45, 0.45, 12);
  assert.ok(moon.y + 12 <= text.y, 'clears the text');
  assert.ok(moon.y - 12 < 0, 'cut off by the top');
});

test('the sheet’s moon dims as it leaves full: 90% at two thirds lit, 75% just under half', () => {
  assert.equal(sheetDim(1), 1);
  assert.equal(sheetDim(0.85), 1);
  assert.ok(Math.abs(sheetDim(0.68) - 0.9) < 0.01);
  assert.ok(Math.abs(sheetDim(0.43) - 0.75) < 0.01);
});

test('the moon strip’s ticks are counted from each day’s midnight, however long the day', () => {
  // Midnights 84 px apart for 24 hours, then 87.5 for a day of 25, as a clock change makes.
  const midnights = [0, 84, 171.5];
  assert.deepEqual(tickAt(83, midnights), { day: 0, mark: 11 });
  assert.deepEqual(tickAt(84, midnights), { day: 1, mark: 0 });
  assert.deepEqual(tickAt(90.4, midnights), { day: 1, mark: 0 });
  assert.deepEqual(tickAt(91, midnights), { day: 1, mark: 1 });
  assert.deepEqual(tickAt(170, midnights), { day: 1, mark: 12 });
  assert.deepEqual(tickAt(171.4, midnights), { day: 2, mark: 0 });
});

test('the moon strip ticks lightly past each mark and firmly past each midnight, either way', () => {
  const midnights = [0, 84, 171.5],
    feel = (from: number, to: number) => tickFeel(tickAt(from, midnights), tickAt(to, midnights));
  assert.equal(feel(80, 85), 'medium');
  assert.equal(feel(85, 80), 'medium');
  assert.equal(feel(85, 92), 'light');
  assert.equal(feel(92, 85), 'light');
  assert.equal(feel(85, 87), undefined);
  // A frame that jumps several marks and a midnight with them is firm.
  assert.equal(feel(60, 100), 'medium');
  // The last mark of a 25-hour day is an hour from the midnight after it.
  assert.equal(feel(167.5, 171.4), 'medium');
});
