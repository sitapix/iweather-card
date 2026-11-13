import { WEATHER_DEFAULTS } from '../weather/conditions.ts';
import { TILES, isTile, type TileId } from '../cards/ids.ts';
import { UNIT_CHOICES, UNIT_DEFAULTS, UNIT_KIND_NAMES, type UnitKind } from '../weather/units.ts';
import { READING_OPTIONS, type SourceSettings } from '../weather/sources.ts';
import { isList, isRecord } from '../lib/values.ts';
import { say } from '../weather/words.ts';
import { entityPattern, type Domain } from './home-assistant.ts';

// The card's element, its editor's, and the type a dashboard's YAML names it by.
export const CARD_TAG = 'iweather-card';
export const EDITOR_TAG = `${CARD_TAG}-editor` as const;
export const CARD_TYPE = `custom:${CARD_TAG}` as const;
// The averages from Open-Meteo's archive, where `averages` otherwise names a sensor.
export const OPEN_METEO = 'open-meteo';
// The hours and days the forecasts can show.
export const FORECAST_LIMITS = {
  forecast_hours: { min: 2, max: 48 },
  forecast_days: { min: 1, max: 10 },
} as const;
// Let the page's upper space range from none to twice its original spacing.
export const TOP_PADDING_LIMITS = { min: 0, max: 200 } as const;
// How often the card checks its online sources, in minutes. Home Assistant's own
// integrations keep their update schedules.
export const REFRESH_LIMITS = {
  radar_refresh_minutes: { min: 1, max: 60 },
  forecast_refresh_minutes: { min: 15, max: 360 },
} as const;
// The domains each entity setting accepts, for checking the YAML and for the editor's pickers.
export const SETTING_DOMAINS = {
  entity: ['weather'],
  forecast_entity: ['weather'],
  condition_entity: ['weather', 'sensor', 'input_select', 'select'],
  next_hour_entity: ['weather', 'sensor'],
  air_quality_entity: ['sensor'],
  averages: ['sensor'],
  alert_entities: ['sensor', 'binary_sensor'],
  // Each reading's own sensor (see READING_OPTIONS).
  readings: ['sensor', 'input_number', 'number', 'weather'],
  // Where the weather is for, when not home (see weatherPlace).
  zone: ['zone'],
} as const satisfies Readonly<Record<string, readonly Domain[]>>;
type EntitySetting = keyof typeof SETTING_DOMAINS;
const PATTERNS: Readonly<Record<EntitySetting, RegExp>> = {
  entity: entityPattern(...SETTING_DOMAINS.entity),
  forecast_entity: entityPattern(...SETTING_DOMAINS.forecast_entity),
  condition_entity: entityPattern(...SETTING_DOMAINS.condition_entity),
  next_hour_entity: entityPattern(...SETTING_DOMAINS.next_hour_entity),
  air_quality_entity: entityPattern(...SETTING_DOMAINS.air_quality_entity),
  averages: entityPattern(...SETTING_DOMAINS.averages),
  alert_entities: entityPattern(...SETTING_DOMAINS.alert_entities),
  readings: entityPattern(...SETTING_DOMAINS.readings),
  zone: entityPattern(...SETTING_DOMAINS.zone),
};

