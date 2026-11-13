import type { TileId } from '../cards/ids.ts';
// How the full layout fills its grid. The hourly panel, the daily list and the map stand as one
// block, and everything else packs around it, each in the first room it fits, so all a tile's
// size decides is how much room is left over. Wind and moon read well one cell wide or two, and
// beside the list the map reads well at two rows or as tall as the list: of those choices, the one
// that leaves the fewest cells empty is taken, the widest and tallest where several tie. What is
// on the page changes that: without air quality wind and moon take its room, and an alert or
// the next hour above the block leaves them less.

// The counts of columns with a block, and how wide the hourly panel is in each. At four the map
// stands under the list; from five, beside it.
export const PAGE_COLUMNS = [4, 5, 6] as const;
export type PageColumns = (typeof PAGE_COLUMNS)[number];
const HOURLY_WIDTH: Readonly<Record<PageColumns, number>> = { 4: 2, 5: 4, 6: 4 };
const STACKED: PageColumns = 4;
// Every tile and panel that isn't one cell wide is two.
const WIDE = 2;
// The map is two wide, and at least two tall.
const MAP_ROWS = 2;

export interface PageContents {
  // Panels that open the page, ahead of the block, each two cells wide.
  leading: number;
  // The cells taken by everything else of a set width.
  cells: number;
  // Tiles that can stand one cell wide or two.
  flexible: readonly TileId[];
  hourly: boolean;
  // The rows the daily list spans; none without a list.
  listRows: number;
  map: boolean;
}
export interface PageFit {
  // The row the block starts in, how many the map spans, and which tiles stand two wide.
  top: number;
  mapRows: number;
  wide: readonly TileId[];
}

// The block starts in the first row with room for the hourly panel beside what leads the page,
// which fills the rows from the left.
function blockTop(columns: PageColumns, { leading, hourly }: PageContents): number {
  const width = hourly ? HOURLY_WIDTH[columns] : 0;
  let top = 1,
    free = columns;
  for (let panel = 0; panel < leading; panel++) {
    if (free < WIDE) {
      top++;
      free = columns;
    }
    free -= WIDE;
  }
  return free < width ? top + 1 : top;
}
// Every way of choosing among the tiles, most chosen first, then the earliest.
function choices(tiles: readonly TileId[]): TileId[][] {
  const sets: TileId[][] = [[]];
  for (const tile of [...tiles].reverse()) sets.unshift(...sets.map(set => [tile, ...set]));
  return sets;
}

export function pageFit(columns: PageColumns, contents: PageContents): PageFit {
  const { leading, cells, flexible, hourly, listRows, map } = contents,
    top = blockTop(columns, contents),
    stacked = columns === STACKED,
    tallest = stacked || !map ? MAP_ROWS : Math.max(listRows, MAP_ROWS),
    fixed = leading * WIDE + cells + flexible.length + listRows * WIDE + (hourly ? HOURLY_WIDTH[columns] : 0);
  let best: (PageFit & { empty: number }) | undefined;
  for (let mapRows = tallest; mapRows >= MAP_ROWS; mapRows--)
    for (const wide of choices(flexible)) {
      const taken = fixed + wide.length + (map ? mapRows * WIDE : 0),
        beside = stacked ? listRows + (map ? MAP_ROWS : 0) : Math.max(listRows, map ? mapRows : 0),
        rows = Math.max(top + beside, Math.ceil(taken / columns)),
        empty = rows * columns - taken;
      if (!best || empty < best.empty) best = { top, mapRows, wide, empty };
    }
  return { top, mapRows: best?.mapRows ?? MAP_ROWS, wide: best?.wide ?? [] };
}
