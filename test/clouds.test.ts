import { test } from 'vitest';
import assert from 'node:assert/strict';
import { CLOUD_SPRITES, cloudSlots, bakeCloud, relight, sharpened } from '../src/sky/clouds.ts';
import { DECK_COUNT, cloudPicks, cloudPosition, deckClouds, type CloudDeck } from '../src/sky/cloud-decks.ts';
import { lightStorm } from '../scripts/storm-light.ts';

test('baked sprites carry six light maps and coverage that fades before the edges', () => {
  const { maps, width, height } = bakeCloud('cumulus', 2, 48, 24, 12);
  const at = (x: number, y: number, k: number) => maps[(y * width + x) * 7 + k] ?? NaN;
  assert.equal(at(0, 0, 6), 0);
  assert.equal(at(width - 1, height - 1, 6), 0);
  const centre = [Math.floor(width / 2), Math.floor(height * 0.6)] as const;
  assert.ok(at(...centre, 6) > 0.5, 'the heap is solid in the middle');
  // Lit from above, the top of a heap is brighter than its base.
  const lit = relight({ maps, width, height }, [0, 1, 0]),
    top = lit[(Math.floor(height * 0.35) * width + centre[0]) * 4] ?? NaN,
    base = lit[(Math.floor(height * 0.85) * width + centre[0]) * 4] ?? NaN;
  assert.ok(top > base);
});

test('the isolated storm shades its dense folds and leaves an opening between the low banks', () => {
  const sprite = CLOUD_SPRITES.find(([kind]) => kind === 'isolatedStorm');
  assert.ok(sprite);
  const volume = bakeCloud(...sprite, 96, 42, 12),
    { width, maps } = volume;
  // Small patches across the baked view: a crest above the left bank and a gap between banks.
  const patch = (x: number, y: number, channel: number) => {
    let sum = 0;
    for (let row = y; row < y + 4; row++)
      for (let col = x; col < x + 4; col++) sum += maps[(row * width + col) * 7 + channel] ?? 0;
    return sum / 16;
  };
  const coverage = (x: number, y: number) => patch(x, y, 6),
    crest = coverage(78, 7),
    left = coverage(78, 22),
    right = coverage(26, 22),
    gap = coverage(47, 22);
  assert.ok(crest > left && left > right);
  assert.ok(right > gap + 0.025);
  assert.equal(coverage(78, 38), 0);
  // An opaque shoulder shadows the opaque cloud just below it. Both should remain
  // visible when lit from the front, which uses a separate directional map.
  assert.ok(coverage(78, 7) > 0.9 && coverage(78, 14) > 0.9);
  assert.ok(patch(78, 7, 2) > patch(78, 14, 2) + 0.28);
  assert.ok(patch(78, 14, 4) > patch(78, 14, 2) + 0.2);

  const haze = coverage(78, 29);
  lightStorm(volume);
  // The visible lip still has cloud and sky fill. Direct light falls away across it.
  const overhead = patch(78, 7, 2),
    lip = patch(63, 14, 2);
  assert.ok(coverage(63, 14) > 0.35 && overhead > 0.35);
  assert.ok(lip < overhead * 0.3 && patch(78, 14, 2) < overhead * 0.2);
  assert.ok(patch(63, 14, 3) > 0.7 && patch(78, 22, 2) < overhead * 0.3);

  // Two staggered crests on the far side of the frame emerge through the open haze.
  const farCrest = patch(20, 17, 2),
    nearCrest = patch(27, 20, 2),
    opening = patch(25, 16, 2);
  assert.ok(Math.min(farCrest, nearCrest) > opening + 0.035);
  assert.ok(patch(26, 6, 2) > patch(32, 6, 2) + 0.12, 'the upper bank hangs over a shaded fold');
  // Below the painted banks only the volume contributes haze. Extending the last
  // painted row here drags its individual pixels into long vertical streaks.
  assert.equal(coverage(78, 29), haze * 0.5);
  assert.equal(patch(78, 29, 2), 0);
});