const WEATHER_MODES = ['auto', 'conditions', 'rain', 'wind'] as const;
const WEATHER_LAYOUTS = ['auto', 'compact', 'strip', 'expanded', 'page'] as const;
// How large the full page draws: standard, or larger for a screen seen from across a room.
const PAGE_SIZES = ['standard', 'large', 'extra_large'] as const;
const SHEET_STYLES = ['auto', 'sheet', 'popover'] as const;
// Haptic feedback: the moon's timeline ticking past its marks; that and a tap for each view, day,
// chart reading, tile and map control; or none.
const HAPTICS = ['moon', 'all', 'off'] as const;
// A map from RainViewer's radar, from Home Assistant's data alone, or none (`false` too).
const MAP_SOURCES = ['rainviewer', 'local', 'none'] as const;
const MAPS = [...MAP_SOURCES, false] as const;
// The air quality scale a sensor reports on, by country or region.
export const AIR_SCALE_IDS = [
  'us',
  'at',
  'ca',
  'cn',
  'de',
  'es',
  'eu',
  'fr',
  'ie',
  'in',
  'kr',
  'mx',
  'sg',
  'uk',
] as const;
export type AirScaleId = (typeof AIR_SCALE_IDS)[number];
export const DEFAULT_AIR_SCALE: AirScaleId = 'us';
// Left to itself, the card goes by what the sensor calls its scale (see airScale).
export const AIR_SCALE_AUTO = 'auto';
export type WeatherMode = (typeof WEATHER_MODES)[number];
export type WeatherLayout = (typeof WEATHER_LAYOUTS)[number];
export type PageSize = (typeof PAGE_SIZES)[number];
export type SheetStyle = (typeof SHEET_STYLES)[number];
export type Haptics = (typeof HAPTICS)[number];
export type MapSource = (typeof MAP_SOURCES)[number];
export const MAP_LAYER_KINDS = ['precipitation', 'wind', 'air_quality', 'temperature'] as const;
export type MapLayerKind = (typeof MAP_LAYER_KINDS)[number];
const FLAGS = [
  'weather_scene',
  'weather_animation',
  'glass_refraction',
  'show_forecast',
  'show_high_low',
  'show_daily',
  'show_name',
  'map_wind_animation',
  'map_precipitation_animation',
  'open_meteo_forecast',
  'local_only',
  'low_power',
] as const;
// What tapping, holding and double-tapping the conditions do, as Home Assistant's actions.
export const ACTION_SETTINGS = ['tap_action', 'hold_action', 'double_tap_action'] as const;
export type ActionSetting = (typeof ACTION_SETTINGS)[number];
export type CardAction = Readonly<Record<string, unknown>> & { readonly action: string };
const isAction = (value: unknown): value is CardAction => isRecord(value) && typeof value['action'] === 'string';
// Every setting's default, which the visual editor also shows and leaves out of the YAML.
export const CONFIG_DEFAULTS = Object.freeze({
  ...WEATHER_DEFAULTS,
  ...UNIT_DEFAULTS,
  show_name: true,
  glass_refraction: true,
  // The card's own wind map moves before it is opened.
  map_wind_animation: true,
  map_precipitation_animation: true,
  // The page fills what the weather entity's forecast leaves out, when it leaves anything out.
  open_meteo_forecast: true,
  radar_refresh_minutes: 5,
  forecast_refresh_minutes: 60,
  // The card asks only Home Assistant, whatever else is set (see localOnly).
  local_only: false,
  low_power: false,
  // The moon's timeline ticks past its marks; the rest of the card's feedback is asked for.
  haptics: 'moon',
  size: 'standard',
  top_padding: 50,
  sheet_style: 'auto',
  tiles: TILES,
} as const);

// The card's settings once checked, with every default filled in.
export type CardConfig = SourceSettings &
  Record<UnitKind, string> &
  Record<(typeof FLAGS)[number], boolean> & {
    entity: string;
    name?: string;
    place_name?: string;
    weather_mode: WeatherMode;
    weather_layout: WeatherLayout;
    size: PageSize;
    top_padding: number;
    sheet_style: SheetStyle;
    haptics: Haptics;
    forecast_days: number;
    forecast_hours: number;
    radar_refresh_minutes: number;
    forecast_refresh_minutes: number;
    tiles: readonly TileId[];
    air_quality_entity?: string;
    air_quality_scale?: AirScaleId | typeof AIR_SCALE_AUTO;
    alert_entities?: readonly string[];
    averages?: string;
    forecast_entity?: string;
    next_hour_entity?: string;
    map?: (typeof MAPS)[number];
    map_layers?: Partial<Record<MapLayerKind, string>>;
    map_tile_url?: string;
    zone?: string;
    time_zone?: string;
  } & Partial<Record<ActionSetting, CardAction>>;

