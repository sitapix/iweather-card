import assert from 'node:assert/strict';
import { test } from 'vitest';
import { enlarged } from '../src/map/gl.ts';

// A sheet's own map is drawn twice the size and shown at half (see groundStill): every size in its
// style doubles, wherever the style keeps it.
test('a size doubles as a number, in each value an interpolation or step gives, and in a list', () => {
  assert.equal(enlarged(12, 2), 24);
  assert.deepEqual(enlarged(['interpolate', ['linear'], ['zoom'], 8, 9.5, 13, 11.5], 2), [
    'interpolate',
    ['linear'],
    ['zoom'],
    8,
    19,
    13,
    23,
  ]);
  assert.deepEqual(enlarged(['step', ['get', 'rank'], 15, 3, 12.5], 2), ['step', ['get', 'rank'], 30, 3, 25]);
  assert.deepEqual(enlarged([2, 4], 2), [4, 8]);
});

test('a size worked out some other way is multiplied, and one inside a stop doubles where it stands', () => {
  const read = ['get', 'size'];
  assert.deepEqual(enlarged(read, 2), ['*', 2, read]);
  assert.deepEqual(enlarged(['interpolate', ['linear'], ['zoom'], 5, read, 10, 3], 2), [
    'interpolate',
    ['linear'],
    ['zoom'],
    5,
    ['*', 2, read],
    10,
    6,
  ]);
  // Not a size at all: left as it is.
  assert.equal(enlarged('auto', 2), 'auto');
});
