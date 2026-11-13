import {
  CONDITION,
  type EntityState,
  type ForecastEntry,
  type ForecastType,
  type HassConfig,
  WEATHER_CONDITIONS,
  type WeatherCondition,
} from '../src/card/home-assistant.ts';
import type { WeatherLayout } from '../src/card/config.ts';
import { DAY, HOUR } from '../src/lib/time.ts';
import { zoneAt } from './scene-clock.ts';

// The demo's sample weather: a day in each condition, the sun at any hour, and the Home Assistant
// state the card is handed for them, with the settings a visitor picks as the card's YAML. No page
// here, so the tests read it in Node.

export const ENTITY = 'weather.home';
export const ALERTS = 'sensor.weather_alerts';
export const CARD_TYPE = 'custom:iweather-card';
// Where the sample weather is, for the map, the moon, the air and the normals.
export const PLACE = { name: 'Chicago', latitude: 41.88, longitude: -87.63 } as const;

export type Units = 'us' | 'metric';
export type Theme = 'light' | 'dark';

// A day's weather, in °F, mph, inches, inHg and miles: the high, and the readings while it lasts.
export interface Weather {
  id: string;
  label: string;
  condition: WeatherCondition;
  high: number;
  humidity: number;
  wind: number;
  cover: number;
  // An hour's rain or snow (as water) while it falls.
  rain: number;
  visibility: number;
  pressure: number;
}

export const WEATHERS: readonly Weather[] = [
  {
    id: 'clear',
    label: 'Clear',
    condition: CONDITION.sunny,
    high: 78,
    humidity: 40,
    wind: 6,
    cover: 3,
    rain: 0,
    visibility: 10,
    pressure: 30.12,
  },
  {
    id: 'partly-cloudy',
    label: 'Partly cloudy',
    condition: CONDITION.partlyCloudy,
    high: 72,
    humidity: 50,
    wind: 8,
    cover: 45,
    rain: 0,
    visibility: 10,
    pressure: 30.02,
  },
  {
    id: 'cloudy',
    label: 'Cloudy',
    condition: CONDITION.cloudy,
    high: 63,
    humidity: 70,
    wind: 10,
    cover: 95,
    rain: 0,
    visibility: 9,
    pressure: 29.92,
  },
  {
    id: 'fog',
    label: 'Fog',
    condition: CONDITION.fog,
    high: 54,
    humidity: 97,
    wind: 3,
    cover: 100,
    rain: 0,
    visibility: 0.3,
    pressure: 30.05,
  },
  {
    id: 'rain',
    label: 'Rain',
    condition: CONDITION.rainy,
    high: 57,
    humidity: 88,
    wind: 12,
    cover: 95,
    rain: 0.08,
    visibility: 5,
    pressure: 29.78,
  },
  {
    id: 'downpour',
    label: 'Downpour',
    condition: CONDITION.pouring,
    high: 60,
    humidity: 95,
    wind: 16,
    cover: 100,
    rain: 0.45,
    visibility: 2,
    pressure: 29.66,
  },
  {
    id: 'thunderstorm',
    label: 'Thunderstorm',
    condition: CONDITION.lightningRainy,
    high: 79,
    humidity: 84,
    wind: 18,
    cover: 80,
    rain: 0.3,
    visibility: 4,
    pressure: 29.7,
  },
  {
    id: 'lightning',
    label: 'Dry lightning',
    condition: CONDITION.lightning,
    high: 88,
    humidity: 30,
    wind: 14,
    cover: 60,
    rain: 0,
    visibility: 10,
    pressure: 29.8,
  },
  {
    id: 'snow',
    label: 'Snow',
    condition: CONDITION.snowy,
    high: 29,
    humidity: 86,
    wind: 10,
    cover: 100,
    rain: 0.06,
    visibility: 1.5,
    pressure: 29.95,
  },
  {
    id: 'sleet',
    label: 'Sleet',
    condition: CONDITION.snowyRainy,
    high: 34,
    humidity: 92,
    wind: 13,
    cover: 100,
    rain: 0.05,
    visibility: 3,
    pressure: 29.85,
  },
  {
    id: 'hail',
    label: 'Hail',
    condition: CONDITION.hail,
    high: 55,
    humidity: 85,
    wind: 20,
    cover: 90,
    rain: 0.2,
    visibility: 3,
    pressure: 29.72,
  },
  {
    id: 'windy',
    label: 'Windy',
    condition: CONDITION.windy,
    high: 66,
    humidity: 45,
    wind: 28,
    cover: 25,
    rain: 0,
    visibility: 10,
    pressure: 29.88,
  },
  {
    id: 'wind-and-cloud',
    label: 'Wind and cloud',
    condition: CONDITION.windyVariant,
    high: 58,
    humidity: 60,
    wind: 32,
    cover: 90,
    rain: 0,
    visibility: 9,
    pressure: 29.6,
  },
];
export const DEFAULT_WEATHER = 'partly-cloudy';
export function weatherById(id: string): Weather {
  const weather = WEATHERS.find(each => each.id === id) ?? WEATHERS.find(each => each.id === DEFAULT_WEATHER);
  if (!weather) throw new Error(`No sample weather ${DEFAULT_WEATHER}.`);
  return weather;
}

