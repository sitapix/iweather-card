import assert from 'node:assert/strict';
import { test } from 'vitest';
import { digest, namesIn } from '../scripts/names.ts';

// Made-up names, as the real ones may not be written here.
const lists = {
  names: new Set([digest('Zephyrcast'), digest('Gale Board Pro')]),
  firstWords: new Set([digest('gale')]),
};

test('a name is found in any case, on its line, and one of several words as a phrase', () => {
  assert.deepEqual(namesIn('Plain words.\nLike ZEPHYRCAST does,\nor the gale board pro.', lists), [
    { line: 2, name: 'ZEPHYRCAST' },
    { line: 3, name: 'gale board pro' },
  ]);
});

test('a name inside another word or an identifier is not the name', () => {
  assert.deepEqual(namesIn('zephyrcasts zephyrcast_mode a gale board', lists), []);
});

test('a digest is of the words alone, whatever their case and spacing', () => {
  assert.equal(digest('Gale  Board-Pro'), digest('gale board pro'));
  assert.match(digest('Zephyrcast'), /^[0-9a-f]{16}$/u);
});
