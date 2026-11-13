import type { SheetCard, TileCard } from '../card.ts';
import { precipitationSheet } from './sheet.ts';
import { precipitationTile } from './tile.ts';
import { phrase } from '../../weather/words.ts';
import { glyphs } from '../shared/glyphs.ts';

export const precipitation: TileCard & SheetCard = {
  id: 'precipitation',
  label: phrase('Precipitation'),
  title: phrase('Precipitation'),
  tile: precipitationTile,
  opens: () => ({ id: 'precipitation' }),
  sheet: precipitationSheet,
  glyph: glyphs.precipitation,
  units: ['precipitation_unit'],
};
