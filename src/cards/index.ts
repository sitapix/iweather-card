import type { CardConfig } from '../card/config.ts';
import type { HomeAssistant } from '../card/home-assistant.ts';
import { airQuality } from './air-quality/index.ts';
import { alertsCard } from './alerts/sheet.ts';
import { averages } from './averages/index.ts';
import { RANK, type SheetCard, type SheetInputs, type TileCard } from './card.ts';
import { feelsLikeCard } from './feels-like/index.ts';
import { conditions } from './forecast/conditions.ts';
import { humidity } from './humidity/index.ts';
import type { SheetId, TileId } from './ids.ts';
import { moon } from './moon/index.ts';
import { nextHourCard } from './next-hour/sheet.ts';
import { precipitation } from './precipitation/index.ts';
import { pressure } from './pressure/index.ts';
import type { TileContext } from './shared/context.ts';
import { sun } from './sun/index.ts';
import { uv } from './uv/index.ts';
import { visibility } from './visibility/index.ts';
import { wind } from './wind/index.ts';
import { map } from '../map/index.ts';
import { isTile } from './ids.ts';

// Every inner card, once. Each says what it is; the compiler checks below that every tile and
// every sheet is here.
const CARDS = {
  air_quality: airQuality,
  wind,
  moon,
  sun,
  uv,
  map,
  feels_like: feelsLikeCard,
  averages,
  precipitation,
  visibility,
  humidity,
  pressure,
  conditions,
  alerts: alertsCard,
  next_hour: nextHourCard,
};
export const TILE_CARDS: Readonly<Record<TileId, TileCard>> = CARDS;
export const SHEET_CARDS: Readonly<Record<SheetId, SheetCard>> = CARDS;
// The sheets of a day's readings, in the order of the menu by which a sheet from the foot of the
// screen turns from one to another.
export const SWITCHABLE: readonly SheetId[] = [
  'conditions',
  'uv',
  'wind',
  'precipitation',
  'humidity',
  'visibility',
  'pressure',
];

// The entities the tiles read beyond those the card's settings name.
export const tileEntities = (config: CardConfig, hass: HomeAssistant): string[] =>
  config.tiles.flatMap(id => TILE_CARDS[id].reads?.(config, hass) ?? []);
// Whether a tile can open a sheet now.
export const opensSheet = (id: TileId, ctx: SheetInputs): boolean =>
  TILE_CARDS[id].available?.(ctx) ?? ctx.hourly.length > 0;
// The tiles in the configured order, those that matter now moved up.
export function tileOrder(ids: readonly TileId[], ctx: TileContext): { id: TileId; rank: number }[] {
  return ids
    .map((id, index) => ({ id, index, rank: TILE_CARDS[id].rank?.(ctx) ?? RANK.usual }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ id, rank }) => ({ id, rank }));
}
// A tile's markup for the card's context, or null when the provider lacks its data.
export function tileMarkup(id: string, ctx: TileContext): string | null {
  try {
    return isTile(id) ? TILE_CARDS[id].tile(ctx) : null;
  } catch {
    return null;
  }
}
