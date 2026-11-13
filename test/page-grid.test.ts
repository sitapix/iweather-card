import assert from 'node:assert/strict';
import { test } from 'vitest';
import { type PageColumns, type PageContents, type PageFit, pageFit } from '../src/card/page-grid.ts';
import type { TileId } from '../src/cards/ids.ts';

// A page's contents: every tile but the map, three rows of list, wind and moon free to widen, air
// quality among the set tiles (a usual one) unless a case takes it away or leads with it.
const USUAL = 10;
const contents = (changes: Partial<PageContents> = {}): PageContents => ({
  leading: 0,
  cells: USUAL,
  flexible: ['wind', 'moon'],
  hourly: true,
  listRows: 3,
  map: true,
  ...changes,
});
const fits = (changes?: Partial<PageContents>) =>
  ([4, 5, 6] as const).map(columns => pageFit(columns, contents(changes)));
const placed = (top: number, mapRows: number, ...wide: TileId[]): PageFit => ({ top, mapRows, wide });
const same = (found: PageFit, wanted: PageFit) =>
  assert.deepEqual({ ...found, wide: found.wide.toSorted() }, { ...wanted, wide: wanted.wide.toSorted() });
const each = (found: PageFit[], wanted: PageFit[]) => {
  for (const [i, one] of found.entries()) same(one, wanted[i] ?? placed(0, 0));
};

test('with everything on the page, wind and moon take what the columns leave', () => {
  // Four columns: air quality over wind and moon side by side. Five and six: both two wide.
  each(fits(), [placed(1, 2), placed(1, 3, 'wind', 'moon'), placed(1, 3, 'wind', 'moon')]);
});
test('what leads the page takes room from wind and moon', () => {
  const nextHour = { leading: 1 };
  each(fits(nextHour), [placed(1, 2, 'wind', 'moon'), placed(2, 3), placed(1, 3)]);
  // Air quality that matters leads in place of its usual cells.
  each(fits({ leading: 1, cells: USUAL - 2 }), [
    placed(1, 2),
    placed(2, 3, 'wind', 'moon'),
    placed(1, 3, 'wind', 'moon'),
  ]);
});
test('an alert that doesn’t lead packs among the tiles', () => {
  each(fits({ cells: USUAL + 2 }), [placed(1, 2, 'wind', 'moon'), placed(1, 3), placed(1, 3)]);
});
test('what leads goes above the block once the hourly panel has no room beside it', () => {
  const tops = (leading: number) => ([4, 5, 6] as const).map(columns => pageFit(columns, contents({ leading })).top);
  assert.deepEqual(tops(0), [1, 1, 1]);
  assert.deepEqual(tops(1), [1, 2, 1]);
  assert.deepEqual(tops(2), [2, 2, 2]);
  assert.deepEqual(tops(3), [2, 3, 2]);
});
test('the map gives up a row where that fills the grid', () => {
  // Three that lead: a two-row map leaves two cells under it, and nothing is left empty.
  each(fits({ leading: 3, cells: USUAL - 2 }), [placed(2, 2), placed(3, 2), placed(2, 2)]);
});
test('without air quality wind and moon take its room', () => {
  // Beside the block at four columns: two wide, stacked. Five and six: the map gives up a row, and
  // at six that alone fills the block's side, wind and moon one wide.
  each(fits({ cells: USUAL - 2 }), [placed(1, 2, 'wind', 'moon'), placed(1, 2, 'wind'), placed(1, 2)]);
  // Without visibility too, wind and moon stand one wide in the last row at five.
  same(pageFit(5, contents({ cells: USUAL - 3 })), placed(1, 3));
});
test('the gaps never reach a whole row, whatever leads the page and however many tiles there are', () => {
  const empty = (columns: PageColumns, page: PageContents, { top, mapRows, wide }: PageFit) => {
    const hourly = page.hourly ? (columns === 4 ? 2 : 4) : 0,
      taken =
        page.leading * 2 +
        page.cells +
        page.flexible.length +
        wide.length +
        page.listRows * 2 +
        (page.map ? mapRows * 2 : 0) +
        hourly,
      rows = Math.max(top + page.listRows + (columns === 4 ? 2 : 0), Math.ceil(taken / columns));
    return rows * columns - taken;
  };
  for (const columns of [4, 5, 6] as const)
    for (const leading of [0, 1, 2, 3])
      for (const cells of [8, 9, 10, 11, 12, 14]) {
        const page = contents({ leading, cells });
        assert.ok(empty(columns, page, pageFit(columns, page)) < columns, JSON.stringify({ columns, page }));
      }
});
test('a page without a list or a map has only what is there to fit', () => {
  same(pageFit(5, contents({ map: false })), placed(1, 2, 'wind', 'moon'));
  same(pageFit(4, contents({ listRows: 0, map: false, hourly: false, cells: 8 })), placed(1, 2, 'wind', 'moon'));
});
