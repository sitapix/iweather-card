import type { SheetCard, TileCard } from '../card.ts';
import { finite } from '../../lib/values.ts';
import { moonSheet } from './sheet.ts';
import { moonTile } from './tile.ts';
import { phrase } from '../../weather/words.ts';

export const moon: TileCard & SheetCard = {
  id: 'moon',
  label: phrase('Moon'),
  title: phrase('Moon'),
  widens: true,
  tile: moonTile,
  available: ctx => finite(ctx.latitude) && finite(ctx.longitude),
  opens: () => ({ id: 'moon' }),
  sheet: moonSheet,
};
