import { RANK, type SheetCard, type TileCard } from '../card.ts';
import { airIsSignificant, airNow } from './rules.ts';
import { airQualitySheet, pollutantIds } from './sheet.ts';
import { airQualityTile } from './tile.ts';
import { phrase } from '../../weather/words.ts';

export const airQuality: TileCard & SheetCard = {
  id: 'air_quality',
  label: phrase('Air quality'),
  title: phrase('Air Quality'),
  wide: true,
  tile: airQualityTile,
  // Bad enough to matter, it comes first.
  rank(ctx) {
    const air = airNow(ctx);
    return air && airIsSignificant(air.value, air.scale) ? RANK.first : RANK.usual;
  },
  // Its sheet lists the sensors on the index's own device.
  reads: (config, hass) => pollutantIds(hass, config.air_quality_entity),
  available: () => true,
  opens: () => ({ id: 'air_quality' }),
  sheet: airQualitySheet,
};