const oneOf = <T>(choices: readonly T[], value: unknown): value is T => choices.some(choice => choice === value);
export const isLayout = (value: unknown): value is WeatherLayout => oneOf(WEATHER_LAYOUTS, value);
export const isMapSource = (value: unknown): value is MapSource => oneOf(MAP_SOURCES, value);
// A tile template: {z}, {x} and {y}, in whatever order the service wants them.
const TILE_URL = /^https:\/\/(?=.*\{z\})(?=.*\{x\})(?=.*\{y\})/;

// With `local_only` nothing the card asks for by itself leaves Home Assistant, whatever else is
// set: no forecast or normals from Open-Meteo, and no radar. A map has no ground without tiles, so
// it shows only on tiles the user named, with Home Assistant's data over them.
function localOnly({ averages, map, ...config }: CardConfig): CardConfig {
  return {
    ...config,
    open_meteo_forecast: false,
    ...(averages && averages !== OPEN_METEO ? { averages } : {}),
    ...(typeof map === 'string' && map !== 'none' && config.map_tile_url ? { map: 'local' as const } : {}),
  };
}

// A card's saved settings in today's names. Home Assistant keeps what was saved, so each step here
// stays for as long as cards saved before it may be around.
export function currentConfig(config: Readonly<Record<string, unknown>>): Record<string, unknown> {
  // What tapping did was one of three words, of which only 'none' differed from the default.
  const { tap_behavior: tap, ...rest } = config;
  const tapped =
    tap === 'none' && rest['tap_action'] === undefined ? { ...rest, tap_action: { action: 'none' } } : rest;
  // Haptic feedback was on for everything, or off.
  const haptics = tapped['haptics'];
  return typeof haptics === 'boolean' ? { ...tapped, haptics: haptics ? 'all' : 'off' } : tapped;
}