// The languages the card speaks, by Home Assistant's codes, each named in itself.
export const LANGUAGES: readonly (readonly [code: string, name: string])[] = [
  ['en', 'English'],
  ['cs', 'Čeština'],
  ['da', 'Dansk'],
  ['de', 'Deutsch'],
  ['es', 'Español'],
  ['fi', 'Suomi'],
  ['fr', 'Français'],
  ['it', 'Italiano'],
  ['ja', '日本語'],
  ['ko', '한국어'],
  ['nb', 'Norsk bokmål'],
  ['nl', 'Nederlands'],
  ['pl', 'Polski'],
  ['pt', 'Português'],
  ['sv', 'Svenska'],
  ['zh-Hans', '简体中文'],
  ['zh-Hant', '繁體中文'],
];

// --- The sun ------------------------------------------------------------------------------
// A twelve-hour day: up at 6, highest at noon, down at 18, lowest at midnight.
export const SUNRISE = 6;
export const NOON = 12;
export const SUNSET = 18;
const HOURS = 24;
const HIGHEST = 55;
const LOWEST = -40;
const DAYLIGHT = SUNSET - SUNRISE;

// The sun's height and whether it is climbing, at an hour of the scene's day.
export function sunAt(hour: number): { elevation: number; rising: boolean } {
  const day = hour >= SUNRISE && hour <= SUNSET,
    since = day ? hour - SUNRISE : (hour - SUNSET + HOURS) % HOURS,
    height = Math.sin((Math.PI * since) / (day ? DAYLIGHT : HOURS - DAYLIGHT));
  return { elevation: Math.round((day ? HIGHEST : LOWEST) * height * 10) / 10, rising: hour < NOON };
}

// sun.sun at an hour of the scene's day: next rising, noon and setting at 6, 12 and 18.
export function sunState(hour: number, now: number): EntityState {
  const { elevation, rising } = sunAt(hour),
    start = Math.floor(now / HOUR) * HOUR,
    next = (at: number) => {
      const last = start - ((hour - at + HOURS) % HOURS) * HOUR;
      return new Date(last > now ? last : last + DAY).toISOString();
    };
  return {
    entity_id: 'sun.sun',
    state: elevation >= 0 ? 'above_horizon' : 'below_horizon',
    attributes: { elevation, rising, next_rising: next(SUNRISE), next_noon: next(NOON), next_setting: next(SUNSET) },
  };
}