test('decks follow the preset decks: family, count, height and size', () => {
  const decks: (CloudDeck | null)[] = [
    ['cirrostratus', 4, [14, 20], 23, [0.18, 0.2]],
    ['altostratus', 3, [18, 24], 11.3, [0.25, 0.3]],
    null,
    ['cumulus', 2, [1.5, 3.2], 0, [0.5, 1]],
  ];
  const sky = deckClouds(decks, 7),
    [high] = sky;
  assert.equal(sky.length, DECK_COUNT);
  assert.equal(sky[2], null);
  assert.deepEqual(
    sky.map(deck => deck?.length ?? 0),
    [4, 3, 0, 2],
  );
  assert.ok(high);
  for (const cloud of high) {
    assert.ok(cloudSlots('Cirrostratus_SingleL').includes(cloud.sprite));
    assert.ok(cloud.y >= 41 && cloud.y <= 45);
    assert.ok(cloud.scale >= 14 && cloud.scale <= 20);
  }
  assert.deepEqual(deckClouds(decks, 3), deckClouds(decks, 3));
});

test('eight particles share six distinct textures and wrap through the emitter fade', () => {
  const deck: CloudDeck = ['cumulus', 8, [2, 6], 0, [1, 3], [100, 0, 0], 'Cumulus_SingleM', 0, 0, true, 8];
  const particles = deckClouds([deck], 7)[0] ?? [],
    slots = cloudPicks('Cumulus_SingleM', 8, 6, 7);
  assert.deepEqual(
    particles.map(p => p.sprite),
    [slots[0], slots[0], slots[1], slots[1], ...slots.slice(2)],
  );
  assert.equal(new Set(slots).size, 6);
  const first = particles[0];
  assert.ok(first);
  assert.ok(Math.abs(first.speed - (1 + 2 * 0.1397016)) < 1e-6);
  assert.ok(Math.abs(first.scale - (2 + 4 * 0.1397016)) < 1e-6);
  assert.deepEqual(cloudPosition({ ...first, x: 100 }, 0), [100, 0]);
  const [x, fade] = cloudPosition({ ...first, x: -93, speed: 1 }, 4);
  assert.equal(x, -97);
  assert.ok(Math.abs(fade - 0.4) < 1e-8);
  assert.deepEqual(cloudPosition({ ...first, x: -99, speed: 1 }, 2), [99, 1 / 7.5]);
});
test('the outer decks capture unit size and the middle decks capture a reproducible uniform size', () => {
  const deck: CloudDeck = ['cumulus', 6, [4, 4], 0, [0, 0], [12, 8, 4]];
  const scales = (artSeed: number) =>
    deckClouds([deck, deck, deck, deck], artSeed).map(group => group?.map(p => p.scale));
  const [back, midBack, midFront, front] = scales(12);
  assert.deepEqual(back, [4, 4, 4, 4, 4, 4]);
  assert.deepEqual(front, back);
  assert.ok(midBack && midFront && [...midBack, ...midFront].every(size => size >= 0 && size <= 4));
  assert.equal(new Set(midBack).size, 6);
  assert.deepEqual(scales(12), scales(31));
  const foreground = deckClouds([null, null, deck])[2];
  assert.ok(foreground?.every(particle => particle.y >= 6 && particle.y <= 14 && Math.abs(particle.z) <= 2));
});
test('sharpening deepens an edge, leaves flat cloud alone and stays within the maps', () => {
  const width = 16,
    height = 4,
    edge = width / 2,
    maps = new Float32Array(width * height * 7).map((_, i) => (Math.floor(i / 7) % width < edge ? 0.25 : 0.75));
  const out = sharpened(maps, width, height, 3);
  const at = (x: number) => out[x * 7] ?? NaN;
  assert.equal(at(0), 0.25, 'far from the edge nothing changes');
  assert.equal(at(width - 1), 0.75);
  assert.ok(at(edge - 1) < 0.25 && at(edge) > 0.75, 'each side of the edge is pushed away from the other');
  assert.ok(sharpened(maps, width, height, 20).every(value => value >= 0 && value <= 1));
});
