import { finite } from '../lib/values.ts';
import {
  type WeatherCondition,
  isCondition,
  STATE,
  CONDITION,
  type EntityState,
  type ForecastEntry,
  SUN_ENTITY,
} from '../card/home-assistant.ts';
import { type Sun, forecasts } from './forecast-items.ts';
import { type SceneInputs, moonAltitude, moonHourAt, moonPhase, moonTilt, windMetersPerSecond } from '../sky/sky.ts';
import { hourUnderWay } from './now.ts';
import { solarHour } from '../sky/presets.ts';
import { convertUnit, UNITS } from './units.ts';
import { phrase, say } from './words.ts';
import { DAY, MINUTE } from '../lib/time.ts';
import { ELEVATION, solarElevation, sunEvents } from '../sky/sun.ts';

export const WEATHER_DEFAULTS = Object.freeze({
  weather_scene: true,
  weather_animation: true,
  weather_layout: 'auto',
  show_daily: true,
  forecast_days: 10,
  show_forecast: true,
  show_high_low: true,
  forecast_hours: 24,
  weather_mode: 'auto',
});

const CONDITION_LABELS: Readonly<Record<WeatherCondition, string>> = {
  'clear-night': phrase('Clear'),
  sunny: phrase('Sunny'),
  partlycloudy: phrase('Partly cloudy'),
  cloudy: phrase('Cloudy'),
  rainy: phrase('Rain'),
  pouring: phrase('Heavy rain'),
  snowy: phrase('Snow'),
  'snowy-rainy': phrase('Mixed rain and snow'),
  hail: phrase('Hail'),
  lightning: phrase('Thunderstorms'),
  'lightning-rainy': phrase('Thunderstorms'),
  fog: phrase('Fog'),
  windy: phrase('Windy'),
  'windy-variant': phrase('Windy'),
  exceptional: phrase('Exceptional conditions'),
};

// A condition of Home Assistant's, in words; one of an integration's own, as it is written; and an
// unknown one, none.
export function conditionLabel(condition: string): string {
  if (isCondition(condition)) return say(CONDITION_LABELS[condition]);
  if (noCondition(condition)) return '';
  return condition === STATE.unavailable ? say('Weather unavailable') : condition;
}
// An integration with no condition to give says so as unknown, or with nothing at all.
export const noCondition = (condition: string | undefined): boolean => condition === STATE.unknown || condition === '';

// An entity can be read unless Home Assistant says it can't. One with no condition still has its
// readings, when it has a temperature.
export const weatherAvailable = <S extends { state: string; attributes?: Readonly<Record<string, unknown>> }>(
  state: S | undefined,
): state is S =>
  state !== undefined &&
  state.state !== STATE.unavailable &&
  (!noCondition(state.state) || finite(state.attributes?.['temperature']));

// Night is when the sun is down, whatever the condition says: some integrations call a clear night
// sunny.
export function sceneCondition(
  state: { state: string } | undefined,
  sun: { state: string } | undefined,
): { condition: string; night: boolean } {
  const condition = weatherAvailable(state) ? state.state : STATE.unavailable;
  return {
    condition,
    night: condition === CONDITION.clearNight || sun?.state === STATE.belowHorizon,
  };
}

// A weather entity away from home needs its own Sun. Event times are kept until the next
// event, while elevation and direction follow the current moment. Near a pole the next
// crossing can be months away; the search stops after a year, including places with none.
const SUN_SEARCH_DAYS = 366,
  SUN_CACHE_LIMIT = 16;