// --- A day's readings ----------------------------------------------------------------------
const WET: ReadonlySet<WeatherCondition> = new Set([
  CONDITION.rainy,
  CONDITION.pouring,
  CONDITION.lightningRainy,
  CONDITION.snowy,
  CONDITION.snowyRainy,
  CONDITION.hail,
]);
const isWet = (condition: WeatherCondition): boolean => WET.has(condition);
// The days after today, and how much warmer or cooler each runs than today. Below freezing,
// what would fall as rain falls as snow.
const LATER: readonly WeatherCondition[] = [
  CONDITION.partlyCloudy,
  CONDITION.sunny,
  CONDITION.cloudy,
  CONDITION.rainy,
  CONDITION.sunny,
  CONDITION.partlyCloudy,
  CONDITION.lightningRainy,
  CONDITION.cloudy,
  CONDITION.sunny,
];
const DAY_STEPS = [0, 2, 4, -1, -5, -2, 3, 5, 1, -3];
const FREEZING = 36;
const COLD_LATER: Partial<Record<WeatherCondition, WeatherCondition>> = {
  [CONDITION.rainy]: CONDITION.snowy,
  [CONDITION.lightningRainy]: CONDITION.snowy,
};
// Cloud over each condition when it isn't the day's own.
const COVER: Readonly<Record<WeatherCondition, number>> = {
  [CONDITION.clearNight]: 3,
  [CONDITION.sunny]: 5,
  [CONDITION.partlyCloudy]: 45,
  [CONDITION.cloudy]: 92,
  [CONDITION.fog]: 100,
  [CONDITION.rainy]: 95,
  [CONDITION.pouring]: 100,
  [CONDITION.lightningRainy]: 80,
  [CONDITION.lightning]: 60,
  [CONDITION.snowy]: 100,
  [CONDITION.snowyRainy]: 100,
  [CONDITION.hail]: 90,
  [CONDITION.windy]: 25,
  [CONDITION.windyVariant]: 90,
  [CONDITION.exceptional]: 50,
};
// How long the chosen weather lasts, the most a day's temperature swings (less under cloud),
// and the hour it peaks.
const HELD_HOURS = 12;
const SWING = { clear: 16, overcast: 8 } as const;
const OVERCAST = 80;
const WARMEST = 15;
const DAYS = 10;
// An hour's rain against the day's, the chance of it by turn, and how much the wind varies.
const RAIN_STEPS = [1, 0.7, 1.3, 0.9];
const WET_CHANCE = 60;
const CHANCE_STEP = 10;
const DRY_CHANCE = [0, 5, 0, 10, 0, 0];
const WIND_STEPS = [0, 2, 1, 3, -1, 1];
const GUST = 1.5;
const BEARING = 210;
const BEARING_TURN = 3;
const BEARING_SPAN = 60;
const HUMID_SWING = 8;
const UV_HIGHEST = 8;
const CLOUD_SHADE = 0.7;
const PERCENT = 100;
const DAILY_CHANCE = { wet: 80, dry: 10 } as const;
// Miles to the horizon on a day without rain or fog.
const CLEAR_VISIBILITY = 10;

export interface Day {
  condition: WeatherCondition;
  high: number;
  low: number;
}

// Each day of the forecast: today the chosen weather, then the run of days after it.
export function days(weather: Weather): Day[] {
  return Array.from({ length: DAYS }, (_, i) => {
    const later = LATER[(i - 1 + LATER.length) % LATER.length] ?? CONDITION.partlyCloudy,
      condition = i === 0 ? weather.condition : weather.high < FREEZING ? (COLD_LATER[later] ?? later) : later,
      high = weather.high + (DAY_STEPS[i] ?? 0),
      swing = (COVER[condition] >= OVERCAST ? SWING.overcast : SWING.clear) / 2;
    return { condition, high, low: high - swing * 2 };
  });
}

// A clear hour after dark is a clear night.
const atHour = (condition: WeatherCondition, hour: number): WeatherCondition =>
  condition === CONDITION.sunny && (hour < SUNRISE || hour >= SUNSET) ? CONDITION.clearNight : condition;

