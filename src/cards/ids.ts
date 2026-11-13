// The detail tiles. Each tile turns the entity, its forecasts and
// sun.sun into markup, or returns null when the provider lacks the data, so a
// missing reading hides its tile instead of showing a placeholder.
// The default order: air quality, wind and moon (two wide where there is room), the sun, UV
// and the map, then the readings. Some tiles move up while they matter (see tileOrder).
export const TILES = [
  'air_quality',
  'wind',
  'moon',
  'sun',
  'uv',
  'map',
  'feels_like',
  'averages',
  'precipitation',
  'visibility',
  'humidity',
  'pressure',
] as const;
export type TileId = (typeof TILES)[number];
export const isTile = (value: unknown): value is TileId => TILES.some(tile => tile === value);
// The sheets: one for most tiles, the day-by-day conditions, and one each for the alerts and the
// next hour. The feels-like tile has none of its own: it opens the conditions.
export type SheetId = Exclude<TileId, 'feels_like'> | 'conditions' | 'alerts' | 'next_hour';
// The symbols a tile or a day-by-day sheet heads itself with. The sun tile has two: `sun` for a
// sunrise, and `sunset`; and a pinned hourly panel heads itself like a tile, with `clock`.
export type GlyphId = TileId | 'conditions' | 'sunset' | 'clock';
