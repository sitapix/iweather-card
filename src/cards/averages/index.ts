import { RANK, type SheetCard, type TileCard } from '../card.ts';
import { averageToday } from './rules.ts';
import { averagesSheet } from './sheet.ts';
import { averagesTile } from './tile.ts';
import { phrase } from '../../weather/words.ts';

export const averages: TileCard & SheetCard = {
  id: 'averages',
  label: phrase('Averages'),
  title: phrase('Averages'),
  tile: averagesTile,
  // On an unusual day, a high outside its normal range, it moves up.
  rank(ctx) {
    const average = averageToday(ctx);
    return average && (average.high < average.normal.range[0] || average.high > average.normal.range[1])
      ? RANK.raised
      : RANK.usual;
  },
  available: ctx => Boolean(ctx.climate),
  opens: () => ({ id: 'averages' }),
  sheet: averagesSheet,
  // Its tab of temperatures or of precipitation.
  units: variant => [variant === 'precipitation' ? 'precipitation_unit' : 'temperature_unit'],
};
