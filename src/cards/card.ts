import type { SkyKind } from '../sky/presets-data.ts';
import type { ForecastEntry, HomeAssistant } from '../card/home-assistant.ts';
import type { CardConfig, MapLayerKind } from '../card/config.ts';
import type { DetailDay } from '../sheets/days.ts';
import type { History } from '../weather/history.ts';
import type { WeatherAlert } from './alerts/rules.ts';
import type { DayBand } from './averages/climate.ts';
import type { NextHour } from './next-hour/rules.ts';
import type { SheetId, TileId } from './ids.ts';
import type { Reach, Series } from '../sheets/series.ts';
import type { TileContext } from './shared/context.ts';
import type { UnitKind } from '../weather/units.ts';

// What decides whether a tile can open a sheet.
export type SheetInputs = Pick<TileContext, 'latitude' | 'longitude'> &
  Partial<Pick<TileContext, 'climate'>> & { hourly: readonly ForecastEntry[] };
// A sheet to open: which, on what day and on what tab.
export interface Opening {
  id: SheetId;
  day?: string | undefined;
  variant?: string | undefined;
}
// Tiles move up while they matter, ahead of the rest, each group in the configured order.
export const RANK = { first: 0, raised: 1, usual: 2 } as const;
// An inner card's tile on the page.
export interface TileCard {
  id: TileId;
  // Its name in the card's settings.
  label: string;
  // It reads best two columns wide.
  wide?: boolean;
  // It has a layout two columns wide beside its own, which the page takes where that fills its
  // grid (see pageFit).
  widens?: boolean;
  // Its markup, or null when the provider lacks the data, which hides the tile.
  tile: (ctx: TileContext) => string | null;
  // What else changes it, beyond its markup.
  redrawnBy?: (ctx: TileContext, layer?: MapLayerKind) => unknown;
  // Entities it reads beyond those the card's settings name.
  reads?: (config: CardConfig, hass: HomeAssistant) => readonly string[];
  // How far up it moves now; RANK.usual otherwise.
  rank?: (ctx: TileContext) => number;
  // Whether it can open a sheet now; otherwise, once the forecast has hours.
  available?: (ctx: SheetInputs) => boolean;
  // The sheet a press opens.
  opens: (ctx: TileContext) => Opening;
}

// What a sheet is drawn from.
export interface SheetView {
  ctx: TileContext;
  title: string;
  // The day picked, and every day on offer.
  day: DetailDay | undefined;
  days: DetailDay[];
  // The tab picked; the alerts' sheet, the alert picked.
  variant: string;
  // The moon's calendar, in months from this one, and its timeline, in ms from now.
  month: number;
  moonOffset: number;
  // Home Assistant's history of what the sheet shows: undefined while it loads.
  history: History | null | undefined;
  // How far its reading goes over all it can show, held while it's open (see seriesReach).
  reach: Reach | null;
  // Whether history can be asked for at all.
  canAsk: boolean;
  // The normal range at each hour of the date (see dayBand).
  dayBand: DayBand | null | undefined;
  alerts: readonly WeatherAlert[];
  nextHour: NextHour | undefined;
  // A condition's name as the card shows it, and the weather now as the card names it.
  named: (condition: string) => string;
  nowName: string;
  nowSky?: SkyKind | undefined;
  // The map chosen in its layer picker.
  mapLayer: MapLayerKind | undefined;
  // From the foot of the screen, the menu of the sheets it can turn to (see switcher.ts).
  switcher?: string;
}
// An inner card's sheet.
export interface SheetCard {
  id: SheetId;
  title: string;
  // The reading it follows: its whole series sets its charts' scale.
  series?: Series;
  sheet: (view: SheetView) => string;
  // What else changes it, beyond its markup.
  redrawnBy?: (ctx: TileContext, layer?: MapLayerKind) => unknown;
  // The dialog's name, where it differs from the title.
  named?: (ctx: TileContext, layer: MapLayerKind | undefined) => string | undefined;
  // Its glyph, and what it shows that its title doesn't say, in the menu of the sheets a sheet
  // from the foot can turn to (see SWITCHABLE).
  glyph?: string;
  shows?: readonly string[];
  // The kinds of unit its readings are in, which its options pick, by its tab where they differ.
  units?: readonly UnitKind[] | ((variant: string) => readonly UnitKind[]);
}
