import type { SheetCard, TileCard } from '../card.ts';
import { finite } from '../../lib/values.ts';
import { sunSheet } from './sheet.ts';
import { sunTile } from './tile.ts';
import { phrase } from '../../weather/words.ts';

export const sun: TileCard & SheetCard = {
  id: 'sun',
  label: phrase('Sunrise and sunset'),
  title: phrase('Sunrise and Sunset'),
  tile: sunTile,
  available: ctx => finite(ctx.latitude) && finite(ctx.longitude),
  opens: () => ({ id: 'sun' }),
  sheet: sunSheet,
};