// 1 at the warmest hour of the day, -1 twelve hours from it.
const warmth = (hour: number) => Math.cos((2 * Math.PI * (hour - WARMEST)) / HOURS);

// How much daylight is out at an hour, 0 to 1.
function daylight(hour: number): number {
  if (hour <= SUNRISE || hour >= SUNSET) return 0;
  return Math.sin((Math.PI * (hour - SUNRISE)) / DAYLIGHT);
}

// The hours from the one under way: the chosen weather for half a day, then each day's own.
export function hours(weather: Weather, hour: number, now: number): ForecastEntry[] {
  const start = Math.floor(now / HOUR) * HOUR,
    forecastDays = days(weather);
  return Array.from({ length: DAYS * HOURS - hour }, (_, i) => {
    const local = (hour + i) % HOURS,
      day = forecastDays[Math.floor((hour + i) / HOURS)] ?? forecastDays[0],
      held = i < HELD_HOURS,
      condition = atHour(held ? weather.condition : (day?.condition ?? weather.condition), local),
      wet = isWet(condition),
      high = day?.high ?? weather.high,
      low = day?.low ?? weather.high,
      cover = held ? weather.cover : COVER[condition],
      rain = held ? weather.rain : (WEATHERS.find(other => other.condition === condition)?.rain ?? 0);
    return {
      datetime: new Date(start + i * HOUR).toISOString(),
      condition,
      temperature: Math.round(low + ((high - low) * (1 + warmth(local))) / 2),
      humidity: Math.min(PERCENT, Math.max(0, Math.round(weather.humidity - HUMID_SWING * warmth(local)))),
      precipitation: wet ? Math.round(rain * (RAIN_STEPS[i % RAIN_STEPS.length] ?? 1) * PERCENT) / PERCENT : 0,
      precipitation_probability: wet
        ? WET_CHANCE + (i % RAIN_STEPS.length) * CHANCE_STEP
        : (DRY_CHANCE[i % DRY_CHANCE.length] ?? 0),
      wind_speed: weather.wind + (WIND_STEPS[i % WIND_STEPS.length] ?? 0),
      wind_gust_speed: Math.round((weather.wind + (WIND_STEPS[i % WIND_STEPS.length] ?? 0)) * GUST),
      wind_bearing: BEARING + ((i * BEARING_TURN) % BEARING_SPAN),
      cloud_coverage: cover,
      uv_index: Math.round(UV_HIGHEST * daylight(local) * (1 - (cover / PERCENT) * CLOUD_SHADE)),
      pressure: weather.pressure,
      visibility: held || wet ? weather.visibility : CLEAR_VISIBILITY,
    };
  });
}

// The days, dated at local noon so no zone moves one onto the date before.
export function daily(weather: Weather, hour: number, now: number): ForecastEntry[] {
  const noon = Math.floor(now / HOUR) * HOUR + (NOON - hour) * HOUR;
  return days(weather).map((day, i) => ({
    datetime: new Date(noon + i * DAY).toISOString(),
    condition: day.condition,
    temperature: day.high,
    templow: day.low,
    precipitation_probability: isWet(day.condition) ? DAILY_CHANCE.wet : DAILY_CHANCE.dry,
    precipitation: isWet(day.condition) ? weather.rain * HELD_HOURS : 0,
    wind_speed: weather.wind,
  }));
}

