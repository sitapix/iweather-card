import type { SheetCard, TileCard } from '../card.ts';
import { readingSheet } from '../../sheets/reading.ts';
import { visibilityReading } from './sheet.ts';
import { visibilityTile } from './tile.ts';
import { finite } from '../../lib/values.ts';
import { phrase } from '../../weather/words.ts';

export const visibility: TileCard & SheetCard = {
  id: 'visibility',
  label: phrase('Visibility'),
  title: phrase('Visibility'),
  tile: visibilityTile,
  available: ctx => ctx.hourly.some(entry => finite(entry.visibility)),
  opens: () => ({ id: 'visibility' }),
  series: visibilityReading.series,
  glyph: visibilityReading.glyph,
  sheet: readingSheet(visibilityReading),
  units: ['distance_unit'],
};
