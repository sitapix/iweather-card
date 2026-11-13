import type { SheetCard, TileCard } from '../card.ts';
import { readingSheet } from '../../sheets/reading.ts';
import { pressureReading } from './sheet.ts';
import { pressureTile } from './tile.ts';
import { finite } from '../../lib/values.ts';
import { phrase } from '../../weather/words.ts';

export const pressure: TileCard & SheetCard = {
  id: 'pressure',
  label: phrase('Pressure'),
  title: phrase('Pressure'),
  tile: pressureTile,
  available: ctx => ctx.hourly.some(entry => finite(entry.pressure)),
  opens: () => ({ id: 'pressure' }),
  series: pressureReading.series,
  glyph: pressureReading.glyph,
  sheet: readingSheet(pressureReading),
  units: ['pressure_unit'],
};
