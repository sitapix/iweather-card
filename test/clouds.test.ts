import { test } from 'vitest';
import assert from 'node:assert/strict';
import { CLOUD_SPRITES, bakeCloud, relight, sharpened } from '../src/sky/clouds.ts';
import { DECK_COUNT, deckClouds, type CloudDeck } from '../src/sky/cloud-decks.ts';
import { noiseCube } from '../src/sky/clouds-gl.ts';

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
    assert.equal(CLOUD_SPRITES[cloud.sprite]?.[0], 'cirrostratus');
    assert.ok(cloud.y < 0.1, 'a high deck sits at the top of the sky');
    assert.ok(cloud.scale >= 14 / 48 && cloud.scale <= 20 / 48);
  }
  assert.deepEqual(deckClouds(decks, 3), deckClouds(decks, 3), 'seeded, so a sky is stable');
});

test('a deck can draw its clouds thinner and taller than baked', () => {
  const plain: CloudDeck = ['wispy', 4, [15, 19], 17, [0.45, 0.5], [45, 10, 5]],
    drawn: CloudDeck = ['wispy', 4, [15, 19], 17, [0.45, 0.5], [45, 10, 5], 0.5, 1.5],
    solid = deckClouds([plain], 2)[0]?.[0],
    thin = deckClouds([drawn], 2)[0]?.[0];
  assert.ok(solid && thin);
  assert.equal(solid.tall, 1, 'as baked unless the deck says');
  assert.equal(thin.tall, 1.5);
  assert.ok(Math.abs(thin.alpha - solid.alpha * 0.5) < 1e-9);
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

// The cube's bytes folded into one number (32-bit FNV-1a): any texel out by a shade changes it.
const fingerprint = (bytes: Uint8Array) =>
  bytes.reduce((folded, byte) => Math.imul(folded ^ byte, 16_777_619) >>> 0, 2_166_136_261);

test('the GPU clouds tear their edges with the noise they were tuned on, to the byte', async () => {
  let pauses = 0;
  const cube = await noiseCube(64, () => {
    pauses++;
    return Promise.resolve();
  });
  assert.equal(cube.length, 64 ** 3);
  assert.equal(fingerprint(cube).toString(16), '1ea88d71');
  // Built a few slices at a time, so the page draws in between.
  assert.equal(pauses, 8);
});
