import type { SheetCard, TileCard } from '../card.ts';
import { readingSheet } from '../../sheets/reading.ts';
import { uvReading } from './sheet.ts';
import { uvTile } from './tile.ts';
import { phrase } from '../../weather/words.ts';

export const uv: TileCard & SheetCard = {
  id: 'uv',
  label: phrase('UV index'),
  title: phrase('UV Index'),
  tile: uvTile,
  opens: () => ({ id: 'uv' }),
  series: uvReading.series,
  glyph: uvReading.glyph,
  sheet: readingSheet(uvReading),
};