// Fills defaults and rejects settings the card cannot honor, with messages HA shows on the card, in
// the page's language. Each opens on words: a sentence that opens on a value capitalizes it.
export function normalizeConfig(saved: unknown): CardConfig {
  if (!isRecord(saved)) throw new Error(say('iWeather needs a card configuration.'));
  const config = currentConfig(saved);
  // A setting the card's YAML gives, even as null; otherwise its default.
  const read = (key: string, fallback?: unknown): unknown => (Object.hasOwn(config, key) ? config[key] : fallback);
  const entity = read('entity');
  if (typeof entity !== 'string' || !PATTERNS.entity.test(entity))
    throw new Error(say('Choose a weather entity, for example {example}.', { example: 'weather.home' }));
  const flag = (key: (typeof FLAGS)[number]): boolean => {
    const value = read(key, CONFIG_DEFAULTS[key]);
    if (typeof value !== 'boolean') throw new Error(say('The setting {key} must be true or false.', { key }));
    return value;
  };
  const result: CardConfig = {
    entity,
    weather_scene: flag('weather_scene'),
    weather_animation: flag('weather_animation'),
    glass_refraction: flag('glass_refraction'),
    show_forecast: flag('show_forecast'),
    show_high_low: flag('show_high_low'),
    show_daily: flag('show_daily'),
    show_name: flag('show_name'),
    map_wind_animation: flag('map_wind_animation'),
    map_precipitation_animation: flag('map_precipitation_animation'),
    open_meteo_forecast: flag('open_meteo_forecast'),
    local_only: flag('local_only'),
    low_power: flag('low_power'),
    haptics: 'moon',
    weather_mode: 'auto',
    weather_layout: 'auto',
    size: 'standard',
    top_padding: CONFIG_DEFAULTS.top_padding,
    sheet_style: 'auto',
    ...UNIT_DEFAULTS,
    forecast_days: 0,
    forecast_hours: 0,
    radar_refresh_minutes: CONFIG_DEFAULTS.radar_refresh_minutes,
    forecast_refresh_minutes: CONFIG_DEFAULTS.forecast_refresh_minutes,
    tiles: TILES,
  };
  const choice = <T extends string>(key: string, choices: readonly T[], fallback: T): T => {
    const value = read(key, fallback);
    if (!oneOf(choices, value))
      throw new Error(say('The setting {key} must be one of: {choices}.', { key, choices: choices.join(', ') }));
    return value;
  };
  result.weather_mode = choice('weather_mode', WEATHER_MODES, CONFIG_DEFAULTS.weather_mode);
  result.weather_layout = choice('weather_layout', WEATHER_LAYOUTS, CONFIG_DEFAULTS.weather_layout);
  result.size = choice('size', PAGE_SIZES, CONFIG_DEFAULTS.size);
  result.sheet_style = choice('sheet_style', SHEET_STYLES, CONFIG_DEFAULTS.sheet_style);
  result.haptics = choice('haptics', HAPTICS, CONFIG_DEFAULTS.haptics);
  for (const key of UNIT_KIND_NAMES) result[key] = choice(key, UNIT_CHOICES[key], CONFIG_DEFAULTS[key]);
  const whole = (key: string, fallback: number, low: number, high: number): number => {
    const value = read(key, fallback);
    if (typeof value !== 'number' || !Number.isInteger(value) || value < low || value > high)
      throw new Error(say('The setting {key} must be a whole number from {low} to {high}.', { key, low, high }));
    return value;
  };
  result.top_padding = whole(
    'top_padding',
    CONFIG_DEFAULTS.top_padding,
    TOP_PADDING_LIMITS.min,
    TOP_PADDING_LIMITS.max,
  );
  for (const key of ['forecast_days', 'forecast_hours'] as const) {
    const { min, max } = FORECAST_LIMITS[key];
    result[key] = whole(key, CONFIG_DEFAULTS[key], min, max);
  }
  for (const key of ['radar_refresh_minutes', 'forecast_refresh_minutes'] as const) {
    const { min, max } = REFRESH_LIMITS[key];
    result[key] = whole(key, CONFIG_DEFAULTS[key], min, max);
  }
  const tiles = read('tiles', CONFIG_DEFAULTS.tiles);
  if (!isList(tiles) || !tiles.every(isTile))
    throw new Error(
      say('The setting {key} must be a list of: {choices}.', { key: 'tiles', choices: TILES.join(', ') }),
    );
  if (new Set(tiles).size !== tiles.length)
    throw new Error(say('Each tile can appear in {key} only once.', { key: 'tiles' }));
  result.tiles = tiles;
  // An entity setting: unset, or an id that matches `pattern`.
  const entityOf = (key: string, pattern: RegExp, message: () => string): string | undefined => {
    const value = read(key);
    if (value !== undefined && (typeof value !== 'string' || !pattern.test(value))) throw new Error(message());
    return value;
  };
  const air = entityOf('air_quality_entity', PATTERNS.air_quality_entity, () =>
    say('The setting {key} must be a sensor, for example {example}.', {
      key: 'air_quality_entity',
      example: 'sensor.air_quality_index',
    }),
  );
  if (air !== undefined) result.air_quality_entity = air;
  if (read('air_quality_scale') !== undefined)
    result.air_quality_scale = choice('air_quality_scale', [AIR_SCALE_AUTO, ...AIR_SCALE_IDS], AIR_SCALE_AUTO);
  const alerts = read('alert_entities');
  if (alerts !== undefined) {
    if (
      !isList(alerts) ||
      !alerts.every((id): id is string => typeof id === 'string' && PATTERNS.alert_entities.test(id))
    )
      throw new Error(
        say('The setting {key} must be a list of sensors or binary sensors, for example {example}.', {
          key: 'alert_entities',
          example: '[binary_sensor.meteoalarm]',
        }),
      );
    result.alert_entities = alerts;
  }
  const averages = read('averages');
  if (averages !== undefined) {
    if (typeof averages !== 'string' || (averages !== OPEN_METEO && !PATTERNS.averages.test(averages)))
      throw new Error(
        say('The setting {key} must be {choice} or a temperature sensor, for example {example}.', {
          key: 'averages',
          choice: OPEN_METEO,
          example: 'sensor.outdoor_temperature',
        }),
      );
    result.averages = averages;
  }
  // Readings from other entities: a sensor, an input_number or a number entity each.
  for (const option of READING_OPTIONS) {
    const id = entityOf(option, PATTERNS.readings, () =>
      say('The setting {key} must be a sensor or a weather entity, for example {sensor} or {weather}.', {
        key: option,
        sensor: 'sensor.outdoor_humidity',
        weather: 'weather.open_meteo',
      }),
    );
    if (id !== undefined) result[option] = id;
  }
  const condition = entityOf('condition_entity', PATTERNS.condition_entity, () =>
    say('The setting {key} must be a weather entity or a sensor whose state is a weather condition.', {
      key: 'condition_entity',
    }),
  );
  if (condition !== undefined) result.condition_entity = condition;
  const forecast = entityOf('forecast_entity', PATTERNS.forecast_entity, () =>
    say('The setting {key} must be a weather entity, for example {example}.', {
      key: 'forecast_entity',
      example: 'weather.open_meteo',
    }),
  );
  if (forecast !== undefined) result.forecast_entity = forecast;
  const nextHour = entityOf('next_hour_entity', PATTERNS.next_hour_entity, () =>
    say('The setting {key} must be a weather entity or a sensor.', { key: 'next_hour_entity' }),
  );
  if (nextHour !== undefined) result.next_hour_entity = nextHour;
  const zone = entityOf('zone', PATTERNS.zone, () =>
    say('The setting {key} must be a zone, for example {example}.', { key: 'zone', example: 'zone.paris' }),
  );
  if (zone !== undefined) result.zone = zone;
  const map = read('map');
  if (map !== undefined) {
    if (!oneOf(MAPS, map))
      throw new Error(
        say('The setting {key} must be one of: {choices}.', { key: 'map', choices: MAP_SOURCES.join(', ') }),
      );
    result.map = map;
  }
  const layers = read('map_layers');
  if (layers !== undefined) {
    const invalid = new Error(
      say('The setting {key} must give each of {kinds} an https tile URL with {z}, {x} and {y}.', {
        key: 'map_layers',
        kinds: MAP_LAYER_KINDS.join(', '),
      }),
    );
    if (!isRecord(layers)) throw invalid;
    const valid: Partial<Record<MapLayerKind, string>> = {};
    for (const [kind, url] of Object.entries(layers)) {
      if (!oneOf(MAP_LAYER_KINDS, kind) || typeof url !== 'string' || !TILE_URL.test(url)) throw invalid;
      valid[kind] = url;
    }
    result.map_layers = valid;
  }
  const tileUrl = read('map_tile_url');
  if (tileUrl !== undefined) {
    if (typeof tileUrl !== 'string' || !TILE_URL.test(tileUrl))
      throw new Error(say('The setting {key} must be an https URL with {z}, {x} and {y}.', { key: 'map_tile_url' }));
    result.map_tile_url = tileUrl;
  }
  for (const key of ACTION_SETTINGS) {
    const action = read(key);
    if (action === undefined) continue;
    if (!isAction(action))
      throw new Error(
        say('The setting {key} must be an action, for example {example}.', { key, example: 'action: more-info' }),
      );
    result[key] = action;
  }
  const name = read('name');
  if (name !== undefined) {
    if (typeof name !== 'string') throw new Error(say('The setting {key} must be text.', { key: 'name' }));
    result.name = name;
  }
  const place = read('place_name');
  if (place !== undefined) {
    if (typeof place !== 'string') throw new Error(say('The setting {key} must be text.', { key: 'place_name' }));
    if (place.trim()) result.place_name = place.trim();
  }
  const timeZone = read('time_zone');
  if ((timeZone ?? '') !== '') {
    const invalid = say('Choose a valid IANA time zone for {key}, for example {example}.', {
      key: 'time_zone',
      example: 'America/Chicago',
    });
    if (typeof timeZone !== 'string') throw new Error(invalid);
    try {
      new Intl.DateTimeFormat(undefined, { timeZone }).format();
    } catch {
      throw new Error(invalid);
    }
    result.time_zone = timeZone;
  }
  return result.local_only ? localOnly(result) : result;
}
