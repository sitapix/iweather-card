import type { SheetCard, TileCard } from '../card.ts';
import { readingSheet } from '../../sheets/reading.ts';
import { humidityReading } from './sheet.ts';
import { humidityTile } from './tile.ts';
import { phrase } from '../../weather/words.ts';

export const humidity: TileCard & SheetCard = {
  id: 'humidity',
  label: phrase('Humidity'),
  title: phrase('Humidity'),
  tile: humidityTile,
  opens: () => ({ id: 'humidity' }),
  series: humidityReading.series,
  glyph: humidityReading.glyph,
  sheet: readingSheet(humidityReading),
};
