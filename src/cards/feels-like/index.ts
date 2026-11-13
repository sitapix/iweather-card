import { RANK, type TileCard } from '../card.ts';
import { dateKey } from '../../weather/forecast-items.ts';
import { feltApart } from './rules.ts';
import { feelsLikeTile } from './tile.ts';
import { phrase } from '../../weather/words.ts';

export const feelsLikeCard: TileCard = {
  id: 'feels_like',
  label: phrase('Feels like'),
  tile: feelsLikeTile,
  // It moves up 5 °F (2.8 °C) or more from the temperature.
  rank: ctx => (feltApart(ctx.attrs) === null ? RANK.usual : RANK.raised),
  // Today's conditions, on their feels-like tab.
  opens: ctx => ({ id: 'conditions', day: dateKey(Date.now(), ctx.timeZone), variant: 'feels_like' }),
};