// --- Units --------------------------------------------------------------------------------
// From the sample's units into metric, to the decimals an integration sends.
const FAHRENHEIT_ZERO = 32;
const CELSIUS_PER_FAHRENHEIT = 5 / 9;
const KM_PER_MILE = 1.609344;
const MM_PER_INCH = 25.4;
const HPA_PER_INHG = 33.8639;
const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;
const METRIC = {
  temperature: (value: number) => round((value - FAHRENHEIT_ZERO) * CELSIUS_PER_FAHRENHEIT, 1),
  speed: (value: number) => round(value * KM_PER_MILE, 1),
  rain: (value: number) => round(value * MM_PER_INCH, 1),
  pressure: (value: number) => round(value * HPA_PER_INHG, 0),
  distance: (value: number) => round(value * KM_PER_MILE, 1),
} as const;
const READING_KINDS: Partial<Record<string, keyof typeof METRIC>> = {
  temperature: 'temperature',
  templow: 'temperature',
  apparent_temperature: 'temperature',
  dew_point: 'temperature',
  wind_speed: 'speed',
  wind_gust_speed: 'speed',
  precipitation: 'rain',
  pressure: 'pressure',
  visibility: 'distance',
};
export const UNIT_NAMES = {
  us: {
    temperature_unit: '°F',
    wind_speed_unit: 'mph',
    precipitation_unit: 'in',
    pressure_unit: 'inHg',
    visibility_unit: 'mi',
  },
  metric: {
    temperature_unit: '°C',
    wind_speed_unit: 'km/h',
    precipitation_unit: 'mm',
    pressure_unit: 'hPa',
    visibility_unit: 'km',
  },
} as const;

// An entry's readings in `units`, from the sample's.
export function inUnits<T extends Record<string, unknown>>(entry: T, units: Units): T {
  if (units === 'us') return entry;
  const converted: Record<string, unknown> = { ...entry };
  for (const [key, value] of Object.entries(entry)) {
    const kind = READING_KINDS[key];
    if (kind && typeof value === 'number') converted[key] = METRIC[kind](value);
  }
  return { ...entry, ...converted };
}

// --- What the card is handed ---------------------------------------------------------------
// A weather alert fit for each condition, as an alerts integration lists them.
interface Alert {
  Event: string;
  Headline: string;
  Severity: 'Minor' | 'Moderate' | 'Severe' | 'Extreme';
}
const ALERT_HOURS = 6;
const QUIET_ALERT: Alert = {
  Event: 'Special Weather Statement',
  Headline: 'Gusty winds and a sharp change in temperature this evening.',
  Severity: 'Minor',
};
const CONDITION_ALERTS: Partial<Record<WeatherCondition, Alert>> = {
  [CONDITION.lightningRainy]: {
    Event: 'Severe Thunderstorm Warning',
    Headline: 'Storms with hail to an inch across and gusts to 60 mph are moving east at 30 mph.',
    Severity: 'Severe',
  },
  [CONDITION.lightning]: {
    Event: 'Red Flag Warning',
    Headline: 'Dry lightning, low humidity and gusty winds could spread fires quickly.',
    Severity: 'Severe',
  },
  [CONDITION.pouring]: {
    Event: 'Flood Watch',
    Headline: 'Two to three inches of rain could flood streams and low roads.',
    Severity: 'Moderate',
  },
  [CONDITION.rainy]: {
    Event: 'Flood Advisory',
    Headline: 'Ponding on roads and in poorly drained areas through the afternoon.',
    Severity: 'Minor',
  },
  [CONDITION.snowy]: {
    Event: 'Winter Storm Warning',
    Headline: 'Six to ten inches of snow, with travel very difficult tonight.',
    Severity: 'Severe',
  },
  [CONDITION.snowyRainy]: {
    Event: 'Winter Weather Advisory',
    Headline: 'Sleet and freezing rain will leave roads and walkways slippery.',
    Severity: 'Moderate',
  },
  [CONDITION.hail]: {
    Event: 'Severe Thunderstorm Warning',
    Headline: 'Hail the size of golf balls with these storms.',
    Severity: 'Severe',
  },
  [CONDITION.fog]: {
    Event: 'Dense Fog Advisory',
    Headline: 'Visibility a quarter mile or less until mid-morning.',
    Severity: 'Minor',
  },
  [CONDITION.windy]: {
    Event: 'Wind Advisory',
    Headline: 'Gusts to 50 mph could blow around loose objects.',
    Severity: 'Moderate',
  },
  [CONDITION.windyVariant]: {
    Event: 'High Wind Warning',
    Headline: 'Gusts to 65 mph could bring down trees and power lines.',
    Severity: 'Severe',
  },
};

