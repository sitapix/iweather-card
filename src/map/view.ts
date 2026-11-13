import type { MapLayerKind } from '../card/config.ts';
import { glyphs } from '../cards/shared/glyphs.ts';
import type { TileContext } from '../cards/shared/context.ts';
import { finite } from '../lib/values.ts';
import { UNITS, convertUnit } from '../weather/units.ts';
import { mapKind } from './sources.ts';
import { airBand, airGlyphFor, airIsSignificant, airNow } from '../cards/air-quality/rules.ts';
import { AIR_SCALES } from '../cards/air-quality/scales.ts';
import { temperatureColor } from '../weather/temperature-colors.ts';
import { header } from '../cards/shared/tile.ts';
import { phrase, say } from '../weather/words.ts';
// The wind map's blue, which its pin takes too.
const WIND_BLUE = '#0078bd';
// The pin's colours by how serious the air is (see AIR_TIERS), for the air quality map.
const AQI_COLORS = ['#4fc36a', '#f2d33a', '#f59b23', '#ea4b3c', '#a24dd6', '#7e2236'];
const MAP_TITLES: Readonly<Record<MapLayerKind, string>> = {
  precipitation: phrase('Precipitation'),
  wind: phrase('Wind map'),
  air_quality: phrase('Air quality map'),
  temperature: phrase('Temperature map'),
};
const MAP_GLYPHS: Readonly<Record<Exclude<MapLayerKind, 'air_quality'>, string>> = {
  precipitation: glyphs.map,
  wind: glyphs.wind,
  temperature: glyphs.feels_like,
};
// The map tile follows the forecast panel and the weather (see mapKind) using whatever data the card
// has: RainViewer radar when enabled, the weather entity's wind, the air quality sensor,
// the temperature. `map_layers` can add tile overlays from any service for each kind.
export interface MapView {
  kind: MapLayerKind;
  title: string;
  glyph: string;
  inputs: MapInputs;
}
// What a map draws from. Readings a map may not have are '' (see the pins in map/markup.ts).
export interface MapInputs {
  latitude: number;
  longitude: number;
  kind: MapLayerKind;
  // The reading its pin carries: the temperature, the wind speed or the AQI, and its colour.
  badge: string;
  tint: string;
  bearing: string;
  speed: string;
  unit: string;
  // Today's low and high, the weather now and the temperature unit, for the large map's pins.
  low: string;
  high: string;
  condition: string;
  temperatureUnit: string;
  // The ground follows the theme, not the sky; and what the pin is named, if anything.
  dark: boolean;
  pinName: string;
}
// The map for a view: the kind that matters most now (see mapKind), or `layer` where one is chosen.
export function mapView(
  ctx: Pick<
    TileContext,
    | 'config'
    | 'latitude'
    | 'longitude'
    | 'attrs'
    | 'hass'
    | 'condition'
    | 'hourly'
    | 'daily'
    | 'now'
    | 'nextHour'
    | 'mode'
    | 'dark'
    | 'pinName'
    | 'airSupply'
  >,
  layer?: MapLayerKind,
): MapView | null {
  // The map looks where the weather is for (see weatherPlace).
  const { attrs, latitude, longitude } = ctx;
  if (!(ctx.config.map === 'rainviewer' || ctx.config.map === 'local') || !finite(latitude) || !finite(longitude))
    return null;
  const air = airNow(ctx),
    aqi = air?.value ?? Number.NaN,
    scale = air?.scale ?? AIR_SCALES.us,
    // The map's own colours run on the US scale, so a reading on any other leaves its pin to the map.
    sameScale = scale === AIR_SCALES.us;
  // The strongest wind now: the gust, or the wind itself.
  const gust = attrs.wind_gust_speed ?? attrs.wind_speed;
  const kind =
    layer ??
    mapKind({
      mode: ctx.mode,
      state: ctx.condition,
      hourly: ctx.hourly,
      now: ctx.now,
      nextHour: ctx.nextHour === true,
      radar: ctx.config.map === 'rainviewer',
      airSignificant: finite(aqi) && airIsSignificant(aqi, scale),
      gust: convertUnit('wind_speed_unit', gust ?? Number.NaN, attrs.wind_speed_unit, UNITS.kilometersPerHour),
    });
  const title = say(MAP_TITLES[kind]),
    glyph = kind === 'air_quality' ? airGlyphFor(aqi, scale) : MAP_GLYPHS[kind];
  // The map pin carries a reading: the temperature, the wind speed or the AQI.
  const badge =
    kind === 'wind' ? attrs.wind_speed : kind === 'air_quality' ? (sameScale ? aqi : undefined) : attrs.temperature;
  const tint =
    kind === 'air_quality'
      ? (AQI_COLORS[airBand(scale, aqi).tier] ?? '')
      : kind === 'temperature'
        ? temperatureColor(attrs.temperature ?? Number.NaN, attrs.temperature_unit)
        : kind === 'wind'
          ? WIND_BLUE
          : '';
  const today = ctx.daily.find(day => day.today) ?? ctx.daily[0];
  return {
    kind,
    title,
    glyph,
    inputs: {
      latitude,
      longitude,
      kind,
      badge: finite(badge) ? String(Math.round(badge)) : '',
      tint,
      bearing: finite(attrs.wind_bearing) ? String(attrs.wind_bearing) : '',
      speed: finite(attrs.wind_speed) ? String(attrs.wind_speed) : '',
      unit: attrs.wind_speed_unit ?? '',
      low: finite(today?.low) ? String(today.low) : '',
      high: finite(today?.high) ? String(today.high) : '',
      condition: ctx.condition ?? '',
      temperatureUnit: attrs.temperature_unit ?? '',
      dark: ctx.dark,
      pinName: ctx.pinName,
    },
  };
}

export function mapTile(ctx: TileContext): string | null {
  const view = mapView(ctx);
  return view && `${header(view.glyph, view.title)}<div class="radar" data-kind="${view.kind}"></div>`;
}
