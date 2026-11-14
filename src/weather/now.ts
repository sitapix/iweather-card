import { isCloudAltitude, type EntityAttributes } from '../card/home-assistant.ts';
import { finite } from '../lib/values.ts';
import { HOUR } from '../lib/time.ts';
import { convertUnit, UNITS } from './units.ts';
import type { TimedEntry } from './forecast-items.ts';

// The weather now, as every tile, sheet and the sky read it. Integrations each leave different
// readings out, so each is taken from the first of these that has it:
// - the weather entity, or the sensor set for that reading (see withSensors);
// - the second weather entity (`forecast_entity`), in the first's units;
// - the forecast's hour under way, which holds the second entity's hours and Open-Meteo's too.
// A dew point the entity lacks is worked out from the temperature and humidity before the others
// are asked, when both come from the same place, so it agrees with the humidity shown beside it.
// A gust from elsewhere is no less than the wind now.
export const NOW_READINGS = [
  'temperature',
  'apparent_temperature',
  'humidity',
  'dew_point',
  'cloud_coverage',
  'uv_index',
  'pressure',
  'wind_speed',
  'wind_gust_speed',
  'wind_bearing',
  'visibility',
] as const;
export type NowReading = (typeof NOW_READINGS)[number];
export type NowSource = 'sensor' | 'entity' | 'second' | 'hour' | 'worked out';
export interface NowInputs {
  // The weather entity's attributes in the card's units, with any sensors' readings in them.
  entity: EntityAttributes;
  // The readings a sensor supplied (see sensorReadings).
  sensors: ReadonlySet<string>;
  // The second weather entity's attributes, in the first's units, while it is available.
  second: EntityAttributes | undefined;
  hour: TimedEntry | undefined;
}
export interface Now {
  attrs: EntityAttributes;
  // Where each reading came from, for those found anywhere.
  from: Partial<Record<NowReading, NowSource>>;
}

// What no reading can be, which integrations send to mean they have none: a share outside 0 to 100%
// (as −99), a negative UV index, or a gust of nothing in a wind.
const SHARES: ReadonlySet<string> = new Set(['humidity', 'cloud_coverage', 'precipitation_probability']),
  WHOLE = 100;
export function plausible(key: string, value: number, wind: unknown): boolean {
  if (SHARES.has(key)) return value >= 0 && value <= WHOLE;
  if (key === 'uv_index') return value >= 0;
  if (key === 'wind_gust_speed') return value > 0 || !finite(wind) || wind === 0;
  return true;
}
// A reading is there when it's a plausible number, or a bearing given as a compass point.
const holds = (key: NowReading, value: unknown, wind: unknown): value is number | string =>
  (finite(value) && plausible(key, value, wind)) ||
  (key === 'wind_bearing' && typeof value === 'string' && value !== '');

export function readingsNow({ entity, sensors, second, hour }: NowInputs): Now {
  const from: Now['from'] = {},
    // What is taken from elsewhere, by attribute.
    lent: Record<string, unknown> = {};
  const take = (key: NowReading, ownOnly = false) => {
    const places = [
      [entity, sensors.has(key) ? 'sensor' : 'entity'],
      [second, 'second'],
      [hour, 'hour'],
    ] as const;
    for (const [values, source] of ownOnly ? places.slice(0, 1) : places) {
      const value = values?.[key];
      if (!holds(key, value, values?.wind_speed)) continue;
      from[key] = source;
      if (source === 'second' || source === 'hour') lent[key] = value;
      return;
    }
    // Nothing has it: a value of the entity's that no reading can be goes.
    if (finite(entity[key])) lent[key] = undefined;
  };
  const now = (key: NowReading): unknown => (key in lent ? lent[key] : entity[key]);
  for (const key of NOW_READINGS) if (key !== 'dew_point') take(key);
  // The entity's own dew point, else one worked out from readings taken together, else another's.
  take('dew_point', true);
  const temperature = now('temperature'),
    humidity = now('humidity'),
    together = from.temperature !== undefined && from.temperature === from.humidity,
    worked =
      together && finite(temperature) && finite(humidity)
        ? dewPoint(temperature, humidity, entity.temperature_unit)
        : undefined;
  if (from.dew_point === undefined && worked !== undefined) {
    from.dew_point = 'worked out';
    lent['dew_point'] = worked;
  } else if (from.dew_point === undefined) take('dew_point');
  // Keep a reported cloud height and fill a missing one from the forecast hour.
  if (!isCloudAltitude(entity.cloud_altitude)) {
    const altitude = isCloudAltitude(second?.cloud_altitude) ? second.cloud_altitude : hour?.cloud_altitude;
    if (isCloudAltitude(altitude)) lent['cloud_altitude'] = altitude;
  }
  if (from.wind_gust_speed === 'second' || from.wind_gust_speed === 'hour') {
    const wind = now('wind_speed'),
      gust = now('wind_gust_speed');
    if (finite(wind) && finite(gust) && gust < wind) lent['wind_gust_speed'] = wind;
  }
  return { attrs: Object.keys(lent).length ? { ...entity, ...lent } : entity, from };
}

// The forecast's hour under way: the last to start by now, until the next one starts (three hours
// at most, for a forecast in steps of three), else one starting within the hour.
const LONGEST_STEP = 3 * HOUR;
export function hourUnderWay(hours: readonly TimedEntry[], now: number): TimedEntry | undefined {
  const at = hours.findLastIndex(entry => entry.time <= now),
    entry = hours[at],
    next = hours[at + 1];
  if (entry && now < entry.time + Math.min(next ? next.time - entry.time : HOUR, LONGEST_STEP)) return entry;
  return next && next.time - now <= HOUR ? next : undefined;
}

// The dew point from the temperature and relative humidity, to within about 0.35 °C from −45 °C to
// 60 °C. Below freezing it is still the dew point over water, as weather services report it.
const MAGNUS = { a: 17.62, b: 243.12 } as const,
  SATURATED = 100,
  TEMPERATURE_UNITS = new Set<string>([UNITS.celsius, UNITS.fahrenheit, UNITS.kelvin]);
export function dewPoint(temperature: number, humidity: number, unit: string | undefined): number | undefined {
  if (unit === undefined || !TEMPERATURE_UNITS.has(unit) || humidity <= 0) return undefined;
  const celsius = convertUnit('temperature_unit', temperature, unit, UNITS.celsius),
    gamma = Math.log(Math.min(humidity, SATURATED) / SATURATED) + (MAGNUS.a * celsius) / (MAGNUS.b + celsius);
  return convertUnit('temperature_unit', (MAGNUS.b * gamma) / (MAGNUS.a - gamma), UNITS.celsius, unit);
}