export function alertState(condition: WeatherCondition, now: number): EntityState {
  const alert = CONDITION_ALERTS[condition] ?? QUIET_ALERT;
  return {
    entity_id: ALERTS,
    state: '1',
    attributes: {
      friendly_name: 'Weather alerts',
      Alerts: [{ ...alert, Ends: new Date(now + ALERT_HOURS * HOUR).toISOString() }],
    },
  };
}

// Everything the card reads of Home Assistant for one scene: the states, the forecasts and where
// and when it is.
export interface World {
  states: Record<string, EntityState>;
  forecasts: Partial<Record<ForecastType, ForecastEntry[]>>;
  config: HassConfig;
}

export interface Scene {
  weather: Weather;
  hour: number;
  units: Units;
}

// The sample weather for a scene, as an integration would send it.
export function sampleWorld({ weather, hour, units }: Scene, now: number): World {
  const hourly = hours(weather, hour, now),
    first = hourly[0],
    condition = atHour(weather.condition, hour),
    attributes = inUnits(
      {
        temperature: first?.temperature ?? weather.high,
        humidity: first?.humidity ?? weather.humidity,
        pressure: weather.pressure,
        wind_speed: weather.wind,
        wind_gust_speed: Math.round(weather.wind * GUST),
        wind_bearing: BEARING,
        visibility: weather.visibility,
        cloud_coverage: weather.cover,
        uv_index: first?.uv_index ?? 0,
      },
      units,
    );
  const states: Record<string, EntityState> = {
    [ENTITY]: {
      entity_id: ENTITY,
      state: condition,
      attributes: {
        ...attributes,
        ...UNIT_NAMES[units],
        friendly_name: PLACE.name,
        attribution: 'Sample weather for this page',
        supported_features: 3,
      },
    },
    'sun.sun': sunState(hour, now),
  };
  return {
    states,
    forecasts: {
      hourly: hourly.map(entry => inUnits(entry, units)),
      daily: daily(weather, hour, now).map(entry => inUnits(entry, units)),
    },
    config: {
      location_name: 'Home',
      time_zone: zoneAt(hour, now),
      latitude: PLACE.latitude,
      longitude: PLACE.longitude,
    },
  };
}

// The world with an alert in it, fit for its weather, or as it is.
export function withAlert(world: World, alert: boolean, now: number): World {
  if (!alert) return world;
  const state = world.states[ENTITY]?.state,
    condition = WEATHER_CONDITIONS.find(each => each === state) ?? CONDITION.exceptional;
  return { ...world, states: { ...world.states, [ALERTS]: alertState(condition, now) } };
}

// --- The card's settings ---------------------------------------------------------------------
export interface Choices {
  layout: WeatherLayout;
  alert: boolean;
}
export type CardSettings = Readonly<Record<string, string | readonly string[]>>;

// The settings the card is given, which are the ones shown as YAML. The page layout shows what the
// online services add, and alerts when there are some.
export function cardSettings({ layout, alert }: Choices): CardSettings {
  return {
    type: CARD_TYPE,
    entity: ENTITY,
    ...(layout === 'auto' ? {} : { weather_layout: layout }),
    ...(layout === 'page' ? { map: 'rainviewer', averages: 'open-meteo' } : {}),
    ...(layout === 'page' && alert ? { alert_entities: [ALERTS] } : {}),
  };
}

// Settings as a dashboard's YAML.
export function yaml(settings: CardSettings): string {
  return Object.entries(settings)
    .map(([key, value]) =>
      typeof value === 'string' ? `${key}: ${value}` : `${key}:\n${value.map(item => `  - ${item}`).join('\n')}`,
    )
    .join('\n');
}
