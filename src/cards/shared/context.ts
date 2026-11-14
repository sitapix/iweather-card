import type { RainOutlook } from '../../weather/rain-outlook.ts';
import type { EntityAttributes, EntityState, HomeAssistant } from '../../card/home-assistant.ts';
import type { TimedEntry, DailyItem } from '../../weather/forecast-items.ts';
import type { CardConfig } from '../../card/config.ts';
import type { RecentRain, Climate } from '../averages/climate.ts';
import type { AirSupply } from '../air-quality/open-meteo.ts';
import type { DataUpdate } from '../../weather/freshness.ts';
// What the tiles and detail sheets are built from, as the card gathers it each render.
export interface TileContext {
  // Unique per card, so its SVG ids never clash with another card's on the page.
  id: string;
  // The weather entity's attributes, in the card's units, with the readings it leaves out filled in
  // from elsewhere (see readingsNow).
  attrs: EntityAttributes;
  hourly: readonly TimedEntry[];
  // The hours over before `hourly`'s first, oldest first: yesterday's and today's so far, with the
  // same readings. Only the supplement has them, so with it off or failed there are none.
  pastHours: readonly TimedEntry[];
  daily: readonly DailyItem[];
  // sun.sun.
  sun: Pick<EntityState, 'state' | 'attributes'> | undefined;
  config: CardConfig;
  hass: HomeAssistant | undefined;
  locale: string | undefined;
  // The locale numbers are written in (see numberLocale).
  numbers: string | undefined;
  timeZone: string | undefined;
  now: number;
  // Actual entity-change and supplemental-forecast retrieval times, never render times.
  freshness?: readonly DataUpdate[];
  // A forced 12- or 24-hour clock; undefined follows the locale.
  hour12: boolean | undefined;
  // A reading in the locale, with up to `digits` decimals; '—' when it isn't a number.
  fmt: (value: number | null | undefined, digits?: number) => string;
  // The forecast panel's view ('conditions', 'rain' or 'wind'), as shown.
  mode: string | undefined;
  // The weather entity's state.
  condition: string | undefined;
  latitude: number | undefined;
  longitude: number | undefined;
  // The weather is for Home Assistant's home (see isHome).
  atHome: boolean;
  // The theme is dark, whatever the sky is doing: Home Assistant's, or the screen's where it doesn't say.
  dark: boolean;
  // What the map's pin is named: the reader's own place at home, else the town or city set, if any.
  pinName: string;
  placeName: string;
  // The entity's attributes three hours ago, from history, for the pressure trend.
  earlier: Readonly<Record<string, unknown>> | undefined;
  // What a precipitation sensor recorded over the last `hours` (6, else 24, when anything fell),
  // and over the last 24 hours, in the card's unit.
  recent?: { hours: number; amount: number; partial?: boolean } | undefined;
  lastDay?: number | undefined;
  // The air quality sensor's reading a day ago, from history.
  airYesterday?: number | undefined;
  // Air quality filled in for the weather's place, where no sensor is set (see airNow).
  airSupply?: AirSupply | undefined;
  // That is on its way for the first time.
  airAwaited?: boolean;
  // The next-hour panel is showing precipitation on its way.
  nextHour?: boolean;
  // How soon precipitation comes, from the minute forecast and then the hourly (see rainOutlook);
  // undefined while the minute forecast is on its way.
  rainOutlook?: RainOutlook | undefined;
  // The last weeks' precipitation, day by day to yesterday (see openMeteoRecentRain).
  recentRain?: RecentRain | null | undefined;
  climate: Climate | null | undefined;
}
// Formatting a clock time needs only the locale.
export type ClockContext = Pick<TileContext, 'locale' | 'timeZone' | 'hour12'>;
