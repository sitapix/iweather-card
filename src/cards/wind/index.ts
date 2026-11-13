import type { SheetCard, TileCard } from '../card.ts';
import { readingSheet } from '../../sheets/reading.ts';
import { windReading } from './sheet.ts';
import { windTile } from './tile.ts';
import { phrase } from '../../weather/words.ts';

export const wind: TileCard & SheetCard = {
  id: 'wind',
  label: phrase('Wind'),
  title: phrase('Wind'),
  widens: true,
  tile: windTile,
  opens: () => ({ id: 'wind' }),
  series: windReading.series,
  glyph: windReading.glyph,
  sheet: readingSheet(windReading),
  units: ['wind_speed_unit'],
};