interface SunSchedule {
  from: number;
  until: number;
  rising: number | undefined;
  setting: number | undefined;
  noon: number | undefined;
}
const sunSchedules = new Map<string, SunSchedule>();
export function sunAt(
  { latitude, longitude }: { latitude?: number | undefined; longitude?: number | undefined },
  now: number,
): EntityState | undefined {
  if (!finite(latitude) || !finite(longitude)) return undefined;
  const key = `${latitude}|${longitude}`;
  let schedule = sunSchedules.get(key);
  if (!schedule || now < schedule.from || now >= schedule.until) {
    let rising: number | undefined, setting: number | undefined, noon: number | undefined;
    for (let day = -1; day <= SUN_SEARCH_DAYS; day++) {
      const events = sunEvents(now + day * DAY, latitude, longitude);
      if (rising === undefined && events.sunrise !== null && events.sunrise > now) rising = events.sunrise;
      if (setting === undefined && events.sunset !== null && events.sunset > now) setting = events.sunset;
      if (noon === undefined && events.noon > now) noon = events.noon;
      if (rising !== undefined && setting !== undefined && noon !== undefined) break;
    }
    schedule = {
      from: now,
      until: Math.min(rising ?? Infinity, setting ?? Infinity, noon ?? now + DAY),
      rising,
      setting,
      noon,
    };
    if (sunSchedules.size >= SUN_CACHE_LIMIT) sunSchedules.clear();
    sunSchedules.set(key, schedule);
  }
  const elevation = solarElevation(now, latitude, longitude);
  return {
    entity_id: SUN_ENTITY,
    state: elevation > ELEVATION.daylight ? STATE.aboveHorizon : STATE.belowHorizon,
    attributes: {
      elevation,
      rising: solarElevation(now + MINUTE, latitude, longitude) > elevation,
      ...(schedule.rising === undefined ? {} : { next_rising: new Date(schedule.rising).toISOString() }),
      ...(schedule.setting === undefined ? {} : { next_setting: new Date(schedule.setting).toISOString() }),
      ...(schedule.noon === undefined ? {} : { next_noon: new Date(schedule.noon).toISOString() }),
    },
  };
}

// `state` has the readings now filled in (see readingsNow); `hourly` is the forecast, whose hour
// under way's amount tells drizzle from rain.
export function sceneInputs(
  state: Pick<EntityState, 'state' | 'attributes'> | undefined,
  sun: Sun | undefined,
  location: { latitude?: number | undefined; longitude?: number | undefined } = {},
  now = Date.now(),
  hourly: readonly ForecastEntry[] = [],
): SceneInputs {
  const attrs = state?.attributes,
    sunAttrs = sun?.attributes;
  const hour = hourUnderWay(forecasts(hourly), now),
    dewPoint = attrs?.dew_point;
  // Solar time places the sun on its path; the moon uses its own rise-to-set
  // progress on the same path, from its hour angle.
  const parse = (key: 'next_rising' | 'next_setting') => Date.parse(sunAttrs?.[key] ?? ''),
    moonNow = moonAltitude(now, location.latitude, location.longitude);
  const moonHour = finite(moonNow) && moonNow > 0 ? moonHourAt(now, location.latitude, location.longitude) : undefined;
  return {
    ...sceneCondition(state, sun),
    solarHour: solarHour(now, {
      nextRising: parse('next_rising'),
      nextSetting: parse('next_setting'),
      elevation: sunAttrs?.elevation,
      rising: sunAttrs?.rising !== false,
    }),
    moonHour,
    moonAltitude: moonNow,
    moonTilt: moonTilt(now, location.latitude, location.longitude),
    moonPhase: moonPhase(now),
    elevation: finite(sunAttrs?.elevation) ? sunAttrs.elevation : undefined,
    rising: sunAttrs?.rising !== false,
    cloudCover: finite(attrs?.cloud_coverage) ? attrs.cloud_coverage : undefined,
    cloudAltitude: attrs?.cloud_altitude,
    windSpeed: windMetersPerSecond(attrs?.wind_speed, attrs?.wind_speed_unit),
    precipitation: finite(attrs?.precipitation)
      ? attrs.precipitation
      : finite(hour?.precipitation)
        ? hour.precipitation
        : undefined,
    precipitationUnit: attrs?.precipitation_unit,
    // In °C and km, whatever the entity or the card displays, for the condition definitions.
    temperature: finite(attrs?.temperature)
      ? convertUnit('temperature_unit', attrs.temperature, attrs.temperature_unit, UNITS.celsius)
      : undefined,
    humidity: finite(attrs?.humidity) ? attrs.humidity : undefined,
    visibility: finite(attrs?.visibility)
      ? convertUnit('distance_unit', attrs.visibility, attrs.visibility_unit, UNITS.kilometers)
      : undefined,
    dewPoint: finite(dewPoint)
      ? convertUnit('temperature_unit', dewPoint, attrs?.temperature_unit, UNITS.celsius)
      : undefined,
  };
}
